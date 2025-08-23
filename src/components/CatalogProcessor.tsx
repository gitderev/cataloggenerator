import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/use-toast';
import { Upload, Download, FileText, AlertCircle } from 'lucide-react';
import { DataPreview } from '@/components/DataPreview';
import * as XLSX from 'xlsx';

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
}

interface LogEntry {
  Matnr: string;
  reason: string;
  originalData: any;
}

const CatalogProcessor: React.FC = () => {
  const [files, setFiles] = useState<{
    material: FileData | null;
    stock: FileData | null;
    price: FileData | null;
  }>({
    material: null,
    stock: null,
    price: null
  });

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedData, setProcessedData] = useState<ProcessedRecord[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<{
    totalRecords: number;
    validRecords: number;
    filteredRecords: number;
  } | null>(null);

  const parseCSV = (text: string): { data: any[]; headers: string[] } => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return { data: [], headers: [] };

    const headers = lines[0].split(';').map(h => h.trim().replace(/"/g, ''));
    const data = lines.slice(1).map(line => {
      const values = line.split(';').map(v => v.trim().replace(/"/g, ''));
      const record: any = {};
      headers.forEach((header, index) => {
        record[header] = values[index] || '';
      });
      return record;
    });

    return { data, headers };
  };

  const handleFileUpload = async (file: File, type: 'material' | 'stock' | 'price') => {
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      
      setFiles(prev => ({
        ...prev,
        [type]: {
          name: file.name,
          data: parsed.data,
          headers: parsed.headers
        }
      }));

      toast({
        title: "File caricato",
        description: `${file.name} caricato con successo (${parsed.data.length} righe)`
      });
    } catch (error) {
      toast({
        title: "Errore",
        description: "Errore durante il caricamento del file",
        variant: "destructive"
      });
    }
  };

  const processData = async () => {
    if (!files.material || !files.stock || !files.price) {
      toast({
        title: "File mancanti",
        description: "Carica tutti e tre i file prima di procedere",
        variant: "destructive"
      });
      return;
    }

    setProcessing(true);
    setProgress(0);

    try {
      // Simula progresso
      const updateProgress = (value: number) => {
        setProgress(value);
        return new Promise(resolve => setTimeout(resolve, 100));
      };

      await updateProgress(10);

      // Crea mappe per lookup rapido
      const stockMap = new Map();
      files.stock.data.forEach(record => {
        if (record.Matnr) {
          stockMap.set(record.Matnr, record);
        }
      });

      await updateProgress(30);

      const priceMap = new Map();
      files.price.data.forEach(record => {
        if (record.Matnr) {
          priceMap.set(record.Matnr, record);
        }
      });

      await updateProgress(50);

      // Processa i dati con left join
      const processed: ProcessedRecord[] = [];
      const logs: LogEntry[] = [];

      for (const materialRecord of files.material.data) {
        const matnr = materialRecord.Matnr;
        if (!matnr) continue;

        const stockRecord = stockMap.get(matnr);
        const priceRecord = priceMap.get(matnr);

        // Combina i dati
        const combined = {
          ...materialRecord,
          ...stockRecord,
          ...priceRecord
        };

        // Applica filtri
        let reason = '';

        if (!combined.EAN || combined.EAN.trim() === '') {
          reason = 'EAN vuoto';
        } else if (!combined.ExistingStock || parseFloat(combined.ExistingStock) <= 0) {
          reason = 'ExistingStock <= 0';
        } else if (!combined.ListPrice || isNaN(parseFloat(combined.ListPrice))) {
          reason = 'ListPrice non numerico o vuoto';
        } else if (!combined.CustBestPrice || combined.CustBestPrice.trim() === '' || isNaN(parseFloat(combined.CustBestPrice))) {
          reason = 'CustBestPrice vuoto o non numerico';
        }

        if (reason) {
          logs.push({
            Matnr: matnr,
            reason,
            originalData: combined
          });
        } else {
          // Calcola prezzi con IVA
          const listPrice = parseFloat(combined.ListPrice);
          const custBestPrice = parseFloat(combined.CustBestPrice);
          const listPriceWithIVA = Math.round(listPrice * 1.22 * 100) / 100;
          const custBestPriceWithIVA = Math.round(custBestPrice * 1.22 * 100) / 100;

          processed.push({
            Matnr: combined.Matnr,
            ManufPartNr: combined.ManufPartNr || '',
            EAN: combined.EAN,
            ShortDescription: combined.ShortDescription || '',
            ExistingStock: parseFloat(combined.ExistingStock),
            ListPrice: listPrice,
            CustBestPrice: custBestPrice,
            IVA: '22%',
            'ListPrice con IVA': listPriceWithIVA,
            'CustBestPrice con IVA': custBestPriceWithIVA
          });
        }
      }

      await updateProgress(90);

      setProcessedData(processed);
      setLogEntries(logs);
      setStats({
        totalRecords: files.material.data.length,
        validRecords: processed.length,
        filteredRecords: logs.length
      });

      await updateProgress(100);

      toast({
        title: "Elaborazione completata",
        description: `${processed.length} record validi, ${logs.length} scartati`
      });

    } catch (error) {
      toast({
        title: "Errore",
        description: "Errore durante l'elaborazione dei dati",
        variant: "destructive"
      });
    } finally {
      setProcessing(false);
    }
  };

  const downloadExcel = () => {
    if (processedData.length === 0) return;

    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1_$2');
    const filename = `catalogo_${timestamp}.xlsx`;

    const ws = XLSX.utils.json_to_sheet(processedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogo');
    XLSX.writeFile(wb, filename);

    toast({
      title: "Download completato",
      description: `File ${filename} scaricato`
    });
  };

  const downloadLog = () => {
    if (logEntries.length === 0) return;

    const csvContent = [
      'Matnr,Motivo,Dati Originali',
      ...logEntries.map(entry => 
        `${entry.Matnr},"${entry.reason}","${JSON.stringify(entry.originalData).replace(/"/g, '""')}"`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'log_scartati.csv';
    link.click();
  };

  const FileUploadCard: React.FC<{
    title: string;
    type: 'material' | 'stock' | 'price';
    file: FileData | null;
  }> = ({ title, type, file }) => (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-card-foreground mb-4">{title}</h3>
      
      {!file ? (
        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
          <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <div>
            <input
              type="file"
              accept=".txt,.csv"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0];
                if (selectedFile) {
                  handleFileUpload(selectedFile, type);
                }
              }}
              className="hidden"
              id={`file-${type}`}
            />
            <label
              htmlFor={`file-${type}`}
              className="cursor-pointer inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Carica File
            </label>
            <p className="text-muted-foreground text-sm mt-2">
              CSV delimitato da ; con header
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between p-4 bg-accent rounded-lg">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <div>
              <p className="font-medium text-card-foreground">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {file.data.length} righe
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFiles(prev => ({ ...prev, [type]: null }))}
            className="text-destructive hover:text-destructive"
          >
            Rimuovi
          </Button>
        </div>
      )}
    </Card>
  );

  const allFilesLoaded = files.material && files.stock && files.price;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Processore Catalogo
          </h1>
          <p className="text-muted-foreground text-lg">
            Carica i tre file TXT, elabora i dati e scarica il catalogo Excel
          </p>
        </div>

        {/* Upload Files */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FileUploadCard
            title="Material File"
            type="material"
            file={files.material}
          />
          <FileUploadCard
            title="Stock File Data"
            type="stock"
            file={files.stock}
          />
          <FileUploadCard
            title="Price File Data"
            type="price"
            file={files.price}
          />
        </div>

        {/* Process Button */}
        {allFilesLoaded && (
          <div className="text-center">
            <Button
              onClick={processData}
              disabled={processing}
              size="lg"
              className="bg-gradient-primary text-primary-foreground shadow-glow"
            >
              {processing ? 'Elaborazione in corso...' : 'Elabora Dati'}
            </Button>
          </div>
        )}

        {/* Progress Bar */}
        {processing && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Progresso Elaborazione</h3>
            <Progress value={progress} className="w-full" />
            <p className="text-sm text-muted-foreground mt-2">{progress}% completato</p>
          </Card>
        )}

        {/* Statistics */}
        {stats && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-card-foreground mb-4">Statistiche</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-accent rounded-lg">
                <div className="text-2xl font-bold text-primary">{stats.totalRecords}</div>
                <div className="text-sm text-muted-foreground">Record Totali</div>
              </div>
              <div className="text-center p-4 bg-accent rounded-lg">
                <div className="text-2xl font-bold text-green-600">{stats.validRecords}</div>
                <div className="text-sm text-muted-foreground">Record Validi</div>
              </div>
              <div className="text-center p-4 bg-accent rounded-lg">
                <div className="text-2xl font-bold text-orange-600">{stats.filteredRecords}</div>
                <div className="text-sm text-muted-foreground">Record Scartati</div>
              </div>
            </div>
          </Card>
        )}

        {/* Download Buttons */}
        {processedData.length > 0 && (
          <div className="flex justify-center gap-4">
            <Button onClick={downloadExcel} className="bg-gradient-success">
              <Download className="mr-2 h-4 w-4" />
              Scarica Excel
            </Button>
            {logEntries.length > 0 && (
              <Button onClick={downloadLog} variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Scarica Log
              </Button>
            )}
          </div>
        )}

        {/* Data Preview */}
        {processedData.length > 0 && (
          <DataPreview
            data={processedData}
            title="Anteprima Catalogo (prime 10 righe)"
            maxRows={10}
          />
        )}

        {/* Instructions */}
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-primary mt-1" />
            <div>
              <h3 className="text-lg font-semibold text-card-foreground mb-2">Istruzioni</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Carica i tre file TXT (CSV con delimitatore ;)</li>
                <li>• I file verranno uniti tramite left join sulla colonna Matnr</li>
                <li>• Saranno filtrati i record con EAN vuoto, ExistingStock ≤ 0, o prezzi non validi</li>
                <li>• Verrà calcolata l'IVA al 22% sui prezzi</li>
                <li>• Potrai scaricare il catalogo Excel e il log degli scartati</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default CatalogProcessor;