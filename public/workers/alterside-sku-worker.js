// alterside-sku-worker.js - Module Worker for SKU processing
// Self-contained with all utilities inlined, no imports

let isProcessing = false;
let shouldCancel = false;
let indexByMPN = new Map();
let indexByEAN = new Map();

// Worker boot signal - MUST be first line of execution
self.postMessage({ type: 'worker_boot', version: 'module-1.0' });

// Global error handler
self.addEventListener('error', function(e) {
  self.postMessage({
    type: 'worker_error',
    where: 'boot',
    message: e.message || 'Worker boot error',
    detail: {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error ? e.error.stack : null
    }
  });
});

// Utility functions - all inlined
function sanitizeEAN(ean) {
  if (!ean) return '';
  return String(ean).replace(/[^0-9]/g, '');
}

function toCents(euro) {
  return Math.round(parseFloat(euro) * 100);
}

function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

// Message handler with full protocol compliance
self.onmessage = function(e) {
  try {
    const { type, data } = e.data || {};
    
    if (type === 'INIT') {
      // Hardened INIT handling
      try {
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid INIT payload');
        }
        
        // Respond with worker_ready
        self.postMessage({
          type: 'worker_ready',
          version: 'module-1.0',
          schema: 1
        });
        
        console.log('ready_emitted=true');
        return;
        
      } catch (error) {
        self.postMessage({
          type: 'worker_error',
          where: 'boot',
          message: error.message,
          stack: error.stack
        });
        return;
      }
    }
    
    if (type === 'PRESCAN_START') {
      try {
        // Calculate total immediately
        const materialData = data?.materialData || [];
        const total = materialData.filter(row => 
          row.ManufPartNr && String(row.ManufPartNr).trim()
        ).length;
        
        if (total === 0) {
          throw new Error('No valid ManufPartNr found for prescan');
        }
        
        // Send immediate progress with done=0
        self.postMessage({
          type: 'prescan_progress',
          done: 0,
          total: total
        });
        
        // Simulate prescan processing
        let done = 0;
        const batchSize = Math.max(1, Math.floor(total / 10));
        
        const processBatch = () => {
          if (shouldCancel) return;
          
          done = Math.min(done + batchSize, total);
          
          self.postMessage({
            type: 'prescan_progress',
            done: done,
            total: total
          });
          
          if (done >= total) {
            self.postMessage({
              type: 'prescan_done',
              counts: {
                mpnIndexed: total,
                eanIndexed: materialData.filter(row => row.EAN).length
              },
              total: total
            });
          } else {
            setTimeout(processBatch, 50);
          }
        };
        
        setTimeout(processBatch, 100);
        
      } catch (error) {
        self.postMessage({
          type: 'worker_error',
          where: 'prescan',
          message: error.message,
          detail: 'total_failed'
        });
      }
      return;
    }
    
    if (type === 'SKU_START') {
      // SKU processing logic would go here
      // For now, just acknowledge
      self.postMessage({
        type: 'sku_progress',
        done: 0,
        total: data?.sourceRows?.length || 0
      });
      return;
    }
    
    if (type === 'ping') {
      self.postMessage({ type: 'pong' });
      return;
    }
    
    if (type === 'cancel') {
      shouldCancel = true;
      self.postMessage({ type: 'cancelled' });
      return;
    }
    
    if (type === 'crash') {
      // Intentional crash for testing
      throw new Error('Intentional crash for echo test');
    }
    
  } catch (error) {
    self.postMessage({
      type: 'worker_error',
      where: 'runtime',
      message: error.message,
      stack: error.stack
    });
  }
};