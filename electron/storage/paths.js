import fs from 'fs';
import path from 'path';
import { app } from 'electron';

let cachedPaths = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function getStoragePaths() {
  if (cachedPaths) {
    return cachedPaths;
  }

  const userDataRoot = app.getPath('userData');
  const storageRoot = path.join(userDataRoot, 'storage');

  cachedPaths = {
    userDataRoot,
    storageRoot,
    dataRoot: path.join(storageRoot, 'data'),
    databaseFile: path.join(storageRoot, 'data', 'invoices.db'),
    filesRoot: path.join(storageRoot, 'files'),
    originalsRoot: path.join(storageRoot, 'files', 'originals'),
    previewsRoot: path.join(storageRoot, 'files', 'previews'),
    cacheRoot: path.join(storageRoot, 'cache'),
    thumbnailsRoot: path.join(storageRoot, 'cache', 'thumbnails'),
    ocrTempRoot: path.join(storageRoot, 'cache', 'ocr-temp'),
    exportTempRoot: path.join(storageRoot, 'cache', 'export-temp'),
    logsRoot: path.join(storageRoot, 'cache', 'logs'),
  };

  return cachedPaths;
}

export function ensureStorageLayout() {
  const paths = getStoragePaths();

  [
    paths.storageRoot,
    paths.dataRoot,
    paths.filesRoot,
    paths.originalsRoot,
    paths.previewsRoot,
    paths.cacheRoot,
    paths.thumbnailsRoot,
    paths.ocrTempRoot,
    paths.exportTempRoot,
    paths.logsRoot,
  ].forEach(ensureDir);

  return paths;
}

export function buildDatedSubdir(rootDir, date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return ensureDir(path.join(rootDir, year, month));
}
