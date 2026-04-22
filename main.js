import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureOcrService, registerOcrIpcHandlers, stopOcrService } from './electron/ocr/service.js';
import { getStorageDatabaseInfo } from './electron/storage/database.js';
import { registerStorageIpcHandlers } from './electron/storage/ipc.js';
import { ensureStorageLayout } from './electron/storage/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // Development mode: load the local dev server
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools automatically in dev mode
    // mainWindow.webContents.openDevTools();
  } else {
    // Production mode: load the built React app
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

function initializeStorageFoundation() {
  try {
    ensureStorageLayout();
    registerOcrIpcHandlers();
    registerStorageIpcHandlers();

    const storageInfo = getStorageDatabaseInfo();
    console.log('[storage] sqlite ready:', storageInfo.path);
    console.log('[storage] schema version:', storageInfo.schemaVersion);
  } catch (error) {
    console.error('[storage] initialization skipped:', error);
  }
}

app.whenReady().then(() => {
  initializeStorageFoundation();
  ensureOcrService().then((result) => {
    if (!result.ok) {
      console.warn('[ocr-service] startup skipped:', result.error);
    }
  });
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopOcrService();
});
