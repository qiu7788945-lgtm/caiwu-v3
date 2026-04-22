import fs from 'fs';
import Database from 'better-sqlite3';
import { ensureStorageLayout, getStoragePaths } from './paths.js';

let dbInstance = null;

function initializeSchema(db) {
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
      primary_file_id INTEGER,
      original_file_path TEXT,
      preview_file_path TEXT,
      thumbnail_file_path TEXT,
      FOREIGN KEY (primary_file_id) REFERENCES files(id) ON DELETE SET NULL
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

    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_target_month ON invoices(targetMonth);
    CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_invoice_id ON files(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_files_role ON files(file_role);
  `);

  db.prepare(`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    key: 'storage_schema_version',
    value: '1',
  });
}

export function getStorageDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const paths = ensureStorageLayout();
  dbInstance = new Database(paths.databaseFile);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  initializeSchema(dbInstance);

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
  const paths = getStoragePaths();

  return {
    path: paths.databaseFile,
    schemaVersion: getStorageSchemaVersion(),
  };
}

function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

export function getStorageDbSummary() {
  const db = getStorageDb();
  const paths = getStoragePaths();
  const databaseFileExists = fs.existsSync(paths.databaseFile);
  const databaseFileSize = databaseFileExists ? fs.statSync(paths.databaseFile).size : 0;
  const supportsImageBase64Column = hasColumn(db, 'invoices', 'image_base64');

  const invoiceCount = db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count;
  const fileCount = db.prepare('SELECT COUNT(*) AS count FROM files').get().count;
  const missingOriginalFilePathCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM invoices
      WHERE original_file_path IS NULL OR TRIM(original_file_path) = ''
    `)
    .get().count;
  const imageBase64Count = supportsImageBase64Column
    ? db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM invoices
          WHERE image_base64 IS NOT NULL AND TRIM(image_base64) <> ''
        `)
        .get().count
    : 0;
  const orphanFileRecordCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM files f
      LEFT JOIN invoices i ON i.id = f.invoice_id
      WHERE f.invoice_id IS NOT NULL AND i.id IS NULL
    `)
    .get().count;
  const orphanInvoicePrimaryFileCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM invoices i
      LEFT JOIN files f ON f.id = i.primary_file_id
      WHERE i.primary_file_id IS NOT NULL AND f.id IS NULL
    `)
    .get().count;

  return {
    databasePath: paths.databaseFile,
    databaseFileExists,
    databaseFileSize,
    schemaVersion: getStorageSchemaVersion(),
    invoiceCount,
    fileCount,
    imageBase64Count,
    supportsImageBase64Column,
    missingOriginalFilePathCount,
    orphanFileRecordCount,
    orphanInvoicePrimaryFileCount,
  };
}
