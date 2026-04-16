import Dexie, { type EntityTable } from 'dexie';
import type { Invoice } from './types/invoice';
export type { Invoice } from './types/invoice';


const db = new Dexie('InvoiceManagerDB') as Dexie & {
  invoices: EntityTable<
    Invoice,
    'id' // primary key "id" (for the typings only)
  >;
};

// Schema declaration:
db.version(1).stores({
  invoices: '++id, targetMonth, invoice_number, created_at' // Primary key and indexed props
});

export { db };
