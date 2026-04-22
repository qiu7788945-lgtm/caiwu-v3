import { contextBridge, ipcRenderer } from 'electron';

const storageApi = {
  getPaths: () => ipcRenderer.invoke('storage:get-paths'),
  getSummary: () => ipcRenderer.invoke('storage:get-summary'),
  openRoot: () => ipcRenderer.invoke('storage:open-root'),
  openPath: (target) => ipcRenderer.invoke('storage:open-path', target),
  clearCache: (action) => ipcRenderer.invoke('storage:clear-cache', action),
  optimizeDatabase: (options) => ipcRenderer.invoke('storage:optimize-database', options),
  saveOriginalFile: (payload) => ipcRenderer.invoke('storage:save-original-file', payload),
  createInvoiceRecord: (payload) => ipcRenderer.invoke('storage:create-invoice-record', payload),
};

const migrationApi = {
  getStatus: (options) => ipcRenderer.invoke('migration:get-status', options),
  startLegacySync: (options) => ipcRenderer.invoke('migration:start-legacy-sync', options),
  pauseLegacySync: (options) => ipcRenderer.invoke('migration:pause-legacy-sync', options),
  resumeLegacySync: (options) => ipcRenderer.invoke('migration:resume-legacy-sync', options),
  runLegacySyncBatch: (payload) => ipcRenderer.invoke('migration:run-legacy-sync-batch', payload),
};

try {
  contextBridge.exposeInMainWorld('invoiceStorage', storageApi);
  contextBridge.exposeInMainWorld('invoiceMigration', migrationApi);
} catch {
  window.invoiceStorage = storageApi;
  window.invoiceMigration = migrationApi;
}
