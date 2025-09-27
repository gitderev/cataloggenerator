import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { Upload, Download, FileText, CheckCircle, XCircle, AlertCircle, Clock, Activity, Info } from 'lucide-react';
import { filterAndNormalizeForEAN, type EANStats, type DiscardedRow } from '@/utils/ean';
import { forceEANText, exportDiscardedRowsCSV } from '@/utils/excelFormatter';
import { toComma99Cents, validateEnding99, computeFinalEan, computeFromListPrice, toCents, formatCents } from '@/utils/pricing';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

interface FileData {
  name: string;
  data: any[];
  headers: string[];
  raw: File;
  isValid?: boolean;
}

interface FileUploadState {
  material: { file: FileData | null; status: 'empty' | 'valid' | 'error' | 'warning'; error?: string; warning?: string; diagnostics?: any };
  stock: { file: FileData | null; status: 'empty' | 'valid' | 'error' | 'warning'; error?: string; warning?: string; diagnostics?: any };
  price: { file: FileData | null; status: 'empty' | 'valid' | 'error' | 'warning'; error?: string; warning?: string; diagnostics?: any };
}

interface ProcessedRecord {
  Matnr: string;
  ManufPartNr: string;
  EAN: string;
  ShortDescription: string;
  ExistingStock: number;
  ListPrice: number;
  CustBestPrice: number;
  'Costo di Spedizione': number;
  IVA: number;
  'Prezzo con spediz e IVA': number;
  FeeDeRev: number;
  'Fee Marketplace': number;
  'Subtotale post-fee': number;
  'Prezzo Finale': number | string; // String display for EAN (e.g. "34,99"), number for MPN
  'ListPrice con Fee': number | string; // Can be empty string for invalid ListPrice
}

