export interface ParsedOcrInvoice {
  invoice_code: string | null;
  invoice_number: string | null;
  date: string | null;
  buyer_company: string | null;
  seller_company: string | null;
  total_amount: number | null;
  amount: number | null;
  tax_amount: number | null;
  check_code: string | null;
  invoice_type: string | null;
  tax_rate: string | null;
}

export const parseOcrInvoice = (_text: string): ParsedOcrInvoice => {
  return {
    invoice_code: null,
    invoice_number: null,
    date: null,
    buyer_company: null,
    seller_company: null,
    total_amount: null,
    amount: null,
    tax_amount: null,
    check_code: null,
    invoice_type: null,
    tax_rate: null,
  };
};
