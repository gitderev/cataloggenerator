import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MaterialRecord {
  Matnr: string;
  ManufPartNr: string;
  EAN: string;
  ShortDescription: string;
}

interface StockRecord {
  Matnr: string;
  ManufPartNr: string;
  ExistingStock: number;
}

interface PriceRecord {
  Matnr: string;
  ManufPartNr: string;
  ListPrice: number;
  CustBestPrice: number;
}

interface ProcessedRecord {
  Matnr: string;
  ManufPartNr: string;
  EAN: string;
  ShortDescription: string;
  ExistingStock: number;
  ListPrice: number;
  CustBestPrice: number;
  IVA: string;
  'ListPrice con IVA': number;
  'CustBestPrice con IVA': number;
}

interface LogEntry {
  source_file: string;
  line_number?: number;
  Matnr: string;
  ManufPartNr: string;
  EAN: string;
  reason: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action } = await req.json()
    
    if (action === 'process-catalog') {
      return await processCatalog()
    }
    
    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  } catch (error) {
    console.error('Error in catalog processor:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function processCatalog() {
  const startTime = Date.now()
  const logs: LogEntry[] = []
  const counters = {
    materialRows: 0,
    stockRows: 0,
    priceRows: 0,
    finalRows: 0,
    duplicateMatnr: 0,
    emptyEAN: 0,
    invalidStock: 0,
    missingPrices: 0,
    joinMissing: 0
  }

  try {
    // Get FTP credentials from environment
    const ftpHost = Deno.env.get('FTP_HOST')
    const ftpUser = Deno.env.get('FTP_USER')
    const ftpPass = Deno.env.get('FTP_PASS')
    const ftpPassive = Deno.env.get('FTP_PASSIVE') !== 'false'

    if (!ftpHost || !ftpUser || !ftpPass) {
      throw new Error('Missing FTP credentials in environment variables')
    }

    // Download files from FTP
    const materialData = await downloadAndParseFTPFile(ftpHost, ftpUser, ftpPass, ftpPassive, 'MaterialFile.txt')
    const stockData = await downloadAndParseFTPFile(ftpHost, ftpUser, ftpPass, ftpPassive, 'StockFileData_790813.txt')
    const priceData = await downloadAndParseFTPFile(ftpHost, ftpUser, ftpPass, ftpPassive, 'pricefileData_790813.txt')

    // Parse and process data
    const { records: materialRecords, duplicates: matDuplicates } = parseAndDeduplicateMaterial(materialData, logs)
    const { records: stockRecords, duplicates: stockDuplicates } = parseAndDeduplicateStock(stockData, logs)
    const { records: priceRecords, duplicates: priceDuplicates } = parseAndDeduplicatePrice(priceData, logs)

    counters.materialRows = materialRecords.length
    counters.stockRows = stockRecords.length
    counters.priceRows = priceRecords.length
    counters.duplicateMatnr = matDuplicates + stockDuplicates + priceDuplicates

    // Create lookup maps
    const stockMap = new Map<string, StockRecord>()
    const priceMap = new Map<string, PriceRecord>()

    stockRecords.forEach(record => stockMap.set(record.Matnr, record))
    priceRecords.forEach(record => priceMap.set(record.Matnr, record))

    // Process and join data
    const processedRecords: ProcessedRecord[] = []

    for (const materialRecord of materialRecords) {
      const stockRecord = stockMap.get(materialRecord.Matnr)
      const priceRecord = priceMap.get(materialRecord.Matnr)

      // Check if join is possible
      if (!stockRecord || !priceRecord) {
        logs.push({
          source_file: 'JOIN',
          Matnr: materialRecord.Matnr,
          ManufPartNr: materialRecord.ManufPartNr,
          EAN: materialRecord.EAN,
          reason: `Join mancante: ${!stockRecord ? 'Stock' : ''} ${!priceRecord ? 'Price' : ''}`
        })
        counters.joinMissing++
        continue
      }

      // Apply filters
      if (!materialRecord.EAN || materialRecord.EAN.trim() === '') {
        logs.push({
          source_file: 'MaterialFile.txt',
          Matnr: materialRecord.Matnr,
          ManufPartNr: materialRecord.ManufPartNr,
          EAN: materialRecord.EAN,
          reason: 'EAN vuoto'
        })
        counters.emptyEAN++
        continue
      }

      if (stockRecord.ExistingStock <= 0) {
        logs.push({
          source_file: 'StockFileData_790813.txt',
          Matnr: materialRecord.Matnr,
          ManufPartNr: materialRecord.ManufPartNr,
          EAN: materialRecord.EAN,
          reason: `ExistingStock non valido: ${stockRecord.ExistingStock}`
        })
        counters.invalidStock++
        continue
      }

      if (!priceRecord.ListPrice || !priceRecord.CustBestPrice) {
        logs.push({
          source_file: 'pricefileData_790813.txt',
          Matnr: materialRecord.Matnr,
          ManufPartNr: materialRecord.ManufPartNr,
          EAN: materialRecord.EAN,
          reason: 'Prezzi mancanti'
        })
        counters.missingPrices++
        continue
      }

      // Calculate VAT and prices with VAT
      const listPriceWithVAT = Math.round(priceRecord.ListPrice * 1.22 * 100) / 100
      const custBestPriceWithVAT = Math.round(priceRecord.CustBestPrice * 1.22 * 100) / 100

      processedRecords.push({
        Matnr: materialRecord.Matnr,
        ManufPartNr: materialRecord.ManufPartNr,
        EAN: materialRecord.EAN,
        ShortDescription: materialRecord.ShortDescription,
        ExistingStock: Math.floor(stockRecord.ExistingStock),
        ListPrice: priceRecord.ListPrice,
        CustBestPrice: priceRecord.CustBestPrice,
        IVA: '22%',
        'ListPrice con IVA': listPriceWithVAT,
        'CustBestPrice con IVA': custBestPriceWithVAT
      })
    }

    counters.finalRows = processedRecords.length
    const endTime = Date.now()
    const duration = endTime - startTime

    // Generate timestamp for files
    const now = new Date()
    const timezone = 'Europe/Rome'
    const timestamp = formatTimestamp(now, timezone)
    const dateOnly = formatDateOnly(now, timezone)

    return new Response(
      JSON.stringify({
        success: true,
        data: processedRecords.slice(0, 10), // Preview first 10 rows
        totalRows: processedRecords.length,
        counters,
        logs,
        duration,
        timestamp,
        dateOnly,
        fullData: processedRecords // For Excel generation
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Processing error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        logs,
        counters 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

async function downloadAndParseFTPFile(host: string, user: string, pass: string, passive: boolean, filename: string): Promise<string[]> {
  // Since Deno doesn't have native FTP support, we'll simulate this for now
  // In a real implementation, you would use an FTP library
  
  // For demonstration, return mock data that matches the expected format
  if (filename === 'MaterialFile.txt') {
    return [
      'Matnr;ManufPartNr;EAN;ShortDescription',
      '12345;MPN001;1234567890123;Test Product 1',
      '12346;MPN002;1234567890124;Test Product 2'
    ]
  } else if (filename === 'StockFileData_790813.txt') {
    return [
      'Matnr;ManufPartNr;ExistingStock',
      '12345;MPN001;10',
      '12346;MPN002;5'
    ]
  } else if (filename === 'pricefileData_790813.txt') {
    return [
      'Matnr;ManufPartNr;ListPrice;CustBestPrice',
      '12345;MPN001;100,50;95,25',
      '12346;MPN002;200,00;190,00'
    ]
  }
  
  throw new Error(`File not found: ${filename}`)
}

function parseAndDeduplicateMaterial(lines: string[], logs: LogEntry[]) {
  const records: MaterialRecord[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (let i = 1; i < lines.length; i++) { // Skip header
    const parts = lines[i].split(';').map(p => p.trim())
    if (parts.length < 4) continue

    const matnr = parts[0]
    if (seen.has(matnr)) {
      logs.push({
        source_file: 'MaterialFile.txt',
        line_number: i + 1,
        Matnr: matnr,
        ManufPartNr: parts[1] || '',
        EAN: parts[2] || '',
        reason: 'Duplicato Matnr'
      })
      duplicates++
      continue
    }

    seen.add(matnr)
    records.push({
      Matnr: matnr,
      ManufPartNr: parts[1] || '',
      EAN: parts[2] || '',
      ShortDescription: parts[3] || ''
    })
  }

  return { records, duplicates }
}

function parseAndDeduplicateStock(lines: string[], logs: LogEntry[]) {
  const records: StockRecord[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (let i = 1; i < lines.length; i++) { // Skip header
    const parts = lines[i].split(';').map(p => p.trim())
    if (parts.length < 3) continue

    const matnr = parts[0]
    if (seen.has(matnr)) {
      logs.push({
        source_file: 'StockFileData_790813.txt',
        line_number: i + 1,
        Matnr: matnr,
        ManufPartNr: parts[1] || '',
        EAN: '',
        reason: 'Duplicato Matnr'
      })
      duplicates++
      continue
    }

    const stockStr = parts[2].replace(',', '.')
    const stock = parseFloat(stockStr)
    
    if (isNaN(stock)) {
      logs.push({
        source_file: 'StockFileData_790813.txt',
        line_number: i + 1,
        Matnr: matnr,
        ManufPartNr: parts[1] || '',
        EAN: '',
        reason: 'ExistingStock non numerico'
      })
      continue
    }

    seen.add(matnr)
    records.push({
      Matnr: matnr,
      ManufPartNr: parts[1] || '',
      ExistingStock: stock
    })
  }

  return { records, duplicates }
}

function parseAndDeduplicatePrice(lines: string[], logs: LogEntry[]) {
  const records: PriceRecord[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (let i = 1; i < lines.length; i++) { // Skip header
    const parts = lines[i].split(';').map(p => p.trim())
    if (parts.length < 4) continue

    const matnr = parts[0]
    if (seen.has(matnr)) {
      logs.push({
        source_file: 'pricefileData_790813.txt',
        line_number: i + 1,
        Matnr: matnr,
        ManufPartNr: parts[1] || '',
        EAN: '',
        reason: 'Duplicato Matnr'
      })
      duplicates++
      continue
    }

    const listPriceStr = parts[2].replace(',', '.')
    const custBestPriceStr = parts[3].replace(',', '.')
    
    const listPrice = parseFloat(listPriceStr)
    const custBestPrice = parseFloat(custBestPriceStr)
    
    if (isNaN(listPrice) || isNaN(custBestPrice)) {
      logs.push({
        source_file: 'pricefileData_790813.txt',
        line_number: i + 1,
        Matnr: matnr,
        ManufPartNr: parts[1] || '',
        EAN: '',
        reason: 'Prezzi non numerici'
      })
      continue
    }

    seen.add(matnr)
    records.push({
      Matnr: matnr,
      ManufPartNr: parts[1] || '',
      ListPrice: listPrice,
      CustBestPrice: custBestPrice
    })
  }

  return { records, duplicates }
}

function formatTimestamp(date: Date, timezone: string): string {
  // Simple format for filename: YYYYMMDD_HHMM
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  
  return `${year}${month}${day}_${hours}${minutes}`
}

function formatDateOnly(date: Date, timezone: string): string {
  // Format for Excel sheet name: YYYY-MM-DD
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  
  return `${year}-${month}-${day}`
}