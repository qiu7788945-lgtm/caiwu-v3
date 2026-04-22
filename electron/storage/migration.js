import path from 'path';
import {
  getStorageDb,
  getLegacySyncItem,
  getLegacySyncTaskRow,
  normalizeInvoiceNumberForDuplicateCheck,
  upsertLegacySyncItem,
  upsertLegacySyncTask,
} from './database.js';
import { saveOriginalFile } from './files.js';

const DEFAULT_TASK_KEY = 'legacy_dexie_to_sqlite';
const DEFAULT_BATCH_SIZE = 20;

const migrationRuntimeState = new Map();

function nowIso() {
  return new Date().toISOString();
}

function inferExtensionFromMime(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'application/pdf') return '.pdf';
  return '.bin';
}

function parseLegacyBase64Payload(imageBase64, legacyId) {
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    return null;
  }

  const trimmed = imageBase64.trim();
  const dataUrlMatch = trimmed.match(/^data:(.+?);base64,(.+)$/);

  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1] || 'application/octet-stream';
    const base64Data = dataUrlMatch[2];
    return {
      mimeType,
      buffer: Buffer.from(base64Data, 'base64'),
      originalName: `legacy_invoice_${legacyId ?? Date.now()}${inferExtensionFromMime(mimeType)}`,
    };
  }

  return {
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(trimmed, 'base64'),
    originalName: `legacy_invoice_${legacyId ?? Date.now()}${inferExtensionFromMime('application/octet-stream')}`,
  };
}

function normalizeTaskRow(row, taskKey = DEFAULT_TASK_KEY) {
  if (!row) {
    return {
      migrationKey: taskKey,
      phase: 'bootstrap',
      status: 'idle',
      totalRecords: 0,
      processedRecords: 0,
      successRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      lastCursor: null,
      lastId: null,
      startedAt: null,
      updatedAt: null,
      finishedAt: null,
      lastError: null,
      config: {
        source: 'dexie',
        destination: 'sqlite',
        migrateImageBase64ToFiles: true,
        batchSize: DEFAULT_BATCH_SIZE,
      },
      summary: {
        currentStep: 'not_started',
        canResume: true,
        canPause: false,
        note: 'Legacy sync skeleton is ready. A later phase can continue from the saved cursor.',
      },
      runtime: {
        isRunnerAttached: false,
        pauseRequested: false,
      },
    };
  }

  const config = row.config_json ? JSON.parse(row.config_json) : {
    source: 'dexie',
    destination: 'sqlite',
    migrateImageBase64ToFiles: true,
    batchSize: DEFAULT_BATCH_SIZE,
  };
  const summary = row.summary_json ? JSON.parse(row.summary_json) : {
    currentStep: 'idle',
    canResume: row.status !== 'completed',
    canPause: row.status === 'running',
    note: 'No migration batch has been executed yet.',
  };
  const runtime = migrationRuntimeState.get(taskKey) ?? {
    isRunnerAttached: false,
    pauseRequested: false,
  };

  return {
    migrationKey: row.task_key,
    phase: row.phase,
    status: row.status,
    totalRecords: row.total_records,
    processedRecords: row.processed_records,
    successRecords: row.success_records,
    failedRecords: row.failed_records,
    skippedRecords: row.skipped_records,
    lastCursor: row.last_cursor,
    lastId: row.last_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    config,
    summary,
    runtime,
  };
}

function persistTaskStatus(taskKey, patch = {}) {
  const existing = getLegacySyncTaskRow(taskKey);
  const normalized = normalizeTaskRow(existing, taskKey);
  const next = {
    task_key: taskKey,
    phase: patch.phase ?? normalized.phase,
    status: patch.status ?? normalized.status,
    total_records: patch.totalRecords ?? normalized.totalRecords,
    processed_records: patch.processedRecords ?? normalized.processedRecords,
    success_records: patch.successRecords ?? normalized.successRecords,
    failed_records: patch.failedRecords ?? normalized.failedRecords,
    skipped_records: patch.skippedRecords ?? normalized.skippedRecords,
    last_cursor: patch.lastCursor ?? normalized.lastCursor,
    last_id: patch.lastId ?? normalized.lastId,
    started_at: patch.startedAt ?? normalized.startedAt,
    updated_at: nowIso(),
    finished_at: patch.finishedAt ?? normalized.finishedAt,
    last_error: patch.lastError ?? normalized.lastError,
    config_json: JSON.stringify(patch.config ?? normalized.config),
    summary_json: JSON.stringify(patch.summary ?? normalized.summary),
  };

  return normalizeTaskRow(upsertLegacySyncTask(next), taskKey);
}

