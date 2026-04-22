import { ipcMain, shell } from 'electron';
import path from 'path';
import { getStorageDb, getStorageDbSummary } from './database.js';
import { clearStorageCache, collectDirectoryStats, saveOriginalFile } from './files.js';
import { ensureStorageLayout, getStoragePaths } from './paths.js';

let registered = false;

function normalizeInvoicePayload(payload = {}) {
  return {
    raw_data: payload.raw_data ?? '',
    invoice_code: payload.invoice_code ?? null,
    invoice_number: payload.invoice_number ?? null,
    amount: payload.amount ?? null,
    date: payload.date ?? null,
    check_code: payload.check_code ?? null,
    is_duplicate: payload.is_duplicate ? 1 : 0,
    buyer_company: payload.buyer_company ?? null,
    invoice_type: payload.invoice_type ?? null,
    seller_company: payload.seller_company ?? null,
    tax_rate: payload.tax_rate ?? null,
    tax_amount: payload.tax_amount ?? null,
    total_amount: payload.total_amount ?? null,
    reimburser: payload.reimburser ?? null,
    targetMonth: payload.targetMonth ?? null,
    created_at: payload.created_at ?? new Date().toISOString(),
    import_batch_id: payload.import_batch_id ?? null,
    source_page: payload.source_page ?? null,
    primary_file_id: payload.primary_file_id ?? null,
    original_file_path: payload.original_file_path ?? null,
    preview_file_path: payload.preview_file_path ?? null,
    thumbnail_file_path: payload.thumbnail_file_path ?? null,
  };
}

function getPublicStoragePaths() {
  const paths = getStoragePaths();
  return {
    storageRoot: paths.storageRoot,
    databaseFile: paths.databaseFile,
    originalsRoot: paths.originalsRoot,
    previewsRoot: paths.previewsRoot,
    thumbnailsRoot: paths.thumbnailsRoot,
    ocrTempRoot: paths.ocrTempRoot,
    exportTempRoot: paths.exportTempRoot,
    logsRoot: paths.logsRoot,
  };
}

function normalizePathForMatch(filePath) {
  return path.normalize(filePath || '').toLowerCase();
}

function buildStorageSummary() {
  const paths = getStoragePaths();
  const db = getStorageDb();
  const dbSummary = getStorageDbSummary();
  const originalsStats = collectDirectoryStats(paths.originalsRoot);
  const previewsStats = collectDirectoryStats(paths.previewsRoot);
  const cacheStats = collectDirectoryStats(paths.cacheRoot);
  const storedFiles = db
    .prepare(`
      SELECT absolute_path
      FROM files
      WHERE absolute_path IS NOT NULL AND TRIM(absolute_path) <> ''
    `)
    .all();
  const trackedPaths = new Set(
    storedFiles.map((row) => normalizePathForMatch(row.absolute_path)).filter(Boolean)
  );
  const orphanDiskOriginalFileCount = originalsStats.filePaths.reduce((count, filePath) => {
    return count + (trackedPaths.has(normalizePathForMatch(filePath)) ? 0 : 1);
  }, 0);
  const orphanDiskPreviewFileCount = previewsStats.filePaths.reduce((count, filePath) => {
    return count + (trackedPaths.has(normalizePathForMatch(filePath)) ? 0 : 1);
  }, 0);
  const totalSizeBytes =
    dbSummary.databaseFileSize + originalsStats.bytes + previewsStats.bytes + cacheStats.bytes;

  return {
    database: {
      path: dbSummary.databasePath,
      exists: dbSummary.databaseFileExists,
      sizeBytes: dbSummary.databaseFileSize,
      schemaVersion: dbSummary.schemaVersion,
    },
    counts: {
      invoices: dbSummary.invoiceCount,
      files: dbSummary.fileCount,
      imageBase64: dbSummary.imageBase64Count,
      missingOriginalFilePath: dbSummary.missingOriginalFilePathCount,
    },
    directories: {
      root: {
        path: paths.storageRoot,
      },
      originals: {
        path: paths.originalsRoot,
        sizeBytes: originalsStats.bytes,
        fileCount: originalsStats.fileCount,
      },
      previews: {
        path: paths.previewsRoot,
        sizeBytes: previewsStats.bytes,
        fileCount: previewsStats.fileCount,
      },
      cache: {
        path: paths.cacheRoot,
        sizeBytes: cacheStats.bytes,
        fileCount: cacheStats.fileCount,
      },
    },
    totals: {
      sizeBytes: totalSizeBytes,
    },
    orphaned: {
      fileRecords: dbSummary.orphanFileRecordCount,
      invoicePrimaryFiles: dbSummary.orphanInvoicePrimaryFileCount,
      diskOriginalFiles: orphanDiskOriginalFileCount,
      diskPreviewFiles: orphanDiskPreviewFileCount,
      hasAny:
        dbSummary.orphanFileRecordCount > 0 ||
        dbSummary.orphanInvoicePrimaryFileCount > 0 ||
        orphanDiskOriginalFileCount > 0 ||
        orphanDiskPreviewFileCount > 0,
    },
    capabilities: {
      supportsImageBase64Column: dbSummary.supportsImageBase64Column,
    },
  };
}

