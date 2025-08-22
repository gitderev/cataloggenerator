import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Download, FileText, Database, CheckCircle, AlertCircle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

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

interface ProcessingResult {
  success: boolean;
  data?: ProcessedRecord[];
  fullData?: ProcessedRecord[];
  totalRows?: number;
  counters?: any;
  logs?: LogEntry[];
  duration?: number;
  timestamp?: string;
  dateOnly?: string;
  error?: string;
}

const CatalogManager: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewData, setPreviewData] = useState<ProcessedRecord[] | null>(null);
  const [fullData, setFullData] = useState<ProcessedRecord[] | null>(null);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [processingStats, setProcessingStats] = useState<any>(null);
  const [timestamp, setTimestamp] = useState<string>('');
  const [dateOnly, setDateOnly] = useState<string>('');
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  
  const { toast } = useToast();

  // Initialize Supabase client
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  );

  const updateProgress = useCallback((newProgress: number) => {
    setProgress(newProgress);
    const elapsed = Date.now() - startTime;
    setElapsedTime(elapsed);
  }, [startTime]);

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const estimateTimeRemaining = (): string => {
    if (progress === 0 || elapsedTime === 0) return '--:--';
    const totalEstimated = (elapsedTime / progress) * 100;
    const remaining = totalEstimated - elapsedTime;
    return formatTime(remaining);
  };

  const handleUpdateCatalog = useCallback(async () => {
    setIsProcessing(true);
    setProgress(0);
    setStartTime(Date.now());
    setElapsedTime(0);
    setPreviewData(null);
    setFullData(null);
    setLogs(null);
    setProcessingStats(null);

    try {
      updateProgress(10);
      
      const { data, error } = await supabase.functions.invoke('catalog-processor', {
        body: { action: 'process-catalog' }
      });

      if (error) {
        throw new Error(`Errore Supabase: ${error.message}`);
      }

      const result: ProcessingResult = data;

      if (!result.success) {
        throw new Error(result.error || 'Errore sconosciuto durante l\'elaborazione');
      }

      updateProgress(100);

      setPreviewData(result.data || []);
      setFullData(result.fullData || []);
      setLogs(result.logs || []);
      setProcessingStats(result.counters);
      setTimestamp(result.timestamp || '');
      setDateOnly(result.dateOnly || '');

      toast({
        title: "Catalogo aggiornato",
        description: `${result.totalRows} prodotti elaborati con successo`,
      });

    } catch (error) {
      console.error('Error updating catalog:', error);
      toast({
        title: "Errore nell'aggiornamento",
        description: error instanceof Error ? error.message : "Errore sconosciuto",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [supabase, toast, updateProgress]);

  const handleDownloadExcel = useCallback(() => {
    if (!fullData || !timestamp || !dateOnly) return;

    try {
      const worksheet = XLSX.utils.json_to_sheet(fullData);
      const workbook = XLSX.utils.book_new();
      
      // Set column widths
      const maxWidth = 20;
      const wscols = Object.keys(fullData[0] || {}).map(() => ({ width: maxWidth }));
      worksheet['!cols'] = wscols;
      
      XLSX.utils.book_append_sheet(workbook, worksheet, dateOnly);
      XLSX.writeFile(workbook, `catalogo_${timestamp}.xlsx`);
      
      toast({
        title: "Excel scaricato",
        description: `File catalogo_${timestamp}.xlsx scaricato con ${fullData.length} prodotti`,
      });
    } catch (error) {
      toast({
        title: "Errore nel download",
        description: error instanceof Error ? error.message : "Errore sconosciuto",
        variant: "destructive",
      });
    }
  }, [fullData, timestamp, dateOnly, toast]);

  const handleDownloadLog = useCallback(() => {
    if (!logs || !timestamp) return;

    try {
      const csvContent = [
        'source_file;line_number;Matnr;ManufPartNr;EAN;reason',
        ...logs.map(log => 
          `${log.source_file};${log.line_number || ''};${log.Matnr};${log.ManufPartNr};${log.EAN};${log.reason}`
        )
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `catalogo_log_${timestamp}.csv`;
      link.click();

      toast({
        title: "Log scaricato",
        description: `File catalogo_log_${timestamp}.csv scaricato con ${logs.length} voci`,
      });
    } catch (error) {
      toast({
        title: "Errore nel download log",
        description: error instanceof Error ? error.message : "Errore sconosciuto",
        variant: "destructive",
      });
    }
  }, [logs, timestamp, toast]);

  const canDownloadExcel = fullData && fullData.length > 0;
  const canDownloadLog = logs && logs.length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-hero border-b shadow-elevation">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Database className="h-10 w-10 text-primary" />
              <h1 className="text-4xl font-bold text-primary">Gestione Catalogo</h1>
            </div>
            <p className="text-xl text-primary/80 max-w-3xl mx-auto">
              Aggiorna automaticamente il catalogo prodotti collegandoti via FTP e processando i file materiali
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Progress Bar */}
        {isProcessing && (
          <Card className="p-6 mb-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-card-foreground">Elaborazione in corso...</span>
                <span className="text-sm text-muted-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-3" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Tempo trascorso: {formatTime(elapsedTime)}</span>
                <span>Tempo stimato rimanente: {estimateTimeRemaining()}</span>
              </div>
            </div>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Button
            onClick={handleUpdateCatalog}
            disabled={isProcessing}
            variant="hero"
            size="lg"
            className="min-w-[250px]"
          >
            <RefreshCw className={`mr-2 h-5 w-5 ${isProcessing ? 'animate-spin' : ''}`} />
            AGGIORNA CATALOGO
          </Button>
          
          <Button
            onClick={handleDownloadExcel}
            disabled={!canDownloadExcel}
            variant="success"
            size="lg"
            className="min-w-[200px]"
          >
            <Download className="mr-2 h-5 w-5" />
            SCARICA EXCEL
          </Button>

          <Button
            onClick={handleDownloadLog}
            disabled={!canDownloadLog}
            variant="outline"
            size="lg"
            className="min-w-[200px]"
          >
            <FileText className="mr-2 h-5 w-5" />
            SCARICA LOG
          </Button>
        </div>

        {/* Processing Statistics */}
        {processingStats && (
          <Card className="p-6 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <h2 className="text-2xl font-semibold text-card-foreground">
                Riepilogo Elaborazione
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{processingStats.materialRows}</div>
                <div className="text-sm text-muted-foreground">Righe Material</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{processingStats.stockRows}</div>
                <div className="text-sm text-muted-foreground">Righe Stock</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{processingStats.priceRows}</div>
                <div className="text-sm text-muted-foreground">Righe Price</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">{processingStats.finalRows}</div>
                <div className="text-sm text-muted-foreground">Righe Finali</div>
              </div>
            </div>
            
            {(processingStats.duplicateMatnr > 0 || processingStats.emptyEAN > 0 || processingStats.invalidStock > 0 || processingStats.missingPrices > 0) && (
              <div className="mt-6 pt-4 border-t">
                <h3 className="text-lg font-semibold text-card-foreground mb-3">Scarti per Motivo</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {processingStats.duplicateMatnr > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-orange-500">{processingStats.duplicateMatnr}</div>
                      <div className="text-sm text-muted-foreground">Duplicati Matnr</div>
                    </div>
                  )}
                  {processingStats.emptyEAN > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-orange-500">{processingStats.emptyEAN}</div>
                      <div className="text-sm text-muted-foreground">EAN Vuoto</div>
                    </div>
                  )}
                  {processingStats.invalidStock > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-orange-500">{processingStats.invalidStock}</div>
                      <div className="text-sm text-muted-foreground">Stock Invalido</div>
                    </div>
                  )}
                  {processingStats.missingPrices > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-orange-500">{processingStats.missingPrices}</div>
                      <div className="text-sm text-muted-foreground">Prezzi Mancanti</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Data Preview */}
        {previewData && previewData.length > 0 && (
          <Card className="p-6 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <h2 className="text-2xl font-semibold text-card-foreground">
                Anteprima Catalogo (Prime 10 Righe)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Matnr</th>
                    <th className="text-left p-2 font-medium">ManufPartNr</th>
                    <th className="text-left p-2 font-medium">EAN</th>
                    <th className="text-left p-2 font-medium">ShortDescription</th>
                    <th className="text-left p-2 font-medium">ExistingStock</th>
                    <th className="text-left p-2 font-medium">ListPrice</th>
                    <th className="text-left p-2 font-medium">CustBestPrice</th>
                    <th className="text-left p-2 font-medium">IVA</th>
                    <th className="text-left p-2 font-medium">ListPrice con IVA</th>
                    <th className="text-left p-2 font-medium">CustBestPrice con IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((row, index) => (
                    <tr key={index} className="border-b hover:bg-muted/25">
                      <td className="p-2">{row.Matnr}</td>
                      <td className="p-2">{row.ManufPartNr}</td>
                      <td className="p-2">{row.EAN}</td>
                      <td className="p-2 max-w-[200px] truncate">{row.ShortDescription}</td>
                      <td className="p-2">{row.ExistingStock}</td>
                      <td className="p-2">{row.ListPrice.toFixed(2).replace('.', ',')}</td>
                      <td className="p-2">{row.CustBestPrice.toFixed(2).replace('.', ',')}</td>
                      <td className="p-2">{row.IVA}</td>
                      <td className="p-2">{row['ListPrice con IVA'].toFixed(2).replace('.', ',')}</td>
                      <td className="p-2">{row['CustBestPrice con IVA'].toFixed(2).replace('.', ',')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Instructions */}
        <Card className="p-6 bg-accent/30">
          <h3 className="text-lg font-semibold text-card-foreground mb-4">
            Come utilizzare la Gestione Catalogo
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Clicca su <strong>"AGGIORNA CATALOGO"</strong> per avviare la connessione FTP automatica</li>
            <li>Il sistema scarica automaticamente i tre file necessari dal server FTP configurato</li>
            <li>I dati vengono elaborati applicando i filtri e i calcoli IVA richiesti</li>
            <li>Visualizza l'anteprima delle prime 10 righe del catalogo elaborato</li>
            <li>Scarica il file Excel completo con <strong>"SCARICA EXCEL"</strong></li>
            <li>Scarica il file di log dettagliato con <strong>"SCARICA LOG"</strong> per analisi approfondite</li>
          </ol>
          
          <div className="mt-6 pt-4 border-t">
            <h4 className="font-semibold text-card-foreground mb-2">File elaborati automaticamente:</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li><strong>MaterialFile.txt</strong> - Elenco completo prodotti con Matnr, ManufPartNr, EAN, ShortDescription</li>
              <li><strong>StockFileData_790813.txt</strong> - Dati scorte con Matnr, ManufPartNr, ExistingStock</li>
              <li><strong>pricefileData_790813.txt</strong> - Listini prezzi con Matnr, ManufPartNr, ListPrice, CustBestPrice</li>
            </ul>
          </div>

          {!import.meta.env.VITE_SUPABASE_URL && (
            <div className="mt-4 p-4 bg-orange-100 border border-orange-300 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <span className="font-medium text-orange-800">Configurazione Richiesta</span>
              </div>
              <p className="text-sm text-orange-700 mt-1">
                Per utilizzare questa funzionalità è necessario configurare le credenziali FTP nelle variabili d'ambiente.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default CatalogManager;