interface FeeConfig {
  feeDrev: number;   // e.g. 1.05
  feeMkt: number;    // e.g. 1.08
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

interface ProcessingStats {
  totalRecords: number;
  validRecordsEAN: number;
  validRecordsManufPartNr: number;
  filteredRecordsEAN: number;
  filteredRecordsManufPartNr: number;
  stockDuplicates: number;
  priceDuplicates: number;
}

const REQUIRED_HEADERS = {
  material: ['Matnr', 'ManufPartNr', 'EAN', 'ShortDescription'],
  stock: ['Matnr', 'ExistingStock'],
  price: ['Matnr', 'ListPrice', 'CustBestPrice']
};

const OPTIONAL_HEADERS = {
  material: [],
  stock: ['ManufPartNr'],
  price: ['ManufPartNr']
};

const DEFAULT_FEES: FeeConfig = { feeDrev: 1.05, feeMkt: 1.08 };

function loadFees(): FeeConfig {
  try {
    const raw = localStorage.getItem('catalog_fees_v2');
    if (!raw) return DEFAULT_FEES;
    const obj = JSON.parse(raw);
    return {
      feeDrev: Number(obj.feeDrev) || DEFAULT_FEES.feeDrev,
      feeMkt: Number(obj.feeMkt) || DEFAULT_FEES.feeMkt,
    };
  } catch { 
    return DEFAULT_FEES; 
  }
}

function saveFees(cfg: FeeConfig) {
  localStorage.setItem('catalog_fees_v2', JSON.stringify(cfg));
}

function ceilInt(x: number): number { 
  return Math.ceil(x); 
}

function computeFinalPrice({
  CustBestPrice, ListPrice, feeDrev, feeMkt
}: { CustBestPrice?: number; ListPrice?: number; feeDrev: number; feeMkt: number; }): {
  base: number, shipping: number, iva: number, subtotConIva: number,
  postFee: number, prezzoFinaleEAN: number, prezzoFinaleMPN: number, listPriceConFee: number | string,
  eanResult: { finalCents: number; finalDisplay: string; route: string; debug: any }
} {
  const shipping = 6.00;
  const ivaMultiplier = 1.22;
  
  const hasBest = Number.isFinite(CustBestPrice) && CustBestPrice! > 0;
  const hasListPrice = Number.isFinite(ListPrice) && ListPrice! > 0;
  
  let base = 0;
  let baseRoute = '';
  
  // Select base price with route tracking
  if (hasBest) {
    base = CustBestPrice!;
    baseRoute = 'cbp';
  } else if (hasListPrice) {
    base = Math.ceil(ListPrice!); // ONLY ceil allowed in EAN pipeline - on ListPrice as base
    baseRoute = 'listprice_ceiled';
  } else {
    // No valid price
    const emptyEanResult = { finalCents: 0, finalDisplay: '0,00', route: 'none', debug: {} };
    return { 
      base: 0, shipping, iva: 0, subtotConIva: 0, 
      postFee: 0, prezzoFinaleEAN: 0, prezzoFinaleMPN: 0, listPriceConFee: '', eanResult: emptyEanResult 
    };
  }
  
  // Calculate for display/compatibility (old pipeline values)
  const subtot_base_sped = base + shipping;
  const iva = subtot_base_sped * 0.22;
  const subtotConIva = subtot_base_sped + iva;
  const postFee = subtotConIva * feeDrev * feeMkt;
  
  // EAN final price: use new computeFinalEan function (cent-precise with ending ,99)
  const eanResult = computeFinalEan(
    { listPrice: ListPrice || 0, custBestPrice: CustBestPrice > 0 ? CustBestPrice : undefined },
    { feeDeRev: feeDrev, feeMarketplace: feeMkt }
  );
  const prezzoFinaleEAN = eanResult.finalCents / 100;
  
  // MPN final price: use old logic (ceil to integer)
  const prezzoFinaleMPN = Math.ceil(postFee);
  
  // Calculate ListPrice con Fee - SEPARATE pipeline, independent from main calculation
  let listPriceConFee: number | string = '';
  if (hasListPrice) {
    const baseLP = ListPrice!; // use ListPrice as-is, no ceil here
    const subtotBasSpedLP = baseLP + shipping;
    const ivaLP = subtotBasSpedLP * 0.22;
    const subtotConIvaLP = subtotBasSpedLP + ivaLP;
    const postFeeLP = subtotConIvaLP * feeDrev * feeMkt;
    listPriceConFee = Math.ceil(postFeeLP); // ceil to integer for ListPrice con Fee
  }

  return { base, shipping, iva, subtotConIva, postFee, prezzoFinaleEAN, prezzoFinaleMPN, listPriceConFee, eanResult };
}

const AltersideCatalogGenerator = () => {
  const [files, setFiles] = useState<FileUploadState>({
    material: { file: null, status: 'empty' },
    stock: { file: null, status: 'empty' },
    price: { file: null, status: 'empty' }
  });

  // Fee configuration
  const [feeConfig, setFeeConfig] = useState<FeeConfig>(loadFees());
  const [rememberFees, setRememberFees] = useState(false);

  // Save fees when rememberFees is checked
  useEffect(() => {
    if (rememberFees) {
      saveFees(feeConfig);
    }
  }, [feeConfig, rememberFees]);

  const [processingState, setProcessingState] = useState<'idle' | 'validating' | 'ready' | 'running' | 'completed' | 'failed'>('idle');

  // Debug events
  const [debugEvents, setDebugEvents] = useState<string[]>([]);

  const dbg = useCallback((event: string, data?: any) => {
    const timestamp = new Date().toLocaleTimeString('it-IT', { hour12: false });
    const message = `[${timestamp}] ${event}${data ? ' | ' + JSON.stringify(data) : ''}`;
    setDebugEvents(prev => [...prev, message]);
  }, []);

  useEffect(() => {
    (window as any).dbg = dbg;
  }, [dbg]);

  const validateHeaders = (headers: string[], requiredHeaders: string[], optionalHeaders: string[] = []): { 
    valid: boolean; 
    missing: string[]; 
    missingOptional: string[];
    hasWarning: boolean;
  } => {
    const normalizedHeaders = headers.map(h => h.trim().replace(/^\uFEFF/, '')); // Remove BOM
    const missing = requiredHeaders.filter(req => !normalizedHeaders.includes(req));
    const missingOptional = optionalHeaders.filter(opt => !normalizedHeaders.includes(opt));
    
    return { 
      valid: missing.length === 0, 
      missing, 
      missingOptional,
      hasWarning: missingOptional.length > 0
    };
  };

  const parseCSV = async (file: File): Promise<{ data: any[]; headers: string[] }> => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        delimiter: ';',
        encoding: 'UTF-8',
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            reject(new Error(`Errore parsing: ${results.errors[0].message}`));
            return;
          }
          
