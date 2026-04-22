export {};

declare global {
  interface InvoiceStorageSummary {
    database: {
      path: string;
      exists: boolean;
      sizeBytes: number;
      schemaVersion: number;
    };
    counts: {
      invoices: number;
      files: number;
      imageBase64: number;
      missingOriginalFilePath: number;
    };
    directories: {
      root: {
        path: string;
      };
      originals: {
        path: string;
        sizeBytes: number;
        fileCount: number;
      };
      previews: {
        path: string;
        sizeBytes: number;
        fileCount: number;
      };
      cache: {
        path: string;
        sizeBytes: number;
        fileCount: number;
      };
    };
    totals: {
      sizeBytes: number;
    };
    orphaned: {
      fileRecords: number;
      invoicePrimaryFiles: number;
      diskOriginalFiles: number;
      diskPreviewFiles: number;
      hasAny: boolean;
    };
    capabilities: {
      supportsImageBase64Column: boolean;
    };
  }

  interface InvoiceStorageClearCacheResult {
    ok: boolean;
    deletedBytes: number;
    deletedFiles: number;
    deletedDirectories: number;
    targetPaths: string[];
    error: string | null;
  }

  interface Window {
    invoiceOcr?: {
      health: () => Promise<{
        ok: boolean;
        url?: string;
      }>;
      recognizeImage: (payload: {
        imageBase64: string;
      }) => Promise<{
        ok: boolean;
        text?: string;
        angle?: number;
        avg_score?: number;
        lines?: Array<{
          text: string;
          score: number;
        }>;
        error?: string;
      }>;
    };
    invoiceStorage?: {
      getPaths: () => Promise<{
        storageRoot: string;
        databaseFile: string;
        originalsRoot: string;
        previewsRoot: string;
        thumbnailsRoot: string;
        ocrTempRoot: string;
        exportTempRoot: string;
        logsRoot: string;
      }>;
      getSummary: () => Promise<InvoiceStorageSummary>;
      openRoot: () => Promise<{
        ok: boolean;
        target: string;
        error: string | null;
      }>;
      clearCache: () => Promise<InvoiceStorageClearCacheResult>;
      saveOriginalFile: (payload: {
        content: Uint8Array;
        originalName: string;
        mimeType: string;
        createdAt: Date;
      }) => Promise<{
        fileName: string;
        absolutePath: string;
        relativePath: string;
        sizeBytes: number;
        ext: string | null;
        sha256: string;
      }>;
      createInvoiceRecord: (payload: {
        invoice: {
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
          reimburser?: string | null;
          targetMonth: string | null;
          created_at: string;
          import_batch_id: string | null;
          source_page: number | null;
          image_base64?: string | null;
          primary_file_id: number | null;
          original_file_path: string | null;
          preview_file_path: string | null;
          thumbnail_file_path: string | null;
          storage_status?: string;
          storage_version?: number;
        };
        file?: {
          file_role: string;
          file_kind: string;
          original_name: string;
          mime_type: string;
          ext: string | null;
          size_bytes: number;
          relative_path: string;
          absolute_path: string;
          sha256: string;
          source_page: number | null;
        };
      }) => Promise<unknown>;
    };
  }
}
