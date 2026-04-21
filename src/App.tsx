import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-expect-error - Vite specific import
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Download, Camera, Keyboard, Trash2, AlertCircle, CheckCircle2, Upload, FolderOpen, ChevronDown, X, Edit2, Settings, DownloadCloud, UploadCloud, Database, FileText } from 'lucide-react';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
import { format } from 'date-fns';
import { generateMonthList } from './utils/months';
import * as XLSX from 'xlsx';
import { cn } from './utils/cn';
import { parseQrInvoice } from './parsers/qrInvoice';
import { parseOcrInvoice } from './parsers/ocrInvoice';
import { parsePdfInvoice } from './parsers/pdfInvoice';
import { createInvoiceDraft } from './services/invoiceFactory';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Invoice } from './db';
import type { SearchOption, InvoiceTypeOption } from './types/invoice';
import { pinyin } from 'pinyin-pro';

const PRESET_COMPANIES: {label: string, value: string, search: string}[] = [];

const PRESET_INVOICE_TYPES = [
  { label: '1-火车票 (税率 9%)', value: '1-火车票', search: '1 hcp huochepiao', taxRate: '9%' },
  { label: '2-火车票退票费 (税率 6%)', value: '2-火车票退票费', search: '2 hcptpf huochepiaotuipiaofei', taxRate: '6%' },
  { label: '3-客运服务费1 (税率 1%)', value: '3-客运服务费1', search: '3 kyfwf1 keyunfuwufei1', taxRate: '1%' },
  { label: '4-客运服务费3 (税率 3%)', value: '4-客运服务费3', search: '4 kyfwf3 keyunfuwufei3', taxRate: '3%' },
  { label: '5-飞机票 (税率自行填写)', value: '5-飞机票', search: '5 fjp feijipiao', taxRate: null },
  { label: '6-其他及普票 (税率 0%)', value: '6-其他及普票', search: '6 qtjpp qitajiupupiao', taxRate: '0%' }
];

