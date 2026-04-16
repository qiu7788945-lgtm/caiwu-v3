import type { Invoice } from '../types/invoice';

export interface InvoiceDraftInput {
  raw_data: string;
  invoice_code: string | null;
  invoice_number: string | null;
  invoice_type: string | null;
  buyer_company: string | null;
  seller_company: string | null;
  date: string | null;
  amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  check_code: string | null;
  tax_rate: string | null;
  targetMonth: string | null;
  created_at: string;
  image_base64?: string | null;
}

export type InvoiceDraft = Omit<Invoice, 'id'>;

export const createInvoiceDraft = (input: InvoiceDraftInput): InvoiceDraft => {
  return {
    raw_data: input.raw_data,
    invoice_code: input.invoice_code,
    invoice_number: input.invoice_number,
    amount: input.amount,
    date: input.date,
    check_code: input.check_code,
    is_duplicate: false,
    buyer_company: input.buyer_company,
    invoice_type: input.invoice_type,
    seller_company: input.seller_company,
    tax_rate: input.tax_rate,
    tax_amount: input.tax_amount,
    total_amount: input.total_amount,
    reimburser: null,
    targetMonth: input.targetMonth,
    created_at: input.created_at,
    image_base64: input.image_base64 ?? null,
  };
};
