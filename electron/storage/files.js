import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildDatedSubdir, ensureStorageLayout, getStoragePaths } from './paths.js';

function normalizeExtension(originalName = '', mimeType = '', fallback = '.bin') {
  const existingExt = path.extname(originalName || '').toLowerCase();
  if (existingExt) {
    return existingExt;
  }

  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';

  return fallback;
}

function buildStoredFileName(originalName, mimeType) {
  const ext = normalizeExtension(originalName, mimeType);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = crypto.randomBytes(6).toString('hex');
  return `${stamp}_${random}${ext}`;
}

function toBuffer(content) {
  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (typeof content === 'string') {
    return Buffer.from(content);
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content);
  }

  throw new Error('Unsupported file content type');
}

function walkDirSize(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return 0;
  }

  const stat = fs.statSync(targetDir);
  if (stat.isFile()) {
    return stat.size;
  }

  return fs
    .readdirSync(targetDir, { withFileTypes: true })
    .reduce((total, entry) => total + walkDirSize(path.join(targetDir, entry.name)), 0);
}

export function saveOriginalFile({
  content,
  originalName,
  mimeType,
  createdAt = new Date(),
}) {
  const paths = ensureStorageLayout();
  const buffer = toBuffer(content);
  const targetDir = buildDatedSubdir(paths.originalsRoot, createdAt);
  const fileName = buildStoredFileName(originalName, mimeType);
  const absolutePath = path.join(targetDir, fileName);

  fs.writeFileSync(absolutePath, buffer);

  return {
    fileName,
    absolutePath,
    relativePath: path.relative(paths.storageRoot, absolutePath),
    sizeBytes: buffer.length,
    ext: path.extname(fileName).toLowerCase() || null,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

export function getStorageUsageSummary() {
  const paths = ensureStorageLayout();
  const databaseSize = fs.existsSync(paths.databaseFile)
    ? fs.statSync(paths.databaseFile).size
    : 0;

  const originalsSize = walkDirSize(paths.originalsRoot);
  const previewsSize = walkDirSize(paths.previewsRoot);
  const thumbnailsSize = walkDirSize(paths.thumbnailsRoot);
  const ocrTempSize = walkDirSize(paths.ocrTempRoot);
  const exportTempSize = walkDirSize(paths.exportTempRoot);
  const logsSize = walkDirSize(paths.logsRoot);

  return {
    paths,
    sizes: {
      database: databaseSize,
      originals: originalsSize,
      previews: previewsSize,
      thumbnails: thumbnailsSize,
      ocrTemp: ocrTempSize,
      exportTemp: exportTempSize,
      logs: logsSize,
      total:
        databaseSize +
        originalsSize +
        previewsSize +
        thumbnailsSize +
        ocrTempSize +
        exportTempSize +
        logsSize,
    },
  };
}

export function getStoragePlanningSnapshot() {
  const paths = getStoragePaths();
  return {
    databaseFile: paths.databaseFile,
    originalsRoot: paths.originalsRoot,
    previewsRoot: paths.previewsRoot,
    thumbnailsRoot: paths.thumbnailsRoot,
    ocrTempRoot: paths.ocrTempRoot,
    exportTempRoot: paths.exportTempRoot,
    logsRoot: paths.logsRoot,
  };
}
