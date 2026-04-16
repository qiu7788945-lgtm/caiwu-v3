export interface ParsedPdfInvoice {
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

export const parsePdfInvoice = (text: string): ParsedPdfInvoice => {
  const noSpaceText = text.replace(/\s+/g, '');
  const pdfHeaderText = text.slice(0, 3000);
  const pdfHeaderNoSpaceText = pdfHeaderText.replace(/\s+/g, '');

  const parseAmount = (value: string | undefined) => {
    if (!value) return null;
    const parsed = parseFloat(value.replace(/,/g, '.'));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const invoiceCodeMatch = noSpaceText.match(/(?:发票代码|代码)[:：]?(\d{10,12})/)
    || noSpaceText.match(/(?<!\d)(\d{10,12})(?!\d)/);

  const invoiceNumberMatch = pdfHeaderNoSpaceText.match(/发票号码[:：]?(\d{8,24})/)
    || noSpaceText.match(/发票号码[:：]?(\d{8,24})/)
    || noSpaceText.match(/(?<!\d)(\d{20})(?!\d)/);

  const dateMatch = pdfHeaderNoSpaceText.match(/开票日期[:：]?(\d{4})[年\-./](\d{1,2})[月\-./](\d{1,2})[日号]?/)
    || noSpaceText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);

  const checkCodeMatch = noSpaceText.match(/(?:校验码|机器编号)[:：]?(\d{20}|\d{16}|\d{12})/);

  const buyerBlockMatch = pdfHeaderNoSpaceText.match(/购买方信息([\s\S]{0,200}?)(?:销售方信息|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);
  const sellerBlockMatch = pdfHeaderNoSpaceText.match(/销售方信息([\s\S]{0,200}?)(?:项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);

  const buyerNameMatch = buyerBlockMatch?.[1].match(/名称[:：]?([\u4e00-\u9fa5()（）a-zA-Z0-9]{4,60}?)(?:纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户行及账号|电话|地址|$)/);
  const sellerNameMatch = sellerBlockMatch?.[1].match(/名称[:：]?([\u4e00-\u9fa5()（）a-zA-Z0-9]{4,60}?)(?:纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户行及账号|电话|地址|$)/);

  const totalAmountMatch = noSpaceText.match(/价税合计(?:\(小写\)|（小写）|小写)?[^\d￥¥Y]*[￥¥Y]?(\d+[.,]\d{2})/);
  const amountTaxMatch = noSpaceText.match(/合计[^\d￥¥Y]*[￥¥Y]?(\d+[.,]\d{2})[^\d￥¥Y%]*(\d+[.,]\d{2})/);

  const taxRateMatch = noSpaceText.match(/(?:税率|征收率)[:：]?\s*(13%|9%|6%|3%|1%|0%|免税|不征税)/)
    || noSpaceText.match(/(13|9|6|3|1|0)[%％]/);

  let date: string | null = null;
  if (dateMatch) {
    date = `${dateMatch[1]}${String(dateMatch[2]).padStart(2, '0')}${String(dateMatch[3]).padStart(2, '0')}`;
  }

  let amount = amountTaxMatch ? parseAmount(amountTaxMatch[1]) : null;
  let tax_amount = amountTaxMatch ? parseAmount(amountTaxMatch[2]) : null;
  let total_amount = totalAmountMatch ? parseAmount(totalAmountMatch[1]) : null;

  if (!total_amount) {
    const allYenAmounts = noSpaceText.match(/[￥¥]\d+\.\d{2}/g) || [];
    const fallbackAmount = allYenAmounts[0] ? parseAmount(allYenAmounts[0].slice(1)) : null;
    const fallbackTaxAmount = allYenAmounts[1] ? parseAmount(allYenAmounts[1].slice(1)) : null;
    const fallbackTotalAmount = allYenAmounts.length > 0 ? parseAmount(allYenAmounts[allYenAmounts.length - 1].slice(1)) : null;

    if (amount == null) amount = fallbackAmount;
    if (tax_amount == null) tax_amount = fallbackTaxAmount;
    if (total_amount == null) total_amount = fallbackTotalAmount;
  }

  if (total_amount == null && amount != null && tax_amount != null) {
    total_amount = Number((amount + tax_amount).toFixed(2));
  }

  return {
    invoice_code: invoiceCodeMatch ? invoiceCodeMatch[1] : null,
    invoice_number: invoiceNumberMatch ? invoiceNumberMatch[1] : null,
    date,
    buyer_company: buyerNameMatch ? buyerNameMatch[1] : null,
    seller_company: sellerNameMatch ? sellerNameMatch[1] : null,
    total_amount,
    amount,
    tax_amount,
    check_code: checkCodeMatch ? checkCodeMatch[1] : null,
    invoice_type: null,
    tax_rate: taxRateMatch ? (taxRateMatch[1].includes('%') || taxRateMatch[1] === '免税' || taxRateMatch[1] === '不征税' ? taxRateMatch[1] : `${taxRateMatch[1]}%`) : null,
  };
};
