const DEBUG_INVOICE_PARSE = false;

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
  const rawText = text || '';
  const normalizedText = rawText
    .replace(/[（【]/g, '(')
    .replace(/[）】]/g, ')')
    .replace(/[：]/g, ':')
    .replace(/徳/g, '德');
  const noSpaceText = normalizedText.replace(/\s+/g, '');
  const compactText = normalizedText.replace(/[ \t]+/g, '');

  const parseAmount = (value: string | undefined) => {
    if (!value) return null;
    const cleaned = value.replace(/[￥¥,，\s]/g, '').trim();
    if (!cleaned || cleaned === '***') return null;
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? null : Number(parsed.toFixed(2));
  };

  const normalizeCompanyName = (value: string | undefined | null) => {
    if (!value) return null;
    const cleaned = value
      .replace(/^[名称:：\s]+/, '')
      .replace(/(?:统一社会信用代码|纳税人识别号|识别号|地址、电话|开户银行及账号|开户行及账号|开户地址及账号|开户地址|账号|电话|地址|机器编号|校验码).*$/, '')
      .replace(/[\[【]/g, '(')
      .replace(/[\]】]/g, ')')
      .replace(/徳/g, '德')
      .replace(/[\s\n\r]+/g, '')
      .replace(/\(+/g, '(')
      .replace(/\)+/g, ')')
      .replace(/有\s*限\s*公\s*司/g, '有限公司')
      .replace(/[^\u4e00-\u9fa5A-Za-z0-9()（）·\-]/g, '')
      .trim();
    return cleaned || null;
  };

  const headerBlacklist = new Set([
    '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率', '税额', '价税合计',
    '购买方信息', '销售方信息', '名称', '购买方', '销售方', '货物或应税劳务', '服务名称', '合计', '备注',
    '税务局', '开户银行', '账号', '开户地址', '地址', '电话', '纳税人识别号', '机器编号', '校验码'
  ]);

  const orgKeywordPattern = /(公司|有限公司|分公司|工作室|中心|店|局|园|馆|科技|商贸|传媒|餐饮|图文|设计|咨询|健康|药房|租赁|文化|便利店|超市)/;
  const companyNoisePattern = /(税务局|开户银行|开户行|账号|开户地址|地址、电话|电话|纳税人识别号|统一社会信用代码|机器编号|校验码)/;

  const normalizeLine = (line: string) => line
    .replace(/[（【\[]/g, '(')
    .replace(/[）】\]]/g, ')')
    .replace(/[：]/g, ':')
    .replace(/徳/g, '德')
    .replace(/有\s*限\s*公\s*司/g, '有限公司')
    .replace(/\s+/g, ' ')
    .trim();

  const rawLines = rawText.split(/\r?\n/);
  const normalizedLines = rawLines.map(normalizeLine).filter(Boolean);
  const lines = normalizedLines.length > 1
    ? normalizedLines
    : normalizedText
        .split(/(?=开票日期|发票号码|购买方|销售方|统一社会信用代码|纳税人识别号|项目名称|价税合计|合计)/)
        .map(normalizeLine)
        .filter(Boolean);

  const isHeaderLine = (line: string) => {
    const compact = line.replace(/\s+/g, '');
    if (headerBlacklist.has(compact)) return true;
    return Array.from(headerBlacklist).some(item => compact === item || compact.startsWith(item));
  };

  const isCompanyNoiseLine = (line: string) => companyNoisePattern.test(line.replace(/\s+/g, ''));

  const isTaxIdLine = (line: string) => /[A-Z0-9]{15,25}/.test(line) || /(统一社会信用代码|纳税人识别号)/.test(line);
  const isAmountLine = (line: string) => /[￥¥]|\d+\.\d{2}/.test(line);
  const isCompanyLike = (line: string) => {
    const candidate = normalizeCompanyName(line);
    if (!candidate) return false;
    const compact = candidate.replace(/\s+/g, '');
    if (compact.length < 4 || compact.length > 40) return false;
    if (isHeaderLine(compact)) return false;
    if (isCompanyNoiseLine(compact)) return false;
    if (isTaxIdLine(compact)) return false;
    if (isAmountLine(compact)) return false;
    return orgKeywordPattern.test(compact);
  };

  const expandShortCompanyName = (line: string, index: number) => {
    const current = normalizeCompanyName(line);
    if (!current) return null;
    if (current.length >= 6) return current;
    const next = normalizeCompanyName(lines[index + 1] || '');
    if (next && next.length <= 12 && !isTaxIdLine(next) && !isHeaderLine(next) && !isCompanyNoiseLine(next) && !isAmountLine(next)) {
      const merged = normalizeCompanyName(`${current}${next}`);
      if (merged && orgKeywordPattern.test(merged)) return merged;
    }
    return current;
  };

  const splitMultipleCompanies = (line: string) => {
    const compact = normalizeCompanyName(line)?.replace(/\s+/g, '') || '';
    if (!compact) return [] as string[];
    const matches = compact.match(/[\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,40}?(?:有限公司|分公司|工作室|中心|便利店|超市|药房|店|局|园|馆|科技|商贸|传媒|餐饮|图文|设计|咨询|健康|租赁|文化|公司)/g) || [];
    return matches.map(match => normalizeCompanyName(match)).filter((value): value is string => Boolean(value));
  };

  const findDateLineIndex = () => lines.findIndex(line => /开票日期|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(line));
  const sectionStopPattern = /(项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|开票日期)/;
  const buyerSectionPattern = /购买方信息|购买方/;
  const sellerSectionPattern = /销售方信息|销售方/;

  const extractCompanyNearLabel = (sourceLines: string[]) => {
    for (let i = 0; i < sourceLines.length; i++) {
      const line = sourceLines[i];
      const inlineMatch = line.match(/名称\s*[:：]?\s*(.+)$/);
      if (inlineMatch) {
        const inlineCompany = normalizeCompanyName(inlineMatch[1]);
        if (inlineCompany && isCompanyLike(inlineCompany)) return inlineCompany;
      }

      if (/^名称\s*[:：]?$/.test(line.replace(/\s+/g, ''))) {
        for (let offset = 1; offset <= 2; offset++) {
          const nextLine = sourceLines[i + offset];
          if (!nextLine) break;
          if (isHeaderLine(nextLine) || isCompanyNoiseLine(nextLine) || isTaxIdLine(nextLine) || isAmountLine(nextLine)) continue;
          const candidate = normalizeCompanyName(nextLine);
          if (candidate && isCompanyLike(candidate)) return candidate;
        }
      }
    }
    return null;
  };

  const extractSectionCompanyByLines = (sectionPattern: RegExp, exactLabelPattern?: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const compact = lines[i].replace(/\s+/g, '');
      if (!sectionPattern.test(compact)) continue;

      const windowLines: string[] = [];
      for (let j = i; j < Math.min(lines.length, i + 8); j++) {
        const currentCompact = lines[j].replace(/\s+/g, '');
        if (
          j > i
          && (
            sectionStopPattern.test(currentCompact)
            || (exactLabelPattern ? exactLabelPattern.test(currentCompact) : false)
          )
        ) break;
        windowLines.push(lines[j]);
      }

      const labeledCompany = extractCompanyNearLabel(windowLines);
      if (labeledCompany) return labeledCompany;

      for (let k = 1; k < windowLines.length; k++) {
        const candidate = normalizeCompanyName(windowLines[k]);
        if (!candidate) continue;
        if (isHeaderLine(candidate) || isCompanyNoiseLine(candidate) || isTaxIdLine(candidate) || isAmountLine(candidate)) continue;
        if (isCompanyLike(candidate)) return candidate;
      }
    }

    return null;
  };

  const extractCompanyFromSectionLines = (sectionPattern: RegExp, nextSectionPattern?: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const compact = lines[i].replace(/\s+/g, '');
      if (!sectionPattern.test(compact)) continue;

      const windowLines: string[] = [];
      for (let j = i; j < Math.min(lines.length, i + 10); j++) {
        const currentLine = lines[j];
        const currentCompact = currentLine.replace(/\s+/g, '');
        if (
          j > i
          && (
            sectionStopPattern.test(currentCompact)
            || (nextSectionPattern ? nextSectionPattern.test(currentCompact) : false)
          )
        ) break;
        windowLines.push(currentLine);
      }

      const mergedWindow = windowLines.join('').replace(/\s+/g, '');
      const labeledMatch = mergedWindow.match(/名称[:：]?([\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,60}?)(?=纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户银行及账号|开户行及账号|电话|地址|机器编号|校验码|$)/);
      if (labeledMatch) {
        const company = normalizeCompanyName(labeledMatch[1]);
        if (company && isCompanyLike(company)) return company;
      }

      const labeledLineCompany = extractCompanyNearLabel(windowLines);
      if (labeledLineCompany) return labeledLineCompany;

      for (let k = 0; k < windowLines.length; k++) {
        const candidate = normalizeCompanyName(windowLines[k]);
        if (!candidate) continue;
        if (isHeaderLine(candidate) || isCompanyNoiseLine(candidate) || isTaxIdLine(candidate) || isAmountLine(candidate)) continue;
        if (isCompanyLike(candidate)) return candidate;
      }
    }

    return null;
  };

  const extractCompanyFromSectionCompactText = (sectionTitle: string, nextSectionTitle?: string) => {
    const escapedSectionTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedNextSectionTitle = nextSectionTitle ? nextSectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const boundary = nextSectionTitle
      ? `${escapedNextSectionTitle}|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$`
      : '项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$';
    const sectionMatch = normalizedText.match(new RegExp(`${escapedSectionTitle}([\\s\\S]{0,260}?)(?:${boundary})`));
    if (!sectionMatch) return null;

    const labeledMatch = sectionMatch[1].match(/名称[:：]?([\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,60}?)(?=纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户银行及账号|开户行及账号|电话|地址|机器编号|校验码|$)/);
    if (!labeledMatch) return null;
    const company = normalizeCompanyName(labeledMatch[1]);
    return company && isCompanyLike(company) ? company : null;
  };

  const extractCompanyFromBlock = (blockText: string | undefined) => {
    if (!blockText) return null;
    const normalizedBlock = blockText
      .replace(/[（【]/g, '(')
      .replace(/[）】]/g, ')')
      .replace(/[：]/g, ':');

    const labeledNameMatch = normalizedBlock.match(/名称\s*[:：]?\s*([^\n\r]+)/);
    if (labeledNameMatch) {
      const labeledName = normalizeCompanyName(labeledNameMatch[1]);
      if (labeledName && isCompanyLike(labeledName)) return labeledName;
    }

    const blockLines = normalizedBlock.split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const labeledLineCompany = extractCompanyNearLabel(blockLines);
    if (labeledLineCompany) return labeledLineCompany;

    for (const line of blockLines) {
      if (isHeaderLine(line) || isCompanyNoiseLine(line) || isTaxIdLine(line) || isAmountLine(line)) continue;
      const normalized = normalizeCompanyName(line);
      if (normalized && isCompanyLike(normalized)) return normalized;
    }

    const mergedBlock = normalizedBlock.replace(/\s+/g, '');
    const mergedMatches = mergedBlock.match(/[\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,40}?(?:有限责任公司|股份有限公司|分公司|事务所|工作室|中心|便利店|超市|药房|店|局|园|馆|科技|商贸|传媒|餐饮|图文|设计|咨询|健康|租赁|文化|公司)/g) || [];
    for (const match of mergedMatches) {
      const normalized = normalizeCompanyName(match);
      if (normalized && isCompanyLike(normalized)) return normalized;
    }

    return null;
  };

  const extractCompanyFromCompactBlock = (blockText: string | undefined) => {
    if (!blockText) return null;
    const compactBlock = blockText
      .replace(/[（【]/g, '(')
      .replace(/[）】]/g, ')')
      .replace(/[：]/g, ':')
      .replace(/\s+/g, '');

    const labeledNameMatch = compactBlock.match(/名称[:：]?([\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,60}?)(?=纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户银行及账号|开户行及账号|电话|地址|机器编号|校验码|$)/);
    if (labeledNameMatch) {
      const labeledName = normalizeCompanyName(labeledNameMatch[1]);
      if (labeledName && isCompanyLike(labeledName)) return labeledName;
    }

    return extractCompanyFromBlock(blockText);
  };

  const extractCompaniesByBlocks = () => {
    const buyerBlockMatch = rawText.match(/购买方信息([\s\S]{0,240}?)(?:销售方信息|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);
    const sellerBlockMatch = rawText.match(/销售方信息([\s\S]{0,240}?)(?:项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);
    const compactBuyerBlockMatch = normalizedText.match(/购买方信息([\s\S]{0,240}?)(?:销售方信息|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);
    const compactSellerBlockMatch = normalizedText.match(/销售方信息([\s\S]{0,240}?)(?:项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);
    const buyerCompactSection = extractCompanyFromSectionCompactText('购买方信息', '销售方信息');
    const sellerCompactSection = extractCompanyFromSectionCompactText('销售方信息');
    const buyerLineSection = extractCompanyFromSectionLines(buyerSectionPattern, sellerSectionPattern);
    const sellerLineSection = extractCompanyFromSectionLines(sellerSectionPattern);
    const buyerNearSection = extractSectionCompanyByLines(buyerSectionPattern, sellerSectionPattern);
    const sellerNearSection = extractSectionCompanyByLines(sellerSectionPattern);

    return {
      buyer: buyerCompactSection || extractCompanyFromCompactBlock(compactBuyerBlockMatch?.[1]) || extractCompanyFromBlock(buyerBlockMatch?.[1]) || buyerLineSection || buyerNearSection,
      seller: sellerCompactSection || extractCompanyFromCompactBlock(compactSellerBlockMatch?.[1]) || extractCompanyFromBlock(sellerBlockMatch?.[1]) || sellerLineSection || sellerNearSection,
    };
  };

  const extractCompaniesByLines = () => {
    let buyer: string | null = null;
    let seller: string | null = null;
    let seenBuyerTaxId = false;
    let seenSellerTaxId = false;
    const startIndex = Math.max(0, findDateLineIndex());

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (isHeaderLine(line)) continue;

      const splitCompanies = splitMultipleCompanies(line).filter(isCompanyLike);
      if (!buyer && splitCompanies.length >= 1) {
        buyer = expandShortCompanyName(splitCompanies[0], i);
        if (splitCompanies.length >= 2) {
          seller = expandShortCompanyName(splitCompanies[1], i);
        }
        continue;
      }

      if (!buyer && isCompanyLike(line)) {
        buyer = expandShortCompanyName(line, i);
        continue;
      }

      if (buyer && !seenBuyerTaxId && isTaxIdLine(line)) {
        seenBuyerTaxId = true;
        continue;
      }

      if (buyer && seenBuyerTaxId && !seller) {
        if (splitCompanies.length >= 1) {
          seller = expandShortCompanyName(splitCompanies[0], i);
          continue;
        }
        if (isCompanyLike(line)) {
          seller = expandShortCompanyName(line, i);
          continue;
        }
      }

      if (seller && !seenSellerTaxId && isTaxIdLine(line)) {
        seenSellerTaxId = true;
        break;
      }
    }

    return { buyer, seller };
  };

  const blockCompanies = extractCompaniesByBlocks();
  const lineCompanies = extractCompaniesByLines();

  const invoiceCodeMatch = noSpaceText.match(/(?:发票代码|代码)\s*[:：]?\s*(\d{10,12})/)
    || noSpaceText.match(/(?<!\d)(\d{10,12})(?!\d)/);

  const invoiceNumberMatch = noSpaceText.match(/(?:发票号码|票号|号码)\s*[:：]?\s*(\d{20})(?!\d)/)
    || compactText.match(/(?:发票号码|票号|号码)\s*[:：]?\s*(\d{20})(?!\d)/)
    || noSpaceText.match(/(?<!\d)(\d{20})(?!\d)/);

  const dateMatch = normalizedText.match(/开票日期\s*[:：]?\s*(\d{4})\s*[年\-./]\s*(\d{1,2})\s*[月\-./]\s*(\d{1,2})\s*[日号]?/)
    || normalizedText.match(/(?<!\d)(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?!\d)/);

  const checkCodeMatch = noSpaceText.match(/(?:校验码|机器编号)\s*[:：]?\s*(\d{12,20})/);

  const buyer_company = blockCompanies.buyer || lineCompanies.buyer;
  const seller_company = blockCompanies.seller || lineCompanies.seller;

  if (DEBUG_INVOICE_PARSE) {
    console.log('[PDF normalized lines]', lines.slice(0, 20));
    console.log('[PDF buyer extracted]', buyer_company ?? null);
    console.log('[PDF seller extracted]', seller_company ?? null);
  }

  const totalAmountMatch = normalizedText.match(/价税合计(?:\s*\(小写\))?\s*[:：]?\s*[￥¥]?\s*(\d+[.,]\d{2})/)
    || noSpaceText.match(/价税合计(?:\(小写\))?[^\d￥¥]*[￥¥]?(\d+[.,]\d{2})/);

  const amountTaxLabeledMatch = normalizedText.match(/合计\s*[:：]?\s*[￥¥]?\s*(\d+[.,]\d{2}|\*\*\*)[\s\S]{0,20}?税额\s*[:：]?\s*(?:[￥¥]?\s*)?(\d+[.,]\d{2}|\*\*\*|免税|不征税)/)
    || normalizedText.match(/金额\s*[:：]?\s*[￥¥]?\s*(\d+[.,]\d{2})[\s\S]{0,20}?税额\s*[:：]?\s*(?:[￥¥]?\s*)?(\d+[.,]\d{2}|\*\*\*|免税|不征税)/);

  const allCurrencyMatches = [...noSpaceText.matchAll(/[￥¥](\d+\.\d{2})/g)].map(m => parseAmount(m[1])).filter((v): v is number => v != null);

  let amount = amountTaxLabeledMatch ? parseAmount(amountTaxLabeledMatch[1]) : null;
  let tax_amount = amountTaxLabeledMatch && !['***', '免税', '不征税'].includes(amountTaxLabeledMatch[2])
    ? parseAmount(amountTaxLabeledMatch[2])
    : null;
  let total_amount = totalAmountMatch ? parseAmount(totalAmountMatch[1]) : null;

  if (amount == null && allCurrencyMatches.length >= 1) amount = allCurrencyMatches[0];
  if (tax_amount == null && allCurrencyMatches.length >= 2) tax_amount = allCurrencyMatches[1];
  if (total_amount == null && allCurrencyMatches.length >= 1) total_amount = allCurrencyMatches[allCurrencyMatches.length - 1];

  const taxRateMatch = normalizedText.match(/(?:税率|征收率)\s*[:：]?\s*(13%|9%|6%|3%|1%|0%|免税|不征税)/)
    || normalizedText.match(/(13|9|6|3|1|0)\s*[%％]/)
    || normalizedText.match(/(?:免税|不征税)/);

  let tax_rate: string | null = null;
  if (taxRateMatch) {
    const matched = taxRateMatch[1] || taxRateMatch[0];
    tax_rate = matched.includes('%') || matched === '免税' || matched === '不征税' ? matched : `${matched}%`;
  }

  if ((tax_rate === '免税' || tax_rate === '不征税') && tax_amount == null) {
    tax_amount = 0;
  }

  if (total_amount == null && amount != null && tax_amount != null) {
    total_amount = Number((amount + tax_amount).toFixed(2));
  }

  if (amount == null && total_amount != null && tax_amount != null) {
    amount = Number((total_amount - tax_amount).toFixed(2));
  }

  let date: string | null = null;
  if (dateMatch) {
    date = `${dateMatch[1]}${String(dateMatch[2]).padStart(2, '0')}${String(dateMatch[3]).padStart(2, '0')}`;
  }

  let invoice_type: string | null = null;
  if (/增值税电子发票\(普通发票\)|电子发票\(普通发票\)/.test(normalizedText)) {
    invoice_type = '电子发票（普通发票）';
  } else if (/增值税电子专用发票|电子发票\(增值税专用发票\)|专用发票/.test(normalizedText)) {
    invoice_type = '电子发票（增值税专用发票）';
  } else if (/通行费/.test(normalizedText)) {
    invoice_type = '通行费';
  } else if (/不动产经营租赁服务/.test(normalizedText)) {
    invoice_type = '不动产经营租赁服务';
  } else if (/预付卡销售/.test(normalizedText)) {
    invoice_type = '预付卡销售';
  }

  return {
    invoice_code: invoiceCodeMatch ? invoiceCodeMatch[1] : null,
    invoice_number: invoiceNumberMatch ? invoiceNumberMatch[1] : null,
    date,
    buyer_company,
    seller_company,
    total_amount,
    amount,
    tax_amount,
    check_code: checkCodeMatch ? checkCodeMatch[1] : null,
    invoice_type,
    tax_rate,
  };
};
