// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const { DesktopOidcAuth } = require('./desktop-auth');

if (!app.isPackaged) dotenv.config({ path: path.join(__dirname, '.env') });

function loadRuntimeConfig() {
  let packaged = {};
  if (app.isPackaged) {
    const configPath = path.join(process.resourcesPath, 'app-config.json');
    if (fs.existsSync(configPath)) packaged = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return {
    workerApiUrl: packaged.workerApiUrl || process.env.WORKER_API_URL || 'https://order-manager-proxy.printmobusiness.workers.dev',
    oidcIssuer: packaged.oidcIssuer || process.env.OIDC_ISSUER,
    oidcClientId: packaged.oidcClientId || process.env.OIDC_CLIENT_ID,
    oidcScopes: packaged.oidcScopes || process.env.OIDC_SCOPES
  };
}

const runtimeConfig = loadRuntimeConfig();
const WORKER_API_URL = String(runtimeConfig.workerApiUrl || '').replace(/\/+$/, '');
let desktopAuth;

async function workerFetch(endpoint, options = {}) {
  const token = await desktopAuth.getToken(true);
  const response = await fetch(`${WORKER_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Worker API (${endpoint}) failed (${response.status}): ${body}`);
  }
  return response.json();
}

function mutate(target, patch) {
  return workerFetch('/order-manager/v1/legacy/queue/mutate', {
    method: 'POST',
    body: JSON.stringify({ ...target, patch })
  });
}

ipcMain.on('get-asset-path', (event, file) => {
  event.returnValue = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', file)
    : path.join(__dirname, file);
});

ipcMain.handle('get-queue', () => workerFetch('/order-manager/v1/legacy/queue'));
ipcMain.handle('delete-order', (_event, orderName) => workerFetch('/order-manager/v1/legacy/queue/item', {
  method: 'DELETE', body: JSON.stringify({ orderName })
}));
ipcMain.handle('update-status', (_event, orderName, status) => mutate({ orderName }, { status }));
ipcMain.handle('update-statuses', (_event, orderNames, status) => mutate({ orderNames }, { status }));
ipcMain.handle('update-bundle-status', (_event, bundleName, status) => mutate({ bundleName }, { status }));
ipcMain.handle('update-ready', (_event, orderName, blanksStatus, printsStatus, blanksOrdered, printsOrdered) =>
  mutate({ orderName }, { blanksStatus, printsStatus, blanksOrdered, printsOrdered }));
ipcMain.handle('set-bundle', (_event, orderNames, bundle) => mutate({ orderNames }, { bundle }));
ipcMain.handle('add-file', (_event, orderName, addAttachment) => mutate({ orderName }, { addAttachment }));
ipcMain.handle('remove-files', (_event, orderName, removeAttachmentNames) => mutate({ orderName }, { removeAttachmentNames }));
ipcMain.handle('update-notes', (_event, orderName, notes) => mutate({ orderName }, { notes }));
ipcMain.handle('update-name', (_event, orderName, custName) => mutate({ orderName }, { custName }));
ipcMain.handle('update-progress', (_event, orderName, progress) => mutate({ orderName }, { progress }));
ipcMain.handle('process-batch', (_event, orderIds) => workerFetch('/order-manager/v1/legacy/ss/batch', {
  method: 'POST', body: JSON.stringify({ orderIds })
}));

function safeDownloadName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

ipcMain.handle('download-asset', async (_event, url, suggestedName) => {
  const safeName = safeDownloadName((suggestedName || 'order-asset').trim() || 'order-asset');
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: safeName });
  if (canceled || !filePath) return { canceled: true };
  const headers = {};
  if (String(url).startsWith(WORKER_API_URL)) {
    headers.Authorization = `Bearer ${await desktopAuth.getToken(true)}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Failed to fetch asset (${response.status})`);
  await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  return { canceled: false, filePath };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(async () => {
  desktopAuth = new DesktopOidcAuth(runtimeConfig);
  try {
    await desktopAuth.getToken(true);
    createWindow();
  } catch (err) {
    dialog.showErrorBox('PrintMO sign-in failed', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
