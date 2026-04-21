import { contextBridge, ipcRenderer } from 'electron';

const storageApi = {
  getPaths: () => ipcRenderer.invoke('storage:get-paths'),
  getSummary: () => ipcRenderer.invoke('storage:get-summary'),
  openRoot: () => ipcRenderer.invoke('storage:open-root'),
  saveOriginalFile: (payload) => ipcRenderer.invoke('storage:save-original-file', payload),
  createInvoiceRecord: (payload) => ipcRenderer.invoke('storage:create-invoice-record', payload),
};

try {
  contextBridge.exposeInMainWorld('invoiceStorage', storageApi);
} catch {
  window.invoiceStorage = storageApi;
}
