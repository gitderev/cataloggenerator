import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, 
  Download, 
  CheckCircle, 
  XCircle, 
  Cloud, 
  FileText,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { useSyncProgress, EXPORT_FILES, type SyncRunState } from '@/hooks/useSyncProgress';

interface ServerSyncPanelProps {
  disabled?: boolean;
  onSyncStarted?: () => void;
  onSyncComplete?: () => void;
}

export const ServerSyncPanel: React.FC<ServerSyncPanelProps> = ({
  disabled = false,
  onSyncStarted,
  onSyncComplete,
}) => {
  const {
    state,
    isRunning,
    isComplete,
    isFailed,
    startSync,
    downloadExport,
    reset,
    getProgress,
    getStepDisplayName,
  } = useSyncProgress();

  const handleStartSync = async () => {
    onSyncStarted?.();
    const success = await startSync();
    if (success) {
      // Wait for completion via polling
    }
  };

  React.useEffect(() => {
    if (isComplete) {
      onSyncComplete?.();
    }
  }, [isComplete, onSyncComplete]);

  const progress = getProgress();
  const stepName = getStepDisplayName(state.currentStep);

  return (
    <Card className="p-6 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            Pipeline Server-Side
          </h3>
          {state.runId && (
            <span className="text-xs text-muted-foreground font-mono">
              Run: {state.runId.substring(0, 8)}...
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Genera gli export (Catalogo EAN, ePrice, Mediaworld) sul server e caricali su SFTP.
          I file scaricati saranno identici a quelli inviati via SFTP.
        </p>

        {/* Status Display */}
        {isRunning && (
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 animate-spin text-primary" />
              <span className="font-medium">In esecuzione: {stepName}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progresso: {progress}%</span>
              {state.startedAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Avviato: {state.startedAt.toLocaleTimeString('it-IT')}
                </span>
              )}
            </div>
          </div>
        )}

        {isComplete && (
          <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-2">
              <CheckCircle className="h-5 w-5" />
              <span className="font-semibold">Pipeline completata con successo</span>
            </div>
            {state.runtimeMs && (
              <p className="text-sm text-green-600 dark:text-green-500">
                Tempo di esecuzione: {Math.round(state.runtimeMs / 1000)}s
              </p>
            )}
          </div>
        )}

        {isFailed && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 mb-2">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold">Pipeline fallita</span>
            </div>
            {state.errorMessage && (
              <p className="text-sm text-red-600 dark:text-red-500 break-words">
                {state.errorMessage}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className="mt-2"
            >
              Riprova
            </Button>
          </div>
        )}

        {/* Location Warnings */}
        {Object.keys(state.locationWarnings).length > 0 && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium text-sm">Warning Stock Location</span>
            </div>
            <ul className="text-xs text-amber-600 dark:text-amber-500 space-y-1">
              {Object.entries(state.locationWarnings).map(([key, count]) => (
                count > 0 && (
                  <li key={key}>
                    {key.replace(/_/g, ' ')}: {count}
                  </li>
                )
              ))}
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleStartSync}
            disabled={disabled || isRunning}
            className="flex-1 min-w-[200px]"
            size="lg"
          >
            {isRunning ? (
              <>
                <Activity className="mr-2 h-5 w-5 animate-spin" />
                Pipeline in corso...
              </>
            ) : (
              <>
                <Cloud className="mr-2 h-5 w-5" />
                AVVIA PIPELINE SERVER
              </>
            )}
          </Button>
        </div>

        {/* Download Buttons - Only shown after success or always available */}
        {(isComplete || state.status === 'idle') && (
          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Download className="h-4 w-4" />
              Scarica Export (file server-side)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {Object.entries(EXPORT_FILES).map(([key, file]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClick={() => downloadExport(key as keyof typeof EXPORT_FILES)}
                  disabled={isRunning}
                  className="justify-start"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {file.displayName}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              I file CSV scaricati sono identici a quelli caricati su SFTP dalla pipeline.
            </p>
          </div>
        )}

        {/* Step Details (collapsible) */}
        {Object.keys(state.steps).length > 0 && state.currentStep !== 'current_step' && (
          <details className="border-t pt-4 mt-4">
            <summary className="text-sm font-medium cursor-pointer hover:text-primary">
              Dettaglio step eseguiti
            </summary>
            <div className="mt-2 space-y-1 text-xs">
              {Object.entries(state.steps)
                .filter(([key]) => key !== 'current_step')
                .map(([stepKey, stepData]) => (
                  <div key={stepKey} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                    {stepData.status === 'completed' || stepData.status === 'success' ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : stepData.status === 'failed' ? (
                      <XCircle className="h-3 w-3 text-red-500" />
                    ) : (
                      <Activity className="h-3 w-3 text-primary animate-spin" />
                    )}
                    <span className="font-mono">{stepKey}</span>
                    <span className="text-muted-foreground">
                      {stepData.status}
                      {stepData.rows && ` (${stepData.rows} righe)`}
                      {stepData.duration_ms && ` - ${stepData.duration_ms}ms`}
                    </span>
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
};

export default ServerSyncPanel;
