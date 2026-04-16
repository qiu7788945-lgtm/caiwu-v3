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

export const parseOcrInvoice = (text: string): ParsedOcrInvoice => {
  const normalizedText = text.replace(/\s+/g, '');

  const parseAmount = (value: string | undefined) => {
    if (!value) return null;
    const parsed = parseFloat(value.replace(/,/g, '.'));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const invoiceCodeMatch = normalizedText.match(/(?:发票代码|代码)[:：]?(\d{10,12})/)
    || normalizedText.match(/(?<!\d)(\d{10,12})(?!\d)/);

  const invoiceNumberMatch = normalizedText.match(/(?:发票号码|票号|号码)[:：]?(\d{8,24})/)
    || normalizedText.match(/(?<!\d)(\d{20})(?!\d)/)
    || normalizedText.match(/(?<!\d)(\d{8})(?!\d)/);

  const dateMatch = normalizedText.match(/(?:开票日期|日期)[:：]?(\d{4})[年\-./](\d{1,2})[月\-./](\d{1,2})[日号]?/)
    || normalizedText.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);

  const buyerMatch = normalizedText.match(/(?:购买方|购方|买方)(?:名称)?[:：]?([\u4e00-\u9fa5()（）a-zA-Z0-9]{4,60}?)(?:纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户行及账号|电话|地址|销售方|销方|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);

  const sellerMatch = normalizedText.match(/(?:销售方|销方)(?:名称)?[:：]?([\u4e00-\u9fa5()（）a-zA-Z0-9]{4,60}?)(?:纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户行及账号|电话|地址|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);

  const totalAmountMatch = normalizedText.match(/价税合计(?:\(小写\)|（小写）|小写)?[^\d￥¥Y]*[￥¥Y]?(\d+[.,]\d{2})/);

  const amountTaxMatch = normalizedText.match(/合计[^\d￥¥Y]*[￥¥Y]?(\d+[.,]\d{2})[^\d￥¥Y%]*(\d+[.,]\d{2})/);

  const checkCodeMatch = normalizedText.match(/(?:校验码|机器编号)[:：]?(\d{20}|\d{16}|\d{12})/);

  const taxRateMatch = normalizedText.match(/(?:税率|征收率)[:：]?(13%|9%|6%|3%|1%|0%|免税|不征税)/)
    || normalizedText.match(/(13|9|6|3|1|0)[%％]/);

  let date: string | null = null;
  if (dateMatch) {
    if (dateMatch.length >= 4) {
      date = `${dateMatch[1]}${String(dateMatch[2]).padStart(2, '0')}${String(dateMatch[3]).padStart(2, '0')}`;
    } else if (dateMatch[0]) {
      date = dateMatch[0];
    }
  }

  let amount = amountTaxMatch ? parseAmount(amountTaxMatch[1]) : null;
  let tax_amount = amountTaxMatch ? parseAmount(amountTaxMatch[2]) : null;
  let total_amount = totalAmountMatch ? parseAmount(totalAmountMatch[1]) : null;

  if (total_amount == null && amount != null && tax_amount != null) {
    total_amount = Number((amount + tax_amount).toFixed(2));
  }

  if (amount == null && total_amount != null && tax_amount != null) {
    amount = Number((total_amount - tax_amount).toFixed(2));
  }

  return {
    invoice_code: invoiceCodeMatch ? invoiceCodeMatch[1] : null,
    invoice_number: invoiceNumberMatch ? invoiceNumberMatch[1] : null,
    date,
    buyer_company: buyerMatch ? buyerMatch[1] : null,
    seller_company: sellerMatch ? sellerMatch[1] : null,
    total_amount,
    amount,
    tax_amount,
    check_code: checkCodeMatch ? checkCodeMatch[1] : null,
    invoice_type: null,
    tax_rate: taxRateMatch ? (taxRateMatch[1].includes('%') || taxRateMatch[1] === '免税' || taxRateMatch[1] === '不征税' ? taxRateMatch[1] : `${taxRateMatch[1]}%`) : null,
  };
};
