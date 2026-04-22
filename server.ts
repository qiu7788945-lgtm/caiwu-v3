import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const OCR_SERVICE_BASE_URL = 'http://127.0.0.1:18000';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get('/api/ocr/health', async (_req, res) => {
    try {
      const response = await fetch(`${OCR_SERVICE_BASE_URL}/health`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      console.error('Error checking OCR service health:', error);
      res.status(502).json({ ok: false, error: 'OCR service unavailable' });
    }
  });

  app.post('/api/ocr/image', async (req, res) => {
    try {
      const { image_base64 } = req.body ?? {};
      if (!image_base64 || typeof image_base64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'image_base64 is required' });
      }

      const body = new URLSearchParams();
      body.append('image_base64', image_base64);

      const response = await fetch(`${OCR_SERVICE_BASE_URL}/ocr/image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const rawText = await response.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { ok: false, error: rawText || 'Upstream returned non-JSON response' };
      }

      res.status(response.status).json(data);
    } catch (error) {
      console.error('Error proxying OCR image request:', error);
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'OCR proxy request failed' });
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



