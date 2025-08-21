import React from 'react';
import { FileUpload } from './FileUpload';
import { Card } from '@/components/ui/card';
import { Plus, FileSpreadsheet } from 'lucide-react';

interface AdditionalFilesUploadProps {
  files: (File | null)[];
  onFileSelect: (index: number) => (file: File | null) => void;
}

export const AdditionalFilesUpload: React.FC<AdditionalFilesUploadProps> = ({
  files,
  onFileSelect
}) => {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <FileSpreadsheet className="h-6 w-6 text-accent-foreground" />
        <h3 className="text-lg font-semibold text-card-foreground">
          File Aggiuntivi
        </h3>
      </div>
      <p className="text-muted-foreground mb-6">
        Carica fino a 3 file aggiuntivi che verranno uniti al file materiali base tramite SKU
      </p>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-2">
            <FileUpload
              onFileSelect={onFileSelect(index)}
              selectedFile={files[index]}
              title={`File Aggiuntivo ${index + 1}`}
            />
          </div>
        ))}
      </div>
    </Card>
  );
};