const EditableCell = ({ value, onChange, type = "text", placeholder = "点击填写", options }: { value: any, onChange: (val: any) => void, type?: string, placeholder?: string, options?: SearchOption[] }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [val, setVal] = useState(value || '');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setVal(value || '');
  }, [value]);

  const handleBlur = () => {
    setIsEditing(false);
    setShowDropdown(false);
    if (val !== (value || '')) {
      onChange(type === 'number' ? (val ? parseFloat(val) : null) : val);
    }
  };

  if (isEditing) {
    const filteredOptions = options?.filter(opt => 
      opt.label.toLowerCase().includes(val.toLowerCase()) || 
      opt.search.toLowerCase().includes(val.toLowerCase())
    );

    return (
      <div className="relative w-full">
        <input
          autoFocus
          type={type}
          value={val}
          onChange={e => {
            setVal(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={handleBlur}
          onKeyDown={e => e.key === 'Enter' && handleBlur()}
          className="w-full px-1 py-1 border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
        />
        {showDropdown && val && options && filteredOptions && filteredOptions.length > 0 && (
          <div className="absolute z-50 left-0 top-full mt-1 w-max min-w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
            {filteredOptions.map(opt => (
              <div
                key={opt.value}
                className="px-3 py-2 text-xs cursor-pointer hover:bg-indigo-50 text-slate-700"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent input onBlur from firing before this
                  setVal(opt.value);
                  setShowDropdown(false);
                  setIsEditing(false);
                  if (opt.value !== (value || '')) {
                    onChange(opt.value);
                  }
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const displayValue = type === 'number' && value != null && value !== '' 
    ? Number(value).toFixed(2) 
    : value;

  return (
    <div 
      onClick={() => setIsEditing(true)} 
      title={displayValue || ''}
      className={cn(
        "px-1 py-1 min-h-[24px] w-full rounded cursor-text hover:bg-slate-200 transition-colors flex items-center border border-transparent hover:border-slate-300 overflow-hidden",
        (value == null || value === '') && "text-slate-400 italic"
      )}
    >
      <span className="truncate block w-full">{(value == null || value === '') ? placeholder : displayValue}</span>
    </div>
  );
};

/**
 * 生成归档月份列表（从2026年03月开始，直到当前系统月份+1个月）
 * 确保历史月份不会随时间推移而消失
 */

export default function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isOcrUploading, setIsOcrUploading] = useState(false);
  const ocrFileInputRef = useRef<HTMLInputElement>(null);
  const [filterCompany, setFilterCompany] = useState<string>('全部受方');
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
  const [monthList, setMonthList] = useState<string[]>(() => {
    const saved = localStorage.getItem('invoice_month_list');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return generateMonthList();
  });

  useEffect(() => {
    localStorage.setItem('invoice_month_list', JSON.stringify(monthList));
  }, [monthList]);

  const [activeFolderMonth, setActiveFolderMonth] = useState<string>(monthList[0] || 'ALL');
  const [isEditingMonths, setIsEditingMonths] = useState(false);
  const [newMonthInput, setNewMonthInput] = useState('');

  const [companies, setCompanies] = useState<SearchOption[]>(() => {
    const saved = localStorage.getItem('invoice_companies');
    const migrated = localStorage.getItem('invoice_companies_migrated_empty');
    if (saved) {
      try { 
        let parsed = JSON.parse(saved);
        if (!migrated) {
          const oldPresets = ['艾捷博雅', '迪沃特', '浙江博颐', '天津博蕴', '中科博蕴', '青岛艾捷博雅'];
          parsed = parsed.filter((c: any) => !oldPresets.includes(c.value));
          localStorage.setItem('invoice_companies_migrated_empty', 'true');
        }
        return parsed; 
      } catch (e) {}
    }
    return PRESET_COMPANIES;
  });

  const [invoiceTypes, setInvoiceTypes] = useState<InvoiceTypeOption[]>(() => {
    const saved = localStorage.getItem('invoice_types');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return PRESET_INVOICE_TYPES;
  });

  useEffect(() => {
    localStorage.setItem('invoice_companies', JSON.stringify(companies));
  }, [companies]);

  useEffect(() => {
    localStorage.setItem('invoice_types', JSON.stringify(invoiceTypes));
  }, [invoiceTypes]);

  const [reimbursers, setReimbursers] = useState<SearchOption[]>(() => {
    const saved = localStorage.getItem('invoice_reimbursers');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('invoice_reimbursers', JSON.stringify(reimbursers));
  }, [reimbursers]);

  const [sellerCompanies, setSellerCompanies] = useState<SearchOption[]>(() => {
    const saved = localStorage.getItem('invoice_seller_companies');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('invoice_seller_companies', JSON.stringify(sellerCompanies));
  }, [sellerCompanies]);

  const [isBackendOpen, setIsBackendOpen] = useState(false);
  const [backendTab, setBackendTab] = useState<'companies' | 'sellerCompanies' | 'invoiceTypes' | 'reimbursers' | 'data'>('companies');
  const [newCompanyLabel, setNewCompanyLabel] = useState('');
  const [newSellerCompanyLabel, setNewSellerCompanyLabel] = useState('');
  const [newReimburserLabel, setNewReimburserLabel] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [newTypeValue, setNewTypeValue] = useState('');
  const [newTypeTax, setNewTypeTax] = useState('');

  const [isAutoMode, setIsAutoMode] = useState(() => {
    const saved = localStorage.getItem('invoice_auto_mode');
    return saved ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem('invoice_auto_mode', JSON.stringify(isAutoMode));
  }, [isAutoMode]);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('invoice_column_widths');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      buyer_company: 150,
      invoice_type: 100,
      invoice_number: 120,
      seller_company: 150,
    };
  });

  useEffect(() => {
    localStorage.setItem('invoice_column_widths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  const handleMouseDown = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    resizingCol.current = colKey;
    startX.current = e.clientX;
    startWidth.current = columnWidths[colKey] || 150;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = moveEvent.clientX - startX.current;
      const newWidth = Math.max(50, startWidth.current + diff);
      setColumnWidths(prev => ({ ...prev, [resizingCol.current!]: newWidth }));
    };

    const handleMouseUp = () => {
      resizingCol.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 视图层过滤：使用 useLiveQuery 精准查询当前选中月份的数据，实现数据变化时的界面自动刷新
  const filteredInvoices = useLiveQuery(
    async () => {
      let results;
      if (activeFolderMonth !== 'ALL') {
        results = await db.invoices.where('targetMonth').equals(activeFolderMonth).reverse().sortBy('created_at');
      } else {
        results = await db.invoices.orderBy('created_at').reverse().toArray();
      }
      
      if (filterCompany !== '全部受方') {
        results = results.filter(inv => inv.buyer_company === filterCompany);
      }
      return results;
    },
    [activeFolderMonth, filterCompany]
  );
  const loading = filteredInvoices === undefined;
  const invoicesToDisplay = filteredInvoices || [];

  const scannerInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Focus input on load for scanner gun
    if (scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  }, []);

  const lastScannedRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });

  const playBeep = (type: 'success' | 'error' | 'duplicate') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'error') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } else if (type === 'duplicate') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      }
    } catch (e) {
      console.error('Audio play failed', e);
    }
  };

  const isSubmittingRef = useRef(false);

  const handleScanSubmit = async (data: string, imageBase64?: string) => {
    if (isSubmittingRef.current) return; // 防抖，防止瞬间多次触发

    const trimmedData = data.trim();
    if (!trimmedData) return;
    
    // Prevent rapid duplicate scans from camera (within 2 seconds)
    const now = Date.now();
    if (lastScannedRef.current.text === trimmedData && now - lastScannedRef.current.time < 2000) {
      return;
    }
    lastScannedRef.current = { text: trimmedData, time: now };
    
    isSubmittingRef.current = true;
    try {
      const {
        invoice_type,
        invoice_code,
        invoice_number,
        parsedAmount,
        date,
        check_code,
      } = parseQrInvoice(trimmedData);

      // 提取发票号码进行查重
      const finalInvoiceNumber = invoice_number || `UNKNOWN-${Date.now()}`;

      // --- 查重区 ---
      const existingInvoice = await db.invoices.where('invoice_number').equals(finalInvoiceNumber).first();
      const is_duplicate = !!existingInvoice;
      
      if (is_duplicate) {
        playBeep('duplicate');
      } else {
        playBeep('success');
      }

      const newInvoice: Invoice = createInvoiceDraft({
        raw_data: trimmedData,
        invoice_code,
        invoice_number: finalInvoiceNumber,
        invoice_type,
        buyer_company: null,
        seller_company: null,
        date,
        amount: null,
        tax_amount: null,
        total_amount: parsedAmount,
        check_code,
        tax_rate: null,
        targetMonth: activeFolderMonth === 'ALL' ? format(new Date(), 'yyyy年MM月') : activeFolderMonth,
        created_at: new Date().toISOString(),
        import_batch_id: null,
        source_page: null,
        image_base64: imageBase64 || null,
      });
      newInvoice.is_duplicate = is_duplicate;

      // 将包含完整属性的数据真实写入 IndexedDB
      await db.invoices.add(newInvoice);
      
      // --- 焦点重置区 ---
      if (scannerInputRef.current) {
        scannerInputRef.current.value = ''; // 强制清空 DOM 值
        scannerInputRef.current.focus();
      }
    } catch (err) {
      playBeep('error');
      setError(err instanceof Error ? err.message : '保存扫描数据失败');
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (scannerInputRef.current) {
      // 1. 获取底层 DOM 的真实值，彻底绕过 React 状态更新的任何延迟
      let rawValue = scannerInputRef.current.value;
      // 2. 修复中文输入法导致的标点符号问题（将全角逗号替换为半角逗号）
      rawValue = rawValue.replace(/，/g, ',');
      handleScanSubmit(rawValue);
    }
  };

  const toggleCamera = () => {
    if (isScanning) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
        scannerRef.current = null;
      }
      setIsScanning(false);
    } else {
      setIsScanning(true);
      setTimeout(() => {
        scannerRef.current = new Html5QrcodeScanner(
          "reader",
          { fps: 10, qrbox: { width: 250, height: 250 } },
          /* verbose= */ false
        );
        scannerRef.current.render(
          (decodedText) => {
            handleScanSubmit(decodedText);
            // Optional: stop scanning after success
            // toggleCamera();
          },
          (error) => {
            // ignore scan errors (happens when no QR code is in frame)
          }
        );
      }, 100);
    }
  };

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const readFileAsBytes = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  };

  const persistImageInvoiceToPrimaryStorage = async ({
    file,
    rawData,
    invoice,
  }: {
    file: File;
    rawData: string;
    invoice: {
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
      import_batch_id: string | null;
      source_page: number | null;
      is_duplicate: boolean;
    };
  }) => {
    if (!window.invoiceStorage) {
      return {
        ok: false as const,
        stage: 'bridge' as const,
        message: '当前运行环境未提供 invoiceStorage 桥接，已跳过 SQLite 试点写入。',
      };
    }

    let savedFile: Awaited<ReturnType<NonNullable<typeof window.invoiceStorage>['saveOriginalFile']>> | null = null;

    try {
      const fileBytes = await readFileAsBytes(file);
      savedFile = await window.invoiceStorage.saveOriginalFile({
        content: fileBytes,
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        createdAt: new Date(invoice.created_at),
      });
    } catch (err) {
      return {
        ok: false as const,
        stage: 'file' as const,
        message: `原图落盘失败：${err instanceof Error ? err.message : '未知错误'}`,
      };
    }

    try {
      const sqliteRecord = await window.invoiceStorage.createInvoiceRecord({
        invoice: {
          raw_data: rawData,
          invoice_code: invoice.invoice_code,
          invoice_number: invoice.invoice_number,
          invoice_type: invoice.invoice_type,
          buyer_company: invoice.buyer_company,
          seller_company: invoice.seller_company,
          date: invoice.date,
          amount: invoice.amount,
          tax_amount: invoice.tax_amount,
          total_amount: invoice.total_amount,
          check_code: invoice.check_code,
          tax_rate: invoice.tax_rate,
          targetMonth: invoice.targetMonth,
          created_at: invoice.created_at,
          import_batch_id: invoice.import_batch_id,
          source_page: invoice.source_page,
          is_duplicate: invoice.is_duplicate,
          image_base64: null,
          primary_file_id: null,
          original_file_path: savedFile.absolutePath,
          preview_file_path: null,
          thumbnail_file_path: null,
          storage_status: 'ready',
          storage_version: 1,
        },
        file: {
          file_role: 'original',
          file_kind: 'image',
          original_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          ext: savedFile.ext,
          size_bytes: savedFile.sizeBytes,
          relative_path: savedFile.relativePath,
          absolute_path: savedFile.absolutePath,
          sha256: savedFile.sha256,
          source_page: null,
        },
      });

      return {
        ok: true as const,
        savedFile,
        sqliteRecord,
      };
    } catch (err) {
      return {
        ok: false as const,
        stage: 'sqlite' as const,
        message: `SQLite 写入失败：${err instanceof Error ? err.message : '未知错误'}`,
        savedFile,
      };
    }
  };

  const requestLocalOcrText = async (imageBase64: string) => {
    try {
      const response = await fetch('/api/ocr/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      const result = await response.json();
      const paddleText = typeof result?.text === 'string' ? result.text.trim() : '';
      if (response.ok && result?.ok === true && paddleText.replace(/\s+/g, '').length >= 20) {
        console.log('[OCR source]', 'paddle');
        console.log('[OCR raw preview]', paddleText.slice(0, 80));
        return paddleText;
      }
    } catch (err) {
    }

    return '';
  };

  const extractImageOcrText = async (file: File, imageBase64: string) => {
    const paddleText = await requestLocalOcrText(imageBase64);
    if (paddleText) {
      return paddleText;
    }

    const result = await Tesseract.recognize(file, 'chi_sim+eng', {
      logger: m => console.log(m)
    });
    const fallbackText = result.data.text || '';
    console.log('[OCR source]', 'tesseract');
    console.log('[OCR raw preview]', fallbackText.slice(0, 80));
    return fallbackText;
  };

  const processImageOcrInvoice = async (file: File, dataUrl: string, extractedText: string) => {
    if (!extractedText) throw new Error("无法从文件中提取文本");

    const noSpaceText = extractedText.replace(/\s+/g, '');

    let invoice_code = null;
    let invoice_number = null;
    let date = null;
    let buyer_company = null;
    let seller_company = null;
    let total_amount = null;
    let amount = null;
    let tax_amount = null;
    let check_code = null;
    let invoice_type = null;
    let tax_rate = null;

    const parsed = parseOcrInvoice(extractedText);
    console.log('[OCR parsed]', { buyer_company: parsed.buyer_company, seller_company: parsed.seller_company });
    invoice_code = parsed.invoice_code;
    invoice_number = parsed.invoice_number;
    date = parsed.date;
    buyer_company = parsed.buyer_company;
    seller_company = parsed.seller_company;
    total_amount = parsed.total_amount;
    amount = parsed.amount;
    tax_amount = parsed.tax_amount;
    check_code = parsed.check_code;
    tax_rate = parsed.tax_rate;

    let matchedKeyword = '';
    if (noSpaceText.includes('退票费')) matchedKeyword = '退票费';
    else if (noSpaceText.includes('火车票') || noSpaceText.includes('铁路客票')) matchedKeyword = '火车票';
    else if (noSpaceText.includes('飞机票') || noSpaceText.includes('航空运输电子客票行程单') || noSpaceText.includes('行程单')) matchedKeyword = '飞机票';
    else if (noSpaceText.includes('客运服务费') || noSpaceText.includes('汽车票') || noSpaceText.includes('客运')) matchedKeyword = '客运服务费';
    else if (noSpaceText.includes('通行费')) matchedKeyword = '通行费';
    else if (noSpaceText.includes('增值税') || noSpaceText.includes('电子发票') || noSpaceText.includes('普通发票') || noSpaceText.includes('专用发票') || noSpaceText.includes('数电票') || noSpaceText.includes('发票')) matchedKeyword = '其他及普票';

    const normalizedInvoiceNumber = (invoice_number || '').trim();
    const finalInvoiceNumber = normalizedInvoiceNumber || null;
    const finalAmount = amount ?? null;
    const finalTaxAmount = tax_amount ?? null;
    const finalTotalAmount = total_amount ?? null;

    if (!finalInvoiceNumber && finalTotalAmount == null) {
      throw new Error("未能识别到发票关键信息，请确保图片清晰或PDF格式正确。");
    }

    if (matchedKeyword) {
      const preset = invoiceTypes.find(t => t.value.includes(matchedKeyword) || t.label.includes(matchedKeyword));
      if (preset) {
        invoice_type = preset.value;
      }
    }

    const createdAt = new Date().toISOString();
    const targetMonth = activeFolderMonth === 'ALL' ? format(new Date(), 'yyyy年MM月') : activeFolderMonth;

    let isDuplicate = false;
    if (finalInvoiceNumber) {
      const existing = await db.invoices.where('invoice_number').equals(finalInvoiceNumber).first();
      isDuplicate = !!existing;
    }

    const primaryStorageResult = await persistImageInvoiceToPrimaryStorage({
      file,
      rawData: extractedText,
      invoice: {
        invoice_code,
        invoice_number: finalInvoiceNumber,
        invoice_type,
        buyer_company,
        seller_company,
        date,
        amount: finalAmount,
        tax_amount: finalTaxAmount,
        total_amount: finalTotalAmount,
        check_code,
        tax_rate,
        targetMonth,
        created_at: createdAt,
        import_batch_id: null,
        source_page: null,
        is_duplicate: isDuplicate,
      },
    });

    const newInvoice: Invoice = createInvoiceDraft({
      raw_data: extractedText,
      invoice_code,
      invoice_number: finalInvoiceNumber,
      invoice_type,
      buyer_company,
      seller_company,
      date,
      amount: finalAmount,
      tax_amount: finalTaxAmount,
      total_amount: finalTotalAmount,
      check_code,
      tax_rate,
      targetMonth,
      created_at: createdAt,
      import_batch_id: null,
      source_page: null,
      image_base64: dataUrl || null,
    });
    newInvoice.is_duplicate = isDuplicate;

    try {
      await db.invoices.add(newInvoice);
    } catch (err) {
      if (primaryStorageResult.ok) {
        throw new Error(`Dexie 兼容副本写入失败，但 SQLite 试点写入已成功。请勿重复导入。${err instanceof Error ? ` 原因：${err.message}` : ''}`);
      }
      throw new Error(`Dexie 兼容副本写入失败：${err instanceof Error ? err.message : '未知错误'}`);
    }

    if (!primaryStorageResult.ok) {
      console.error('[image-ocr primary storage failed]', primaryStorageResult);
      setError(`图片 OCR 已写入当前界面兼容存储，但新主存试点失败：${primaryStorageResult.message}`);
    }
  };

  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsOcrUploading(true);
    setError(null);

    try {
      let dataUrl = '';

      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pdfImportBatchId = `PDF_IMPORT_${Date.now()}`;

        if (pdf.numPages > 150) {
          throw new Error('PDF 页数超过 150 页，请拆分后导入');
        }

        const failedPages: string[] = [];
        let successCount = 0;
        const DEBUG_PDF_OCR = true;
        const isValidPdfOcrText = (text: string) => {
          const normalized = (text || '').replace(/\s+/g, '');
          if (!normalized || normalized.length < 20) return false;
          return /发票号码[:：]?\d{8,24}|开票日期[:：]?\d{4}[年\-./]\d{1,2}[月\-./]\d{1,2}|购买方|销售方|价税合计|金额|税额/.test(normalized);
        };
        const scorePdfOcrText = (text: string) => {
          const normalized = (text || '').replace(/\s+/g, '');
          let score = normalized.length;
          if (/发票号码[:：]?\d{8,24}/.test(normalized)) score += 120;
          if (/开票日期[:：]?\d{4}[年\-./]\d{1,2}[月\-./]\d{1,2}/.test(normalized)) score += 100;
          if (/购买方|销售方/.test(normalized)) score += 80;
          if (/价税合计|金额|税额/.test(normalized)) score += 60;
          return score;
        };
        const parseAmt = (str: string) => parseFloat(
          str
            .replace(/[，]/g, '.')
            .replace(/[−﹣－]/g, '-')
        );
        const renderPdfPageImage = async (page: any, scale: number) => {
          const viewport = page.getViewport({ scale, rotation: 0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('无法创建 PDF 页面渲染上下文');
          }
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: context, viewport, canvas } as any).promise;
          return canvas.toDataURL('image/jpeg', 0.82);
        };
        const dataUrlToFile = async (dataUrl: string, pageNumber: number) => {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          return new File([blob], `pdf-page-${pageNumber}.jpg`, { type: blob.type || 'image/jpeg' });
        };
        const tryDecodePdfPageQr = async (imageBase64: string, pageNumber: number) => {
          try {
            const qrFile = await dataUrlToFile(imageBase64, pageNumber);
            const html5QrCode = new Html5Qrcode("reader");
            try {
              const decodedText = await html5QrCode.scanFile(qrFile, true);
              const parsedQr = parseQrInvoice(decodedText);
              if (!parsedQr.invoice_number && parsedQr.parsedAmount == null && !parsedQr.date && !parsedQr.check_code) {
                return null;
              }
              return parsedQr;
            } finally {
              try {
                await html5QrCode.clear();
              } catch {
              }
            }
          } catch {
            return null;
          }
        };
        const isAmountTripleConsistent = (amountValue: number | null, taxValue: number | null, totalValue: number | null) => {
          if (amountValue == null || taxValue == null || totalValue == null) return true;
          return Math.abs(Number((amountValue + taxValue).toFixed(2)) - totalValue) <= 0.06;
        };
        const parseTaxRateNumber = (taxRateValue: string | null) => {
          if (!taxRateValue || taxRateValue === '免税' || taxRateValue === '不征税') return 0;
          const match = taxRateValue.match(/(-?\d+(?:\.\d+)?)\s*[%％]/);
          if (!match) return null;
          const parsed = parseFloat(match[1]);
          return Number.isFinite(parsed) ? parsed / 100 : null;
        };
        const isTaxRateConsistent = (amountValue: number | null, taxValue: number | null, taxRateValue: string | null) => {
          if (amountValue == null || taxValue == null || !taxRateValue) return true;
          const parsedRate = parseTaxRateNumber(taxRateValue);
          if (parsedRate == null) return true;
          const expectedTax = Number((amountValue * parsedRate).toFixed(2));
          return Math.abs(expectedTax - taxValue) <= 0.06;
        };
        const inferMissingAmountByTaxRate = (
          amountValue: number | null,
          taxValue: number | null,
          totalValue: number | null,
          taxRateValue: string | null
        ) => {
          if (totalValue == null || !taxRateValue) {
            return { amount: amountValue, tax_amount: taxValue };
          }

          const parsedRate = parseTaxRateNumber(taxRateValue);
          if (parsedRate == null) {
            return { amount: amountValue, tax_amount: taxValue };
          }

          if (parsedRate === 0) {
            if (amountValue == null && taxValue != null) {
              return {
                amount: Number((totalValue - taxValue).toFixed(2)),
                tax_amount: taxValue,
              };
            }
            if (taxValue == null && amountValue != null) {
              return {
                amount: amountValue,
                tax_amount: Number((totalValue - amountValue).toFixed(2)),
              };
            }
            return { amount: amountValue, tax_amount: taxValue };
          }

          if (amountValue == null && taxValue == null) {
            const inferredAmount = Number((totalValue / (1 + parsedRate)).toFixed(2));
            const inferredTax = Number((totalValue - inferredAmount).toFixed(2));
            if (isAmountTripleConsistent(inferredAmount, inferredTax, totalValue) && isTaxRateConsistent(inferredAmount, inferredTax, taxRateValue)) {
              return {
                amount: inferredAmount,
                tax_amount: inferredTax,
              };
            }
          }

          if (amountValue == null && taxValue != null) {
            const inferredAmount = Number((taxValue / parsedRate).toFixed(2));
            if (isAmountTripleConsistent(inferredAmount, taxValue, totalValue) && isTaxRateConsistent(inferredAmount, taxValue, taxRateValue)) {
              return {
                amount: inferredAmount,
                tax_amount: taxValue,
              };
            }
          }

          if (taxValue == null && amountValue != null) {
            const inferredTax = Number((amountValue * parsedRate).toFixed(2));
            if (isAmountTripleConsistent(amountValue, inferredTax, totalValue) && isTaxRateConsistent(amountValue, inferredTax, taxRateValue)) {
              return {
                amount: amountValue,
                tax_amount: inferredTax,
              };
            }
          }

          return { amount: amountValue, tax_amount: taxValue };
        };
        const normalizeAmountTriple = (
          amountValue: number | null,
          taxValue: number | null,
          totalValue: number | null,
          taxRateValue: string | null = null
        ) => {
          let nextAmount = amountValue;
          let nextTax = taxValue;
          const nextTotal = totalValue;

          if (nextTax != null && nextTotal != null && Math.abs(nextTax - nextTotal) <= 0.01) {
            if (nextAmount == null || !isAmountTripleConsistent(nextAmount, nextTax, nextTotal)) {
              nextTax = null;
            }
          }

          if (nextTax == null && nextTotal != null && nextAmount != null) {
            nextTax = Number((nextTotal - nextAmount).toFixed(2));
          }

          if (nextAmount == null && nextTotal != null && nextTax != null) {
            nextAmount = Number((nextTotal - nextTax).toFixed(2));
          }

          if (nextTotal != null && nextTotal < 0 && (nextAmount == null || nextTax == null)) {
            const inferredNegativeTriple = inferMissingAmountByTaxRate(nextAmount, nextTax, nextTotal, taxRateValue);
            nextAmount = inferredNegativeTriple.amount;
            nextTax = inferredNegativeTriple.tax_amount;
          }

          if (
            nextAmount != null
            && nextTax != null
            && nextTotal != null
            && taxRateValue
            && !isTaxRateConsistent(nextAmount, nextTax, taxRateValue)
          ) {
            const swappedAmount = nextTax;
            const swappedTax = nextAmount;
            if (
              isAmountTripleConsistent(swappedAmount, swappedTax, nextTotal)
              && isTaxRateConsistent(swappedAmount, swappedTax, taxRateValue)
            ) {
              nextAmount = swappedAmount;
              nextTax = swappedTax;
            }
          }

          if (nextTax != null && nextTotal != null && Math.abs(nextTax - nextTotal) <= 0.01) {
            if (nextAmount == null || !isAmountTripleConsistent(nextAmount, nextTax, nextTotal)) {
              nextTax = null;
            }
          }

          if (nextTax != null && nextTotal != null && Math.abs(nextTax - nextTotal) <= 0.01) {
            nextTax = null;
          }

          if (nextTotal != null && (nextAmount == null || nextTax == null)) {
            const inferredTriple = inferMissingAmountByTaxRate(nextAmount, nextTax, nextTotal, taxRateValue);
            nextAmount = inferredTriple.amount;
            nextTax = inferredTriple.tax_amount;
          }

          return {
            amount: nextAmount,
            tax_amount: nextTax,
            total_amount: nextTotal,
          };
        };
        const pickBottomAmountTriplet = (text: string, taxRateValue: string | null = null) => {
          const compact = (text || '').replace(/\s+/g, '');
          if (!compact) return null;

          const anchorCandidates = [
            compact.lastIndexOf('价税合计'),
            compact.lastIndexOf('小写'),
            compact.lastIndexOf('合计'),
          ].filter(pos => pos >= 0);

          if (anchorCandidates.length === 0) return null;

          const anchor = Math.max(...anchorCandidates);
          const regionStart = Math.max(0, Math.max(anchor - 80, compact.length - 360));
          const region = compact.slice(regionStart);
          const totalMatch = region.match(/价税合计(?:\(小写\)|（小写）|小写)?[^\d￥¥\-−﹣－]*[￥¥]?\s*([\-−﹣－]?\d+[.,]\d{2})/);
          const sumMatch = region.match(/合计[^\d￥¥\-−﹣－]*[￥¥]?\s*([\-−﹣－]?\d+[.,]\d{2}|\*\*\*)[\s\S]{0,24}?税额[^\d￥¥\-−﹣－]*[￥¥]?\s*([\-−﹣－]?\d+[.,]\d{2}|\*\*\*|免税|不征税)/)
            || region.match(/金额[^\d￥¥\-−﹣－]*[￥¥]?\s*([\-−﹣－]?\d+[.,]\d{2}|\*\*\*)[\s\S]{0,24}?税额[^\d￥¥\-−﹣－]*[￥¥]?\s*([\-−﹣－]?\d+[.,]\d{2}|\*\*\*|免税|不征税)/);
          const regionCurrencyMatches = [...region.matchAll(/[￥¥]\s*([\-−﹣－]?\d+\.\d{2})/g)].map(m => parseAmt(m[1]));
          const regionPlainAmountMatches = [...region.matchAll(/(?<![\dA-Z])([\-−﹣－]?\d+\.\d{2})(?![\d%])/g)].map(m => parseAmt(m[1]));

          let amountValue = sumMatch && !['***'].includes(sumMatch[1]) ? parseAmt(sumMatch[1]) : null;
          let taxValue = sumMatch && !['***', '免税', '不征税'].includes(sumMatch[2]) ? parseAmt(sumMatch[2]) : null;
          let totalValue = totalMatch ? parseAmt(totalMatch[1]) : null;

          if (amountValue == null && regionCurrencyMatches.length >= 3) amountValue = regionCurrencyMatches[0];
          if (taxValue == null && regionCurrencyMatches.length >= 2) taxValue = regionCurrencyMatches[1];
          if (totalValue == null && regionCurrencyMatches.length >= 1) totalValue = regionCurrencyMatches[regionCurrencyMatches.length - 1];

          if (amountValue == null && regionPlainAmountMatches.length >= 3) amountValue = regionPlainAmountMatches[0];
          if (taxValue == null && regionPlainAmountMatches.length >= 2) taxValue = regionPlainAmountMatches[1];
          if (totalValue == null && regionPlainAmountMatches.length >= 1) totalValue = regionPlainAmountMatches[regionPlainAmountMatches.length - 1];

          const normalizedTriple = normalizeAmountTriple(amountValue, taxValue, totalValue, taxRateValue);
          amountValue = normalizedTriple.amount;
          taxValue = normalizedTriple.tax_amount;
          totalValue = normalizedTriple.total_amount;

          if (!isAmountTripleConsistent(amountValue, taxValue, totalValue)) {
            return null;
          }

          return {
            amount: amountValue,
            tax_amount: taxValue,
            total_amount: totalValue,
          };
        };
        const runPdfFallbackOcr = async (page: any, pageNumber: number) => {
          const runSingleOcrAttempt = async (scale: number) => {
            try {
              const imageBase64 = await renderPdfPageImage(page, scale);
              const response = await fetch('/api/ocr/image', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ image_base64: imageBase64 }),
              });
              const result = await response.json();
              const ocrText = typeof result?.text === 'string' ? result.text.trim() : '';
              return {
                ok: response.ok && result?.ok === true,
                text: ocrText,
                score: scorePdfOcrText(ocrText),
                scale,
              };
            } catch (ocrErr) {
              return {
                ok: false,
                text: '',
                score: -1,
                scale,
              };
            }
          };

          const fastAttempt = await runSingleOcrAttempt(2);
          let bestAttempt = fastAttempt;

          if (!isValidPdfOcrText(fastAttempt.text)) {
            const slowAttempt = await runSingleOcrAttempt(3);
            if (isValidPdfOcrText(slowAttempt.text)) {
              bestAttempt = slowAttempt;
            } else if (slowAttempt.score > bestAttempt.score) {
              bestAttempt = slowAttempt;
            }
          }

          if (DEBUG_PDF_OCR) {
            console.log('[PDF OCR chosen] page=' + pageNumber + ' chosenScale=' + bestAttempt.scale + ' textLength=' + bestAttempt.text.length);
            console.log('[PDF OCR valid] page=' + pageNumber + ' valid=' + isValidPdfOcrText(bestAttempt.text));
          }

          return bestAttempt.ok && isValidPdfOcrText(bestAttempt.text) ? bestAttempt.text : '';
        };

        for (let i = 1; i <= pdf.numPages; i++) {
          try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join('\n');

            let pageTextToParse = pageText;
            let qrParsed: ReturnType<typeof parseQrInvoice> | null = null;
            if (pageText.replace(/\s+/g, '').length < 20) {
              const qrImageBase64 = await renderPdfPageImage(page, 2);
              qrParsed = await tryDecodePdfPageQr(qrImageBase64, i);

              const fallbackText = await runPdfFallbackOcr(page, i);
              if (fallbackText) {
                pageTextToParse = fallbackText;
              }
            }

            const hasTrustedQrFields = Boolean(
              qrParsed?.invoice_number
              || qrParsed?.parsedAmount != null
              || qrParsed?.date
              || qrParsed?.check_code
            );

            if (!hasTrustedQrFields && (!pageTextToParse.trim() || !isValidPdfOcrText(pageTextToParse))) {
              failedPages.push(`${i}(空白页)`);
              continue;
            }

            const noSpaceText = pageTextToParse.replace(/\s+/g, '');
            const parsedPdf = parsePdfInvoice(pageTextToParse);
            let invoice_code = parsedPdf.invoice_code;
            let invoice_number = parsedPdf.invoice_number;
            let date = parsedPdf.date;
            let buyer_company = parsedPdf.buyer_company;
            let seller_company = parsedPdf.seller_company;
            let total_amount = parsedPdf.total_amount;
            let amount = parsedPdf.amount;
            let tax_amount = parsedPdf.tax_amount;
            let check_code = parsedPdf.check_code;
            let invoice_type = parsedPdf.invoice_type;
            let tax_rate = parsedPdf.tax_rate;
            const qrInvoiceNumber = qrParsed?.invoice_number && /^\d{20}$/.test(qrParsed.invoice_number)
              ? qrParsed.invoice_number
              : null;
            const qrDate = qrParsed?.date && /^\d{8}$/.test(qrParsed.date)
              ? qrParsed.date
              : null;
            const qrTotalAmount = typeof qrParsed?.parsedAmount === 'number'
              ? Number(qrParsed.parsedAmount.toFixed(2))
              : null;
            const qrCheckCode = qrParsed?.check_code || null;

            if (qrInvoiceNumber) invoice_number = qrInvoiceNumber;
            if (qrDate) date = qrDate;
            if (qrTotalAmount != null) total_amount = qrTotalAmount;
            if (qrCheckCode) check_code = qrCheckCode;

            if (!invoice_number) {
              const layoutInvoiceMatch = noSpaceText.match(/(?<!\d)(\d{20})(?!\d)/);
              if (layoutInvoiceMatch) invoice_number = layoutInvoiceMatch[1];
            }

            if (!date) {
              const layoutDateMatch = noSpaceText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
              if (layoutDateMatch) {
                date = `${layoutDateMatch[1]}${layoutDateMatch[2].padStart(2, '0')}${layoutDateMatch[3].padStart(2, '0')}`;
              }
            }

            const taxIdCandidates = [...new Set((noSpaceText.match(/[A-Z0-9]{15,25}/g) || []).filter(v => /[A-Z]/.test(v) && /\d/.test(v)))];
            const firstTaxId = taxIdCandidates[0] || '';
            const secondTaxId = taxIdCandidates[1] || '';
            const firstTaxIdPos = firstTaxId ? noSpaceText.indexOf(firstTaxId) : -1;
            const secondTaxIdPos = secondTaxId ? noSpaceText.indexOf(secondTaxId, firstTaxIdPos + firstTaxId.length) : -1;

            const datePos = noSpaceText.search(/\d{4}年\d{1,2}月\d{1,2}日/);
            const companyNamePattern = /(?:[\u4e00-\u9fa5()（）a-zA-Z0-9]{2,80})(?:有限责任公司|股份有限公司|分公司|事务所|工作室|中心|公司|店|厂)/g;
            const cleanCompanyName = (value: string) => value
              .replace(/\d{4}年\d{1,2}月\d{1,2}日/g, '')
              .replace(/[A-Z0-9]{15,25}/g, '')
              .replace(/开票日期/g, '')
              .replace(/纳税人识别号|统一社会信用代码/g, '')
              .trim();

            if (!buyer_company && datePos >= 0 && firstTaxIdPos > datePos) {
              const buyerSection = noSpaceText.slice(datePos, firstTaxIdPos).replace(/^\d{4}年\d{1,2}月\d{1,2}日/, '');
              const buyerCompanyMatches = [...buyerSection.matchAll(companyNamePattern)].map(m => cleanCompanyName(m[0])).filter(Boolean);
              if (buyerCompanyMatches.length > 0) {
                buyer_company = buyerCompanyMatches[buyerCompanyMatches.length - 1];
              }
            }

            if (!seller_company && firstTaxIdPos >= 0 && secondTaxIdPos > firstTaxIdPos) {
              const sellerSection = noSpaceText.slice(firstTaxIdPos, secondTaxIdPos).replace(/^[A-Z0-9]{15,25}/, '');
              const sellerCompanyMatches = [...sellerSection.matchAll(companyNamePattern)].map(m => cleanCompanyName(m[0])).filter(Boolean);
              if (sellerCompanyMatches.length > 0) {
                seller_company = sellerCompanyMatches[sellerCompanyMatches.length - 1];
              }
            }

            const allYenAmounts = noSpaceText.match(/[￥¥]\d+\.\d{2}/g) || [];
            if ((amount === null || tax_amount === null || total_amount === null) && allYenAmounts.length >= 3) {
              const firstAmount = allYenAmounts[0];
              const secondAmount = allYenAmounts[1];
              const lastAmount = allYenAmounts[allYenAmounts.length - 1];
              if (amount === null && firstAmount) amount = parseAmt(firstAmount.slice(1));
              if (tax_amount === null && secondAmount) tax_amount = parseAmt(secondAmount.slice(1));
              if (total_amount === null && lastAmount) total_amount = parseAmt(lastAmount.slice(1));
            }

            if (!tax_rate) {
              const layoutTaxRateMatch = noSpaceText.match(/(13|9|6|3|1|0)%/);
              if (layoutTaxRateMatch) tax_rate = `${layoutTaxRateMatch[1]}%`;
            }

            let matchedKeyword = '';
            if (noSpaceText.includes('退票费')) matchedKeyword = '退票费';
            else if (noSpaceText.includes('火车票') || noSpaceText.includes('铁路客票')) matchedKeyword = '火车票';
            else if (noSpaceText.includes('飞机票') || noSpaceText.includes('航空运输电子客票行程单') || noSpaceText.includes('行程单')) matchedKeyword = '飞机票';
            else if (noSpaceText.includes('客运服务费') || noSpaceText.includes('汽车票') || noSpaceText.includes('客运')) matchedKeyword = '客运服务费';
            else if (noSpaceText.includes('通行费')) matchedKeyword = '通行费';
            else if (noSpaceText.includes('增值税') || noSpaceText.includes('电子发票') || noSpaceText.includes('普通发票') || noSpaceText.includes('专用发票') || noSpaceText.includes('数电票') || noSpaceText.includes('发票')) matchedKeyword = '其他及普票';

            const normalizedInvoiceNumber = (invoice_number || '').trim();
            const labelInvoiceNumber = noSpaceText.match(/(?:发票号码|票号|号码)[:：]?(\d{20})(?!\d)/)?.[1] || null;
            const first20DigitMatch = noSpaceText.match(/\d{20}/);
            const first20Digit = first20DigitMatch ? first20DigitMatch[0] : null;
            const fallbackInvoiceNumber = labelInvoiceNumber || first20Digit;
            const finalInvoiceNumber = normalizedInvoiceNumber ? normalizedInvoiceNumber : fallbackInvoiceNumber;
            const finalYenAmounts = noSpaceText.match(/[￥¥]\d+\.\d{2}/g) || [];
            const finalYenFirst = finalYenAmounts[0] || null;
            const finalYenSecond = finalYenAmounts[1] || null;
            const finalYenLast = finalYenAmounts.length > 0 ? finalYenAmounts[finalYenAmounts.length - 1] : null;
            const yenFallbackAmount = finalYenFirst ? parseAmt(finalYenFirst.slice(1)) : null;
            const yenFallbackTaxAmount = finalYenSecond ? parseAmt(finalYenSecond.slice(1)) : null;
            const yenFallbackTotalAmount = finalYenLast ? parseAmt(finalYenLast.slice(1)) : null;
            let finalAmount = amount ?? yenFallbackAmount ?? null;
            let finalTaxAmount = tax_amount ?? yenFallbackTaxAmount ?? null;
            let finalTotalAmount = qrTotalAmount ?? total_amount ?? yenFallbackTotalAmount ?? null;
            const normalizedInitialTriple = normalizeAmountTriple(finalAmount, finalTaxAmount, finalTotalAmount, tax_rate);
            finalAmount = normalizedInitialTriple.amount;
            finalTaxAmount = normalizedInitialTriple.tax_amount;
            finalTotalAmount = normalizedInitialTriple.total_amount;

            if (
              finalTotalAmount != null
              && finalTotalAmount < 0
              && (finalAmount == null || finalTaxAmount == null)
            ) {
              const bottomTriplet = pickBottomAmountTriplet(pageTextToParse, tax_rate);
              if (bottomTriplet && bottomTriplet.total_amount != null && bottomTriplet.total_amount < 0) {
                finalAmount = bottomTriplet.amount ?? finalAmount;
                finalTaxAmount = bottomTriplet.tax_amount ?? finalTaxAmount;
                finalTotalAmount = qrTotalAmount ?? bottomTriplet.total_amount;
              }
            }

            if (!isAmountTripleConsistent(finalAmount, finalTaxAmount, finalTotalAmount)) {
              const bottomTriplet = pickBottomAmountTriplet(pageTextToParse, tax_rate);
              if (bottomTriplet) {
                finalAmount = bottomTriplet.amount;
                finalTaxAmount = bottomTriplet.tax_amount;
                finalTotalAmount = qrTotalAmount ?? bottomTriplet.total_amount;
              }
            }
            const normalizedFinalTriple = normalizeAmountTriple(finalAmount, finalTaxAmount, finalTotalAmount, tax_rate);
            finalAmount = normalizedFinalTriple.amount;
            finalTaxAmount = normalizedFinalTriple.tax_amount;
            finalTotalAmount = normalizedFinalTriple.total_amount;

            if (!isAmountTripleConsistent(finalAmount, finalTaxAmount, finalTotalAmount)) {
              finalAmount = null;
              finalTaxAmount = null;
            }

            if (!finalInvoiceNumber && finalTotalAmount == null) {
              const reasons: string[] = [];
              if (!finalInvoiceNumber) reasons.push('未识别到发票号码');
              if (finalTotalAmount == null) reasons.push('未识别到价税合计');
              failedPages.push(`${i}(${reasons.join('、')})`);
              continue;
            }

            if (matchedKeyword) {
              const preset = invoiceTypes.find(t => t.value.includes(matchedKeyword) || t.label.includes(matchedKeyword));
              if (preset) {
                invoice_type = preset.value;
              }
            }

            const newInvoice: Invoice = createInvoiceDraft({
              raw_data: `OCR_PARSED_${Date.now()}_${i}`,
              invoice_code,
              invoice_number: finalInvoiceNumber ?? null,
              invoice_type,
              buyer_company,
              seller_company,
              date,
              amount: finalAmount,
              tax_amount: finalTaxAmount,
              total_amount: finalTotalAmount,
              check_code,
              tax_rate,
              targetMonth: activeFolderMonth === 'ALL' ? format(new Date(), 'yyyy年MM月') : activeFolderMonth,
              created_at: new Date().toISOString(),
              import_batch_id: pdfImportBatchId,
              source_page: i,
              image_base64: null,
            });

            if (newInvoice.invoice_number) {
              const existing = await db.invoices.where('invoice_number').equals(newInvoice.invoice_number).first();
              if (existing) {
                newInvoice.is_duplicate = true;
              }
            }

            await db.invoices.add(newInvoice);
            successCount += 1;
          } catch (pageErr) {
            const reason = pageErr instanceof Error ? pageErr.message : '解析失败';
            failedPages.push(`${i}(${reason})`);
          }
        }

        if (ocrFileInputRef.current) {
          ocrFileInputRef.current.value = '';
        }

        setError(`共 ${pdf.numPages} 页，成功 ${successCount} 页，失败 ${failedPages.length} 页${failedPages.length ? `，失败页：${failedPages.join(', ')}` : ''}`);
        return;
      }

      dataUrl = await readFileAsDataUrl(file);
      const extractedText = await extractImageOcrText(file, dataUrl);
      await processImageOcrInvoice(file, dataUrl, extractedText);

      if (ocrFileInputRef.current) {
        ocrFileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('OCR Error:', err);
      setError(err instanceof Error ? err.message : 'OCR 识别失败');
    } finally {
      setIsOcrUploading(false);
    }
  };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const imageBase64 = await readFileAsDataUrl(file);

      try {
        const html5QrCode = new Html5Qrcode("reader");
        const decodedText = await html5QrCode.scanFile(file, true);
        await handleScanSubmit(decodedText, imageBase64);
      } catch (qrErr) {
        const extractedText = await extractImageOcrText(file, imageBase64);
        await processImageOcrInvoice(file, imageBase64, extractedText);
      }
      // Clear the input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError('无法在上传的图片中找到或读取二维码，且文字识别失败。');
      console.error('Error scanning file:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdate = async (id: number, field: keyof Invoice, value: any) => {
    try {
      const invoice = await db.invoices.get(id);
      if (!invoice) return;

      let finalValue = value;
      if ((field === 'amount' || field === 'tax_amount' || field === 'total_amount') && typeof value === 'number') {
        finalValue = Number(value.toFixed(2));
      }

      const updates: any = { [field]: finalValue };

      const calculateTaxes = (totalAmount: number | null | undefined, taxRateStr: string | null | undefined) => {
        if (totalAmount == null || taxRateStr == null) return {};
        const rate = parseFloat(taxRateStr) / 100;
        if (isNaN(rate)) return {};
        const amount = Number((totalAmount / (1 + rate)).toFixed(2));
        const tax_amount = Number((totalAmount - amount).toFixed(2));
        return { amount, tax_amount };
      };

      if (field === 'invoice_type') {
        const preset = invoiceTypes.find(t => t.value === value);
        if (preset) {
          updates.tax_rate = preset.taxRate;
          Object.assign(updates, calculateTaxes(invoice.total_amount, preset.taxRate));
        }
      } else if (field === 'reimburser' && typeof finalValue === 'string' && finalValue.trim() !== '') {
        const trimmed = finalValue.trim();
        if (!reimbursers.some(r => r.value === trimmed)) {
          const py = pinyin(trimmed, { toneType: 'none', type: 'array' }).join('');
          const pyFirst = pinyin(trimmed, { pattern: 'first', toneType: 'none', type: 'array' }).join('');
          setReimbursers(prev => [...prev, { label: trimmed, value: trimmed, search: `${py} ${pyFirst}` }]);
        }
      } else if (field === 'seller_company' && typeof finalValue === 'string' && finalValue.trim() !== '') {
        const trimmed = finalValue.trim();
        if (!sellerCompanies.some(c => c.value === trimmed)) {
          const py = pinyin(trimmed, { toneType: 'none', type: 'array' }).join('');
          const pyFirst = pinyin(trimmed, { pattern: 'first', toneType: 'none', type: 'array' }).join('');
          setSellerCompanies(prev => [...prev, { label: trimmed, value: trimmed, search: `${py} ${pyFirst}` }]);
        }
      } else if (field === 'tax_rate') {
        Object.assign(updates, calculateTaxes(invoice.total_amount, finalValue));
      } else if (field === 'total_amount') {
        if (typeof finalValue === 'number') {
          Object.assign(updates, calculateTaxes(finalValue, invoice.tax_rate));
        }
      } else if (field === 'amount' && typeof finalValue === 'number') {
        if (invoice.total_amount != null) {
          updates.tax_amount = Number((invoice.total_amount - finalValue).toFixed(2));
        } else if (invoice.tax_amount != null) {
          updates.total_amount = Number((finalValue + invoice.tax_amount).toFixed(2));
        }
      } else if (field === 'tax_amount' && typeof finalValue === 'number') {
        if (invoice.total_amount != null) {
          updates.amount = Number((invoice.total_amount - finalValue).toFixed(2));
        } else if (invoice.amount != null) {
          updates.total_amount = Number((invoice.amount + finalValue).toFixed(2));
        }
      }

      await db.invoices.update(id, updates);
    } catch (err) {
      console.error('Failed to update', err);
    }
  };

  const handleDelete = async (id: number) => {
    setConfirmModal({
      isOpen: true,
      title: '确认删除',
      message: '确定要删除这张发票吗？此操作无法恢复。',
      onConfirm: async () => {
        try {
          await db.invoices.delete(id);
          setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          setError(err instanceof Error ? err.message : '删除发票失败');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setConfirmModal({
      isOpen: true,
      title: '确认批量删除',
      message: `确定要删除选中的 ${selectedIds.size} 张发票吗？此操作无法恢复。`,
      onConfirm: async () => {
        try {
          const ids = Array.from(selectedIds);
          await db.invoices.bulkDelete(ids);
          setSelectedIds(new Set());
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          setError(err instanceof Error ? err.message : '批量删除发票失败');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === invoicesToDisplay.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoicesToDisplay.map(inv => inv.id!)));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /**
   * 批量移动选中的发票到目标月份（使用 Dexie 事务）
   */
  const handleMoveInvoices = async (targetMonth: string) => {
    if (!targetMonth || selectedIds.size === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: '确认移动',
      message: `确定将选中的 ${selectedIds.size} 张发票移动到 ${targetMonth} 吗？`,
      onConfirm: async () => {
        try {
          // 使用 Dexie 事务批量更新
          await db.transaction('rw', db.invoices, async () => {
            const ids = Array.from(selectedIds);
            await Promise.all(ids.map(id => db.invoices.update(id, { targetMonth })));
          });
          
          // 状态更新后，清空当前的勾选状态
          setSelectedIds(new Set());
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error('Failed to move invoices', err);
          setError('批量移动失败');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const exportToExcel = () => {
    const selectedInvoices = invoicesToDisplay.filter(inv => inv.id && selectedIds.has(inv.id));
    if (selectedInvoices.length === 0) {
      setError('请至少选择一张发票进行导出。');
      return;
    }

    const dataToExport = selectedInvoices.map(inv => ({
      '导入批次': inv.import_batch_id ?? '',
      'PDF页码': inv.source_page ?? '',
      '受方公司': inv.buyer_company || '',
      '发票类型': inv.invoice_type || '',
      '发票号码': inv.invoice_number || '',
      '开票时间': inv.date || '',
      '开票公司': inv.seller_company || '',
      '开票金额': inv.amount !== null ? Number(Number(inv.amount).toFixed(2)) : '',
      '税率': inv.tax_rate || '',
      '税额': inv.tax_amount !== null ? Number(Number(inv.tax_amount).toFixed(2)) : '',
      '价税合计': inv.total_amount !== null ? Number(Number(inv.total_amount).toFixed(2)) : '',
      '报销人': inv.reimburser || '',
      '扫描时间': format(new Date(inv.created_at), 'yyyy-MM-dd HH:mm:ss')
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    
    // Format amount columns to 2 decimal places in Excel
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = { c: C, r: R };
        const cellRef = XLSX.utils.encode_cell(cellAddress);
        const cell = worksheet[cellRef];
        if (!cell) continue;
        
        // G = 6 (开票金额), I = 8 (税额), J = 9 (价税合计)
        if (C === 6 || C === 8 || C === 9) {
          if (cell.t === 'n') {
            cell.z = '0.00';
          }
        }
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "发票数据");
    
    XLSX.writeFile(workbook, `发票导出_${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`);
  };

  const exportBackup = async () => {
    try {
      const allData = await db.invoices.toArray();
      const backup = {
        version: 1,
        timestamp: new Date().toISOString(),
        data: allData,
        settings: { companies, sellerCompanies, invoiceTypes, monthList, reimbursers }
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `发票系统备份_${format(new Date(), 'yyyyMMdd_HHmmss')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('导出备份失败');
    }
  };

  const importBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const backup = JSON.parse(content);
        if (backup.data && Array.isArray(backup.data)) {
          await db.transaction('rw', db.invoices, async () => {
            await db.invoices.clear();
            await db.invoices.bulkAdd(backup.data);
          });
          if (backup.settings) {
            if (backup.settings.companies) setCompanies(backup.settings.companies);
            if (backup.settings.sellerCompanies) setSellerCompanies(backup.settings.sellerCompanies);
            if (backup.settings.invoiceTypes) setInvoiceTypes(backup.settings.invoiceTypes);
            if (backup.settings.monthList) setMonthList(backup.settings.monthList);
            if (backup.settings.reimbursers) setReimbursers(backup.settings.reimbursers);
          }
          setConfirmModal({
            isOpen: true,
            title: '导入成功',
            message: `成功恢复了 ${backup.data.length} 条发票数据及相关设置。`,
            onConfirm: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
          });
        }
      } catch (err) {
        setError('导入失败，文件格式不正确');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="w-full mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">发票扫描助手 Pro</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsBackendOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
              title="全局后台"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">全局后台</span>
            </button>
            <div className="relative inline-block">
              <select
                className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
              >
                <option value="全部受方">全部受方</option>
                {companies.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <div className="relative inline-block">
              <select
                className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                disabled={selectedIds.size === 0}
                value=""
                onChange={(e) => handleMoveInvoices(e.target.value)}
              >
                <option value="" disabled>移动选中至...</option>
                {monthList.map(m => (
                  <option key={m} value={m} disabled={m === activeFolderMonth}>{m}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <button
              onClick={exportToExcel}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="w-4 h-4" />
              导出选中 ({selectedIds.size})
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              删除选中 ({selectedIds.size})
            </button>
          </div>
        </div>
      </header>

      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium">错误</h3>
              <p className="text-sm mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              &times;
            </button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Input Section */}
          <div className="w-full lg:w-80 shrink-0 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Keyboard className="w-5 h-5 text-indigo-500" />
                  扫码枪输入
                </h2>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-sm font-medium text-slate-600">{isAutoMode ? '自动模式' : '手动模式'}</span>
                  <div className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", isAutoMode ? 'bg-indigo-600' : 'bg-slate-300')}>
                    <input 
                      type="checkbox" 
                      className="sr-only" 
                      checked={isAutoMode}
                      onChange={(e) => setIsAutoMode(e.target.checked)}
                    />
                    <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", isAutoMode ? 'translate-x-6' : 'translate-x-1')} />
                  </div>
                </label>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                {isAutoMode ? '自动模式：扫描条码后自动提交并保存，支持快速连续扫描。' : '手动模式：扫描条码后需点击提交按钮才保存。'}
              </p>
              <form onSubmit={handleFormSubmit} className="flex items-center gap-2 w-full overflow-hidden">
                <input
                  ref={scannerInputRef}
                  type="text"
                  defaultValue=""
                  onChange={(e) => {
                    if (isAutoMode) {
                      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                      scanTimeoutRef.current = setTimeout(() => {
                        if (scannerInputRef.current && scannerInputRef.current.value.trim()) {
                          let rawValue = scannerInputRef.current.value;
                          rawValue = rawValue.replace(/，/g, ',');
                          handleScanSubmit(rawValue);
                        }
                      }, 300); // 300ms 延迟，兼容部分输入较慢的扫码枪或不发送回车的扫码枪
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault(); // 阻止默认回车或Tab行为
                      if (isAutoMode) {
                        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                        let rawValue = e.currentTarget.value;
                        rawValue = rawValue.replace(/，/g, ',');
                        handleScanSubmit(rawValue);
                      }
                    }
                  }}
                  placeholder="在此扫描或输入条码..."
                  className="flex-1 min-w-0 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
                <button
                  type="submit"
                  className="flex-shrink-0 whitespace-nowrap px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  提交
                </button>
              </form>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Camera className="w-5 h-5 text-indigo-500" />
                摄像头 & 图片识别
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                使用设备摄像头直接扫描发票二维码，或上传包含二维码的图片。
              </p>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={toggleCamera}
                  className={cn(
                    "w-full py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-2",
                    isScanning 
                      ? "bg-red-100 text-red-700 hover:bg-red-200" 
                      : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  )}
                >
                  <Camera className="w-5 h-5" />
                  {isScanning ? '停止摄像头' : '启动摄像头'}
                </button>

                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    ref={fileInputRef}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={isUploading}
                  />
                  <button
                    disabled={isUploading}
                    className={cn(
                      "w-full py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-2",
                      isUploading
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200"
                    )}
                  >
                    <Upload className="w-5 h-5" />
                    {isUploading ? '正在识别...' : '上传图片 (仅二维码)'}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleOcrUpload}
                    ref={ocrFileInputRef}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={isOcrUploading}
                  />
                  <button
                    disabled={isOcrUploading}
                    className={cn(
                      "w-full py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-2",
                      isOcrUploading
                        ? "bg-indigo-100 text-indigo-400 cursor-not-allowed"
                        : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                    )}
                  >
                    <FileText className="w-5 h-5" />
                    {isOcrUploading ? '正在OCR识别...' : '上传并解析PDF/图片内容'}
                  </button>
                </div>
              </div>
              
              <div id="reader" className={cn("mt-4 overflow-hidden rounded-xl border border-slate-200", !isScanning && "hidden")}></div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-indigo-500" />
                  账期月份选择
                </h2>
                <button
                  onClick={() => setIsEditingMonths(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 transition-colors flex items-center gap-1"
                >
                  <Edit2 className="w-3 h-3" />
                  编辑
                </button>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[300px] pr-2 space-y-1 custom-scrollbar">
                <button
                  onClick={() => {
                    setActiveFolderMonth('ALL');
                    setSelectedIds(new Set());
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all mb-2",
                    activeFolderMonth === 'ALL'
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm"
                      : "text-slate-600 hover:bg-slate-50 border border-transparent"
                  )}
                >
                  全部月份
                </button>
                {monthList.map(month => (
                  <button
                    key={month}
                    onClick={() => {
                      setActiveFolderMonth(month);
                      setSelectedIds(new Set());
                    }}
                    className={cn(
                      "w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all",
                      activeFolderMonth === month
                        ? "bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 border border-transparent"
                    )}
                  >
                    {month}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Data Table Section */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                <h2 className="text-lg font-semibold">已扫描发票</h2>
                <span className="text-sm text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                  总计: {invoicesToDisplay.length}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto overflow-x-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full text-slate-500">
                    加载中...
                  </div>
                ) : invoicesToDisplay.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                    <CheckCircle2 className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-lg font-medium text-slate-600 mb-1">暂无数据</p>
                    <p className="text-sm">请扫描二维码开始记录</p>
                  </div>
                ) : (
                  <table 
                    className="w-full text-left text-xs table-fixed"
                    style={{ minWidth: 600 + columnWidths.buyer_company + columnWidths.invoice_type + columnWidths.invoice_number + columnWidths.seller_company }}
                  >
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="p-2 w-8">
                          <input
                            type="checkbox"
                            checked={invoicesToDisplay.length > 0 && selectedIds.size === invoicesToDisplay.length}
                            onChange={toggleSelectAll}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                          />
                        </th>
                        <th className="p-2 w-10 font-medium text-slate-600 text-center">序号</th>
                        <th className="p-2 w-14 font-medium text-slate-600">状态</th>
                        <th className="p-2 relative font-medium text-slate-600" style={{ width: columnWidths.buyer_company }}>
                          受方公司
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 active:bg-indigo-600 z-10"
                            onMouseDown={(e) => handleMouseDown(e, 'buyer_company')}
                          />
                        </th>
                        <th className="p-2 relative font-medium text-slate-600" style={{ width: columnWidths.invoice_type }}>
                          发票类型
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 active:bg-indigo-600 z-10"
                            onMouseDown={(e) => handleMouseDown(e, 'invoice_type')}
                          />
                        </th>
                        <th className="p-2 relative font-medium text-slate-600" style={{ width: columnWidths.invoice_number }}>
                          发票号码
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 active:bg-indigo-600 z-10"
                            onMouseDown={(e) => handleMouseDown(e, 'invoice_number')}
                          />
                        </th>
                        <th className="p-2 w-20 font-medium text-slate-600">开票时间</th>
                        <th className="p-2 relative font-medium text-slate-600" style={{ width: columnWidths.seller_company }}>
                          开票公司
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 active:bg-indigo-600 z-10"
                            onMouseDown={(e) => handleMouseDown(e, 'seller_company')}
                          />
                        </th>
                        <th className="p-2 w-16 font-medium text-slate-600">开票金额</th>
                        <th className="p-2 w-10 font-medium text-slate-600">税率</th>
                        <th className="p-2 w-14 font-medium text-slate-600">税额</th>
                        <th className="p-2 w-16 font-medium text-slate-600">价税合计</th>
                        <th className="p-2 w-14 font-medium text-slate-600">报销人</th>
                        <th className="p-2 w-16 font-medium text-slate-600">扫描时间</th>
                        <th className="p-2 w-10 font-medium text-slate-600 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoicesToDisplay.map((inv, index) => (
                        <tr 
                          key={inv.id} 
                          className={cn(
                            "hover:bg-slate-50 transition-colors",
                            inv.is_duplicate && "bg-orange-50/50 hover:bg-orange-50"
                          )}
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={inv.id ? selectedIds.has(inv.id) : false}
                              onChange={() => inv.id && toggleSelect(inv.id)}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                            />
                          </td>
                          <td className="p-2 text-slate-500 text-center">{inv.source_page ?? (index + 1)}</td>
                          <td className="p-2">
                            {inv.is_duplicate ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[10px] font-medium truncate" title="重复">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span className="truncate">重复</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-medium truncate" title="正常">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span className="truncate">正常</span>
                              </span>
                            )}
                          </td>
                          <td className="p-1">
                            <EditableCell options={companies} value={inv.buyer_company} onChange={(v) => inv.id && handleUpdate(inv.id, 'buyer_company', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell options={invoiceTypes} value={inv.invoice_type} onChange={(v) => inv.id && handleUpdate(inv.id, 'invoice_type', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell value={inv.invoice_number} onChange={(v) => inv.id && handleUpdate(inv.id, 'invoice_number', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell value={inv.date} onChange={(v) => inv.id && handleUpdate(inv.id, 'date', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell options={sellerCompanies} value={inv.seller_company} onChange={(v) => inv.id && handleUpdate(inv.id, 'seller_company', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell type="number" value={inv.amount} onChange={(v) => inv.id && handleUpdate(inv.id, 'amount', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell value={inv.tax_rate} onChange={(v) => inv.id && handleUpdate(inv.id, 'tax_rate', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell type="number" value={inv.tax_amount} onChange={(v) => inv.id && handleUpdate(inv.id, 'tax_amount', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell type="number" value={inv.total_amount} onChange={(v) => inv.id && handleUpdate(inv.id, 'total_amount', v)} />
                          </td>
                          <td className="p-1">
                            <EditableCell options={reimbursers} value={inv.reimburser} onChange={(v) => inv.id && handleUpdate(inv.id, 'reimburser', v)} />
                          </td>
                          <td className="p-2 text-slate-500 text-[10px] truncate" title={format(new Date(inv.created_at), 'MM-dd HH:mm')}>
                            {format(new Date(inv.created_at), 'MM-dd HH:mm')}
                          </td>
                          <td className="p-2 text-right">
                            <button
                              onClick={() => inv.id && handleDelete(inv.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 确认对话框 Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{confirmModal.title}</h3>
              </div>
              <p className="text-sm text-slate-600 pl-11">{confirmModal.message}</p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-sm"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑账期月份 Modal */}
      {isEditingMonths && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-indigo-500" />
                编辑账期月份
              </h3>
              <button onClick={() => setIsEditingMonths(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <div className="flex gap-2 mb-6">
                <input 
                  type="text" 
                  placeholder="例如: 2026年04月" 
                  value={newMonthInput}
                  onChange={e => setNewMonthInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newMonthInput && !monthList.includes(newMonthInput)) {
                      const newList = [newMonthInput, ...monthList].sort((a, b) => b.localeCompare(a));
                      setMonthList(newList);
                      setNewMonthInput('');
                    }
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
                <button 
                  onClick={() => {
                    if (newMonthInput && !monthList.includes(newMonthInput)) {
                      const newList = [newMonthInput, ...monthList].sort((a, b) => b.localeCompare(a));
                      setMonthList(newList);
                      setNewMonthInput('');
                    }
                  }}
                  disabled={!newMonthInput}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  添加
                </button>
              </div>
              <div className="space-y-2">
                {monthList.map(m => (
                  <div key={m} className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-indigo-300 transition-colors group">
                    <span className="text-sm font-medium text-slate-700">{m}</span>
                    <button 
                      onClick={() => {
                        if (monthList.length > 1) {
                          setMonthList(monthList.filter(x => x !== m));
                          if (activeFolderMonth === m) {
                            setActiveFolderMonth('ALL');
                          }
                        }
                      }}
                      disabled={monthList.length <= 1}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      title={monthList.length <= 1 ? "至少保留一个月份" : "删除"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 全局后台 Modal */}
      {isBackendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col h-[80vh] animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-500" />
                全局后台管理
              </h3>
              <button onClick={() => setIsBackendOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar */}
              <div className="w-48 bg-slate-50 border-r border-slate-200 p-3 flex flex-col gap-1">
                <button 
                  onClick={() => setBackendTab('companies')} 
                  className={cn("px-3 py-2.5 text-sm font-medium rounded-xl text-left transition-colors", backendTab === 'companies' ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-200")}
                >
                  受方公司管理
                </button>
                <button 
                  onClick={() => setBackendTab('sellerCompanies')} 
                  className={cn("px-3 py-2.5 text-sm font-medium rounded-xl text-left transition-colors", backendTab === 'sellerCompanies' ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-200")}
                >
                  开票公司管理
                </button>
                <button 
                  onClick={() => setBackendTab('invoiceTypes')} 
                  className={cn("px-3 py-2.5 text-sm font-medium rounded-xl text-left transition-colors", backendTab === 'invoiceTypes' ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-200")}
                >
                  发票类型与税率
                </button>
                <button 
                  onClick={() => setBackendTab('reimbursers')} 
                  className={cn("px-3 py-2.5 text-sm font-medium rounded-xl text-left transition-colors", backendTab === 'reimbursers' ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-200")}
                >
                  报销人管理
                </button>
                <button 
                  onClick={() => setBackendTab('data')} 
                  className={cn("px-3 py-2.5 text-sm font-medium rounded-xl text-left transition-colors", backendTab === 'data' ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-200")}
                >
                  数据与备份
                </button>
              </div>
              {/* Content */}
              <div className="flex-1 p-6 overflow-y-auto bg-white custom-scrollbar">
                {backendTab === 'companies' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">添加受方公司</h4>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="公司名称 (例如: 某某科技有限公司)" 
                          value={newCompanyLabel}
                          onChange={e => setNewCompanyLabel(e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button 
                          onClick={() => {
                            if (newCompanyLabel && !companies.some(c => c.value === newCompanyLabel)) {
                              setCompanies([...companies, { label: newCompanyLabel, value: newCompanyLabel, search: newCompanyLabel }]);
                              setNewCompanyLabel('');
                            }
                          }}
                          disabled={!newCompanyLabel}
                          className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          添加
                        </button>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">已添加的公司 ({companies.length})</h4>
                      <div className="space-y-2">
                        {companies.map(c => (
                          <div key={c.value} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <span className="text-sm font-medium text-slate-700">{c.label}</span>
                            <button 
                              onClick={() => setCompanies(companies.filter(x => x.value !== c.value))}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {backendTab === 'sellerCompanies' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">添加开票公司</h4>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="公司名称 (例如: 某某科技有限公司)" 
                          value={newSellerCompanyLabel}
                          onChange={e => setNewSellerCompanyLabel(e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button 
                          onClick={() => {
                            if (newSellerCompanyLabel && !sellerCompanies.some(c => c.value === newSellerCompanyLabel)) {
                              const py = pinyin(newSellerCompanyLabel, { toneType: 'none', type: 'array' }).join('');
                              const pyFirst = pinyin(newSellerCompanyLabel, { pattern: 'first', toneType: 'none', type: 'array' }).join('');
                              setSellerCompanies([...sellerCompanies, { label: newSellerCompanyLabel, value: newSellerCompanyLabel, search: `${py} ${pyFirst}` }]);
                              setNewSellerCompanyLabel('');
                            }
                          }}
                          disabled={!newSellerCompanyLabel}
                          className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          添加
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">提示: 在表格中输入新开票公司时也会自动保存。支持拼音首字母搜索。</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">已添加的开票公司 ({sellerCompanies.length})</h4>
                      <div className="space-y-2">
                        {sellerCompanies.map(c => (
                          <div key={c.value} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-slate-700">{c.label}</span>
                              <span className="text-xs text-slate-500">拼音: {c.search}</span>
                            </div>
                            <button 
                              onClick={() => setSellerCompanies(sellerCompanies.filter(x => x.value !== c.value))}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {backendTab === 'invoiceTypes' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">添加发票类型</h4>
                      <div className="flex gap-2 mb-2">
                        <input 
                          type="text" 
                          placeholder="显示名称 (如: 专票 13%)" 
                          value={newTypeLabel}
                          onChange={e => setNewTypeLabel(e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <input 
                          type="text" 
                          placeholder="实际值 (如: 专票)" 
                          value={newTypeValue}
                          onChange={e => setNewTypeValue(e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <input 
                          type="text" 
                          placeholder="税率 (如: 13%)" 
                          value={newTypeTax}
                          onChange={e => setNewTypeTax(e.target.value)}
                          className="w-32 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button 
                          onClick={() => {
                            if (newTypeLabel && newTypeValue) {
                              setInvoiceTypes([...invoiceTypes, { 
                                label: newTypeLabel, 
                                value: newTypeValue, 
                                search: newTypeLabel, 
                                taxRate: newTypeTax || null 
                              }]);
                              setNewTypeLabel('');
                              setNewTypeValue('');
                              setNewTypeTax('');
                            }
                          }}
                          disabled={!newTypeLabel || !newTypeValue}
                          className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          添加
                        </button>
                      </div>
                      <p className="text-xs text-slate-500">提示: 税率留空表示“自行填写”。</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">已添加的类型 ({invoiceTypes.length})</h4>
                      <div className="space-y-2">
                        {invoiceTypes.map(t => (
                          <div key={t.value} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-slate-700">{t.label}</span>
                              <span className="text-xs text-slate-500">值: {t.value} | 税率: {t.taxRate || '自定义'}</span>
                            </div>
                            <button 
                              onClick={() => setInvoiceTypes(invoiceTypes.filter(x => x.value !== t.value))}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {backendTab === 'reimbursers' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">添加报销人</h4>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="姓名 (例如: 张三)" 
                          value={newReimburserLabel}
                          onChange={e => setNewReimburserLabel(e.target.value)}
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button 
                          onClick={() => {
                            if (newReimburserLabel && !reimbursers.some(c => c.value === newReimburserLabel)) {
                              const py = pinyin(newReimburserLabel, { toneType: 'none', type: 'array' }).join('');
                              const pyFirst = pinyin(newReimburserLabel, { pattern: 'first', toneType: 'none', type: 'array' }).join('');
                              setReimbursers([...reimbursers, { label: newReimburserLabel, value: newReimburserLabel, search: `${py} ${pyFirst}` }]);
                              setNewReimburserLabel('');
                            }
                          }}
                          disabled={!newReimburserLabel}
                          className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          添加
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">提示: 在表格中输入新报销人时也会自动保存。支持拼音首字母搜索。</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 mb-3">已添加的报销人 ({reimbursers.length})</h4>
                      <div className="space-y-2">
                        {reimbursers.map(c => (
                          <div key={c.value} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-slate-700">{c.label}</span>
                              <span className="text-xs text-slate-500">拼音: {c.search}</span>
                            </div>
                            <button 
                              onClick={() => setReimbursers(reimbursers.filter(x => x.value !== c.value))}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {backendTab === 'data' && (
                  <div className="space-y-4">
                    <div className="p-5 border border-red-200 bg-red-50 rounded-2xl flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-red-800 mb-1">清空全部数据</h4>
                        <p className="text-sm text-red-600">删除所有扫描的发票记录，此操作不可逆。</p>
                      </div>
                      <button 
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: '清空全部数据',
                            message: '确定要清空所有发票数据吗？此操作不可恢复！建议先导出备份。',
                            onConfirm: async () => {
                              await db.invoices.clear();
                              setConfirmModal(prev => ({ ...prev, isOpen: false }));
                            }
                          });
                        }}
                        className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors shadow-sm"
                      >
                        清空数据
                      </button>
                    </div>
                    
                    <div className="p-5 border border-slate-200 rounded-2xl flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-slate-800 mb-1">导出实时备份</h4>
                        <p className="text-sm text-slate-500">将当前所有数据和设置导出为 JSON 文件。</p>
                      </div>
                      <button 
                        onClick={exportBackup}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2"
                      >
                        <DownloadCloud className="w-4 h-4" />
                        导出备份
                      </button>
                    </div>

                    <div className="p-5 border border-slate-200 rounded-2xl flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-slate-800 mb-1">读取实时备份</h4>
                        <p className="text-sm text-slate-500">从 JSON 文件恢复数据和设置（将覆盖当前数据）。</p>
                      </div>
                      <label className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2 cursor-pointer">
                        <UploadCloud className="w-4 h-4" />
                        导入备份
                        <input type="file" accept=".json" className="hidden" onChange={importBackup} />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




















