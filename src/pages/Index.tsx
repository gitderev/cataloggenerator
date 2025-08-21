import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { MaterialFileUpload } from '@/components/MaterialFileUpload';
import { AdditionalFilesUpload } from '@/components/AdditionalFilesUpload';
import { DataPreview } from '@/components/DataPreview';
import { MultiColumnMapping } from '@/components/MultiColumnMapping';
import { parseTXT, mergeMultipleTXTData, exportToExcel, autoDetectSKUColumn, ParsedTXT } from '@/utils/txtMerger';
import { useToast } from '@/hooks/use-toast';
import { Merge, Download, FileSpreadsheet, CheckCircle, Database } from 'lucide-react';

interface AdditionalFileData {
  file: File | null;
  parsedData: ParsedTXT | null;
  skuColumn: string;
}

const Index = () => {
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [materialData, setMaterialData] = useState<ParsedTXT | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<AdditionalFileData[]>([
    { file: null, parsedData: null, skuColumn: '' },
    { file: null, parsedData: null, skuColumn: '' },
    { file: null, parsedData: null, skuColumn: '' }
  ]);
  const [mergedData, setMergedData] = useState<any[] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const { toast } = useToast();

  const handleMaterialFileSelect = useCallback(async (file: File | null) => {
    setMaterialFile(file);
    setMaterialData(null);
    
    if (file) {
      try {
        setIsProcessing(true);
        setProgress(25);
        
        const parsed = await parseTXT(file);
        setMaterialData(parsed);
        setProgress(100);
        
        toast({
          title: "File materiali caricato",
          description: `File base elaborato con ${parsed.data.length} prodotti`,
        });
      } catch (error) {
        toast({
          title: "Errore nel caricamento",
          description: error instanceof Error ? error.message : "Errore sconosciuto",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
        setProgress(0);
      }
    }
  }, [toast]);

  const handleAdditionalFileSelect = useCallback((index: number) => {
    return async (file: File | null) => {
      const newAdditionalFiles = [...additionalFiles];
      newAdditionalFiles[index] = { file, parsedData: null, skuColumn: '' };
      setAdditionalFiles(newAdditionalFiles);
      
      if (file) {
        try {
          setIsProcessing(true);
          setProgress(25);
          
          const parsed = await parseTXT(file);
          const detectedSKU = autoDetectSKUColumn(parsed.headers);
          
          newAdditionalFiles[index] = {
            file,
            parsedData: parsed,
            skuColumn: detectedSKU
          };
          setAdditionalFiles(newAdditionalFiles);
          setProgress(100);
          
          toast({
            title: "File aggiuntivo caricato",
            description: `File ${index + 1} elaborato con ${parsed.data.length} righe. ${detectedSKU ? `SKU rilevato: ${detectedSKU}` : ''}`,
          });
        } catch (error) {
          toast({
            title: "Errore nel caricamento",
            description: error instanceof Error ? error.message : "Errore sconosciuto",
            variant: "destructive",
          });
        } finally {
          setIsProcessing(false);
          setProgress(0);
        }
      }
    };
  }, [additionalFiles, toast]);

  const handleSkuColumnChange = useCallback((fileIndex: number, column: string) => {
    const newAdditionalFiles = [...additionalFiles];
    newAdditionalFiles[fileIndex].skuColumn = column;
    setAdditionalFiles(newAdditionalFiles);
  }, [additionalFiles]);

  const handleMerge = useCallback(async () => {
    if (!materialData) {
      toast({
        title: "File materiali mancante",
        description: "Carica prima il file materialfile.txt",
        variant: "destructive",
      });
      return;
    }

    const validAdditionalFiles = additionalFiles.filter(f => 
      f.file && f.parsedData && f.skuColumn
    );

    if (validAdditionalFiles.length === 0) {
      toast({
        title: "File aggiuntivi mancanti",
        description: "Carica almeno un file aggiuntivo con colonna SKU selezionata",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsProcessing(true);
      setProgress(20);

      const additionalFilesData = validAdditionalFiles.map(f => ({
        data: f.parsedData!.data,
        skuColumn: f.skuColumn,
        fileName: f.file!.name.replace('.txt', '')
      }));

      const merged = mergeMultipleTXTData(materialData.data, additionalFilesData);
      setProgress(100);
      setMergedData(merged);

      toast({
        title: "Unione completata",
        description: `${merged.length} prodotti elaborati con ${validAdditionalFiles.length} file aggiuntivi`,
      });
    } catch (error) {
      toast({
        title: "Errore nell'unione",
        description: error instanceof Error ? error.message : "Errore sconosciuto",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [materialData, additionalFiles, toast]);

  const handleExport = useCallback(() => {
    if (!mergedData) return;
    
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      exportToExcel(mergedData, `materiali_uniti_${timestamp}`);
      
      toast({
        title: "Export completato",
        description: `File Excel scaricato con ${mergedData.length} prodotti`,
      });
    } catch (error) {
      toast({
        title: "Errore nell'export",
        description: error instanceof Error ? error.message : "Errore sconosciuto",
        variant: "destructive",
      });
    }
  }, [mergedData, toast]);

  const canMerge = materialData && additionalFiles.some(f => f.file && f.parsedData && f.skuColumn);
  const canExport = mergedData && mergedData.length > 0;
  const validAdditionalFiles = additionalFiles.filter(f => f.parsedData);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-hero border-b shadow-elevation">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Database className="h-10 w-10 text-primary" />
              <h1 className="text-4xl font-bold text-primary">Material Merger Pro</h1>
            </div>
            <p className="text-xl text-primary/80 max-w-3xl mx-auto">
              Unisci il file materiali base con fino a 3 file aggiuntivi per creare un database completo dei prodotti
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Progress Bar */}
        {isProcessing && (
          <Card className="p-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Progress value={progress} className="h-2" />
              </div>
              <span className="text-sm text-muted-foreground">{progress}%</span>
            </div>
          </Card>
        )}

        {/* Material File Upload */}
        <div className="mb-8">
          <MaterialFileUpload
            onFileSelect={handleMaterialFileSelect}
            selectedFile={materialFile}
          />
        </div>

        {/* Additional Files Upload */}
        <div className="mb-8">
          <AdditionalFilesUpload
            files={additionalFiles.map(f => f.file)}
            onFileSelect={handleAdditionalFileSelect}
          />
        </div>

        {/* Column Mapping */}
        {materialData && validAdditionalFiles.length > 0 && (
          <>
            <MultiColumnMapping
              materialHeaders={materialData.headers}
              additionalFiles={validAdditionalFiles.map(f => ({
                headers: f.parsedData!.headers,
                fileName: f.file!.name,
                skuColumn: f.skuColumn
              }))}
              onSkuColumnChange={handleSkuColumnChange}
            />
            
            <div className="my-8">
              <Separator />
            </div>
          </>
        )}

        {/* Data Preview Section */}
        {(materialData || validAdditionalFiles.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {materialData && (
              <DataPreview
                data={materialData.data}
                title="Anteprima File Materiali"
              />
            )}
            {validAdditionalFiles.slice(0, 1).map((file, index) => (
              file.parsedData && (
                <DataPreview
                  key={index}
                  data={file.parsedData.data}
                  title={`Anteprima ${file.file!.name}`}
                />
              )
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Button
            onClick={handleMerge}
            disabled={!canMerge || isProcessing}
            variant="hero"
            size="lg"
            className="min-w-[200px]"
          >
            <Merge className="mr-2 h-5 w-5" />
            Unisci File Materiali
          </Button>
          
          <Button
            onClick={handleExport}
            disabled={!canExport}
            variant="success"
            size="lg"
            className="min-w-[200px]"
          >
            <Download className="mr-2 h-5 w-5" />
            Scarica Excel
          </Button>
        </div>

        {/* Merged Data Preview */}
        {mergedData && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <h2 className="text-2xl font-semibold text-card-foreground">
                Risultato Unione
              </h2>
            </div>
            <DataPreview
              data={mergedData}
              title={`Materiali Uniti (${mergedData.length} prodotti)`}
              maxRows={10}
            />
          </div>
        )}

        {/* Instructions */}
        <Card className="p-6 bg-accent/30">
          <h3 className="text-lg font-semibold text-card-foreground mb-4">
            Come utilizzare Material Merger Pro
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Carica il file <strong>materialfile.txt</strong> contenente l'elenco base dei prodotti</li>
            <li>Carica fino a 3 file aggiuntivi con informazioni da aggiungere ai prodotti</li>
            <li>Il sistema rileva automaticamente i delimitatori e le colonne SKU</li>
            <li>Verifica e correggi le colonne SKU se necessario</li>
            <li>Clicca su "Unisci File Materiali" per elaborare i dati</li>
            <li>Scarica il file Excel completo con tutti i dati uniti per SKU</li>
          </ol>
        </Card>
      </div>
    </div>
  );
};

export default Index;