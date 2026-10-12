// Drives the built web app in Chromium and saves screenshots of the main screens.
// Usage: npm run build && npm run test:ui   (screenshots go to $IMAGEE_SHOTS or ./screenshots)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = process.env.IMAGEE_SHOTS || 'screenshots';
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
const url = 'http://127.0.0.1:4174/';
try {
  for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('heading', { name: '画像を追加して編集を始めましょう' }).waitFor();
  await page.screenshot({ path: `${out}/library-empty-dark.png` });

  // Build fixture images in the page so the test needs no binary files.
  const fixtures = await page.evaluate(async () => {
    const make = async (w, h, hue, alpha) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${hue} 80% 60%)`); g.addColorStop(1, `hsl(${hue + 120} 70% 35%)`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      if (alpha) x.clearRect(w * .6, h * .1, w * .3, h * .3);
      for (let i = 0; i < 12; i++) { x.fillStyle = `hsla(${hue + i * 30} 90% 70% / .7)`; x.beginPath(); x.arc((i * 97) % w, (i * 53) % h, 20 + i * 6, 0, 7); x.fill(); }
      return c.toDataURL('image/png').split(',')[1];
    };
    return [await make(1600, 1000, 260, true), await make(900, 1200, 20, false), await make(1200, 1200, 160, false)];
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像を開く' }).first().click();
  await (await chooser).setFiles(fixtures.map((b64, i) => ({ name: ['夕焼け.png', 'portrait.png', 'square.png'][i], mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })));
  await page.locator('.project').nth(2).waitFor();
  assert.equal(await page.locator('.project').count(), 3);
  await page.getByRole('button', { name: 'お気に入りに追加' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/library-grid-dark.png` });

  await page.getByRole('button', { name: '夕焼け.pngを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(300);
  const zoom = await page.locator('.zoom-readout').textContent();
  assert.notEqual(zoom, '100%', 'large image should open fitted to the window');
  await page.screenshot({ path: `${out}/editor-dark.png` });
  await page.keyboard.press('Control+1');
  assert.equal(await page.locator('.zoom-readout').textContent(), '100%');
  await page.keyboard.press('Control+0');

  await page.getByRole('slider').fill('40');
  await page.getByRole('tab', { name: '履歴' }).click();
  assert.equal(await page.locator('.history-list li').count(), 2);
  await page.keyboard.press('Control+z');
  await page.getByRole('tab', { name: '情報' }).click();
  await page.locator('.histogram').waitFor();
  await page.screenshot({ path: `${out}/editor-info-dark.png` });

  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('radio', { name: 'WebP' }).click();
  await page.locator('.export-summary b', { hasText: /KB|MB/ }).waitFor();
  await page.screenshot({ path: `${out}/export-dark.png` });
  await page.keyboard.press('Escape');

  await page.evaluate(() => localStorage.setItem('imagee-preferences', JSON.stringify({ theme: 'light', checkerboard: 'light' })));
  await page.reload();
  await page.locator('.project').first().waitFor();
  await page.screenshot({ path: `${out}/library-grid-light.png` });
  await page.getByRole('button', { name: 'portrait.pngを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/editor-light.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/library-mobile-light.png` });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(`UI checks passed. Screenshots in ${out}/`);
} finally { server.kill(); }
