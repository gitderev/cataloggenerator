import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface MaterialFileUploadProps {
  onFileSelect: (file: File) => void;
  selectedFile?: File | null;
}

export const MaterialFileUpload: React.FC<MaterialFileUploadProps> = ({
  onFileSelect,
  selectedFile
}) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'text/tab-separated-values': ['.txt', '.tsv']
    },
    multiple: false
  });

  const removeFile = () => {
    onFileSelect(null as any);
  };

  return (
    <Card className="p-6 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-accent/10">
      <div className="flex items-center gap-3 mb-4">
        <Database className="h-6 w-6 text-primary" />
        <h3 className="text-lg font-semibold text-card-foreground">
          File Materiali Base (materialfile.txt)
        </h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Carica il file principale contenente l'elenco completo dei prodotti con codici SKU
      </p>
      
      {!selectedFile ? (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-300 ${
            isDragActive 
              ? 'border-primary bg-primary/20 shadow-glow' 
              : 'border-primary/30 hover:border-primary hover:bg-primary/10'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="mx-auto h-12 w-12 text-primary mb-4" />
          {isDragActive ? (
            <p className="text-primary font-medium">Rilascia il file materialfile.txt qui...</p>
          ) : (
            <div>
              <p className="text-foreground font-medium mb-2">
                Trascina il file materialfile.txt qui o clicca per selezionare
              </p>
              <p className="text-muted-foreground text-sm">
                File base con l'elenco completo dei prodotti
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between p-4 bg-primary/10 rounded-lg border border-primary/20">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <div>
              <p className="font-medium text-card-foreground">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={removeFile}
            className="text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Card>
  );
};