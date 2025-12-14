/**
 * Raw File Diagnostics
 * 
 * Scans raw file content BEFORE parsing to detect E+ notation,
 * calculate file fingerprints, and provide diagnostics.
 */

export interface RawScanResult {
  filename: string;
  fileSize: number;
  rawContainsEPlus: boolean;
  rawEPlusCount: number;
  rawEPlusSampleLines: string[];
  fingerprint: string; // Simple checksum-based fingerprint
  scannedAt: string;
}

export interface RawFileDiagnostics {
  material: RawScanResult | null;
  codiciOK: RawScanResult | null;
}

/**
 * Calculates a simple fingerprint/checksum for a string
 * Uses a fast hash algorithm for quick identification
 */
export function calculateFingerprint(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex and pad
  const hexHash = Math.abs(hash).toString(16).padStart(8, '0');
  return hexHash.toUpperCase();
}

/**
 * Scans raw content for scientific notation (E+/E-) patterns
 * This detects if the SOURCE FILE already contains E+ notation
 * (which indicates the file was corrupted upstream)
 */
export function scanRawContentForEPlus(content: string): {
  containsEPlus: boolean;
  ePlusCount: number;
  sampleLines: string[];
} {
  // Pattern for scientific notation: digit(s) followed by e+/e- and more digits
  const scientificPattern = /[0-9]\.?[0-9]*e[+-]?[0-9]+/gi;
  
  const matches = content.match(scientificPattern);
  const ePlusCount = matches ? matches.length : 0;
  const containsEPlus = ePlusCount > 0;
  
  // Extract sample lines containing E+ notation
  const sampleLines: string[] = [];
  
  if (containsEPlus) {
    const lines = content.split('\n');
    const linePattern = /e[+-]?[0-9]+/i;
    
    for (let i = 0; i < lines.length && sampleLines.length < 10; i++) {
      const line = lines[i];
      if (linePattern.test(line)) {
        // Include line number and truncate if too long
        const truncatedLine = line.length > 200 ? line.substring(0, 200) + '...' : line;
        sampleLines.push(`[Riga ${i + 1}] ${truncatedLine}`);
      }
    }
  }
  
  return {
    containsEPlus,
    ePlusCount,
    sampleLines
  };
}

/**
 * Performs a full raw scan on file content
 */
export function scanRawFile(
  content: string,
  filename: string,
  fileSize: number
): RawScanResult {
  const eplusResult = scanRawContentForEPlus(content);
  const fingerprint = calculateFingerprint(content);
  
  return {
    filename,
    fileSize,
    rawContainsEPlus: eplusResult.containsEPlus,
    rawEPlusCount: eplusResult.ePlusCount,
    rawEPlusSampleLines: eplusResult.sampleLines,
    fingerprint,
    scannedAt: new Date().toISOString()
  };
}

/**
 * Creates an empty diagnostics object
 */
export function createEmptyDiagnostics(): RawFileDiagnostics {
  return {
    material: null,
    codiciOK: null
  };
}

/**
 * Generates a summary log for the raw file diagnostics
 */
export function generateDiagnosticsSummary(diagnostics: RawFileDiagnostics): string {
  const parts: string[] = [];
  
  if (diagnostics.material) {
    const m = diagnostics.material;
    parts.push(`Material: ${m.filename} (${formatBytes(m.fileSize)}, FP:${m.fingerprint})`);
    if (m.rawContainsEPlus) {
      parts.push(`  ⚠️ E+ nel sorgente: ${m.rawEPlusCount} occorrenze`);
    }
  }
  
  if (diagnostics.codiciOK) {
    const c = diagnostics.codiciOK;
    parts.push(`CodiciOK: ${c.filename} (${formatBytes(c.fileSize)}, FP:${c.fingerprint})`);
    if (c.rawContainsEPlus) {
      parts.push(`  ⚠️ E+ nel sorgente: ${c.rawEPlusCount} occorrenze`);
    }
  }
  
  return parts.join('\n');
}

/**
 * Formats bytes into a human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Checks if raw diagnostics indicate source file corruption (E+ in raw)
 */
export function hasSourceFileCorruption(diagnostics: RawFileDiagnostics): boolean {
  return (diagnostics.material?.rawContainsEPlus ?? false) || 
         (diagnostics.codiciOK?.rawContainsEPlus ?? false);
}

/**
 * Generates a warning message for source file corruption
 */
export function generateSourceCorruptionWarning(diagnostics: RawFileDiagnostics): string | null {
  if (!hasSourceFileCorruption(diagnostics)) return null;
  
  const parts: string[] = [];
  
  if (diagnostics.material?.rawContainsEPlus) {
    parts.push(`Material: ${diagnostics.material.rawEPlusCount} E+ trovati nel file sorgente`);
  }
  
  if (diagnostics.codiciOK?.rawContainsEPlus) {
    parts.push(`Mapping (codiciOK): ${diagnostics.codiciOK.rawEPlusCount} E+ trovati nel file sorgente`);
  }
  
  return `⚠️ File sorgente già corrotto: ${parts.join(', ')}. Il file FTP originale contiene notazione scientifica (E+).`;
}
