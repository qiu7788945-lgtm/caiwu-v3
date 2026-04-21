import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
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

app.whenReady().then(() => {
  ensureStorageLayout();
  registerStorageIpcHandlers();

  const storageInfo = getStorageDatabaseInfo();
  console.log('[storage] sqlite ready:', storageInfo.path);
  console.log('[storage] schema version:', storageInfo.schemaVersion);

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