function buildLegacyInsertStatements(db) {
  return {
    insertInvoice: db.prepare(`
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
    `),
    insertFile: db.prepare(`
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
    `),
    updatePrimaryFile: db.prepare(`
      UPDATE invoices
      SET primary_file_id = ?, original_file_path = ?, storage_status = 'legacy_migrated'
      WHERE id = ?
    `),
    selectInvoice: db.prepare('SELECT * FROM invoices WHERE id = ?'),
    selectFile: db.prepare('SELECT * FROM files WHERE id = ?'),
    findInvoiceByInvoiceNumber: db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoice_number = ?
      ORDER BY id ASC
      LIMIT 1
    `),
    findInvoiceByBatchAndPage: db.prepare(`
      SELECT id
      FROM invoices
      WHERE import_batch_id = ? AND source_page = ?
      ORDER BY id ASC
      LIMIT 1
    `),
  };
}

function findEquivalentSqliteInvoice({ statements, record }) {
  const normalizedInvoiceNumber = normalizeInvoiceNumberForDuplicateCheck(record.invoice_number);
  if (normalizedInvoiceNumber) {
    const existingByInvoiceNumber = statements.findInvoiceByInvoiceNumber.get(normalizedInvoiceNumber);
    if (existingByInvoiceNumber) {
      return {
        found: true,
        sqliteInvoiceId: Number(existingByInvoiceNumber.id),
        reason: 'already_exists_in_sqlite',
      };
    }
  }

  if (record.import_batch_id && Number.isInteger(record.source_page) && record.source_page != null) {
    const existingByBatchPage = statements.findInvoiceByBatchAndPage.get(
      record.import_batch_id,
      record.source_page
    );
    if (existingByBatchPage) {
      return {
        found: true,
        sqliteInvoiceId: Number(existingByBatchPage.id),
        reason: 'already_exists_in_sqlite',
      };
    }
  }

  return {
    found: false,
    sqliteInvoiceId: null,
    reason: null,
  };
}

function migrateLegacyRecord({ taskKey, statements, record }) {
  if (!record || typeof record !== 'object') {
    return {
      ok: false,
      reason: 'invalid_record',
      error: 'Legacy record is missing or invalid.',
    };
  }

  const legacyId = typeof record.id === 'number' ? record.id : null;
  if (legacyId == null) {
    return {
      ok: false,
      reason: 'invalid_record',
      error: 'Legacy record does not contain a stable Dexie id.',
    };
  }

  const existingMapping = getLegacySyncItem(taskKey, 'dexie', legacyId);
  if (existingMapping?.status === 'success') {
    return {
      ok: true,
      legacyId,
      skipped: true,
      skipReason: 'already_migrated',
      invoiceId: existingMapping.sqlite_invoice_id ?? null,
    };
  }

  if (existingMapping?.status === 'skipped') {
    return {
      ok: true,
      legacyId,
      skipped: true,
      skipReason: existingMapping.skip_reason ?? 'already_skipped',
      invoiceId: existingMapping.sqlite_invoice_id ?? null,
    };
  }

  const equivalentInvoice = findEquivalentSqliteInvoice({ statements, record });
  if (equivalentInvoice.found) {
    upsertLegacySyncItem({
      task_key: taskKey,
      legacy_source: 'dexie',
      legacy_id: legacyId,
      sqlite_invoice_id: equivalentInvoice.sqliteInvoiceId,
      status: 'skipped',
      skip_reason: equivalentInvoice.reason,
      last_error: null,
    });
    return {
      ok: true,
      legacyId,
      skipped: true,
      skipReason: equivalentInvoice.reason,
      invoiceId: equivalentInvoice.sqliteInvoiceId,
    };
  }

  let savedFile = null;

  if (record.image_base64) {
    try {
      const parsedBase64 = parseLegacyBase64Payload(record.image_base64, legacyId);
      if (!parsedBase64) {
        upsertLegacySyncItem({
          task_key: taskKey,
          legacy_source: 'dexie',
          legacy_id: legacyId,
          sqlite_invoice_id: null,
          status: 'failed',
          skip_reason: null,
          last_error: 'Legacy image_base64 is empty or invalid.',
        });
        return {
          ok: false,
          reason: 'invalid_base64',
          error: 'Legacy image_base64 is empty or invalid.',
        };
      }

      savedFile = saveOriginalFile({
        content: parsedBase64.buffer,
        originalName: parsedBase64.originalName,
        mimeType: parsedBase64.mimeType,
        createdAt: record.created_at ? new Date(record.created_at) : new Date(),
      });
    } catch (err) {
      upsertLegacySyncItem({
        task_key: taskKey,
        legacy_source: 'dexie',
        legacy_id: legacyId,
        sqlite_invoice_id: null,
        status: 'failed',
        skip_reason: null,
        last_error: err instanceof Error ? err.message : 'Failed to save legacy image_base64 as a local file.',
      });
      return {
        ok: false,
        reason: 'file_save_failed',
        error: err instanceof Error ? err.message : 'Failed to save legacy image_base64 as a local file.',
      };
    }
  }

  const tx = statements.insertInvoice.database.transaction(() => {
    const invoiceResult = statements.insertInvoice.run({
      raw_data: record.raw_data ?? '',
      invoice_code: record.invoice_code ?? null,
      invoice_number: record.invoice_number ?? null,
      amount: record.amount ?? null,
      date: record.date ?? null,
      check_code: record.check_code ?? null,
      is_duplicate: record.is_duplicate ? 1 : 0,
      buyer_company: record.buyer_company ?? null,
      invoice_type: record.invoice_type ?? null,
      seller_company: record.seller_company ?? null,
      tax_rate: record.tax_rate ?? null,
      tax_amount: record.tax_amount ?? null,
      total_amount: record.total_amount ?? null,
      reimburser: record.reimburser ?? null,
      targetMonth: record.targetMonth ?? null,
      created_at: record.created_at ?? nowIso(),
      import_batch_id: record.import_batch_id ?? null,
      source_page: record.source_page ?? null,
      image_base64: null,
      primary_file_id: null,
      original_file_path: savedFile?.absolutePath ?? null,
      preview_file_path: null,
      thumbnail_file_path: null,
      storage_status: savedFile ? 'legacy_migrated' : 'legacy_migrated_no_file',
      storage_version: 1,
    });

    const invoiceId = Number(invoiceResult.lastInsertRowid);
    let fileRow = null;

    if (savedFile) {
      const fileResult = statements.insertFile.run({
        invoice_id: invoiceId,
        file_role: 'original',
        file_kind: 'image',
        original_name: savedFile.fileName,
        mime_type: path.extname(savedFile.fileName).toLowerCase() === '.png' ? 'image/png' : 'application/octet-stream',
        ext: savedFile.ext,
        size_bytes: savedFile.sizeBytes,
        relative_path: savedFile.relativePath,
        absolute_path: savedFile.absolutePath,
        sha256: savedFile.sha256,
        source_page: record.source_page ?? null,
      });
      const fileId = Number(fileResult.lastInsertRowid);
      statements.updatePrimaryFile.run(fileId, savedFile.absolutePath, invoiceId);
      fileRow = statements.selectFile.get(fileId);
    }

    return {
      invoice: statements.selectInvoice.get(invoiceId),
      file: fileRow,
    };
  });

  try {
    const migrated = tx();
    upsertLegacySyncItem({
      task_key: taskKey,
      legacy_source: 'dexie',
      legacy_id: legacyId,
      sqlite_invoice_id: migrated.invoice?.id ?? null,
      status: 'success',
      skip_reason: null,
      last_error: null,
    });
    return {
      ok: true,
      legacyId,
      invoiceId: migrated.invoice?.id ?? null,
      fileId: migrated.file?.id ?? null,
      savedFile,
    };
  } catch (err) {
    upsertLegacySyncItem({
      task_key: taskKey,
      legacy_source: 'dexie',
      legacy_id: legacyId,
      sqlite_invoice_id: null,
      status: 'failed',
      skip_reason: null,
      last_error: err instanceof Error ? err.message : 'Failed to insert legacy record into SQLite.',
    });
    return {
      ok: false,
      reason: 'sqlite_insert_failed',
      error: err instanceof Error ? err.message : 'Failed to insert legacy record into SQLite.',
    };
  }
}

export function getLegacySyncStatus(taskKey = DEFAULT_TASK_KEY) {
  return normalizeTaskRow(getLegacySyncTaskRow(taskKey), taskKey);
}

export function startLegacySync(options = {}) {
  const taskKey = options.taskKey ?? DEFAULT_TASK_KEY;
  const current = getLegacySyncStatus(taskKey);

  migrationRuntimeState.set(taskKey, {
    isRunnerAttached: true,
    pauseRequested: false,
  });

  return persistTaskStatus(taskKey, {
    phase: current.processedRecords > 0 ? current.phase : 'planning',
    status: 'running',
    totalRecords: options.totalRecords ?? current.totalRecords ?? 0,
    startedAt: current.startedAt ?? nowIso(),
    finishedAt: null,
    lastError: null,
    config: {
      ...current.config,
      ...(options.config ?? {}),
      batchSize: options.config?.batchSize ?? current.config.batchSize ?? DEFAULT_BATCH_SIZE,
    },
    summary: {
      currentStep: 'ready_for_batch_execution',
      canResume: true,
      canPause: true,
      note: 'Migration task is ready. The renderer can now send the next Dexie batch.',
      recordMigrationPlan: [
        '1. Read one Dexie batch in the renderer process.',
        '2. Send the batch to the main process migration runner.',
        '3. Save structured fields into SQLite invoices.',
        '4. Convert legacy image_base64 into local files when available.',
        '5. Insert file metadata and backfill primary_file_id / original_file_path.',
        '6. Update progress counters, cursor, and failure summary after each record.',
      ],
    },
  });
}

export function pauseLegacySync(options = {}) {
  const taskKey = options.taskKey ?? DEFAULT_TASK_KEY;
  const current = getLegacySyncStatus(taskKey);

  migrationRuntimeState.set(taskKey, {
    ...(migrationRuntimeState.get(taskKey) ?? {
      isRunnerAttached: false,
      pauseRequested: false,
    }),
    pauseRequested: true,
  });

  return persistTaskStatus(taskKey, {
    phase: current.phase,
    status: 'paused',
    summary: {
      ...current.summary,
      currentStep: 'pause_requested',
      canResume: true,
      canPause: false,
      note: 'Pause requested. The next batch runner checks this flag before continuing.',
    },
  });
}

export function resumeLegacySync(options = {}) {
  const taskKey = options.taskKey ?? DEFAULT_TASK_KEY;
  const current = getLegacySyncStatus(taskKey);

  migrationRuntimeState.set(taskKey, {
    isRunnerAttached: true,
    pauseRequested: false,
  });

  return persistTaskStatus(taskKey, {
    phase: current.phase === 'bootstrap' ? 'planning' : current.phase,
    status: 'running',
    finishedAt: null,
    lastError: null,
    summary: {
      ...current.summary,
      currentStep: 'resume_requested',
      canResume: true,
      canPause: true,
      note: 'Resume requested. The next batch continues from lastCursor / lastId.',
    },
  });
}

export function runLegacySyncBatch(options = {}) {
  const taskKey = options.taskKey ?? DEFAULT_TASK_KEY;
  const records = Array.isArray(options.records) ? options.records : [];
  const requestedBatchSize = Number(options.batchSize) > 0
    ? Number(options.batchSize)
    : DEFAULT_BATCH_SIZE;
  const sourceHasMore = Boolean(options.sourceHasMore);
  const totalRecords = Number.isFinite(options.totalRecords) ? Number(options.totalRecords) : undefined;
  const current = getLegacySyncStatus(taskKey);
  const runtime = migrationRuntimeState.get(taskKey) ?? {
    isRunnerAttached: false,
    pauseRequested: false,
  };

  if (current.status === 'paused' || runtime.pauseRequested) {
    const pausedStatus = persistTaskStatus(taskKey, {
      status: 'paused',
      summary: {
        ...current.summary,
        currentStep: 'paused_before_batch',
        canResume: true,
        canPause: false,
        note: 'Batch execution skipped because the task is paused.',
      },
    });

    return {
      taskKey,
      requestedBatchSize,
      processedInThisBatch: 0,
      successInThisBatch: 0,
      failedInThisBatch: 0,
      skippedInThisBatch: 0,
      nextCursor: pausedStatus.lastCursor,
      nextLastId: pausedStatus.lastId,
      hasMore: true,
      errors: [],
      taskStatus: pausedStatus,
    };
  }

  const db = getStorageDb();
  const statements = buildLegacyInsertStatements(db);
  const limitedRecords = records.slice(0, requestedBatchSize);

  let processedInThisBatch = 0;
  let successInThisBatch = 0;
  let failedInThisBatch = 0;
  let skippedInThisBatch = 0;
  let skippedBecauseAlreadyMigrated = 0;
  let skippedBecauseAlreadyExistsInSqlite = 0;
  let nextLastId = current.lastId ?? null;
  let nextCursor = current.lastCursor ?? null;
  const errors = [];

  let taskStatus = persistTaskStatus(taskKey, {
    phase: 'migrating',
    status: 'running',
    totalRecords: totalRecords ?? current.totalRecords,
    summary: {
      ...current.summary,
      currentStep: 'running_batch',
      canResume: true,
      canPause: true,
      note: 'Processing a legacy Dexie batch in the main process.',
    },
  });

  for (const record of limitedRecords) {
    const runtimeState = migrationRuntimeState.get(taskKey) ?? runtime;
    if (runtimeState.pauseRequested) {
      taskStatus = persistTaskStatus(taskKey, {
        status: 'paused',
        lastId: nextLastId,
        lastCursor: nextCursor,
        summary: {
          ...taskStatus.summary,
          currentStep: 'paused_mid_batch',
          canResume: true,
          canPause: false,
          note: 'Batch execution stopped because pause was requested.',
        },
      });
      break;
    }

    const legacyId = typeof record?.id === 'number' ? record.id : null;
    processedInThisBatch += 1;

    if (legacyId == null) {
      skippedInThisBatch += 1;
      errors.push('Skipped one record because it has no stable Dexie id.');
      taskStatus = persistTaskStatus(taskKey, {
        processedRecords: taskStatus.processedRecords + 1,
        skippedRecords: taskStatus.skippedRecords + 1,
        lastError: 'Encountered a legacy record without Dexie id.',
        summary: {
          ...taskStatus.summary,
          currentStep: 'running_batch',
          canResume: true,
          canPause: true,
          note: 'Skipped a record without stable Dexie id.',
        },
      });
      continue;
    }

    const migrated = migrateLegacyRecord({ taskKey, statements, record });
    nextLastId = legacyId;
    nextCursor = String(legacyId);

    if (migrated.ok && migrated.skipped) {
      skippedInThisBatch += 1;
      if (migrated.skipReason === 'already_migrated') {
        skippedBecauseAlreadyMigrated += 1;
      } else if (migrated.skipReason === 'already_exists_in_sqlite') {
        skippedBecauseAlreadyExistsInSqlite += 1;
      }
      taskStatus = persistTaskStatus(taskKey, {
        processedRecords: taskStatus.processedRecords + 1,
        skippedRecords: taskStatus.skippedRecords + 1,
        lastId: nextLastId,
        lastCursor: nextCursor,
        lastError: null,
        summary: {
          ...taskStatus.summary,
          currentStep: 'running_batch_with_skips',
          canResume: true,
          canPause: true,
          note: 'At least one record was skipped because it was already migrated or already existed in SQLite.',
        },
      });
    } else if (migrated.ok) {
      successInThisBatch += 1;
      taskStatus = persistTaskStatus(taskKey, {
        processedRecords: taskStatus.processedRecords + 1,
        successRecords: taskStatus.successRecords + 1,
        lastId: nextLastId,
        lastCursor: nextCursor,
        lastError: null,
        summary: {
          ...taskStatus.summary,
          currentStep: 'running_batch',
          canResume: true,
          canPause: true,
          note: 'Legacy batch is progressing normally.',
        },
      });
    } else {
      failedInThisBatch += 1;
      errors.push(`Legacy id ${legacyId}: ${migrated.error}`);
      taskStatus = persistTaskStatus(taskKey, {
        processedRecords: taskStatus.processedRecords + 1,
        failedRecords: taskStatus.failedRecords + 1,
        lastId: nextLastId,
        lastCursor: nextCursor,
        lastError: migrated.error,
        summary: {
          ...taskStatus.summary,
          currentStep: 'running_batch_with_failures',
          canResume: true,
          canPause: true,
          note: 'At least one legacy record failed in this batch. See the latest error and batch errors.',
        },
      });
    }
  }

  const hasMore = taskStatus.status !== 'paused' && sourceHasMore;
  if (taskStatus.status !== 'paused') {
    taskStatus = persistTaskStatus(taskKey, {
      phase: hasMore ? 'migrating' : 'finalizing',
      status: hasMore ? 'running' : 'completed',
      lastId: nextLastId,
      lastCursor: nextCursor,
      finishedAt: hasMore ? null : nowIso(),
      summary: {
        ...taskStatus.summary,
        currentStep: hasMore ? 'batch_completed_waiting_next_batch' : 'completed',
        canResume: hasMore,
        canPause: hasMore,
        note: hasMore
          ? 'One batch finished successfully. More Dexie records are still pending.'
          : 'Migration task completed for all records that were provided by the renderer.',
      },
    });
  }

  return {
    taskKey,
    requestedBatchSize,
    processedInThisBatch,
    successInThisBatch,
    failedInThisBatch,
    skippedInThisBatch,
    skippedBecauseAlreadyMigrated,
    skippedBecauseAlreadyExistsInSqlite,
    nextCursor,
    nextLastId,
    hasMore,
    errors: errors.slice(0, 10),
    taskStatus,
  };
}
