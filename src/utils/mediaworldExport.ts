import * as XLSX from 'xlsx';
import { formatCents, toCents, parsePercentToRate, parseRate, applyRateCents, ceilToComma99 } from './pricing';

// Mediaworld template column structure (exact order from template)
const MEDIAWORLD_HEADERS_ITALIAN = [
  'SKU offerta',
  'ID Prodotto',
  'Tipo ID prodotto',
  'Descrizione offerta',
  'Descrizione interna offerta',
  "Prezzo dell'offerta",
  'Info aggiuntive prezzo offerta',
  "Quantità dell'offerta",
  'Avviso quantità minima',
  "Stato dell'offerta",
  'Data di inizio della disponibilità',
  'Data di conclusione della disponibilità',
  'Classe logistica',
  'Prezzo scontato',
  'Data di inizio dello sconto',
  'Data di termine dello sconto',
  'Tempo di preparazione della spedizione (in giorni)',
  'Aggiorna/Cancella',
  'Tipo di prezzo che verrà barrato quando verrà definito un prezzo scontato.',
  'Obbligo di ritiro RAEE',
  'Orario di cut-off (solo se la consegna il giorno successivo è abilitata)',
  'VAT Rate % (Turkey only)'
];

const MEDIAWORLD_HEADERS_TECHNICAL = [
  'sku',
  'product-id',
  'product-id-type',
  'description',
  'internal-description',
  'price',
  'price-additional-info',
  'quantity',
  'min-quantity-alert',
  'state',
  'available-start-date',
  'available-end-date',
  'logistic-class',
  'discount-price',
  'discount-start-date',
  'discount-end-date',
  'leadtime-to-ship',
  'update-delete',
  'strike-price-type',
  'mms-weee-take-back-obligation',
  'cut-off-time',
  'vat-rate'
];

interface MediaworldExportParams {
  processedData: any[];
  feeConfig: {
    feeDrev: number;
    feeMkt: number;
    shippingCost: number;
  };
  prepDays: number;
}

interface ValidationError {
  row: number;
  sku: string;
  field: string;
  reason: string;
}

