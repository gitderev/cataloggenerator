import React from 'react';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Settings, FileText } from 'lucide-react';

interface MultiColumnMappingProps {
  materialHeaders: string[];
  additionalFiles: Array<{
    headers: string[];
    fileName: string;
    skuColumn: string;
  }>;
  onSkuColumnChange: (fileIndex: number, column: string) => void;
}

export const MultiColumnMapping: React.FC<MultiColumnMappingProps> = ({
  materialHeaders,
  additionalFiles,
  onSkuColumnChange
}) => {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <Settings className="h-6 w-6 text-primary" />
        <h3 className="text-lg font-semibold text-card-foreground">
          Configurazione Colonne SKU
        </h3>
      </div>
      <p className="text-muted-foreground mb-6">
        Seleziona le colonne che contengono i codici SKU per ciascun file aggiuntivo
      </p>
      
      <div className="space-y-6">
        {/* Material file info */}
        <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="font-medium text-card-foreground">File Materiali Base</span>
          </div>
          <p className="text-sm text-muted-foreground">
            SKU rilevato automaticamente dalle colonne disponibili
          </p>
        </div>

        {/* Additional files mapping */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {additionalFiles.map((file, index) => (
            <div key={index} className="space-y-2">
              <Label htmlFor={`sku-column-${index}`} className="text-sm font-medium">
                SKU - {file.fileName}
              </Label>
              <Select 
                value={file.skuColumn} 
                onValueChange={(value) => onSkuColumnChange(index, value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona colonna SKU" />
                </SelectTrigger>
                <SelectContent>
                  {file.headers.map((header) => (
                    <SelectItem key={header} value={header}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};