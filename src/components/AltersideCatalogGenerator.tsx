import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { Upload, Download, FileText, CheckCircle, XCircle, AlertCircle, Clock, Activity, Info, X } from 'lucide-react';

// Simple hardened worker test component
const AltersideCatalogGeneratorFixed = () => {
  const [diagnosticState, setDiagnosticState] = useState({
    isEnabled: false,
    maxRows: 200,
    workerMessages: [],
    statistics: {
      total: 0,
      batchSize: 1000,
      elapsedPrescan: 0,
      elapsedSku: 0
    },
    errorCounters: {
      msgInvalid: 0,
      workerError: 0,
      timeouts: 0
    },
    testResults: [],
    lastHeartbeat: 0
  });

  const [workerStrategy, setWorkerStrategy] = useState<'blob' | 'module'>('blob');
  const [echoTestResult, setEchoTestResult] = useState<string>('');
  const [workerState, setWorkerState] = useState({
    created: false,
    handlersAttached: false,
    initSent: false,
    bootReceived: false,
    readyReceived: false,
    version: ''
  });

  const [debugEvents, setDebugEvents] = useState<string[]>([]);

  const dbg = useCallback((event: string, data?: any) => {
    const timestamp = new Date().toLocaleTimeString('it-IT', { hour12: false });
    const logEntry = `[${timestamp}] ${event}${data ? ': ' + JSON.stringify(data) : ''}`;
    console.log(logEntry);
    setDebugEvents(prev => [...prev.slice(-19), logEntry]);
  }, []);

  const addWorkerMessage = useCallback((data: any) => {
    const timestamp = new Date().toLocaleTimeString('it-IT', { hour12: false });
    const messageId = Date.now();
    
    setDiagnosticState(prev => ({
      ...prev,
      workerMessages: [...prev.workerMessages.slice(-9), { id: messageId, timestamp, data }],
      lastHeartbeat: Date.now()
    }));
  }, []);

  // Echo Worker Test
  const runEchoTest = useCallback(async (strategy: 'blob' | 'module' = 'blob') => {
    setEchoTestResult('Testing...');
    dbg('echo_test_start', { strategy });
    
    try {
      let worker: Worker;
      
      if (strategy === 'blob') {
        // Minimal echo worker code
        const echoWorkerCode = `
          // Echo worker boot signal
          self.postMessage({ type: 'worker_boot', version: 'echo-1.0' });
          
          self.addEventListener('error', function(e) {
            self.postMessage({
              type: 'worker_error',
              where: 'boot',
              message: e.message
            });
          });
          
          self.onmessage = function(e) {
            try {
              if (e.data.type === 'ping') {
                self.postMessage({ type: 'pong' });
              } else if (e.data.type === 'crash') {
                throw new Error('Intentional crash');
              }
            } catch (error) {
              self.postMessage({
                type: 'worker_error',
                where: 'runtime',
                message: error.message
              });
            }
          };
        `;
        
        const blob = new Blob([echoWorkerCode], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        worker = new Worker(blobUrl);
        dbg('echo_created', { type: 'blob', url: blobUrl });
        
        // Clean up blob URL after test
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        
      } else {
        // Module worker
        worker = new Worker(new URL('/workers/alterside-sku-worker.js', location.origin), { type: 'module' });
        dbg('echo_created', { type: 'module', url: '/workers/alterside-sku-worker.js' });
      }
      
      // Test protocol
      let bootReceived = false;
      let pongReceived = false;
      
      const testPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Echo test timeout'));
        }, 3000);
        
        worker.onmessage = (e) => {
          const { type } = e.data;
          
          if (type === 'worker_boot') {
            bootReceived = true;
            dbg('echo_boot', e.data);
            
            // Send ping after boot
            setTimeout(() => {
              worker.postMessage({ type: 'ping' });
            }, 100);
          }
          
          if (type === 'pong') {
            pongReceived = true;
            dbg('echo_pong', e.data);
            
            clearTimeout(timeout);
            worker.terminate();
            
            if (bootReceived && pongReceived) {
              resolve(`✅ Echo test passed (${strategy})`);
            } else {
              resolve(`⚠️ Partial success (${strategy}): boot=${bootReceived}, pong=${pongReceived}`);
            }
          }
          
          if (type === 'worker_error') {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(`Echo worker error: ${e.data.message}`));
          }
        };
        
        worker.onerror = (error) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(error);
        };
      });
      
      const result = await testPromise;
      setEchoTestResult(result);
      
      // If blob test fails, try module worker
      if (strategy === 'blob' && !result.includes('✅')) {
        dbg('echo_blob_failed', { result });
        return await runEchoTest('module');
      }
      
      return result;
      
    } catch (error) {
      const errorMsg = `❌ Echo test failed (${strategy}): ${error instanceof Error ? error.message : 'Unknown error'}`;
      setEchoTestResult(errorMsg);
      dbg('echo_test_error', { strategy, error: errorMsg });
      
      // If blob fails, try module worker
      if (strategy === 'blob') {
        dbg('echo_fallback_to_module');
        setWorkerStrategy('module');
        return await runEchoTest('module');
      }
      
      return errorMsg;
    }
  }, [dbg]);

  const generateDiagnosticBundle = useCallback(() => {
    const bundle = {
      userAgent: navigator.userAgent,
      url: window.location.href,
      appVersion: '1.0.0',
      workerVersion: workerState.version || 'unknown',
      batchSize: diagnosticState.statistics.batchSize,
      sequenzaEventi: debugEvents.slice(-20),
      primi10MessaggiWorker: diagnosticState.workerMessages.slice(0, 10),
      ultimi5MessaggiWorker: diagnosticState.workerMessages.slice(-5),
      statistiche: diagnosticState.statistics,
      primoWorkerError: diagnosticState.workerMessages.find(msg => msg.data.type === 'worker_error')?.data || null,
      errorCounters: diagnosticState.errorCounters,
      testResults: diagnosticState.testResults,
      timestamp: new Date().toISOString()
    };

    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2)).then(() => {
      toast({
        title: "Diagnostica copiata",
        description: "Bundle diagnostico copiato negli appunti",
      });
    }).catch(() => {
      toast({
        title: "Errore copia",
        description: "Impossibile copiare negli appunti",
        variant: "destructive"
      });
    });
  }, [diagnosticState, debugEvents, workerState.version, toast]);

  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-foreground">
          Alterside Catalog Generator - Worker Test
        </h1>
        <p className="text-lg text-muted">
          Test hardenizzato per worker lifecycle e fallback
        </p>
      </header>

      {/* Diagnostic Toggle */}
      <div className="card border-strong">
        <div className="card-body">
          <h3 className="card-title mb-4">Modalità Diagnostica</h3>
          
          <div className="flex items-center gap-4 mb-4">
            <label htmlFor="diagnostic-mode" className="text-sm font-medium">
              Modalità diagnostica
            </label>
            <input
              id="diagnostic-mode"
              type="checkbox"
              checked={diagnosticState.isEnabled}
              onChange={(e) => {
                setDiagnosticState(prev => ({
                  ...prev,
                  isEnabled: e.target.checked
                }));
              }}
              className="w-4 h-4"
            />
          </div>
          
          {diagnosticState.isEnabled && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <button
                  onClick={() => runEchoTest()}
                  className="btn btn-primary"
                >
                  Echo worker test
                </button>
                
                <button
                  onClick={generateDiagnosticBundle}
                  className="btn btn-secondary"
                >
                  Copia diagnostica
                </button>
              </div>
              
              {echoTestResult && (
                <div className="p-3 bg-muted rounded border">
                  <strong>Echo Test Result:</strong> {echoTestResult}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Worker Messages Panel */}
      {diagnosticState.isEnabled && (
        <div className="card border-strong">
          <div className="card-body">
            <h3 className="card-title mb-4 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 icon-dark" />
              Messaggi Worker (primi 10)
            </h3>
            
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {diagnosticState.workerMessages.length === 0 ? (
                <div className="text-sm text-muted">Nessun messaggio worker ricevuto</div>
              ) : (
                diagnosticState.workerMessages.map((msg, index) => (
                  <div key={msg.id} className="p-2 bg-muted rounded text-xs">
                    <div className="font-mono">
                      <strong>worker_msg #{index + 1}:</strong> [{msg.timestamp}] {JSON.stringify(msg.data)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Debug Events Panel */}
      <div className="card border-strong">
        <div className="card-body">
          <h3 className="card-title mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 icon-dark" />
            Eventi Debug
          </h3>
          
          {/* Diagnostic Toggle Debug Info */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-medium mb-2">Condizioni Toggle Diagnostica</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>Condizione completa: <code>diagnosticState.isEnabled</code></div>
              <div>Risultato: <strong>{diagnosticState.isEnabled ? 'TRUE' : 'FALSE'}</strong></div>
              <div>Worker Strategy: <strong>{workerStrategy}</strong></div>
              <div>Echo Test: <strong>{echoTestResult || 'Not run'}</strong></div>
            </div>
          </div>
          
          <textarea
            value={debugEvents.join('\n')}
            readOnly
            className="w-full h-64 p-3 font-mono text-xs bg-muted border border-strong rounded-lg resize-none"
            style={{ whiteSpace: 'pre-wrap' }}
          />
          
          {debugEvents.length > 0 && (
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{debugEvents.length} eventi registrati</span>
              <button
                onClick={() => setDebugEvents([])}
                className="text-primary hover:text-primary-dark"
              >
                Pulisci log
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic Statistics Panel */}
      {diagnosticState.isEnabled && (
        <div className="card border-strong">
          <div className="card-body">
            <h3 className="card-title mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 icon-dark" />
              Statistiche Diagnostiche
            </h3>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="p-3 bg-muted rounded">
                <div className="font-medium">Worker Strategy</div>
                <div className="text-lg">{workerStrategy}</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="font-medium">Boot Received</div>
                <div className="text-lg">{workerState.bootReceived ? '✅' : '❌'}</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="font-medium">Ready Received</div>
                <div className="text-lg">{workerState.readyReceived ? '✅' : '❌'}</div>
              </div>
              <div className="p-3 bg-muted rounded">
                <div className="font-medium">Echo Test</div>
                <div className="text-lg">{echoTestResult ? (echoTestResult.includes('✅') ? '✅' : '❌') : '⏳'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AltersideCatalogGeneratorFixed;