import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

async function desktop(storage) {
  let ready, window;
  const handlers = new Map(), opened = [], saved = [];
  const responses = [];
  const app = { isPackaged: true, getPath: () => path.resolve('test-user-data'), requestSingleInstanceLock: () => true, on() {}, isReady: () => false, whenReady: () => ({ then(callback) { ready = callback(); } }) };
  class BrowserWindow {
    constructor() { window = this; this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {} }; }
    on() {} setMenuBarVisibility() {} loadURL() {}
  }
  const electron = { app, BrowserWindow, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {}, dialog: {
    async showOpenDialog(_window, options) { opened.push(options); return responses.shift(); },
    async showSaveDialog(_window, options) { saved.push(options); return responses.shift(); },
  } };
  const fs = {
    async readFile(file) { if (storage.has(file)) return storage.get(file); if (file.endsWith('.png')) return Buffer.from('image'); throw new Error('missing'); },
    async writeFile(file, value) { storage.set(file, value); }, async mkdir() {},
    async stat() { return { isFile: () => true, size: 5, mtimeMs: 1 }; },
  };
  runInNewContext(readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8'), {
    require: name => name === 'electron' ? electron : name === 'node:fs/promises' ? fs : name === 'node:path' ? path : { pathToFileURL() {} },
    __dirname: path.resolve('electron'), process: { argv: [], platform: 'win32', env: {} }, Uint8Array, Buffer,
  });
  await ready;
  return { responses, opened, saved, call: (channel, ...args) => handlers.get(channel)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args) };
}

test('desktop remembers the directory after open, cancellation, restart and save', async () => {
  const storage = new Map(), first = await desktop(storage);
  const file = path.resolve('pictures/example.png'), directory = path.dirname(file);
  first.responses.push({ canceled: false, filePaths: [file] });
  await first.call('pick-images', false);
  assert.deepEqual(Array.from(first.opened[0].properties), ['openFile', 'multiSelections']);
  first.responses.push({ canceled: true, filePaths: [] });
  await first.call('pick-images', true);
  assert.equal(first.opened[1].defaultPath, directory);
  const restarted = await desktop(storage);
  restarted.responses.push({ canceled: true, filePaths: [] });
  await restarted.call('pick-images', false);
  assert.equal(restarted.opened[0].defaultPath, directory);
  const output = path.resolve('exports/result.png');
  restarted.responses.push({ canceled: false, filePath: output });
  await restarted.call('save-image', 'result.png', new Uint8Array([1]), 'png');
  assert.equal(restarted.saved[0].defaultPath, path.join(directory, 'result.png'));
  restarted.responses.push({ canceled: true, filePaths: [] });
  await restarted.call('pick-images', false);
  assert.equal(restarted.opened[1].defaultPath, path.dirname(output));
});
