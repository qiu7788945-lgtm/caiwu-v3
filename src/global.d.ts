export {};

declare global {
  interface Window {
    invoiceStorage?: {
      getPaths: () => Promise<{
        databaseFile: string;
        originalsRoot: string;
        previewsRoot: string;
        thumbnailsRoot: string;
        ocrTempRoot: string;
        exportTempRoot: string;
        logsRoot: string;
      }>;
      getSummary: () => Promise<unknown>;
      openRoot: () => Promise<{
        ok: boolean;
        target: string;
        error: string | null;
      }>;
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
          image_base64: string | null;
          primary_file_id: number | null;
          original_file_path: string | null;
          preview_file_path: string | null;
          thumbnail_file_path: string | null;
          storage_status: string;
          storage_version: number;
        };
        file: {
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
