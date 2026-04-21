const DEBUG_INVOICE_PARSE = false;

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
      .replace(/^(?:购买方名称|销售方名称|购方名称|销方名称|购方|销方|购买方|销售方|名称)[:：\s]*/g, '')
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
    '购买方信息', '销售方信息', '购买方', '销售方', '购买方名称', '销售方名称', '名称',
    '货物或应税劳务', '服务名称', '合计', '备注', '开票日期', '发票号码', '校验码',
    '纳税人识别号', '统一社会信用代码', '地址电话', '地址、电话', '开户银行及账号', '开户行及账号',
  ]);

  const companyNoisePattern = /(税务局|开户银行|开户行|账号|开户地址|地址、电话|电话|纳税人识别号|统一社会信用代码|机器编号|校验码)/;
  const orgKeywordPattern = /(公司|有限公司|分公司|工作室|中心|店|局|园|馆|科技|商贸|传媒|餐饮|图文|设计|咨询|健康|药房|租赁|文化|便利店|超市)/;
  const sectionStopPattern = /(项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|开票日期|发票号码|校验码)/;
  const buyerSectionPattern = /购买方信息|购买方|购方/;
  const sellerSectionPattern = /销售方信息|销售方|销方/;

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
        .split(/(?=购买方信息|销售方信息|购买方名称|销售方名称|购买方|销售方|开票日期|发票号码|统一社会信用代码|纳税人识别号|项目名称|价税合计|合计)/)
        .map(normalizeLine)
        .filter(Boolean);

  const isHeaderLine = (line: string) => {
    const compact = line.replace(/\s+/g, '');
    if (headerBlacklist.has(compact)) return true;
    return Array.from(headerBlacklist).some(item => compact === item || compact.startsWith(item));
  };

  const isTaxIdLine = (line: string) => /[A-Z0-9]{15,25}/.test(line) || /(统一社会信用代码|纳税人识别号)/.test(line);
  const isAmountLine = (line: string) => /[￥¥]|\d+\.\d{2}/.test(line);
  const isCompanyNoiseLine = (line: string) => companyNoisePattern.test(line.replace(/\s+/g, ''));

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

  const scoreCompanyCandidate = (value: string | null) => {
    if (!value) return -1;
    let score = value.length;
    if (/有限公司|有限责任公司|股份有限公司/.test(value)) score += 60;
    if (/分公司|工作室|中心|公司/.test(value)) score += 30;
    if (orgKeywordPattern.test(value)) score += 20;
    if (companyNoisePattern.test(value)) score -= 80;
    if (/[A-Z0-9]{15,25}/.test(value)) score -= 80;
    return score;
  };

  const pickBestCompany = (candidates: Array<string | null | undefined>) => {
    const normalizedCandidates = candidates
      .map(candidate => normalizeCompanyName(candidate ?? null))
      .filter((candidate): candidate is string => Boolean(candidate))
      .filter(candidate => isCompanyLike(candidate));

    if (normalizedCandidates.length === 0) return null;

    return normalizedCandidates
      .sort((a, b) => scoreCompanyCandidate(b) - scoreCompanyCandidate(a))[0] || null;
  };

  const buildLabelPatterns = (
    mode: 'buyer' | 'seller' | 'generic',
    allowGenericName: boolean,
  ): RegExp[] => {
    if (mode === 'buyer') {
      return [
        /购买方名称[:：]?(.+)$/,
        /购买方[:：]?(.+)$/,
        /购方名称[:：]?(.+)$/,
        /购方[:：]?(.+)$/,
        ...(allowGenericName ? [/名称[:：]?(.+)$/] : []),
      ];
    }

    if (mode === 'seller') {
      return [
        /销售方名称[:：]?(.+)$/,
        /销售方[:：]?(.+)$/,
        /销方名称[:：]?(.+)$/,
        /销方[:：]?(.+)$/,
        ...(allowGenericName ? [/名称[:：]?(.+)$/] : []),
      ];
    }

    return [
      ...(allowGenericName ? [/(?:购买方名称|销售方名称|名称)[:：]?(.+)$/] : []),
    ];
  };

  const buildExactLabelPatterns = (
    mode: 'buyer' | 'seller' | 'generic',
    allowGenericName: boolean,
  ): RegExp[] => {
    if (mode === 'buyer') {
      return [
        /^购买方名称[:：]?$/,
        /^购买方[:：]?$/,
        /^购方名称[:：]?$/,
        /^购方[:：]?$/,
        ...(allowGenericName ? [/^名称[:：]?$/] : []),
      ];
    }

    if (mode === 'seller') {
      return [
        /^销售方名称[:：]?$/,
        /^销售方[:：]?$/,
        /^销方名称[:：]?$/,
        /^销方[:：]?$/,
        ...(allowGenericName ? [/^名称[:：]?$/] : []),
      ];
    }

    return allowGenericName ? [/^名称[:：]?$/] : [];
  };

  const extractLabeledCompanyFromLine = (
    line: string,
    mode: 'buyer' | 'seller' | 'generic',
    allowGenericName: boolean,
  ) => {
    const compact = line.replace(/\s+/g, '');
    const patterns = buildLabelPatterns(mode, allowGenericName);

    for (const pattern of patterns) {
      const match = compact.match(pattern);
      if (!match) continue;
      const candidate = normalizeCompanyName(match[1]);
      if (candidate && isCompanyLike(candidate)) return candidate;
    }

    return null;
  };

  const extractCompanyNearLabel = (
    sourceLines: string[],
    mode: 'buyer' | 'seller' | 'generic',
    allowGenericName: boolean,
  ) => {
    const exactLabelPatterns = buildExactLabelPatterns(mode, allowGenericName);

    for (let i = 0; i < sourceLines.length; i++) {
      const line = sourceLines[i];
      const inlineCandidate = extractLabeledCompanyFromLine(line, mode, allowGenericName);
      if (inlineCandidate) return inlineCandidate;

      const compact = line.replace(/\s+/g, '');
      if (!exactLabelPatterns.some(pattern => pattern.test(compact))) continue;

      const candidates: string[] = [];
      for (let offset = 1; offset <= 2; offset++) {
        const nextLine = sourceLines[i + offset];
        if (!nextLine) break;
        if (isHeaderLine(nextLine) || isCompanyNoiseLine(nextLine) || isTaxIdLine(nextLine) || isAmountLine(nextLine)) continue;
        const normalized = normalizeCompanyName(nextLine);
        if (normalized) candidates.push(normalized);
      }

      const best = pickBestCompany(candidates);
      if (best) return best;
    }

    return null;
  };

  const extractCompanyFromSectionCompactText = (sectionTitles: string[], nextSectionTitles: string[] = []) => {
    const sectionBoundary = [...nextSectionTitles, '项目名称', '货物或应税劳务', '服务名称', '规格型号', '单位', '数量', '单价', '金额', '税额', '价税合计', '备注', '$']
      .map(title => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    for (const sectionTitle of sectionTitles) {
      const escapedSectionTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sectionMatch = normalizedText.match(new RegExp(`${escapedSectionTitle}([\\s\\S]{0,260}?)(?:${sectionBoundary})`));
      if (!sectionMatch) continue;

      const block = sectionMatch[1];
      const labeledMatch = block.match(/(?:购买方名称|销售方名称|名称)[:：]?([\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,60}?)(?=纳税人识别号|统一社会信用代码|地址、电话|开户地址及账号|开户银行及账号|开户行及账号|电话|地址|机器编号|校验码|$)/);
      if (labeledMatch) {
        const company = normalizeCompanyName(labeledMatch[1]);
        if (company && isCompanyLike(company)) return company;
      }
    }

    return null;
  };

  const extractCompanyFromBlock = (blockText: string | undefined, mode: 'buyer' | 'seller' | 'generic') => {
    if (!blockText) return null;

    const blockLines = blockText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const labeledCompany = extractCompanyNearLabel(blockLines, mode, true);
    if (labeledCompany) return labeledCompany;

    const candidates: string[] = [];
    for (const line of blockLines) {
      if (isHeaderLine(line) || isCompanyNoiseLine(line) || isTaxIdLine(line) || isAmountLine(line)) continue;
      const normalized = normalizeCompanyName(line);
      if (normalized) candidates.push(normalized);
    }

    const best = pickBestCompany(candidates);
    if (best) return best;

    const mergedBlock = blockText.replace(/\s+/g, '');
    const mergedMatches = mergedBlock.match(/[\u4e00-\u9fa5A-Za-z0-9()（）·\-]{4,40}?(?:有限责任公司|股份有限公司|分公司|事务所|工作室|中心|便利店|超市|药房|店|局|园|馆|科技|商贸|传媒|餐饮|图文|设计|咨询|健康|租赁|文化|公司)/g) || [];
    return pickBestCompany(mergedMatches);
  };

  const extractCompanyFromSectionLines = (sectionPattern: RegExp, mode: 'buyer' | 'seller', nextSectionPattern?: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const compact = lines[i].replace(/\s+/g, '');
      if (!sectionPattern.test(compact)) continue;

      const windowLines: string[] = [];
      for (let j = i; j < Math.min(lines.length, i + 10); j++) {
        const currentCompact = lines[j].replace(/\s+/g, '');
        if (
          j > i
          && (
            sectionStopPattern.test(currentCompact)
            || (nextSectionPattern ? nextSectionPattern.test(currentCompact) : false)
          )
        ) break;
        windowLines.push(lines[j]);
      }

      const labeledCompany = extractCompanyNearLabel(windowLines, mode, true);
      if (labeledCompany) return labeledCompany;

      const candidates = windowLines
        .filter(line => !isHeaderLine(line) && !isCompanyNoiseLine(line) && !isTaxIdLine(line) && !isAmountLine(line))
        .map(line => normalizeCompanyName(line));
      const best = pickBestCompany(candidates);
      if (best) return best;
    }

    return null;
  };

  const extractExplicitCompanies = () => {
    const buyerCompact = extractCompanyFromSectionCompactText(['购买方信息', '购买方', '购方'], ['销售方信息', '销售方', '销方']);
    const sellerCompact = extractCompanyFromSectionCompactText(['销售方信息', '销售方', '销方']);

    const buyerBlockMatch = rawText.match(/(?:购买方信息|购买方|购方)([\s\S]{0,240}?)(?:销售方信息|销售方|销方|项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);
    const sellerBlockMatch = rawText.match(/(?:销售方信息|销售方|销方)([\s\S]{0,240}?)(?:项目名称|货物或应税劳务|服务名称|规格型号|单位|数量|单价|金额|税额|价税合计|备注|$)/);

    const buyerBlock = extractCompanyFromBlock(buyerBlockMatch?.[1], 'buyer');
    const sellerBlock = extractCompanyFromBlock(sellerBlockMatch?.[1], 'seller');

    const buyerLineSection = extractCompanyFromSectionLines(buyerSectionPattern, 'buyer', sellerSectionPattern);
    const sellerLineSection = extractCompanyFromSectionLines(sellerSectionPattern, 'seller');

    const globalBuyerLabel = extractCompanyNearLabel(lines, 'buyer', false);
    const globalSellerLabel = extractCompanyNearLabel(lines, 'seller', false);

    return {
      buyer: buyerCompact || buyerBlock || buyerLineSection || globalBuyerLabel,
      seller: sellerCompact || sellerBlock || sellerLineSection || globalSellerLabel,
    };
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

  // Low-confidence fallback: only used when explicit section/label extraction failed.
  const extractCompaniesByLinesFallback = () => {
    let buyer: string | null = null;
    let seller: string | null = null;
    let seenBuyerTaxId = false;
    const startIndex = Math.max(0, findDateLineIndex());

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (isHeaderLine(line)) continue;

      const splitCompanies = splitMultipleCompanies(line).filter(isCompanyLike);

      if (!buyer && splitCompanies.length >= 1) {
        buyer = expandShortCompanyName(splitCompanies[0], i);
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

      if (buyer && seenBuyerTaxId && !seller && splitCompanies.length === 1) {
        seller = expandShortCompanyName(splitCompanies[0], i);
        continue;
      }

      if (buyer && seenBuyerTaxId && !seller && isCompanyLike(line) && splitCompanies.length <= 1) {
        seller = expandShortCompanyName(line, i);
        continue;
      }
    }

    return { buyer, seller };
  };

  const explicitCompanies = extractExplicitCompanies();
  const fallbackCompanies = extractCompaniesByLinesFallback();
  const buyer_company = explicitCompanies.buyer || fallbackCompanies.buyer;
  const seller_company = explicitCompanies.seller || fallbackCompanies.seller;

  const invoiceCodeMatch = noSpaceText.match(/(?:发票代码|代码)\s*[:：]?\s*(\d{10,12})/)
    || noSpaceText.match(/(?<!\d)(\d{10,12})(?!\d)/);

  const labeledInvoiceNumberMatch = noSpaceText.match(/(?:发票号码|票号|号码)\s*[:：]?\s*(\d{8,24})/)
    || compactText.match(/(?:发票号码|票号|号码)\s*[:：]?\s*(\d{8,24})/);
  const strict20DigitInvoiceNumberMatch = noSpaceText.match(/(?<!\d)(\d{20})(?!\d)/);
  const invoiceNumberMatch = strict20DigitInvoiceNumberMatch || labeledInvoiceNumberMatch;

  const dateMatch = normalizedText.match(/(?:开票日期|日期)\s*[:：]?\s*(\d{4})\s*[年\-./]\s*(\d{1,2})\s*[月\-./]\s*(\d{1,2})\s*[日号]?/)
    || normalizedText.match(/(?<!\d)(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?!\d)/)
    || noSpaceText.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);

  const totalAmountMatch = normalizedText.match(/价税合计(?:\s*\(小写\))?\s*[:：]?\s*[￥¥]?\s*(\d+[.,]\d{2})/)
    || noSpaceText.match(/价税合计(?:\(小写\))?[^\d￥¥]*[￥¥]?(\d+[.,]\d{2})/);

  const amountTaxLabeledMatch = normalizedText.match(/合计\s*[:：]?\s*[￥¥]?\s*(\d+[.,]\d{2}|\*\*\*)[\s\S]{0,20}?税额\s*[:：]?\s*(?:[￥¥]?\s*)?(\d+[.,]\d{2}|\*\*\*|免税|不征税)/)
    || normalizedText.match(/金额\s*[:：]?\s*[￥¥]?\s*(\d+[.,]\d{2})[\s\S]{0,20}?税额\s*[:：]?\s*(?:[￥¥]?\s*)?(\d+[.,]\d{2}|\*\*\*|免税|不征税)/);

  const allCurrencyMatches = [...noSpaceText.matchAll(/[￥¥](\d+\.\d{2})/g)].map(m => parseAmount(m[1])).filter((v): v is number => v != null);

  const checkCodeMatch = noSpaceText.match(/(?:校验码|机器编号)\s*[:：]?\s*(\d{12,20})/);

  const taxRateMatch = normalizedText.match(/(?:税率|征收率)\s*[:：]?\s*(13%|9%|6%|3%|1%|0%|免税|不征税)/)
    || normalizedText.match(/(13|9|6|3|1|0)\s*[%％]/)
    || normalizedText.match(/(?:免税|不征税)/);

  let date: string | null = null;
  if (dateMatch) {
    if (dateMatch.length >= 4) {
      date = `${dateMatch[1]}${String(dateMatch[2]).padStart(2, '0')}${String(dateMatch[3]).padStart(2, '0')}`;
    } else if (dateMatch[0]) {
      date = dateMatch[0];
    }
  }

  let amount = amountTaxLabeledMatch ? parseAmount(amountTaxLabeledMatch[1]) : null;
  let tax_amount = amountTaxLabeledMatch && !['***', '免税', '不征税'].includes(amountTaxLabeledMatch[2])
    ? parseAmount(amountTaxLabeledMatch[2])
    : null;
  let total_amount = totalAmountMatch ? parseAmount(totalAmountMatch[1]) : null;

  if (amount == null && allCurrencyMatches.length >= 1) amount = allCurrencyMatches[0];
  if (tax_amount == null && allCurrencyMatches.length >= 2) tax_amount = allCurrencyMatches[1];
  if (total_amount == null && allCurrencyMatches.length >= 1) total_amount = allCurrencyMatches[allCurrencyMatches.length - 1];

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

  if (DEBUG_INVOICE_PARSE) {
    console.log('[OCR normalized lines]', lines.slice(0, 20));
    console.log('[OCR buyer explicit]', explicitCompanies.buyer ?? null);
    console.log('[OCR seller explicit]', explicitCompanies.seller ?? null);
    console.log('[OCR buyer fallback]', fallbackCompanies.buyer ?? null);
    console.log('[OCR seller fallback]', fallbackCompanies.seller ?? null);
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
