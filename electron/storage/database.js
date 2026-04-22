import Database from 'better-sqlite3';
import fs from 'fs';
import { ensureStorageLayout, getStoragePaths } from './paths.js';

let dbInstance = null;

function tableExists(db, tableName) {
  const stmt = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  );
  return Boolean(stmt.get(tableName));
}

function columnExists(db, tableName, columnName) {
  if (!tableExists(db, tableName)) {
    return false;
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, columnSql) {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  }
}

function ensureLegacyInvoicesCompatibility(db) {
  if (!tableExists(db, 'invoices')) {
    return;
  }

  addColumnIfMissing(db, 'invoices', 'import_batch_id', 'import_batch_id TEXT');
  addColumnIfMissing(db, 'invoices', 'source_page', 'source_page INTEGER');
  addColumnIfMissing(db, 'invoices', 'image_base64', 'image_base64 TEXT');
  addColumnIfMissing(db, 'invoices', 'primary_file_id', 'primary_file_id INTEGER');
  addColumnIfMissing(db, 'invoices', 'original_file_path', 'original_file_path TEXT');
  addColumnIfMissing(db, 'invoices', 'preview_file_path', 'preview_file_path TEXT');
  addColumnIfMissing(db, 'invoices', 'thumbnail_file_path', 'thumbnail_file_path TEXT');
  addColumnIfMissing(db, 'invoices', 'storage_status', "storage_status TEXT DEFAULT 'legacy'");
  addColumnIfMissing(db, 'invoices', 'storage_version', 'storage_version INTEGER DEFAULT 1');
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_data TEXT NOT NULL,
      invoice_code TEXT,
      invoice_number TEXT,
      amount REAL,
      date TEXT,
      check_code TEXT,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      buyer_company TEXT,
      invoice_type TEXT,
      seller_company TEXT,
      tax_rate TEXT,
      tax_amount REAL,
      total_amount REAL,
      reimburser TEXT,
      targetMonth TEXT,
      created_at TEXT NOT NULL,
      import_batch_id TEXT,
      source_page INTEGER,
      image_base64 TEXT,
      primary_file_id INTEGER,
      original_file_path TEXT,
      preview_file_path TEXT,
      thumbnail_file_path TEXT,
      storage_status TEXT NOT NULL DEFAULT 'ready',
      storage_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      file_role TEXT NOT NULL,
      file_kind TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      ext TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      sha256 TEXT,
      source_page INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cache_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_type TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      owner_key TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS legacy_sync_tasks (
      task_key TEXT PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'bootstrap',
      status TEXT NOT NULL DEFAULT 'idle',
      total_records INTEGER NOT NULL DEFAULT 0,
      processed_records INTEGER NOT NULL DEFAULT 0,
      success_records INTEGER NOT NULL DEFAULT 0,
      failed_records INTEGER NOT NULL DEFAULT 0,
      skipped_records INTEGER NOT NULL DEFAULT 0,
      last_cursor TEXT,
      last_id INTEGER,
      started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      last_error TEXT,
      config_json TEXT,
      summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS legacy_sync_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_key TEXT NOT NULL,
      legacy_source TEXT NOT NULL DEFAULT 'dexie',
      legacy_id INTEGER NOT NULL,
      sqlite_invoice_id INTEGER,
      status TEXT NOT NULL,
      skip_reason TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(task_key, legacy_source, legacy_id)
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_target_month ON invoices(targetMonth);
    CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_invoice_id ON files(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_files_role ON files(file_role);
    CREATE INDEX IF NOT EXISTS idx_cache_entries_type ON cache_entries(cache_type);
    CREATE INDEX IF NOT EXISTS idx_legacy_sync_items_legacy_id ON legacy_sync_items(legacy_source, legacy_id);
    CREATE INDEX IF NOT EXISTS idx_legacy_sync_items_status ON legacy_sync_items(status);
  `);

  ensureLegacyInvoicesCompatibility(db);

  const applyMigration = (version, name, metaValue) => {
    const hasMigration = db
      .prepare('SELECT version FROM migrations WHERE version = ?')
      .get(version);

    if (hasMigration) {
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(version, name, now);

    db.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run({
      key: 'storage_schema_version',
      value: String(metaValue),
      updated_at: now,
    });
  };

  applyMigration(1, 'phase1_storage_foundation', 1);
  applyMigration(2, 'phase4_legacy_sync_foundation', 2);
  applyMigration(3, 'phase4_legacy_sync_idempotency', 3);
}

export function getStorageDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const paths = ensureStorageLayout();
  fs.mkdirSync(paths.dataRoot, { recursive: true });

  dbInstance = new Database(paths.databaseFile);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  runMigrations(dbInstance);

  return dbInstance;
}

export function getStorageSchemaVersion() {
  const db = getStorageDb();
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = 'storage_schema_version'")
    .get();
  return row?.value ? Number(row.value) : 1;
}

export function getStorageDatabaseInfo() {
  const db = getStorageDb();
  const paths = getStoragePaths();
  const invoiceCountRow = db
    .prepare('SELECT COUNT(*) AS count FROM invoices')
    .get();
  const fileCountRow = db.prepare('SELECT COUNT(*) AS count FROM files').get();

  return {
    path: paths.databaseFile,
    schemaVersion: getStorageSchemaVersion(),
    invoiceCount: invoiceCountRow?.count ?? 0,
    fileCount: fileCountRow?.count ?? 0,
  };
}

export function optimizeStorageDatabase(options = {}) {
  const db = getStorageDb();
  const paths = ensureStorageLayout();
  const beforeBytes = fs.existsSync(paths.databaseFile)
    ? fs.statSync(paths.databaseFile).size
    : 0;
  const runAnalyze = options.analyze !== false;

  db.pragma('optimize');
  db.exec('VACUUM');

  if (runAnalyze) {
    db.exec('ANALYZE');
  }

  const afterBytes = fs.existsSync(paths.databaseFile)
    ? fs.statSync(paths.databaseFile).size
    : 0;

  return {
    ok: true,
    operation: 'vacuum',
    analyzeExecuted: runAnalyze,
    beforeBytes,
    afterBytes,
    bytesReclaimed: Math.max(0, beforeBytes - afterBytes),
    databasePath: paths.databaseFile,
  };
}

export function normalizeInvoiceNumberForDuplicateCheck(invoiceNumber) {
  if (typeof invoiceNumber !== 'string') {
    return null;
  }

  const normalized = invoiceNumber.trim();
  if (!normalized || /^UNKNOWN-/i.test(normalized)) {
    return null;
  }

  if (/^\d{20}$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{8}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

export function detectInvoiceDuplicate(db, invoiceNumber) {
  const normalizedInvoiceNumber = normalizeInvoiceNumberForDuplicateCheck(invoiceNumber);

  if (!normalizedInvoiceNumber) {
    return {
      evaluated: false,
      duplicateDetected: false,
      existingInvoiceId: null,
      matchedInvoiceNumber: null,
      strategy: 'skipped_invalid_invoice_number',
    };
  }

  const existingInvoice = db
    .prepare(`
      SELECT id, invoice_number, created_at
      FROM invoices
      WHERE invoice_number = ?
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(normalizedInvoiceNumber);

  return {
    evaluated: true,
    duplicateDetected: Boolean(existingInvoice),
    existingInvoiceId: existingInvoice ? Number(existingInvoice.id) : null,
    matchedInvoiceNumber: normalizedInvoiceNumber,
    strategy: 'invoice_number',
  };
}

export function getLegacySyncTaskRow(taskKey = 'legacy_dexie_to_sqlite') {
  const db = getStorageDb();
  return db
    .prepare(`
      SELECT
        task_key,
        phase,
        status,
        total_records,
        processed_records,
        success_records,
        failed_records,
        skipped_records,
        last_cursor,
        last_id,
        started_at,
        updated_at,
        finished_at,
        last_error,
        config_json,
        summary_json
      FROM legacy_sync_tasks
      WHERE task_key = ?
    `)
    .get(taskKey);
}

export function upsertLegacySyncTask(task) {
  const db = getStorageDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO legacy_sync_tasks (
      task_key,
      phase,
      status,
      total_records,
      processed_records,
      success_records,
      failed_records,
      skipped_records,
      last_cursor,
      last_id,
      started_at,
      updated_at,
      finished_at,
      last_error,
      config_json,
      summary_json
    ) VALUES (
      @task_key,
      @phase,
      @status,
      @total_records,
      @processed_records,
      @success_records,
      @failed_records,
      @skipped_records,
      @last_cursor,
      @last_id,
      @started_at,
      @updated_at,
      @finished_at,
      @last_error,
      @config_json,
      @summary_json
    )
    ON CONFLICT(task_key) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      total_records = excluded.total_records,
      processed_records = excluded.processed_records,
      success_records = excluded.success_records,
      failed_records = excluded.failed_records,
      skipped_records = excluded.skipped_records,
      last_cursor = excluded.last_cursor,
      last_id = excluded.last_id,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at,
      last_error = excluded.last_error,
      config_json = excluded.config_json,
      summary_json = excluded.summary_json
  `).run({
    task_key: task.task_key,
    phase: task.phase ?? 'bootstrap',
    status: task.status ?? 'idle',
    total_records: task.total_records ?? 0,
    processed_records: task.processed_records ?? 0,
    success_records: task.success_records ?? 0,
    failed_records: task.failed_records ?? 0,
    skipped_records: task.skipped_records ?? 0,
    last_cursor: task.last_cursor ?? null,
    last_id: task.last_id ?? null,
    started_at: task.started_at ?? null,
    updated_at: task.updated_at ?? now,
    finished_at: task.finished_at ?? null,
    last_error: task.last_error ?? null,
    config_json: task.config_json ?? null,
    summary_json: task.summary_json ?? null,
  });

  return getLegacySyncTaskRow(task.task_key);
}

export function getLegacySyncItem(taskKey, legacySource, legacyId) {
  const db = getStorageDb();
  return db.prepare(`
    SELECT
      id,
      task_key,
      legacy_source,
      legacy_id,
      sqlite_invoice_id,
      status,
      skip_reason,
      last_error,
      created_at,
      updated_at
    FROM legacy_sync_items
    WHERE task_key = ? AND legacy_source = ? AND legacy_id = ?
  `).get(taskKey, legacySource, legacyId);
}

export function upsertLegacySyncItem(item) {
  const db = getStorageDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO legacy_sync_items (
      task_key,
      legacy_source,
      legacy_id,
      sqlite_invoice_id,
      status,
      skip_reason,
      last_error,
      created_at,
      updated_at
    ) VALUES (
      @task_key,
      @legacy_source,
      @legacy_id,
      @sqlite_invoice_id,
      @status,
      @skip_reason,
      @last_error,
      @created_at,
      @updated_at
    )
    ON CONFLICT(task_key, legacy_source, legacy_id) DO UPDATE SET
      sqlite_invoice_id = excluded.sqlite_invoice_id,
      status = excluded.status,
      skip_reason = excluded.skip_reason,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run({
    task_key: item.task_key,
    legacy_source: item.legacy_source ?? 'dexie',
    legacy_id: item.legacy_id,
    sqlite_invoice_id: item.sqlite_invoice_id ?? null,
    status: item.status,
    skip_reason: item.skip_reason ?? null,
    last_error: item.last_error ?? null,
    created_at: item.created_at ?? now,
    updated_at: item.updated_at ?? now,
  });

  return getLegacySyncItem(item.task_key, item.legacy_source ?? 'dexie', item.legacy_id);
}
