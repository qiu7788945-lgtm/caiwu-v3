import { contextBridge, ipcRenderer } from 'electron';

const storageApi = {
  getPaths: () => ipcRenderer.invoke('storage:get-paths'),
  getSummary: () => ipcRenderer.invoke('storage:get-summary'),
  openRoot: () => ipcRenderer.invoke('storage:open-root'),
  clearCache: () => ipcRenderer.invoke('storage:clear-cache'),
  saveOriginalFile: (payload) => ipcRenderer.invoke('storage:save-original-file', payload),
  createInvoiceRecord: (payload) => ipcRenderer.invoke('storage:create-invoice-record', payload),
};

const ocrApi = {
  health: () => ipcRenderer.invoke('ocr:health'),
  recognizeImage: (payload) => ipcRenderer.invoke('ocr:image', payload),
};

try {
  contextBridge.exposeInMainWorld('invoiceStorage', storageApi);
  contextBridge.exposeInMainWorld('invoiceOcr', ocrApi);
} catch {
  window.invoiceStorage = storageApi;
  window.invoiceOcr = ocrApi;
}
