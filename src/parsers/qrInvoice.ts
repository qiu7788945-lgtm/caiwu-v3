export interface ParsedQrInvoice {
  invoice_type: string | null;
  invoice_code: string | null;
  invoice_number: string | null;
  parsedAmount: number | null;
  date: string | null;
  check_code: string | null;
}

export const parseQrInvoice = (raw: string): ParsedQrInvoice => {
  const normalizedData = raw.replace(/，/g, ',');
  const parts = normalizedData.split(',').map(p => p.trim());

  let invoice_code = null;
  let invoice_number = null;
  let parsedAmount = null;
  let date = null;
  let check_code = null;

  if (parts[0] === '01') {
    if (parts[2] && parts[2].length === 20) {
      invoice_number = parts[2];
      parsedAmount = parts[3];
      date = parts[4];
      check_code = parts[5];
    } else if (parts[3] && parts[3].length === 20) {
      invoice_code = parts[2] || null;
      invoice_number = parts[3];
      parsedAmount = parts[4];
      date = parts[5];
      check_code = parts[6];
    } else {
      invoice_code = parts[2] || null;
      invoice_number = parts[3] || null;
      parsedAmount = parts[4];
      date = parts[5];
      check_code = parts[6];
    }
  } else if (parts[0] && parts[0].length === 20) {
    invoice_number = parts[0];
    parsedAmount = parts[1];
    date = parts[2];
    check_code = parts[3];
  } else if (parts[0] && (parts[0].length === 10 || parts[0].length === 12) && parts[1] && parts[1].length === 8) {
    invoice_code = parts[0];
    invoice_number = parts[1];
    parsedAmount = parts[2];
    date = parts[3];
    check_code = parts[4];
  } else {
    const num20 = parts.find(p => /^\d{20}$/.test(p));
    if (num20) {
      invoice_number = num20;
      const idx = parts.indexOf(num20);
      parsedAmount = parts[idx + 1];
      date = parts[idx + 2];
    } else {
      const code = parts.find(p => /^\d{10}$|^\d{12}$/.test(p));
      const num8 = parts.find(p => /^\d{8}$/.test(p));
      if (num8) {
        invoice_code = code || null;
        invoice_number = num8;
        const idx = parts.indexOf(num8);
        parsedAmount = parts[idx + 1];
        date = parts[idx + 2];
      }
    }
  }

  if (parsedAmount) {
    const amt = parseFloat(parsedAmount);
    parsedAmount = !isNaN(amt) ? Number(amt.toFixed(2)) : null;
  } else {
    parsedAmount = null;
  }

  return {
    invoice_type: null,
    invoice_code,
    invoice_number,
    parsedAmount,
    date,
    check_code,
  };
};
