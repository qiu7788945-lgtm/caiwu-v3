import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureStorageLayout } from './paths.js';

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

  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }

  if (typeof content === 'string') {
    return Buffer.from(content);
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content);
  }

  throw new Error('Unsupported file content type');
}

function getOriginalsTargetDir(rootDir, createdAt) {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const targetDir = path.join(rootDir, year, month);
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

export function saveOriginalFile({
  content,
  originalName,
  mimeType,
  createdAt = new Date(),
}) {
  const paths = ensureStorageLayout();
  const buffer = toBuffer(content);
  const targetDir = getOriginalsTargetDir(paths.originalsRoot, createdAt);
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

export function collectDirectoryStats(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return {
      bytes: 0,
      fileCount: 0,
      filePaths: [],
    };
  }

  let bytes = 0;
  let fileCount = 0;
  const filePaths = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = fs.statSync(absolutePath);
      bytes += stat.size;
      fileCount += 1;
      filePaths.push(absolutePath);
    }
  }

  return {
    bytes,
    fileCount,
    filePaths,
  };
}

function removeDirectoryContents(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return {
      deletedFiles: 0,
      deletedDirectories: 0,
    };
  }

  let deletedFiles = 0;
  let deletedDirectories = 0;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      const childResult = removeDirectoryContents(absolutePath);
      deletedFiles += childResult.deletedFiles;
      deletedDirectories += childResult.deletedDirectories;
      fs.rmdirSync(absolutePath);
      deletedDirectories += 1;
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    fs.unlinkSync(absolutePath);
    deletedFiles += 1;
  }

  return {
    deletedFiles,
    deletedDirectories,
  };
}

export function clearStorageCache() {
  const paths = ensureStorageLayout();
  const targetPaths = [
    paths.thumbnailsRoot,
    paths.ocrTempRoot,
    paths.exportTempRoot,
    paths.logsRoot,
  ];

  let deletedBytes = 0;
  let deletedFiles = 0;
  let deletedDirectories = 0;

  for (const targetPath of targetPaths) {
    const stats = collectDirectoryStats(targetPath);
    const clearResult = removeDirectoryContents(targetPath);

    deletedBytes += stats.bytes;
    deletedFiles += clearResult.deletedFiles;
    deletedDirectories += clearResult.deletedDirectories;
    fs.mkdirSync(targetPath, { recursive: true });
  }

  return {
    ok: true,
    deletedBytes,
    deletedFiles,
    deletedDirectories,
    targetPaths,
    error: null,
  };
}
