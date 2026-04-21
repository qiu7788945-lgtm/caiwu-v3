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

    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_target_month ON invoices(targetMonth);
    CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_invoice_id ON files(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_files_role ON files(file_role);
    CREATE INDEX IF NOT EXISTS idx_cache_entries_type ON cache_entries(cache_type);
  `);

  ensureLegacyInvoicesCompatibility(db);

  const migrationVersion = 1;
  const hasMigration = db
    .prepare('SELECT version FROM migrations WHERE version = ?')
    .get(migrationVersion);

  if (!hasMigration) {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(migrationVersion, 'phase1_storage_foundation', now);

    db.prepare(`
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run({
      key: 'storage_schema_version',
      value: String(migrationVersion),
      updated_at: now,
    });
  }
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
