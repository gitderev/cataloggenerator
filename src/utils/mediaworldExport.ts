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

export async function exportMediaworldCatalog({
  processedData,
  feeConfig,
  prepDays
}: MediaworldExportParams): Promise<{ success: boolean; error?: string; rowCount?: number }> {
  try {
    // Filter EAN data - same logic as EAN export
    const eanFilteredData = processedData.filter(record => record.EAN && record.EAN.length >= 12);
    
    if (eanFilteredData.length === 0) {
      return { success: false, error: 'Nessuna riga valida con EAN da esportare' };
    }

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
    eanFilteredData.forEach((record) => {
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
      
      // Skip rows with no valid price
      if (baseCents === 0) return;
      
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
      
      // Format Prezzo Finale with comma decimal (e.g., "34,99")
      const prezzoFinaleFormatted = formatCents(prezzoFinaleCents);
      
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
      rowCount: dataRows.length - 2 // Exclude header rows
    };
    
  } catch (error) {
    console.error('Errore export Mediaworld:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto durante export' 
    };
  }
}
