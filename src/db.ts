import Dexie, { type EntityTable } from 'dexie';

export interface Invoice {
  id?: number; // 自增主键
  raw_data: string;
  invoice_code: string | null;
  invoice_number: string | null;
  amount: number | null;
  date: string | null;
  check_code: string | null;
  is_duplicate: boolean;
  buyer_company: string | null;
  invoice_type: string | null;
  seller_company: string | null;
  tax_rate: string | null;
  tax_amount: number | null;
  total_amount: number | null;
  reimburser: string | null;
  targetMonth: string | null;
  created_at: string;
  image_base64?: string | null; // 大容量字段：预留用于存储发票图片的 Base64 数据
}

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
