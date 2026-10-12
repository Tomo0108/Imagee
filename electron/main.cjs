const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { basename, extname, isAbsolute, join } = require('node:path');
const fs = require('node:fs/promises');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'];
// Photoshop documents and Imagee projects open in the library too.
const OPEN_EXTENSIONS = [...IMAGE_EXTENSIONS, 'psd', 'imagee'];
const SAVE_EXTENSIONS = [...OPEN_EXTENSIONS, 'zip'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', psd: 'image/vnd.adobe.photoshop', imagee: 'application/x-imagee' };
const MAX_BYTES = 512 * 1024 * 1024;
let win;
let pendingPaths = [];

if (!app.isPackaged && process.env.IMAGEE_TEST_USER_DATA) app.setPath('userData', process.env.IMAGEE_TEST_USER_DATA);

function isImagePath(file) { return typeof file === 'string' && isAbsolute(file) && OPEN_EXTENSIONS.includes(extname(file).slice(1).toLowerCase()); }
async function readImages(paths) {
  const files = [];
  for (const file of paths.filter(isImagePath).slice(0, 200)) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) continue;
      const ext = extname(file).slice(1).toLowerCase();
      files.push({ name: basename(file), type: MIME[ext], bytes: new Uint8Array(await fs.readFile(file)), lastModified: stat.mtimeMs });
    } catch { /* Unreadable files are skipped. */ }
  }
  return files;
}
function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unauthorized');
    return handler(...args);
  });
}
function openPaths(paths) {
  const images = paths.filter(isImagePath);
  if (!images.length) return;
  pendingPaths.push(...images);
  if (win && !win.webContents.isLoading()) win.webContents.send('open-paths');
}
function createWindow() {
  win = new BrowserWindow({
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } } : {}),
    width: 1480, height: 960, minWidth: 900, minHeight: 640, title: 'Imagee', backgroundColor: '#1c1c20',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (process.argv.includes('--dev')) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(join(__dirname, '../dist/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_event, argv) => { openPaths(argv.slice(1)); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('open-file', (event, file) => { event.preventDefault(); openPaths([file]); });
openPaths(process.argv.slice(1));

app.whenReady().then(() => {
  createWindow();
  register('pick-images', async projects => {
    const filters = projects ? [{ name: '画像・PSD・Imagee プロジェクト', extensions: OPEN_EXTENSIONS }] : [{ name: 'Images', extensions: IMAGE_EXTENSIONS }];
    const result = await dialog.showOpenDialog(win, { title: '画像を開く', properties: ['openFile', 'multiSelections'], filters });
    return result.canceled ? [] : readImages(result.filePaths);
  });
  register('take-launch-images', async () => { const paths = pendingPaths; pendingPaths = []; return readImages(paths); });
  register('save-image', async (suggestedName, bytes, extension) => {
    if (typeof suggestedName !== 'string' || !(bytes instanceof Uint8Array) || !SAVE_EXTENSIONS.includes(extension)) throw new Error('Invalid export');
    const result = await dialog.showSaveDialog(win, { title: '書き出し', defaultPath: basename(suggestedName), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, bytes);
    return basename(result.filePath);
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
