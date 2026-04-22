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
      getSummary: () => Promise<{
        paths: {
          userDataRoot: string;
          storageRoot: string;
          dataRoot: string;
          databaseFile: string;
          filesRoot: string;
          originalsRoot: string;
          previewsRoot: string;
          cacheRoot: string;
          thumbnailsRoot: string;
          ocrTempRoot: string;
          exportTempRoot: string;
          logsRoot: string;
        };
        sizes: {
          database: number;
          originals: number;
          previews: number;
          thumbnails: number;
          ocrTemp: number;
          exportTemp: number;
          logs: number;
          total: number;
        };
        counts: {
          originals: number;
          previews: number;
          thumbnails: number;
          ocrTemp: number;
          exportTemp: number;
          logs: number;
          cacheFiles: number;
          totalFiles: number;
          dbInvoiceCount: number;
          dbFileCount: number;
        };
        database: {
          path: string;
          schemaVersion: number;
          invoiceCount: number;
          fileCount: number;
        };
      }>;
      openRoot: () => Promise<{
        ok: boolean;
        target: string;
        absolutePath: string;
        error: string | null;
      }>;
      openPath: (target: 'root' | 'data' | 'originals' | 'previews' | 'cache' | 'logs') => Promise<{
        ok: boolean;
        target: 'root' | 'data' | 'originals' | 'previews' | 'cache' | 'logs';
        absolutePath: string;
        error: string | null;
      }>;
      clearCache: (action: 'clearThumbnails' | 'clearOcrTemp' | 'clearExportTemp' | 'clearLogs' | 'clearAllCache' | 'clearOrphanCache') => Promise<{
        ok: boolean;
        action: string;
        deletedFiles: number;
        deletedBytes: number;
        errors: string[];
        note?: string;
      }>;
      optimizeDatabase: (options?: { analyze?: boolean }) => Promise<{
        ok: boolean;
        operation: 'vacuum';
        analyzeExecuted: boolean;
        beforeBytes: number;
        afterBytes: number;
        bytesReclaimed: number;
        databasePath: string;
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
      }) => Promise<{
        invoice: {
          id: number;
          raw_data: string;
          invoice_code: string | null;
          invoice_number: string | null;
          amount: number | null;
          date: string | null;
          check_code: string | null;
          is_duplicate: number;
          buyer_company: string | null;
          invoice_type: string | null;
          seller_company: string | null;
          tax_rate: string | null;
          tax_amount: number | null;
          total_amount: number | null;
          reimburser: string | null;
          targetMonth: string | null;
          created_at: string;
          import_batch_id: string | null;
          source_page: number | null;
          image_base64: string | null;
          primary_file_id: number | null;
          original_file_path: string | null;
          preview_file_path: string | null;
          thumbnail_file_path: string | null;
          storage_status: string;
          storage_version: number;
        };
        file: {
          id: number;
          invoice_id: number | null;
          file_role: string;
          file_kind: string;
          original_name: string | null;
          mime_type: string | null;
          ext: string | null;
          size_bytes: number;
          relative_path: string;
          absolute_path: string;
          sha256: string | null;
          source_page: number | null;
        } | null;
        duplicateCheck: {
          evaluated: boolean;
          duplicateDetected: boolean;
          existingInvoiceId: number | null;
          matchedInvoiceNumber: string | null;
          strategy: 'invoice_number' | 'skipped_invalid_invoice_number';
        };
        duplicateDetected: boolean;
        existingDuplicateInvoiceId: number | null;
      }>;
    };
    invoiceMigration?: {
      getStatus: (options?: { taskKey?: string }) => Promise<{
        migrationKey: string;
        phase: string;
        status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
        totalRecords: number;
        processedRecords: number;
        successRecords: number;
        failedRecords: number;
        skippedRecords: number;
        lastCursor: string | null;
        lastId: number | null;
        startedAt: string | null;
        updatedAt: string | null;
        finishedAt: string | null;
        lastError: string | null;
        config: {
          source: string;
          destination: string;
          migrateImageBase64ToFiles: boolean;
          batchSize: number;
        };
        summary: {
          currentStep: string;
          canResume: boolean;
          canPause: boolean;
          note: string;
          recordMigrationPlan?: string[];
        };
        runtime: {
          isRunnerAttached: boolean;
          pauseRequested: boolean;
        };
      }>;
      startLegacySync: (options?: {
        taskKey?: string;
        totalRecords?: number;
        config?: {
          source?: string;
          destination?: string;
          migrateImageBase64ToFiles?: boolean;
          batchSize?: number;
        };
      }) => Promise<{
        migrationKey: string;
        phase: string;
        status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
        totalRecords: number;
        processedRecords: number;
        successRecords: number;
        failedRecords: number;
        skippedRecords: number;
        lastCursor: string | null;
        lastId: number | null;
        startedAt: string | null;
        updatedAt: string | null;
        finishedAt: string | null;
        lastError: string | null;
        config: {
          source: string;
          destination: string;
          migrateImageBase64ToFiles: boolean;
          batchSize: number;
        };
        summary: {
          currentStep: string;
          canResume: boolean;
          canPause: boolean;
          note: string;
          recordMigrationPlan?: string[];
        };
        runtime: {
          isRunnerAttached: boolean;
          pauseRequested: boolean;
        };
      }>;
      pauseLegacySync: (options?: { taskKey?: string }) => Promise<{
        migrationKey: string;
        phase: string;
        status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
        totalRecords: number;
        processedRecords: number;
        successRecords: number;
        failedRecords: number;
        skippedRecords: number;
        lastCursor: string | null;
        lastId: number | null;
        startedAt: string | null;
        updatedAt: string | null;
        finishedAt: string | null;
        lastError: string | null;
        config: {
          source: string;
          destination: string;
          migrateImageBase64ToFiles: boolean;
          batchSize: number;
        };
        summary: {
          currentStep: string;
          canResume: boolean;
          canPause: boolean;
          note: string;
          recordMigrationPlan?: string[];
        };
        runtime: {
          isRunnerAttached: boolean;
          pauseRequested: boolean;
        };
      }>;
      resumeLegacySync: (options?: { taskKey?: string }) => Promise<{
        migrationKey: string;
        phase: string;
        status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
        totalRecords: number;
        processedRecords: number;
        successRecords: number;
        failedRecords: number;
        skippedRecords: number;
        lastCursor: string | null;
        lastId: number | null;
        startedAt: string | null;
        updatedAt: string | null;
        finishedAt: string | null;
        lastError: string | null;
        config: {
          source: string;
          destination: string;
          migrateImageBase64ToFiles: boolean;
          batchSize: number;
        };
        summary: {
          currentStep: string;
          canResume: boolean;
          canPause: boolean;
          note: string;
          recordMigrationPlan?: string[];
        };
        runtime: {
          isRunnerAttached: boolean;
          pauseRequested: boolean;
        };
      }>;
      runLegacySyncBatch: (payload: {
        taskKey?: string;
        batchSize?: number;
        totalRecords?: number;
        sourceHasMore?: boolean;
        records: Array<{
          id: number | null;
          raw_data: string | null;
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
          reimburser: string | null;
          targetMonth: string | null;
          created_at: string | null;
          import_batch_id: string | null;
          source_page: number | null;
          image_base64: string | null;
        }>;
      }) => Promise<{
        taskKey: string;
        requestedBatchSize: number;
        processedInThisBatch: number;
        successInThisBatch: number;
        failedInThisBatch: number;
        skippedInThisBatch: number;
        skippedBecauseAlreadyMigrated: number;
        skippedBecauseAlreadyExistsInSqlite: number;
        nextCursor: string | null;
        nextLastId: number | null;
        hasMore: boolean;
        errors: string[];
        taskStatus: {
          migrationKey: string;
          phase: string;
          status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
          totalRecords: number;
          processedRecords: number;
          successRecords: number;
          failedRecords: number;
          skippedRecords: number;
          lastCursor: string | null;
          lastId: number | null;
          startedAt: string | null;
          updatedAt: string | null;
          finishedAt: string | null;
          lastError: string | null;
          config: {
            source: string;
            destination: string;
            migrateImageBase64ToFiles: boolean;
            batchSize: number;
          };
          summary: {
            currentStep: string;
            canResume: boolean;
            canPause: boolean;
            note: string;
            recordMigrationPlan?: string[];
          };
          runtime: {
            isRunnerAttached: boolean;
            pauseRequested: boolean;
          };
        };
      }>;
    };
  }
}
