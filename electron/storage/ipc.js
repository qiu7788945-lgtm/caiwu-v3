import { ipcMain, shell } from 'electron';
import path from 'path';
import { getStorageDatabaseInfo, getStorageDb } from './database.js';
import { getStoragePlanningSnapshot, getStorageUsageSummary, saveOriginalFile } from './files.js';
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
    image_base64: payload.image_base64 ?? null,
    primary_file_id: payload.primary_file_id ?? null,
    original_file_path: payload.original_file_path ?? null,
    preview_file_path: payload.preview_file_path ?? null,
    thumbnail_file_path: payload.thumbnail_file_path ?? null,
    storage_status: payload.storage_status ?? 'ready',
    storage_version: payload.storage_version ?? 1,
  };
}

export function registerStorageIpcHandlers() {
  if (registered) {
    return;
  }

  ensureStorageLayout();
  getStorageDb();

  ipcMain.handle('storage:get-paths', async () => {
    return getStoragePlanningSnapshot();
  });

  ipcMain.handle('storage:get-summary', async () => {
    return {
      database: getStorageDatabaseInfo(),
      usage: getStorageUsageSummary(),
    };
  });

  ipcMain.handle('storage:open-root', async () => {
    const paths = getStoragePaths();
    const target = paths.storageRoot;
    const errorMessage = await shell.openPath(target);
    return {
      ok: errorMessage === '',
      target,
      error: errorMessage || null,
    };
  });

  ipcMain.handle('storage:save-original-file', async (_event, payload) => {
    if (!payload?.content) {
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
        image_base64,
        primary_file_id,
        original_file_path,
        preview_file_path,
        thumbnail_file_path,
        storage_status,
        storage_version
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
        @image_base64,
        @primary_file_id,
        @original_file_path,
        @preview_file_path,
        @thumbnail_file_path,
        @storage_status,
        @storage_version
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
      SET primary_file_id = ?, original_file_path = ?, storage_status = 'ready'
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