export async function exportMediaworldCatalog({
  processedData,
  feeConfig,
  prepDays
}: MediaworldExportParams): Promise<{ 
  success: boolean; 
  error?: string; 
  rowCount?: number;
  validationErrors?: ValidationError[];
  skippedCount?: number;
}> {
  try {
    // Filter EAN data - same logic as EAN export
    const eanFilteredData = processedData.filter(record => record.EAN && record.EAN.length >= 12);
    
    if (eanFilteredData.length === 0) {
      return { success: false, error: 'Nessuna riga valida con EAN da esportare' };
    }
    
    // Validation arrays
    const validationErrors: ValidationError[] = [];
    let skippedCount = 0;

    // Load template from public folder
    const templateResponse = await fetch('/mediaworld-template.xlsx');
    if (!templateResponse.ok) {
      return { success: false, error: 'Template Mediaworld non trovato' };
    }
    
    const templateBuffer = await templateResponse.arrayBuffer();
    const templateWb = XLSX.read(templateBuffer, { type: 'array' });
    
    // Extract ReferenceData and Columns sheets from template
    const referenceDataSheet = templateWb.Sheets['ReferenceData'];
    const columnsSheet = templateWb.Sheets['Columns'];
    
    // Build data rows with mapping
    const dataRows: (string | number)[][] = [];
    
    // Row 1: Italian headers
    dataRows.push(MEDIAWORLD_HEADERS_ITALIAN);
    
    // Row 2: Technical codes
    dataRows.push(MEDIAWORLD_HEADERS_TECHNICAL);
    
    // Data rows with product mapping
    eanFilteredData.forEach((record, index) => {
      const rowErrors: string[] = [];
      const sku = record.ManufPartNr || '';
      const ean = record.EAN || '';
      
      // === VALIDATION: Required fields ===
      
      // 1. SKU offerta (ManufPartNr) - Required
      if (!sku || sku.trim() === '') {
        validationErrors.push({
          row: index + 1,
          sku: sku || 'N/A',
          field: 'SKU offerta',
          reason: 'ManufPartNr mancante o vuoto'
        });
        rowErrors.push('SKU mancante');
      } else if (sku.length > 40) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'SKU offerta',
          reason: `SKU troppo lungo (${sku.length} caratteri, max 40)`
        });
        rowErrors.push('SKU troppo lungo');
      } else if (sku.includes('/')) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'SKU offerta',
          reason: 'SKU contiene carattere "/" non accettato'
        });
        rowErrors.push('SKU contiene /');
      }
      
      // 2. ID Prodotto (EAN) - Required, must be 12-14 digits
      if (!ean || ean.trim() === '') {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'ID Prodotto',
          reason: 'EAN mancante o vuoto'
        });
        rowErrors.push('EAN mancante');
      } else if (!/^\d{12,14}$/.test(ean)) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'ID Prodotto',
          reason: `EAN non valido: "${ean}" (deve essere 12-14 cifre)`
        });
        rowErrors.push('EAN non valido');
      }
      
      // Calculate prices using the same logic as EAN export
      const hasBest = Number.isFinite(record.CustBestPrice) && record.CustBestPrice > 0;
      const hasListPrice = Number.isFinite(record.ListPrice) && record.ListPrice > 0;
      const surchargeValue = (Number.isFinite(record.Surcharge) && record.Surcharge >= 0) ? record.Surcharge : 0;
      
      let baseCents = 0;
      
      if (hasBest) {
        baseCents = Math.round((record.CustBestPrice + surchargeValue) * 100);
      } else if (hasListPrice) {
        baseCents = Math.round(record.ListPrice * 100);
      }
      
      // 3. Price validation - must have valid base price
      if (baseCents === 0) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'Prezzo',
          reason: 'Nessun prezzo valido (CustBestPrice o ListPrice)'
        });
        rowErrors.push('Prezzo mancante');
      }
      
      // 4. Quantity validation - must be positive integer
      const quantity = record.ExistingStock;
      if (!Number.isFinite(quantity) || quantity < 0) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'Quantità',
          reason: `Quantità non valida: ${quantity}`
        });
        rowErrors.push('Quantità non valida');
      }
      
      // Skip rows with critical errors
      if (rowErrors.length > 0) {
        skippedCount++;
        return;
      }
      
      const shipC = toCents(feeConfig.shippingCost);
      const ivaR = parsePercentToRate(22, 22);
      const feeDR = parseRate(record.FeeDeRev, 1.05);
      const feeMP = parseRate(record['Fee Marketplace'], 1.07);
      
      const afterShippingCents = baseCents + shipC;
      const ivatoCents = applyRateCents(afterShippingCents, ivaR);
      const withFeDR = applyRateCents(ivatoCents, feeDR);
      const subtotalCents = applyRateCents(withFeDR, feeMP);
      const prezzoFinaleCents = ceilToComma99(subtotalCents);
      
      // Calculate ListPrice con Fee (same logic)
      const listC = toCents(record.ListPrice);
      const baseListCents = listC + shipC;
      const ivatoListCents = applyRateCents(baseListCents, ivaR);
      const withFeDRList = applyRateCents(ivatoListCents, feeDR);
      const subtotalListCents = applyRateCents(withFeDRList, feeMP);
      let listPriceConFeeInt = Math.ceil(subtotalListCents / 100);
      
      // Override rule for ListPrice con Fee
      const normListPrice = record.ListPrice !== null && record.ListPrice !== undefined && record.ListPrice !== '' 
        ? parseFloat(String(record.ListPrice).replace(',', '.')) 
        : null;
      const normCustBestPrice = record.CustBestPrice !== null && record.CustBestPrice !== undefined 
        ? parseFloat(String(record.CustBestPrice).replace(',', '.')) 
        : null;
      
      const shouldOverride = normListPrice === null || 
                             normListPrice === 0 || 
                             isNaN(normListPrice) ||
                             (normCustBestPrice !== null && !isNaN(normCustBestPrice) && normListPrice < normCustBestPrice);
      
      if (shouldOverride && normCustBestPrice !== null && !isNaN(normCustBestPrice)) {
        const base = normCustBestPrice * 1.25;
        const candidato = ((base + feeConfig.shippingCost) * 1.22) * feeConfig.feeDrev * feeConfig.feeMkt;
        const candidato_ceil = Math.ceil(candidato);
        const minimo_consentito = Math.ceil((prezzoFinaleCents / 100) * 1.25);
        listPriceConFeeInt = Math.max(candidato_ceil, minimo_consentito);
      }
      
      // 5. Final price validation - must end with ,99
      const prezzoFinaleFormatted = formatCents(prezzoFinaleCents);
      if (!/^\d+,99$/.test(prezzoFinaleFormatted)) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'Prezzo scontato',
          reason: `Prezzo finale non termina con ,99: "${prezzoFinaleFormatted}"`
        });
        // This is a warning, don't skip the row
      }
      
      // 6. ListPrice con Fee validation - must be positive
      if (!Number.isFinite(listPriceConFeeInt) || listPriceConFeeInt <= 0) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: "Prezzo dell'offerta",
          reason: `ListPrice con Fee non valido: ${listPriceConFeeInt}`
        });
        skippedCount++;
        return;
      }
      
      // 7. Price range validation (between 1€ and 100000€)
      if (prezzoFinaleCents < 100 || prezzoFinaleCents > 10000000) {
        validationErrors.push({
          row: index + 1,
          sku,
          field: 'Prezzo scontato',
          reason: `Prezzo finale fuori range (${prezzoFinaleFormatted}): deve essere tra 1€ e 100000€`
        });
        skippedCount++;
        return;
      }
      
      // Build row according to mapping
      const row: (string | number)[] = [
        record.ManufPartNr || '',                    // SKU offerta → ManufPartNr
        record.EAN || '',                            // ID Prodotto → EAN normalizzato
        'EAN',                                       // Tipo ID prodotto → "EAN" (fixed)
        record.ShortDescription || '',               // Descrizione offerta → ShortDescription
        '',                                          // Descrizione interna offerta → vuoto
        listPriceConFeeInt,                          // Prezzo dell'offerta → "ListPrice con Fee"
        '',                                          // Info aggiuntive prezzo offerta → vuoto
        record.ExistingStock || 0,                   // Quantità dell'offerta → ExistingStock
        '',                                          // Avviso quantità minima → vuoto
        'Nuovo',                                     // Stato dell'offerta → "Nuovo" (fixed)
        '',                                          // Data inizio disponibilità → vuoto
        '',                                          // Data fine disponibilità → vuoto
        'Consegna gratuita',                         // Classe logistica → "Consegna gratuita"
        prezzoFinaleFormatted,                       // Prezzo scontato → "Prezzo Finale"
        '',                                          // Data inizio sconto → vuoto
        '',                                          // Data fine sconto → vuoto
        prepDays,                                    // Tempo di preparazione spedizione → user input
        '',                                          // Aggiorna/Cancella → vuoto
        'recommended-retail-price',                  // Tipo prezzo barrato → "recommended-retail-price" (fixed)
        '',                                          // Obbligo ritiro RAEE → vuoto
        '',                                          // Orario cut-off → vuoto
        ''                                           // VAT Rate % (Turkey only) → vuoto
      ];
      
      dataRows.push(row);
    });
    
    // Check if we have valid data rows after validation
    const validRowCount = dataRows.length - 2; // Exclude header rows
    
    if (validRowCount === 0) {
      return { 
        success: false, 
        error: `Nessuna riga valida dopo la validazione. ${skippedCount} righe scartate.`,
        validationErrors,
        skippedCount
      };
    }
    
    // Log validation summary
    if (validationErrors.length > 0) {
      console.warn('Mediaworld export validation:', {
        totalInput: eanFilteredData.length,
        validOutput: validRowCount,
        skipped: skippedCount,
        errors: validationErrors.length
      });
    }
    
    // Create new workbook with 3 sheets
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Data
    const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
    
    // Force ID Prodotto (column B) to text format to preserve leading zeros
    if (dataSheet['!ref']) {
      const range = XLSX.utils.decode_range(dataSheet['!ref']);
      const eanCol = 1; // Column B (ID Prodotto)
      
      for (let R = 2; R <= range.e.r; R++) { // Start from row 3 (index 2)
        const addr = XLSX.utils.encode_cell({ r: R, c: eanCol });
        const cell = dataSheet[addr];
        if (cell) {
          cell.v = (cell.v ?? '').toString();
          cell.t = 's';
          cell.z = '@';
          dataSheet[addr] = cell;
        }
      }
      
      // Force Prezzo scontato (column N, index 13) to text format
      const prezzoScontatoCol = 13;
      for (let R = 2; R <= range.e.r; R++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: prezzoScontatoCol });
        const cell = dataSheet[addr];
        if (cell) {
          cell.v = (cell.v ?? '').toString();
          cell.t = 's';
          cell.z = '@';
          dataSheet[addr] = cell;
        }
      }
    }
    
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Data');
    
    // Sheet 2: ReferenceData (copy from template)
    if (referenceDataSheet) {
      XLSX.utils.book_append_sheet(wb, referenceDataSheet, 'ReferenceData');
    } else {
      // Create empty ReferenceData if not found
      const emptyRefSheet = XLSX.utils.aoa_to_sheet([['ReferenceData']]);
      XLSX.utils.book_append_sheet(wb, emptyRefSheet, 'ReferenceData');
    }
    
    // Sheet 3: Columns (copy from template)
    if (columnsSheet) {
      XLSX.utils.book_append_sheet(wb, columnsSheet, 'Columns');
    } else {
      // Create empty Columns if not found
      const emptyColSheet = XLSX.utils.aoa_to_sheet([['Columns']]);
      XLSX.utils.book_append_sheet(wb, emptyColSheet, 'Columns');
    }
    
    // Serialize to ArrayBuffer
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    if (!wbout || wbout.length === 0) {
      return { success: false, error: 'Buffer vuoto durante la generazione del file' };
    }
    
    // Create blob and download
    const blob = new Blob([wbout], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    const url = URL.createObjectURL(blob);
    
    // Generate filename with timestamp YYYYMMDD
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `mediaworld-offers-${dateStamp}.xlsx`;
    
    // Create anchor and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Delay URL revocation
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    
    return { 
      success: true, 
      rowCount: validRowCount,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      skippedCount: skippedCount > 0 ? skippedCount : undefined
    };
    
  } catch (error) {
    console.error('Errore export Mediaworld:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto durante export',
      validationErrors: []
    };
  }
}
