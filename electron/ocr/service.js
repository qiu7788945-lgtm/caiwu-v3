import { app, ipcMain } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const OCR_HOST = '127.0.0.1';
const OCR_PORT = 18000;
const OCR_BASE_URL = `http://${OCR_HOST}:${OCR_PORT}`;
const OCR_STARTUP_TIMEOUT_MS = 120000;
const OCR_HEALTH_RETRY_MS = 1000;

let ocrProcess = null;
let startupPromise = null;

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOcrServiceRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ocr_service');
  }

  return path.join(app.getAppPath(), 'ocr_service');
}

function getOcrRuntimePaths() {
  const serviceRoot = getOcrServiceRoot();

  return {
    serviceRoot,
    pythonPath: path.join(serviceRoot, '.venv311', 'Scripts', 'python.exe'),
    appPath: path.join(serviceRoot, 'app.py'),
  };
}

function validateOcrRuntimePaths() {
  const runtimePaths = getOcrRuntimePaths();

  if (!fs.existsSync(runtimePaths.serviceRoot)) {
    throw new Error(`OCR service directory not found: ${runtimePaths.serviceRoot}`);
  }

  if (!fs.existsSync(runtimePaths.pythonPath)) {
    throw new Error(`OCR Python runtime not found: ${runtimePaths.pythonPath}`);
  }

  if (!fs.existsSync(runtimePaths.appPath)) {
    throw new Error(`OCR app.py not found: ${runtimePaths.appPath}`);
  }

  return runtimePaths;
}

async function isOcrServiceHealthy(timeoutMs = 3000) {
  const timeout = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(`${OCR_BASE_URL}/health`, {
      signal: timeout.signal,
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data?.ok === true;
  } catch {
    return false;
  } finally {
    timeout.clear();
  }
}

async function waitForOcrHealth(timeoutMs = OCR_STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isOcrServiceHealthy()) {
      return true;
    }

    await delay(OCR_HEALTH_RETRY_MS);
  }

  return false;
}

function attachOcrProcessLogging(childProcess) {
  childProcess.stdout?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      console.log('[ocr-service]', text);
    }
  });

  childProcess.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      console.error('[ocr-service]', text);
    }
  });
}

function spawnOcrService() {
  const runtimePaths = validateOcrRuntimePaths();

  const childProcess = spawn(
    runtimePaths.pythonPath,
    ['-m', 'uvicorn', 'app:app', '--host', OCR_HOST, '--port', String(OCR_PORT)],
    {
      cwd: runtimePaths.serviceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    }
  );

  attachOcrProcessLogging(childProcess);

  childProcess.once('exit', (code, signal) => {
    console.log(`[ocr-service] exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (ocrProcess?.pid === childProcess.pid) {
      ocrProcess = null;
    }
  });

  childProcess.once('error', (error) => {
    console.error('[ocr-service] process error:', error);
  });

  return childProcess;
}

export async function ensureOcrService() {
  if (await isOcrServiceHealthy()) {
    return {
      ok: true,
      source: ocrProcess ? 'managed-process' : 'external-process',
      url: OCR_BASE_URL,
    };
  }

  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    try {
      ocrProcess = spawnOcrService();
      const healthy = await waitForOcrHealth();

      if (!healthy) {
        throw new Error('OCR service startup health check timed out');
      }

      console.log('[ocr-service] ready:', OCR_BASE_URL);

      return {
        ok: true,
        source: 'managed-process',
        url: OCR_BASE_URL,
      };
    } catch (error) {
      console.error('[ocr-service] startup failed:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      startupPromise = null;
    }
  })();

  return startupPromise;
}

async function proxyOcrImageRequest(imageBase64) {
  const startup = await ensureOcrService();
  if (!startup.ok) {
    return {
      ok: false,
      error: startup.error ?? 'OCR service is not running',
    };
  }

  const timeout = createTimeoutSignal(120000);

  try {
    const body = new URLSearchParams();
    body.append('image_base64', imageBase64);

    const response = await fetch(`${OCR_BASE_URL}/ocr/image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: timeout.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error ?? `OCR service returned HTTP ${response.status}`,
      };
    }

    const textLength = typeof data?.text === 'string'
      ? data.text.replace(/\s+/g, '').length
      : 0;
    console.log(`[ocr-service] ipc OCR success textLength=${textLength}`);

    return data;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'OCR request failed',
    };
  } finally {
    timeout.clear();
  }
}

export function registerOcrIpcHandlers() {
  ipcMain.handle('ocr:health', async () => {
    const healthy = await isOcrServiceHealthy();
    return {
      ok: healthy,
      url: OCR_BASE_URL,
    };
  });

  ipcMain.handle('ocr:image', async (_event, payload) => {
    const imageBase64 = payload?.imageBase64;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return {
        ok: false,
        error: 'imageBase64 is required',
      };
    }

    return proxyOcrImageRequest(imageBase64);
  });
}

function killOcrProcessTree(childProcess) {
  if (!childProcess?.pid) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });

    killer.once('error', () => {
      try {
        childProcess.kill();
      } catch {
      }
    });

    return;
  }

  try {
    childProcess.kill('SIGTERM');
  } catch {
  }
}

export function stopOcrService() {
  if (!ocrProcess) {
    return;
  }

  killOcrProcessTree(ocrProcess);
  ocrProcess = null;
}
