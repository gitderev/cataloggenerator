export interface EANResult {
  ok: boolean;
  value?: string;
  reason?: string;
  original?: string;
}

export interface EANStats {
  tot_righe_input: number;
  ean_validi_13: number;
  ean_padded_12_to_13: number;
  ean_mancanti: number;
  ean_non_numerici: number;
  ean_lunghezze_invalid: number;
  ean_duplicati_risolti: number;
}

export interface DiscardedRow {
  Matnr?: string;
  ManufPartNr?: string;
  EAN_originale?: string;
  Motivo_scarto: string;
}

export function normalizeEAN(raw: unknown): EANResult {
  const original = (raw ?? '').toString().trim();
  if (!original) return { ok: false, reason: 'EAN mancante', original };

  // rimuove spazi e trattini interni
  const compact = original.replace(/[\s-]+/g, '');

  // deve essere solo numerico
  if (!/^\d+$/.test(compact)) {
    return { ok: false, reason: 'EAN contiene caratteri non numerici', original };
  }

  if (compact.length === 13) return { ok: true, value: compact, original };
  if (compact.length === 12) return { ok: true, value: '0' + compact, original };

  return { ok: false, reason: `EAN lunghezza ${compact.length} non valida`, original };
}

export function filterAndNormalizeForEAN(
  rows: any[],
  computeFinalPrice: (row: any) => number
): { kept: any[]; discarded: DiscardedRow[]; stats: EANStats } {
  const discarded: DiscardedRow[] = [];
  const valid: any[] = [];
  const stats: EANStats = {
    tot_righe_input: rows.length,
    ean_validi_13: 0,
    ean_padded_12_to_13: 0,
    ean_mancanti: 0,
    ean_non_numerici: 0,
    ean_lunghezze_invalid: 0,
    ean_duplicati_risolti: 0,
  };

  for (const r of rows) {
    const res = normalizeEAN(r.EAN ?? r.ean ?? r.Ean);
    if (!res.ok) {
      if (res.reason === 'EAN mancante') stats.ean_mancanti++;
      else if (res.reason === 'EAN contiene caratteri non numerici') stats.ean_non_numerici++;
      else if (res.reason?.startsWith('EAN lunghezza')) stats.ean_lunghezze_invalid++;
      
      discarded.push({
        Matnr: r.Matnr,
        ManufPartNr: r.ManufPartNr,
        EAN_originale: res.original ?? '',
        Motivo_scarto: res.reason ?? 'EAN non valido'
      });
      continue;
    }
    
    if ((res.original ?? '').replace(/[\s-]+/g, '').length === 12) {
      stats.ean_padded_12_to_13++;
    } else {
      stats.ean_validi_13++;
    }

    r.EAN = res.value!;
    valid.push(r);
  }

  // dedup per EAN: tenere quello con prezzo finale più alto
  const byEAN = new Map<string, { row: any; prezzoFinale: number }>();
  
  for (const r of valid) {
    const key = r.EAN;
    const prezzoFinale = computeFinalPrice(r);

    const prev = byEAN.get(key);
    if (!prev) {
      byEAN.set(key, { row: r, prezzoFinale });
    } else {
      const best = (prezzoFinale >= prev.prezzoFinale) ? { row: r, prezzoFinale } : prev;
      const discardedRow = (best === prev) ? r : prev.row;
      const discardedPrice = (best === prev) ? prezzoFinale : prev.prezzoFinale;

      stats.ean_duplicati_risolti++;
      discarded.push({
        Matnr: discardedRow.Matnr,
        ManufPartNr: discardedRow.ManufPartNr,
        EAN_originale: discardedRow.EAN,
        Motivo_scarto: `ean_duplicato (prezzo_finale=${discardedPrice.toFixed(2)})`
      });

      byEAN.set(key, best);
    }
  }

  const kept = Array.from(byEAN.values()).map(v => v.row);
  return { kept, discarded, stats };
}