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

function scanDirStats(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return { bytes: 0, files: 0, directories: 0 };
  }

  const stat = fs.statSync(targetDir);
  if (stat.isFile()) {
    return { bytes: stat.size, files: 1, directories: 0 };
  }

  return fs.readdirSync(targetDir, { withFileTypes: true }).reduce(
    (acc, entry) => {
      const entryPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        const nested = scanDirStats(entryPath);
        acc.bytes += nested.bytes;
        acc.files += nested.files;
        acc.directories += nested.directories + 1;
      } else {
        const entryStat = fs.statSync(entryPath);
        acc.bytes += entryStat.size;
        acc.files += 1;
      }
      return acc;
    },
    { bytes: 0, files: 0, directories: 0 }
  );
}

function removeDirContents(targetDir) {
  const result = {
    deletedFiles: 0,
    deletedBytes: 0,
    errors: [],
  };

  if (!fs.existsSync(targetDir)) {
    return result;
  }

  const removeEntry = (entryPath) => {
    try {
      const stat = fs.statSync(entryPath);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(entryPath, { withFileTypes: true })) {
          removeEntry(path.join(entryPath, entry.name));
        }
        fs.rmSync(entryPath, { recursive: false, force: true });
        return;
      }

      result.deletedBytes += stat.size;
      result.deletedFiles += 1;
      fs.rmSync(entryPath, { force: true });
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  };

  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    removeEntry(path.join(targetDir, entry.name));
  }

  return result;
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
  const originalsStats = scanDirStats(paths.originalsRoot);
  const previewsStats = scanDirStats(paths.previewsRoot);
  const thumbnailsStats = scanDirStats(paths.thumbnailsRoot);
  const ocrTempStats = scanDirStats(paths.ocrTempRoot);
  const exportTempStats = scanDirStats(paths.exportTempRoot);
  const logsStats = scanDirStats(paths.logsRoot);

  return {
    paths,
    sizes: {
      database: databaseSize,
      originals: originalsStats.bytes,
      previews: previewsStats.bytes,
      thumbnails: thumbnailsStats.bytes,
      ocrTemp: ocrTempStats.bytes,
      exportTemp: exportTempStats.bytes,
      logs: logsStats.bytes,
      total:
        databaseSize +
        originalsStats.bytes +
        previewsStats.bytes +
        thumbnailsStats.bytes +
        ocrTempStats.bytes +
        exportTempStats.bytes +
        logsStats.bytes,
    },
    counts: {
      originals: originalsStats.files,
      previews: previewsStats.files,
      thumbnails: thumbnailsStats.files,
      ocrTemp: ocrTempStats.files,
      exportTemp: exportTempStats.files,
      logs: logsStats.files,
      cacheFiles:
        thumbnailsStats.files +
        ocrTempStats.files +
        exportTempStats.files +
        logsStats.files,
      totalFiles:
        originalsStats.files +
        previewsStats.files +
        thumbnailsStats.files +
        ocrTempStats.files +
        exportTempStats.files +
        logsStats.files,
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

export function clearStorageCache(action) {
  const paths = ensureStorageLayout();
  const actionMap = {
    clearThumbnails: [paths.thumbnailsRoot],
    clearOcrTemp: [paths.ocrTempRoot],
    clearExportTemp: [paths.exportTempRoot],
    clearLogs: [paths.logsRoot],
    clearAllCache: [
      paths.thumbnailsRoot,
      paths.ocrTempRoot,
      paths.exportTempRoot,
      paths.logsRoot,
    ],
    clearOrphanCache: [],
  };

  if (!(action in actionMap)) {
    return {
      ok: false,
      action,
      deletedFiles: 0,
      deletedBytes: 0,
      errors: [`Unsupported cache action: ${action}`],
    };
  }

  if (action === 'clearOrphanCache') {
    return {
      ok: true,
      action,
      deletedFiles: 0,
      deletedBytes: 0,
      errors: [],
      note: 'clearOrphanCache 当前仅保留骨架，暂未执行实际删除，以避免误删正式文件。',
    };
  }

  const result = {
    ok: true,
    action,
    deletedFiles: 0,
    deletedBytes: 0,
    errors: [],
  };

  for (const targetDir of actionMap[action]) {
    const dirResult = removeDirContents(targetDir);
    result.deletedFiles += dirResult.deletedFiles;
    result.deletedBytes += dirResult.deletedBytes;
    result.errors.push(...dirResult.errors);
  }

  result.ok = result.errors.length === 0;
  return result;
}

export function resolveStorageOpenTarget(target = 'root') {
  const paths = ensureStorageLayout();
  const targetMap = {
    root: paths.storageRoot,
    data: paths.dataRoot,
    originals: paths.originalsRoot,
    previews: paths.previewsRoot,
    cache: paths.cacheRoot,
    logs: paths.logsRoot,
  };

  if (!(target in targetMap)) {
    throw new Error(`Unsupported storage open target: ${target}`);
  }

  return {
    target,
    absolutePath: targetMap[target],
  };
}
