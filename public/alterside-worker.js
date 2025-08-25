// alterside-worker.js - Advanced processing for Alterside Catalog Generator
import Papa from 'papaparse';

interface FileData {
  name: string;
  data: any[];
  headers: string[];
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
  'Costo di spedizione': number;
  'Fee Mediaworld': string;
  'Fee Alterside': string;
  'Prezzo finale': number;
  'Prezzo finale Listino': number;
}

interface LogEntry {
  source_file: string;
  line: number;
  Matnr: string;
  ManufPartNr: string;
  EAN: string;
  reason: string;
  details: string;
}

interface ProcessingProgress {
  stage: string;
  progress: number;
  currentFile?: string;
  recordsProcessed?: number;
  totalRecords?: number;
}

// Helper functions
function roundHalfUp(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function ceilToXX99(num) {
  const floored = Math.floor(num);
  return floored + 0.99;
}

function isNumeric(value) {
  return !isNaN(parseFloat(value)) && isFinite(value);
}

self.onmessage = function(e) {
  const { files } = e.data;
  
  try {
    processFiles(files);
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Errore sconosciuto durante l\'elaborazione'
    });
  }
};

function processFiles(files) {
  const logsEAN = [];
  const logsManufPartNr = [];
  const processedEAN = [];
  const processedManufPartNr = [];
  
  // Progress tracking
  const updateProgress = (stage, progress, extra = {}) => {
    self.postMessage({
      type: 'progress',
      stage,
      progress,
      ...extra
    });
  };

  updateProgress('Inizializzazione', 5);

  // Check for missing optional headers and log them
  const stockHeaders = files.stock.headers || [];
  const priceHeaders = files.price.headers || [];
  
  if (!stockHeaders.includes('ManufPartNr')) {
    const headerMissingLog = {
      source_file: 'StockFileData_790813.txt',
      line: '',
      Matnr: '',
      ManufPartNr: '',
      EAN: '',
      reason: 'header_optional_missing',
      details: 'ManufPartNr assente (uso ManufPartNr da Material)'
    };
    logsEAN.push(headerMissingLog);
    logsManufPartNr.push(headerMissingLog);
  }
  
  if (!priceHeaders.includes('ManufPartNr')) {
    const headerMissingLog = {
      source_file: 'pricefileData_790813.txt',
      line: '',
      Matnr: '',
      ManufPartNr: '',
      EAN: '',
      reason: 'header_optional_missing',
      details: 'ManufPartNr assente (uso ManufPartNr da Material)'
    };
    logsEAN.push(headerMissingLog);
    logsManufPartNr.push(headerMissingLog);
  }

  // Create lookup maps for performance
  const stockMap = new Map();
  const priceMap = new Map();
  
  // Track duplicates
  const stockDuplicates = new Set();
  const priceDuplicates = new Set();

  updateProgress('Creazione indici stock', 15);
  
  // Build stock map and detect duplicates
  files.stock.data.forEach((record, index) => {
    const matnr = record.Matnr?.toString().trim();
    if (matnr) {
      if (stockMap.has(matnr)) {
        stockDuplicates.add(matnr);
        const duplicateLog = {
          source_file: 'StockFileData',
          line: index + 2,
          Matnr: matnr,
          ManufPartNr: record.ManufPartNr || '',
          EAN: record.EAN || '',
          reason: 'duplicate_matnr_stock',
          details: 'Matnr duplicato nel file stock - mantenuto il primo'
        };
        logsEAN.push(duplicateLog);
        logsManufPartNr.push(duplicateLog);
      } else {
        stockMap.set(matnr, record);
      }
    }
  });

  updateProgress('Creazione indici prezzi', 25);
  
  // Build price map and detect duplicates
  files.price.data.forEach((record, index) => {
    const matnr = record.Matnr?.toString().trim();
    if (matnr) {
      if (priceMap.has(matnr)) {
        priceDuplicates.add(matnr);
        const duplicateLog = {
          source_file: 'pricefileData',
          line: index + 2,
          Matnr: matnr,
          ManufPartNr: record.ManufPartNr || '',
          EAN: record.EAN || '',
          reason: 'duplicate_matnr_price',
          details: 'Matnr duplicato nel file prezzi - mantenuto il primo'
        };
        logsEAN.push(duplicateLog);
        logsManufPartNr.push(duplicateLog);
      } else {
        priceMap.set(matnr, record);
      }
    }
  });

  updateProgress('Elaborazione record principali', 35);

  const totalMaterialRecords = files.material.data.length;
  
  // Process material records (base for left join)
  files.material.data.forEach((materialRecord, index) => {
    const progress = 35 + Math.floor((index / totalMaterialRecords) * 50);
    if (index % 100 === 0) {
      updateProgress('Elaborazione record', progress, {
        recordsProcessed: index,
        totalRecords: totalMaterialRecords
      });
    }

    const matnr = materialRecord.Matnr?.toString().trim();
    if (!matnr) {
      const emptyMatnrLog = {
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: '',
        ManufPartNr: materialRecord.ManufPartNr || '',
        EAN: materialRecord.EAN || '',
        reason: 'matnr_empty',
        details: 'Codice materiale mancante'
      };
      logsEAN.push(emptyMatnrLog);
      logsManufPartNr.push(emptyMatnrLog);
      return;
    }

    // Get related records
    const stockRecord = stockMap.get(matnr);
    const priceRecord = priceMap.get(matnr);

    // Check for missing joins
    if (!stockRecord) {
      const missingStockLog = {
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: materialRecord.ManufPartNr || '',
        EAN: materialRecord.EAN || '',
        reason: 'join_missing_stock',
        details: 'Matnr non trovato nel file stock'
      };
      logsEAN.push(missingStockLog);
      logsManufPartNr.push(missingStockLog);
      return;
    }

    if (!priceRecord) {
      const missingPriceLog = {
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: materialRecord.ManufPartNr || '',
        EAN: materialRecord.EAN || '',
        reason: 'join_missing_price',
        details: 'Matnr non trovato nel file prezzi'
      };
      logsEAN.push(missingPriceLog);
      logsManufPartNr.push(missingPriceLog);
      return;
    }

    // Combine data
    const combined = {
      ...materialRecord,
      ...stockRecord,
      ...priceRecord
    };

    // Common filters
    const existingStock = combined.ExistingStock;
    if (!isNumeric(existingStock) || parseFloat(existingStock) <= 1) {
      const stockLog = {
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: combined.ManufPartNr || '',
        EAN: combined.EAN || '',
        reason: 'stock_leq_1',
        details: `ExistingStock: ${existingStock} (deve essere > 1)`
      };
      logsEAN.push(stockLog);
      logsManufPartNr.push(stockLog);
      return;
    }

    const listPrice = combined.ListPrice;
    if (!isNumeric(listPrice)) {
      const priceLog = {
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: combined.ManufPartNr || '',
        EAN: combined.EAN || '',
        reason: 'price_missing',
        details: `ListPrice: ${listPrice} (deve essere numerico)`
      };
      logsEAN.push(priceLog);
      logsManufPartNr.push(priceLog);
      return;
    }

    const custBestPrice = combined.CustBestPrice;
    if (!custBestPrice || custBestPrice.toString().trim() === '' || !isNumeric(custBestPrice)) {
      const custLog = {
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: combined.ManufPartNr || '',
        EAN: combined.EAN || '',
        reason: 'custbest_missing',
        details: `CustBestPrice: ${custBestPrice} (deve essere presente e numerico)`
      };
      logsEAN.push(custLog);
      logsManufPartNr.push(custLog);
      return;
    }

    // Calculate prices according to specifications
    const custBestPriceCeil = Math.ceil(parseFloat(custBestPrice));
    const listPriceNum = parseFloat(listPrice);
    
    // IVA calculations
    const listPriceWithIVA = roundHalfUp(listPriceNum * 1.22);
    const custBestPriceWithIVA = roundHalfUp(custBestPriceCeil * 1.22);
    
    // Final price calculations
    // From CustBestPrice: ((((CustBestPrice_ceil × 1,22) + 5) × 1,08) × 1,05) with ceil to xx,99
    const finalPriceBest = ceilToXX99(((custBestPriceWithIVA + 5) * 1.08) * 1.05);
    
    // From ListPrice: ceil(((ListPrice × 1,22) + 5) × 1,08) × 1,05)
    const finalPriceListino = Math.ceil(((listPriceWithIVA + 5) * 1.08) * 1.05);

    // Create base record - always use ManufPartNr from Material only
    const baseRecord = {
      Matnr: matnr,
      ManufPartNr: materialRecord.ManufPartNr || '',
      EAN: materialRecord.EAN?.toString().trim() || '',
      ShortDescription: materialRecord.ShortDescription || '',
      ExistingStock: parseInt(existingStock),
      ListPrice: listPriceNum,
      CustBestPrice: custBestPriceCeil,
      IVA: '22%',
      'ListPrice con IVA': listPriceWithIVA,
      'CustBestPrice con IVA': custBestPriceWithIVA,
      'Costo di spedizione': 5,
      'Fee Mediaworld': '8%',
      'Fee Alterside': '5%',
      'Prezzo finale': finalPriceBest,
      'Prezzo finale Listino': finalPriceListino
    };

    // EAN export filter
    const ean = baseRecord.EAN;
    if (!ean) {
      logsEAN.push({
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: baseRecord.ManufPartNr,
        EAN: '',
        reason: 'ean_empty',
        details: 'Campo EAN mancante o vuoto per export EAN'
      });
    } else {
      processedEAN.push(baseRecord);
    }

    // ManufPartNr export filter
    const manufPartNr = baseRecord.ManufPartNr;
    if (!manufPartNr) {
      logsManufPartNr.push({
        source_file: 'MaterialFile',
        line: index + 2,
        Matnr: matnr,
        ManufPartNr: '',
        EAN: baseRecord.EAN,
        reason: 'manufpartnr_empty',
        details: 'Campo ManufPartNr mancante o vuoto per export ManufPartNr'
      });
    } else {
      processedManufPartNr.push(baseRecord);
    }
  });

  updateProgress('Finalizzazione', 95);

  // Add session info to logs
  const sessionInfo = {
    source_file: 'session',
    line: 0,
    Matnr: '',
    ManufPartNr: '',
    EAN: '',
    reason: 'session_start',
    details: JSON.stringify({
      event: 'session_start',
      materialRowsCount: files.material.data.length,
      optionalHeadersMissing: {
        stock: !stockHeaders.includes('ManufPartNr'),
        price: !priceHeaders.includes('ManufPartNr')
      },
      fees: { mediaworld: 0.08, alterside: 0.05 },
      timestamp: new Date().toISOString()
    })
  };
  
  // Insert session info at the beginning of logs
  logsEAN.unshift(sessionInfo);
  logsManufPartNr.unshift(sessionInfo);

  // Calculate statistics
  const stats = {
    totalRecords: files.material.data.length,
    validRecordsEAN: processedEAN.length,
    validRecordsManufPartNr: processedManufPartNr.length,
    filteredRecordsEAN: logsEAN.length - 1, // Subtract session info
    filteredRecordsManufPartNr: logsManufPartNr.length - 1, // Subtract session info
    stockDuplicates: stockDuplicates.size,
    priceDuplicates: priceDuplicates.size
  };

  updateProgress('Completato', 100);

  // Send results
  self.postMessage({
    type: 'complete',
    processedDataEAN: processedEAN,
    processedDataManufPartNr: processedManufPartNr,
    logEntriesEAN: logsEAN,
    logEntriesManufPartNr: logsManufPartNr,
    stats
  });
}