          const headers = results.meta.fields || [];
          resolve({
            data: results.data,
            headers
          });
        },
        error: (error) => {
          reject(new Error(`Errore lettura file: ${error.message}`));
        }
      });
    });
  };

  const handleFileUpload = async (file: File, type: keyof FileUploadState) => {
    try {
      const parsed = await parseCSV(file);
      const validation = validateHeaders(parsed.headers, REQUIRED_HEADERS[type], OPTIONAL_HEADERS[type]);
      
      if (!validation.valid) {
        const error = `Header mancanti: ${validation.missing.join(', ')}`;
        setFiles(prev => ({
          ...prev,
          [type]: { file: null, status: 'error', error }
        }));
        setProcessingState('idle');
        
        toast({
          title: "Errore validazione header",
          description: error,
          variant: "destructive"
        });
        return;
      }

      // Handle warnings for optional headers
      let warning = '';
      let status: 'valid' | 'warning' = 'valid';
      
      if (validation.hasWarning && (type === 'stock' || type === 'price')) {
        status = 'warning';
        if (type === 'stock') {
          warning = 'Header opzionale assente: ManufPartNr (continuerò usando il valore dal Material).';
        } else if (type === 'price') {
          warning = 'Header opzionale assente: ManufPartNr (continuerò usando il valore dal Material).';
        }
      }

      const fileState = {
        name: file.name,
        data: parsed.data,
        headers: parsed.headers,
        raw: file,
        isValid: validation.valid
      };

      setFiles(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          file: fileState,
          status: fileState.isValid ? 'valid' : 'error',
          warning
        }
      }));

      // Check if all files are loaded with valid required headers
      const allFilesValid = Object.values(files).every(f => f.file && f.file.isValid);
      if (allFilesValid && fileState.isValid) {
        setProcessingState('ready');
      }

      toast({
        title: `File ${type} caricato`,
        description: `${parsed.data.length} righe trovate${warning ? '. ' + warning : ''}`,
        variant: warning ? "default" : "default"
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      setFiles(prev => ({
        ...prev,
        [type]: { file: null, status: 'error', error: errorMessage }
      }));
      setProcessingState('idle');
      
      toast({
        title: "Errore durante il caricamento",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  const generateExcel = async (pipeline: 'EAN' | 'MPN') => {
    if (!files.material.file || !files.stock.file || !files.price.file) {
      toast({
        title: "Errore",
        description: "Tutti i file devono essere caricati prima di procedere",
        variant: "destructive"
      });
      return;
    }

    setProcessingState('running');
    
    try {
      // Simple processing logic
      const materialData = files.material.file.data;
      const processedData: ProcessedRecord[] = [];

      // Basic processing
      materialData.forEach((row: any, index: number) => {
        const finalPrice = computeFinalPrice({
          CustBestPrice: parseFloat(row.CustBestPrice || '0'),
          ListPrice: parseFloat(row.ListPrice || '0'),
          feeDrev: feeConfig.feeDrev,
          feeMkt: feeConfig.feeMkt
        });

        const record: ProcessedRecord = {
          Matnr: row.Matnr || '',
          ManufPartNr: row.ManufPartNr || '',
          EAN: row.EAN || '',
          ShortDescription: row.ShortDescription || '',
          ExistingStock: parseFloat(row.ExistingStock || '0'),
          ListPrice: parseFloat(row.ListPrice || '0'),
          CustBestPrice: parseFloat(row.CustBestPrice || '0'),
          'Costo di Spedizione': finalPrice.shipping,
          IVA: finalPrice.iva,
          'Prezzo con spediz e IVA': finalPrice.subtotConIva,
          FeeDeRev: feeConfig.feeDrev,
          'Fee Marketplace': feeConfig.feeMkt,
          'Subtotale post-fee': finalPrice.postFee,
          'Prezzo Finale': pipeline === 'EAN' ? finalPrice.prezzoFinaleEAN : finalPrice.prezzoFinaleMPN,
          'ListPrice con Fee': finalPrice.listPriceConFee
        };

        processedData.push(record);
      });

      // Create Excel file
      const ws = XLSX.utils.json_to_sheet(processedData);
      const wb = XLSX.utils.book_new();
      const sheetName = pipeline === 'EAN' ? 'EAN' : 'SKU';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      const filename = pipeline === 'EAN' 
        ? `catalogo_ean_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '_')}.xlsx`
        : `catalogo_sku_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '_')}.xlsx`;

      XLSX.writeFile(wb, filename);

      setProcessingState('completed');
      
      toast({
        title: "Export completato",
        description: `File ${filename} scaricato con successo`,
        variant: "default"
      });

    } catch (error) {
      console.error('Errore durante la generazione:', error);
      setProcessingState('failed');
      
      toast({
        title: "Errore durante la generazione",
        description: error instanceof Error ? error.message : 'Errore sconosciuto',
        variant: "destructive"
      });
    }
  };

  const handleFeeChange = (field: 'feeDrev' | 'feeMkt', value: string) => {
    const numValue = parseFloat(value) || 1.0;
    setFeeConfig(prev => ({
      ...prev,
      [field]: numValue
    }));
  };

  const allFilesValid = Object.values(files).every(f => f.file && f.file.isValid);
  const isReady = processingState === 'ready' || allFilesValid;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Alterside Catalog Generator
        </h1>
        <p className="text-gray-600">
          Upload Material, Stock, and Price files to generate EAN and ManufPartNr catalogs
        </p>
      </div>

      {/* File Upload Section */}
      <div className="grid md:grid-cols-3 gap-6">
        {(['material', 'stock', 'price'] as const).map((type) => (
          <Card key={type} className="p-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-semibold capitalize">{type} File</h3>
                {files[type].status === 'valid' && (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                )}
                {files[type].status === 'error' && (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                {files[type].status === 'warning' && (
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                )}
              </div>

              {files[type].file ? (
                <div className="text-sm">
                  <p className="font-medium">{files[type].file?.name}</p>
                  <p className="text-gray-600">{files[type].file?.data.length} rows</p>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                  <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Drop CSV file here or click to browse</p>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file, type);
                    }}
                    className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
              )}

              {files[type].error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                  {files[type].error}
                </div>
              )}

              {files[type].warning && (
                <div className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded">
                  {files[type].warning}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Fee Configuration */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Fee Configuration</h3>
        <div className="grid md:grid-cols-3 gap-4 items-end">
          <div>
            <Label htmlFor="fee-drev">Fee DeRev</Label>
            <Input
              id="fee-drev"
              type="number"
              step="0.01"
              min="1.00"
              value={feeConfig.feeDrev}
              onChange={(e) => handleFeeChange('feeDrev', e.target.value)}
              className="border-input focus-visible:ring-ring"
            />
          </div>
          <div>
            <Label htmlFor="fee-mkt">Fee Marketplace</Label>
            <Input
              id="fee-mkt"
              type="number"
              step="0.01"
              min="1.00"
              value={feeConfig.feeMkt}
              onChange={(e) => handleFeeChange('feeMkt', e.target.value)}
              className="border-input focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember-fees"
              checked={rememberFees}
              onCheckedChange={(checked) => setRememberFees(checked === true)}
            />
            <Label htmlFor="remember-fees" className="text-sm">
              Remember fees
            </Label>
          </div>
        </div>
      </Card>

      {/* Actions Section - Always Visible */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Azioni</h3>
        <div className="flex flex-wrap gap-4">
          <Button
            data-id="btn-ean"
            variant="default"
            onClick={() => generateExcel('EAN')}
            disabled={!allFilesValid || processingState === 'running'}
            className="flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>GENERA EXCEL (EAN)</span>
          </Button>
          
          <Button
            data-id="btn-sku"
            variant="default"
            onClick={() => generateExcel('MPN')}
            disabled={!allFilesValid || processingState === 'running'}
            className="flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>GENERA EXCEL (ManufPartNr)</span>
          </Button>
        </div>
      </Card>

      {/* Processing Status */}
      {processingState === 'running' && (
        <Card className="p-6">
          <div className="flex items-center space-x-4">
            <Activity className="h-5 w-5 text-blue-600 animate-spin" />
            <span>Processing...</span>
          </div>
        </Card>
      )}

      {/* Debug Events */}
      {debugEvents.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Eventi Debug</h3>
          <div className="bg-muted p-4 rounded text-sm font-mono max-h-60 overflow-y-auto">
            {debugEvents.slice(-20).map((event, index) => (
              <div key={index} className="text-foreground">{event}</div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default AltersideCatalogGenerator;