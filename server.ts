import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:18000';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new Database('invoices.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_data TEXT NOT NULL,
    invoice_code TEXT,
    invoice_number TEXT,
    amount REAL,
    date TEXT,
    check_code TEXT,
    is_duplicate BOOLEAN DEFAULT 0,
    buyer_company TEXT,
    invoice_type TEXT,
    seller_company TEXT,
    tax_rate TEXT,
    tax_amount REAL,
    total_amount REAL,
    reimburser TEXT,
    targetMonth TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add columns if they don't exist (for existing databases)
try { db.exec('ALTER TABLE invoices ADD COLUMN buyer_company TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN invoice_type TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN seller_company TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN tax_rate TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN tax_amount REAL'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN total_amount REAL'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN reimburser TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE invoices ADD COLUMN targetMonth TEXT'); } catch (e) {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/ocr/health', async (req, res) => {
    try {
      const response = await fetch(`${OCR_SERVICE_URL}/health`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      console.error('OCR service unavailable:', error);
      res.status(503).json({ ok: false, error: 'OCR service unavailable' });
    }
  });

  app.post('/api/ocr/image', async (req, res) => {
    try {
      if (req.is('application/json')) {
        const { image_base64 } = req.body || {};
        if (!image_base64) {
          return res.status(400).json({ ok: false, error: 'image_base64 is required' });
        }

        const formData = new FormData();
        formData.append('image_base64', image_base64);

        const response = await fetch(`${OCR_SERVICE_URL}/ocr/image`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        return res.status(response.status).json(data);
      }

      const contentType = req.headers['content-type'] || '';
      if (typeof contentType === 'string' && contentType.includes('multipart/form-data')) {
        const response = await fetch(`${OCR_SERVICE_URL}/ocr/image`, {
          method: 'POST',
          headers: {
            'content-type': contentType,
          },
          body: req as unknown as BodyInit,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        const data = await response.json();
        return res.status(response.status).json(data);
      }

      return res.status(400).json({ ok: false, error: 'Unsupported content type' });
    } catch (error) {
      console.error('OCR forwarding failed:', error);
      return res.status(503).json({ ok: false, error: 'OCR service unavailable' });
    }
  });

  // API Routes
  app.get('/api/invoices', (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM invoices ORDER BY created_at DESC');
      const invoices = stmt.all();
      res.json(invoices);
    } catch (error) {
      console.error('Error fetching invoices:', error);
      res.status(500).json({ error: 'Failed to fetch invoices' });
    }
  });

  app.post('/api/invoices', (req, res) => {
    try {
      const { raw_data, targetMonth } = req.body;
      if (!raw_data) {
        return res.status(400).json({ error: 'raw_data is required' });
      }

      // Clean up the raw data: remove whitespace and normalize commas
      const cleaned_data = raw_data.trim().replace(/\s+/g, '').replace(/，/g, ',');
      const parts = cleaned_data.split(',');
      
      let invoice_code = null;
      let invoice_number = null;
      let amount = null;
      let date = null;
      let check_code = null;
      let invoice_type = null;

      if (parts.length >= 2) {
        const typeCode = parts[1];
        const typeMap: Record<string, string> = {
          '01': '增值税专用发票',
          '04': '增值税普通发票',
          '10': '增值税电子普通发票',
          '11': '增值税普通发票(卷票)',
          '14': '增值税电子普通发票(通行费)',
          '15': '二手车销售统一发票',
          '03': '机动车销售统一发票',
          '32': '全电发票(专用发票)',
          '81': '全电发票(普通发票)',
          '82': '全电发票(普通发票)'
        };
        invoice_type = typeMap[typeCode] || typeCode;
      }

      // Date is always 8 digits (YYYYMMDD)
      const dateRegex = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
      // Amount can be positive or negative, with up to 2 decimal places
      const amountRegex = /^-?\d+(\.\d{1,2})?$/;

      let dateIndex = -1;
      
      // Look for the date field. It's usually towards the end.
      // We start from index 2 because code, number, amount come before it.
      for (let i = 2; i < parts.length; i++) {
        if (dateRegex.test(parts[i])) {
          const prevPart = parts[i - 1];
          // The part before date should be the amount (or empty for some special invoices)
          if (prevPart === '' || amountRegex.test(prevPart)) {
            dateIndex = i;
            break;
          }
        }
      }

      if (dateIndex !== -1) {
        date = parts[dateIndex];
        
        const amountStr = parts[dateIndex - 1];
        if (amountStr && amountStr !== '') {
          const parsed = parseFloat(amountStr);
          if (!isNaN(parsed)) {
            amount = parsed;
          }
        }
        
        if (dateIndex - 2 >= 0) {
          invoice_number = parts[dateIndex - 2] || null;
        }
        
        if (dateIndex - 3 >= 0) {
          invoice_code = parts[dateIndex - 3] || null;
        }
        
        if (dateIndex + 1 < parts.length) {
          check_code = parts[dateIndex + 1] || null;
        }
      } else if (parts.length >= 6) {
        // Fallback to standard positions if date regex fails
        const offset = parts.length >= 7 ? 2 : 0;
        invoice_code = parts[offset] || null;
        invoice_number = parts[offset + 1] || null;
        
        const amountStr = parts[offset + 2];
        if (amountStr && amountStr !== '') {
          const parsed = parseFloat(amountStr);
          if (!isNaN(parsed)) amount = parsed;
        }
        
        date = parts[offset + 3] || null;
        check_code = parts[offset + 4] || null;
      }

      // Check for duplicates
      let is_duplicate = 0;
      if (invoice_code && invoice_number) {
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM invoices WHERE invoice_code = ? AND invoice_number = ?');
        const result = checkStmt.get(invoice_code, invoice_number) as { count: number };
        if (result.count > 0) {
          is_duplicate = 1;
        }
      } else if (invoice_number) {
        // For fully digitalized e-invoices (数电票), invoice_code might be null, but invoice_number is unique
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM invoices WHERE invoice_number = ?');
        const result = checkStmt.get(invoice_number) as { count: number };
        if (result.count > 0) {
          is_duplicate = 1;
        }
      } else {
        // If we can't parse code and number, check if exact raw_data exists
        const checkStmt = db.prepare('SELECT COUNT(*) as count FROM invoices WHERE raw_data = ?');
        const result = checkStmt.get(raw_data) as { count: number };
        if (result.count > 0) {
          is_duplicate = 1;
        }
      }

      const insertStmt = db.prepare(`
        INSERT INTO invoices (raw_data, invoice_code, invoice_number, amount, date, check_code, is_duplicate, invoice_type, targetMonth)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = insertStmt.run(raw_data, invoice_code, invoice_number, amount, date, check_code, is_duplicate, invoice_type, targetMonth || null);

      const newInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(newInvoice);
    } catch (error) {
      console.error('Error adding invoice:', error);
      res.status(500).json({ error: 'Failed to add invoice' });
    }
  });

  app.put('/api/invoices/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { buyer_company, invoice_type, seller_company, tax_rate, tax_amount, total_amount, reimburser, targetMonth } = req.body;
      const stmt = db.prepare(`
        UPDATE invoices 
        SET buyer_company = ?, invoice_type = ?, seller_company = ?, tax_rate = ?, tax_amount = ?, total_amount = ?, reimburser = ?, targetMonth = ?
        WHERE id = ?
      `);
      stmt.run(buyer_company, invoice_type, seller_company, tax_rate, tax_amount, total_amount, reimburser, targetMonth, id);
      const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      res.json(updatedInvoice);
    } catch (error) {
      console.error('Error updating invoice:', error);
      res.status(500).json({ error: 'Failed to update invoice' });
    }
  });

  app.put('/api/invoices/batch/move', (req, res) => {
    try {
      const { ids, targetMonth } = req.body;
      if (!Array.isArray(ids) || !targetMonth) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`UPDATE invoices SET targetMonth = ? WHERE id IN (${placeholders})`);
      stmt.run(targetMonth, ...ids);
      res.json({ success: true });
    } catch (error) {
      console.error('Error batch moving invoices:', error);
      res.status(500).json({ error: 'Failed to move invoices' });
    }
  });

  app.delete('/api/invoices/:id', (req, res) => {
    try {
      const { id } = req.params;
      const stmt = db.prepare('DELETE FROM invoices WHERE id = ?');
      stmt.run(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting invoice:', error);
      res.status(500).json({ error: 'Failed to delete invoice' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