export function registerStorageIpcHandlers() {
  if (registered) {
    return;
  }

  ensureStorageLayout();
  getStorageDb();

  ipcMain.handle('storage:get-paths', async () => {
    return getPublicStoragePaths();
  });

  ipcMain.handle('storage:get-summary', async () => {
    return buildStorageSummary();
  });

  ipcMain.handle('storage:open-root', async () => {
    const paths = getStoragePaths();
    const error = await shell.openPath(paths.storageRoot);

    return {
      ok: !error,
      target: paths.storageRoot,
      error: error || null,
    };
  });

  ipcMain.handle('storage:clear-cache', async () => {
    try {
      return clearStorageCache();
    } catch (error) {
      return {
        ok: false,
        deletedBytes: 0,
        deletedFiles: 0,
        deletedDirectories: 0,
        targetPaths: [
          getStoragePaths().thumbnailsRoot,
          getStoragePaths().ocrTempRoot,
          getStoragePaths().exportTempRoot,
          getStoragePaths().logsRoot,
        ],
        error: error instanceof Error ? error.message : '清缓存失败',
      };
    }
  });

  ipcMain.handle('storage:save-original-file', async (_event, payload) => {
    if (payload?.content == null) {
      throw new Error('content is required');
    }

    return saveOriginalFile(payload);
  });

  ipcMain.handle('storage:create-invoice-record', async (_event, payload) => {
    const db = getStorageDb();
    const invoice = normalizeInvoicePayload(payload?.invoice);
    const file = payload?.file ?? null;

    const insertInvoice = db.prepare(`
      INSERT INTO invoices (
        raw_data,
        invoice_code,
        invoice_number,
        amount,
        date,
        check_code,
        is_duplicate,
        buyer_company,
        invoice_type,
        seller_company,
        tax_rate,
        tax_amount,
        total_amount,
        reimburser,
        targetMonth,
        created_at,
        import_batch_id,
        source_page,
        primary_file_id,
        original_file_path,
        preview_file_path,
        thumbnail_file_path
      ) VALUES (
        @raw_data,
        @invoice_code,
        @invoice_number,
        @amount,
        @date,
        @check_code,
        @is_duplicate,
        @buyer_company,
        @invoice_type,
        @seller_company,
        @tax_rate,
        @tax_amount,
        @total_amount,
        @reimburser,
        @targetMonth,
        @created_at,
        @import_batch_id,
        @source_page,
        @primary_file_id,
        @original_file_path,
        @preview_file_path,
        @thumbnail_file_path
      )
    `);

    const insertFile = db.prepare(`
      INSERT INTO files (
        invoice_id,
        file_role,
        file_kind,
        original_name,
        mime_type,
        ext,
        size_bytes,
        relative_path,
        absolute_path,
        sha256,
        source_page
      ) VALUES (
        @invoice_id,
        @file_role,
        @file_kind,
        @original_name,
        @mime_type,
        @ext,
        @size_bytes,
        @relative_path,
        @absolute_path,
        @sha256,
        @source_page
      )
    `);

    const updatePrimaryFile = db.prepare(`
      UPDATE invoices
      SET primary_file_id = ?, original_file_path = ?
      WHERE id = ?
    `);

    const selectInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?');
    const selectFile = db.prepare('SELECT * FROM files WHERE id = ?');

    const tx = db.transaction(() => {
      const invoiceResult = insertInvoice.run(invoice);
      const invoiceId = Number(invoiceResult.lastInsertRowid);
      let fileRow = null;

      if (file) {
        const fileResult = insertFile.run({
          invoice_id: invoiceId,
          file_role: file.file_role ?? 'original',
          file_kind: file.file_kind ?? 'attachment',
          original_name: file.original_name ?? null,
          mime_type: file.mime_type ?? null,
          ext: file.ext ?? path.extname(file.absolute_path || file.relative_path || ''),
          size_bytes: file.size_bytes ?? 0,
          relative_path: file.relative_path,
          absolute_path: file.absolute_path,
          sha256: file.sha256 ?? null,
          source_page: file.source_page ?? null,
        });
        const fileId = Number(fileResult.lastInsertRowid);
        updatePrimaryFile.run(fileId, file.absolute_path, invoiceId);
        fileRow = selectFile.get(fileId);
      }

      return {
        invoice: selectInvoice.get(invoiceId),
        file: fileRow,
      };
    });

    return tx();
  });

  registered = true;
}
