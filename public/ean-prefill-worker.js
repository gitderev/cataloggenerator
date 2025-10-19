// Web Worker for EAN Pre-fill processing
self.onmessage = function(e) {
  const { mappingText, materialData, counters } = e.data;
  
  try {
    // Parse mapping file
    const lines = mappingText.split('\n');
    
    // Validate header
    const header = lines[0]?.trim();
    if (header !== 'mpn;ean') {
      self.postMessage({
        error: true,
        message: 'Header richiesto: mpn;ean'
      });
      return;
    }
    
    // Build mapping map
    const mappingMap = new Map();
    const reports = {
      duplicate_mpn_rows: [],
      empty_ean_rows: [],
      errori_formali: []
    };
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      
      const parts = line.split(';');
      if (parts.length < 2) {
        reports.errori_formali.push({
          raw_line: line,
          reason: 'formato_errato',
          row_index: i + 1
        });
        continue;
      }
      
      const mpn = parts[0]?.trim();
      const ean = parts[1]?.trim();
      
      if (!ean) {
        reports.empty_ean_rows.push({
          mpn: mpn,
          row_index: i + 1
        });
        continue;
      }
      
      if (mappingMap.has(mpn)) {
        const existing = mappingMap.get(mpn);
        if (existing !== ean) {
          reports.duplicate_mpn_rows.push({
            mpn: mpn,
            ean_seen_first: existing,
            ean_conflicting: ean,
            row_index: i + 1
          });
        }
      } else {
        mappingMap.set(mpn, ean);
      }
    }
    
    // Process Material data
    const updatedMaterial = [];
    const updateReports = {
      updated: [],
      already_populated: [],
      skipped_due_to_conflict: [],
      mpn_not_in_material: [],
      missing_mapping_in_new_file: []
    };
    
    const localCounters = {
      already_populated: 0,
      filled_now: 0,
      skipped_due_to_conflict: 0,
      missing_mapping_in_new_file: 0
    };
    
    // Create a set of all MPNs in material for faster lookup
    const materialMPNs = new Set(materialData.map(row => row.ManufPartNr?.toString().trim()).filter(Boolean));
    
    // Check for MPNs in mapping that don't exist in material
    for (const [mpn, ean] of mappingMap.entries()) {
      if (!materialMPNs.has(mpn)) {
        updateReports.mpn_not_in_material.push({
          mpn: mpn,
          ean: ean,
          row_index: 0 // Will be set by main thread if needed
        });
      }
    }
    
    // Process material rows
    for (const row of materialData) {
      const newRow = { ...row };
      const mpn = row.ManufPartNr?.toString().trim();
      const currentEAN = row.EAN?.toString().trim();
      
      if (currentEAN) {
        // EAN already populated
        localCounters.already_populated++;
        updateReports.already_populated.push({
          ManufPartNr: mpn,
          EAN_existing: currentEAN
        });
        
        // Check if there's also a mapping for this MPN
        if (mpn && mappingMap.has(mpn)) {
          const mappingEAN = mappingMap.get(mpn);
          localCounters.skipped_due_to_conflict++;
          updateReports.skipped_due_to_conflict.push({
            ManufPartNr: mpn,
            EAN_material: currentEAN,
            EAN_mapping_first: mappingEAN
          });
        }
      } else if (mpn && mappingMap.has(mpn)) {
        // EAN empty and mapping exists - fill it
        const mappingEAN = mappingMap.get(mpn);
        newRow.EAN = mappingEAN;
        localCounters.filled_now++;
        updateReports.updated.push({
          ManufPartNr: mpn,
          EAN_old: currentEAN || '',
          EAN_new: mappingEAN
        });
      } else {
        // EAN empty and no mapping found
        localCounters.missing_mapping_in_new_file++;
        updateReports.missing_mapping_in_new_file.push({
          ManufPartNr: mpn || ''
        });
      }
      
      updatedMaterial.push(newRow);
    }
    
    // Send results back
    self.postMessage({
      success: true,
      updatedMaterial: updatedMaterial,
      counters: {
        ...counters,
        ...localCounters,
        duplicate_mpn_rows: reports.duplicate_mpn_rows.length,
        mpn_not_in_material: updateReports.mpn_not_in_material.length,
        empty_ean_rows: reports.empty_ean_rows.length,
        errori_formali: reports.errori_formali.length
      },
      reports: {
        ...reports,
        ...updateReports
      }
    });
    
  } catch (error) {
    self.postMessage({
      error: true,
      message: error.message || 'Errore sconosciuto durante l\'elaborazione'
    });
  }
};
