// Drives the built web app in Chromium and saves screenshots of the main screens.
// Usage: npm run build && npm run test:ui   (screenshots go to $IMAGEE_SHOTS or ./screenshots)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';

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
  // A tool's hint shows above the canvas the first time only; afterwards it lives in the help.
  assert.match(await page.locator('.first-hint').textContent(), /表示位置を移動/);
  await page.screenshot({ path: `${out}/editor-dark.png` });
  await page.keyboard.press('b');
  assert.match(await page.locator('.first-hint').textContent(), /描画色を塗ります/);
  await page.keyboard.press('h');
  assert.equal(await page.locator('.first-hint').count(), 0, 'hint is not shown again');
  await page.keyboard.press('Control+1');
  assert.equal(await page.locator('.zoom-readout').textContent(), '100%');
  await page.keyboard.press('Control+0');

  // Adjustments: a slider drag is one history step, auto-correct is another.
  await page.getByRole('tab', { name: '調整' }).click();
  await page.getByRole('slider', { name: '露光量' }).fill('0.8');
  await page.getByRole('slider', { name: '露光量' }).fill('1');
  await page.getByRole('slider', { name: '露光量' }).dispatchEvent('pointerup');
  await page.getByRole('slider', { name: '色温度' }).fill('35');
  await page.getByRole('slider', { name: '色温度' }).dispatchEvent('pointerup');
  await page.getByRole('slider', { name: '周辺光量' }).fill('-45');
  await page.getByRole('slider', { name: '周辺光量' }).dispatchEvent('pointerup');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/editor-adjust-dark.png` });
  await page.getByRole('button', { name: '補正前' }).dispatchEvent('pointerdown');
  await page.locator('.stage-badge').waitFor();
  await page.getByRole('button', { name: '補正前' }).dispatchEvent('pointerup');
  await page.getByRole('button', { name: '自動補正' }).click();
  await page.getByRole('tab', { name: '履歴' }).click();
  assert.deepEqual(await page.locator('.history-list li').allTextContents(), ['開く', '露光量', '色温度', '周辺光量', '自動補正']);
  await page.keyboard.press('Control+z');

  // Crop to a square and rotate a quarter turn: output becomes 1000 × 1000, then stays square.
  await page.getByRole('button', { name: '切り抜きと回転', exact: true }).click();
  await page.locator('.crop-bar').waitFor();
  await page.locator('.crop-bar select').selectOption('1:1');
  await page.getByRole('slider', { name: '角度' }).fill('4.5');
  await page.getByRole('slider', { name: '角度' }).dispatchEvent('pointerup');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/editor-crop-dark.png` });
  await page.getByRole('button', { name: '完了' }).click();
  const dims = await page.locator('.doc-title span').textContent();
  const [w, h] = dims.split('×').map(v => Number(v.trim()));
  assert.equal(w, h, `square crop, got ${dims}`);
  assert.ok(w < 1000 && w > 800, `straightened square crop, got ${dims}`);
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: '情報' }).click();
  await page.locator('.histogram').waitFor();
  await page.screenshot({ path: `${out}/editor-info-dark.png` });

  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('radio', { name: 'WebP' }).click();
  await page.locator('.export-summary b', { hasText: /KB|MB/ }).waitFor();
  await page.screenshot({ path: `${out}/export-dark.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Feature search: a few characters in kana or romaji find canvas size; it and image size resize the document.
  const outputSize = async () => (await page.locator('.doc-title span').textContent()).split('×').map(v => Number(v.trim()));
  const [cropW, cropH] = await outputSize();
  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('きゃ');
  assert.match(await page.locator('.palette-item.on').textContent(), /キャンバスサイズを変更/);
  await page.locator('.palette input').fill('kya');
  assert.match(await page.locator('.palette-item.on').textContent(), /キャンバスサイズを変更/);
  await page.screenshot({ path: `${out}/palette-dark.png` });
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'キャンバスサイズ' }).waitFor();
  await page.getByRole('spinbutton', { name: '幅' }).fill('1800');
  await page.getByRole('radio', { name: '背景色' }).click();
  await page.screenshot({ path: `${out}/resize-canvas-dark.png` });
  await page.getByRole('button', { name: '変更する' }).click();
  await page.waitForTimeout(400);
  const [grownW, grownH] = await outputSize();
  // The crop is reset; the straightening angle stays, so the output is the largest 18:10 area inside it.
  assert.ok(grownW > cropW && Math.abs(grownW / grownH - 1.8) < 0.01, `canvas grew and the crop was reset: ${grownW}×${grownH}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert.deepEqual(await outputSize(), [cropW, cropH], 'undo restores the size');
  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('resize');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '50%' }).click();
  await page.getByRole('button', { name: '変更する' }).click();
  await page.waitForTimeout(400);
  const [halfW, halfH] = await outputSize();
  assert.ok(Math.abs(halfW - cropW / 2) <= 1 && Math.abs(halfH - cropH / 2) <= 1, `image size halves the crop too: ${halfW}×${halfH}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  // Help holds what used to be fixed text.
  await page.keyboard.press('Shift+?');
  await page.getByRole('dialog', { name: 'ヘルプ' }).waitFor();
  assert.match(await page.locator('.help-tools').textContent(), /Alt\+クリックで背景色を取得/);
  await page.screenshot({ path: `${out}/help-dark.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '夕焼け.pngを開く' }).click();
  assert.equal(await page.locator('.doc-title span').textContent(), dims, 'edits are restored when reopening');
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();

  // Painting, selections, layers, masks, text and shapes on the square image; all of it survives reopening.
  await page.getByRole('button', { name: 'square.pngを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(400);
  const stage = await page.locator('.stage').boundingBox();
  const cx = Math.round(stage.x + stage.width / 2), cy = Math.round(stage.y + stage.height / 2);
  const pixel = (x, y) => page.evaluate(([x, y]) => {
    const c = document.querySelector('.stage canvas'), r = c.getBoundingClientRect(), k = c.width / r.width;
    return [...c.getContext('2d').getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data];
  }, [x, y]);
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  const drag = async (from, to, steps = 10) => { await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps }); await page.mouse.up(); await page.waitForTimeout(120); };
  const isRed = ([r, g, b]) => r > 200 && g < 60 && b < 60, isBlue = ([r, g, b]) => b > 200 && r < 60 && g < 60;

  await page.getByLabel('描画色', { exact: true }).fill('#ff0000');
  await blur();
  await page.keyboard.press('b');
  await drag([cx - 150, cy - 150], [cx + 150, cy - 150]);
  assert.ok(isRed(await pixel(cx - 100, cy - 150)), 'brush paints the foreground colour');

  await page.keyboard.press('Shift+N');
  await page.keyboard.press('m');
  await drag([cx - 60, cy - 20], [cx + 60, cy + 80], 5);
  await page.getByLabel('描画色', { exact: true }).fill('#0000ff');
  await blur();
  await page.keyboard.press('Alt+Backspace');
  await page.waitForTimeout(150);
  assert.ok(isBlue(await pixel(cx - 45, cy + 70)), 'selection fills with the foreground colour');
  assert.ok(!isBlue(await pixel(cx - 100, cy + 70)), 'fill stays inside the selection');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  assert.ok(!isBlue(await pixel(cx - 45, cy + 70)), 'undo removes the fill');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  assert.ok(isBlue(await pixel(cx - 45, cy + 70)), 'redo restores the fill');

  await page.keyboard.press('t');
  await page.mouse.click(cx - 150, cy + 150);
  await page.getByRole('textbox', { name: 'テキスト' }).fill('こんにちは Imagee');
  await blur();
  await page.keyboard.press('u');
  await drag([cx + 40, cy - 120], [cx + 160, cy - 40], 5);

  await page.locator('.layer-list li', { hasText: 'レイヤー 1' }).locator('.layer-main').click();
  await page.getByRole('button', { name: /^マスクを追加/ }).click();
  await page.keyboard.press('d');
  await page.keyboard.press('b');
  await drag([cx - 20, cy + 30], [cx + 20, cy + 30], 6);
  assert.ok(!isBlue(await pixel(cx, cy + 30)), 'black on a mask hides the layer');
  assert.ok(isBlue(await pixel(cx - 45, cy + 70)), 'the rest of the layer stays visible');

  await page.keyboard.press('w');
  await page.mouse.click(cx + 100, cy + 100);
  await page.locator('.status-bar', { hasText: '選択' }).waitFor();
  await page.screenshot({ path: `${out}/editor-paint-dark.png` });
  await page.keyboard.press('Control+d');
  const layerNames = async () => page.locator('.layer-list .layer-name').allTextContents();
  assert.deepEqual(await layerNames(), ['図形 1', 'テキスト 1', 'レイヤー 1', '背景']);
  await page.getByRole('tab', { name: '履歴' }).click();
  const labels = await page.locator('.history-list li').allTextContents();
  for (const label of ['ブラシ', '新規レイヤー', '描画色で塗りつぶし', 'テキストを追加', 'テキストを編集', '図形を追加', 'マスクを追加', 'マスクを編集']) assert.ok(labels.includes(label), `history has ${label}: ${labels}`);

  const painted = [await pixel(cx - 100, cy - 150), await pixel(cx - 45, cy + 70), await pixel(cx, cy + 30)];
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'square.pngを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(600);
  assert.deepEqual(await layerNames(), ['図形 1', 'テキスト 1', 'レイヤー 1', '背景'], 'layers are restored');
  assert.ok(isRed(await pixel(cx - 100, cy - 150)) && isBlue(await pixel(cx - 45, cy + 70)) && !isBlue(await pixel(cx, cy + 30)), `painting is restored: ${painted}`);
  await page.screenshot({ path: `${out}/editor-reopened-dark.png` });

  // Colour tools: presets, tone curve, adjustment layers and .cube LUTs.
  const grey = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 12;
  const bright = ([r, g, b]) => r + g + b;
  await page.getByRole('tab', { name: '調整' }).click();
  await page.locator('.preset-main', { hasText: /^モノクロ$/ }).click();
  await page.waitForTimeout(200);
  assert.ok(grey(await pixel(cx - 100, cy - 150)), 'monochrome preset removes colour');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.ok(isRed(await pixel(cx - 100, cy - 150)), 'undo restores colour');
  const probe = [cx - 200, cy + 260];
  const before = bright(await pixel(...probe));
  await page.locator('summary', { hasText: 'トーンカーブ' }).click();
  await page.locator('.curve-graph').scrollIntoViewIfNeeded();
  const graph = await page.locator('.curve-graph').boundingBox();
  await drag([graph.x + graph.width / 2, graph.y + graph.height / 2], [graph.x + graph.width / 2, graph.y + graph.height * 0.25], 5);
  await page.waitForTimeout(200);
  const after = bright(await pixel(...probe));
  assert.ok(after > before + 30, `raising the curve brightens the image (${before} → ${after})`);
  await page.screenshot({ path: `${out}/editor-curves-dark.png` });
  await page.keyboard.press('Control+z');
  await page.getByRole('tab', { name: 'レイヤー' }).click();
  await page.getByRole('button', { name: '調整レイヤーを追加' }).click();
  await page.locator('.adjust-scope').waitFor();
  await page.getByRole('slider', { name: '彩度', exact: true }).fill('-100');
  await page.getByRole('slider', { name: '彩度', exact: true }).dispatchEvent('pointerup');
  await page.waitForTimeout(200);
  assert.ok(grey(await pixel(cx - 100, cy - 150)), 'adjustment layer desaturates the layers below');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const cube = ['TITLE "Invert"', 'LUT_3D_SIZE 2'];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) cube.push(`${1 - r} ${1 - g} ${1 - b}`);
  await page.locator('summary', { hasText: 'LUT' }).click();
  const lutChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '.cube ファイルを読み込む' }).click();
  await (await lutChooser).setFiles({ name: 'invert.cube', mimeType: 'text/plain', buffer: Buffer.from(cube.join('\n')) });
  await page.waitForTimeout(300);
  const [ir, ig, ib] = await pixel(cx - 100, cy - 150);
  assert.ok(ir < 60 && ig > 190 && ib > 190, `LUT inverts red to cyan, got ${[ir, ig, ib]}`);
  await page.screenshot({ path: `${out}/editor-adjust-layer-dark.png` });
  await page.getByRole('tab', { name: '履歴' }).click();
  const colourLabels = await page.locator('.history-list li').allTextContents();
  assert.ok(colourLabels.includes('調整レイヤーを追加') && colourLabels.includes('LUT'), `colour history: ${colourLabels}`);

  // Spot healing removes part of the red stroke; the clone stamp copies the rest elsewhere.
  await page.keyboard.press('Control+z');
  await page.getByRole('tab', { name: 'レイヤー' }).click();
  await page.locator('.layer-list li', { hasText: '背景' }).locator('.layer-main').click();
  await page.keyboard.press('j');
  await page.getByRole('slider', { name: 'サイズ' }).fill('60');
  await drag([cx - 140, cy - 150], [cx - 60, cy - 150], 8);
  await page.waitForTimeout(300);
  assert.ok(!isRed(await pixel(cx - 100, cy - 150)), `healing removes the stroke, got ${await pixel(cx - 100, cy - 150)}`);
  await page.keyboard.press('s');
  await page.keyboard.down('Alt');
  await page.mouse.click(cx + 100, cy - 150);
  await page.keyboard.up('Alt');
  await drag([cx + 100, cy + 250], [cx + 110, cy + 250], 3);
  // A soft (50% hardness) stamp: the copy is red, slightly blended at the edge.
  const stamped = ([r, g, b]) => r > 170 && g < 80 && b < 80;
  assert.ok(stamped(await pixel(cx + 104, cy + 250)), `clone stamp copies the source: ${await pixel(cx + 104, cy + 250)}`);
  await page.screenshot({ path: `${out}/editor-heal-clone-dark.png` });

  // Refining a selection: grow by 8 px on each side.
  await page.keyboard.press('m');
  await drag([cx - 200, cy + 200], [cx - 100, cy + 260], 4);
  const selectionSize = async () => (await page.locator('.status-bar span', { hasText: '選択' }).textContent()).match(/(\d+) × (\d+)/).slice(1).map(Number);
  const [sw] = await selectionSize();
  await page.getByRole('spinbutton', { name: '調整する幅（px）' }).fill('8');
  await page.getByRole('button', { name: '拡張', exact: true }).click();
  await page.waitForTimeout(200);
  const [sw2] = await selectionSize();
  assert.ok(sw2 >= sw + 12 && sw2 <= sw + 20, `selection grows by about 16 px: ${sw} → ${sw2}`);
  await page.keyboard.press('Control+d');

  // Save with layers as PSD and .imagee, then import both back into the library.
  await page.evaluate(() => {
    window.__saved = {};
    window.showSaveFilePicker = async ({ suggestedName }) => ({ name: suggestedName, createWritable: async () => ({ write: async blob => { window.__saved[suggestedName] = blob; }, close: async () => {} }) });
  });
  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('button', { name: 'PSD', exact: true }).click();
  await page.waitForFunction(() => window.__saved['square.psd']);
  await page.getByRole('button', { name: '.imagee', exact: true }).click();
  await page.waitForFunction(() => window.__saved['square.imagee']);
  await page.screenshot({ path: `${out}/export-project-dark.png` });
  const saved = await page.evaluate(async () => Promise.all(Object.entries(window.__saved).map(([name, blob]) => new Promise(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve([name, reader.result.split(',')[1]]); reader.readAsDataURL(blob);
  }))));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  await page.waitForTimeout(500);
  const projectChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像を開く' }).first().click();
  await (await projectChooser).setFiles(saved.map(([name, b64]) => ({ name, mimeType: name.endsWith('.psd') ? 'image/vnd.adobe.photoshop' : 'application/octet-stream', buffer: Buffer.from(b64, 'base64') })));
  await page.locator('.project', { hasText: 'square.psd' }).waitFor();
  assert.equal(await page.locator('.project', { hasText: 'square.png' }).count(), 2, 'the .imagee project is added');
  await page.getByRole('button', { name: 'square.psdを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(await layerNames(), ['図形 1', 'テキスト 1', 'レイヤー 1', '背景'], 'PSD layers are imported');
  assert.ok(isBlue(await pixel(cx - 45, cy + 70)), 'PSD layer pixels are imported');
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'square.pngを開く' }).first().click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(await layerNames(), ['図形 1', 'テキスト 1', '調整レイヤー 1', 'レイヤー 1', '背景'], '.imagee keeps every layer');
  assert.ok(stamped(await pixel(cx + 104, cy + 250)), '.imagee keeps painted pixels');
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();

  // Batch: crop two images to 1:1, fit the long side to 400 px, add a watermark and save them as one zip.
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '一括処理' }).click();
  await page.getByRole('button', { name: 'すべて解除' }).click();
  await page.getByRole('checkbox', { name: 'portrait.png' }).check();
  await page.getByRole('checkbox', { name: '夕焼け.png' }).check();
  await page.getByLabel('縦横比').selectOption('1:1');
  await page.getByLabel('サイズの基準').selectOption('long');
  await page.getByLabel('サイズの値').fill('400');
  await page.getByLabel('色調').selectOption({ label: 'ビビッド' });
  await page.getByLabel('透かし', { exact: true }).fill('© Imagee');
  await page.getByRole('radio', { name: 'PNG' }).click();
  await page.getByLabel('ファイル名の末尾').fill('_web');
  await page.getByLabel('レシピ名').fill('SNS 用');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('imagee-recipes'))[0].name), 'SNS 用', 'the recipe is saved');
  await page.screenshot({ path: `${out}/batch-dark.png` });
  await page.getByRole('button', { name: '2枚を書き出す' }).click();
  await page.waitForFunction(() => window.__saved['Imagee-2枚.zip'], null, { timeout: 30000 });
  const zip = await page.evaluate(async () => { const b = new Uint8Array(await window.__saved['Imagee-2枚.zip'].arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); });
  const entries = unzipSync(new Uint8Array(Buffer.from(zip, 'base64')));
  assert.deepEqual(Object.keys(entries).sort(), ['portrait_web.png', '夕焼け_web.png'].sort(), 'batch outputs are named with the suffix');
  for (const [name, data] of Object.entries(entries)) {
    const view = new DataView(data.buffer, data.byteOffset);
    writeFileSync(`${out}/batch-${name}`, data);
    assert.deepEqual([view.getUint32(16), view.getUint32(20)], [400, 400], `${name} is cropped to 1:1 and resized to 400 px`);
  }
  // On-device AI on a small scene: sky above a fence and grass, with a red ball in front.
  const scene = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 180); sky.addColorStop(0, '#6e9ee6'); sky.addColorStop(1, '#8ab4e8');
    x.fillStyle = sky; x.fillRect(0, 0, 400, 180);
    let seed = 1; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 180; y < 300; y += 2) for (let i = 0; i < 400; i += 2) { x.fillStyle = `rgb(${60 + rand() * 50},${120 + rand() * 50},${40 + rand() * 30})`; x.fillRect(i, y, 2, 2); }
    x.fillStyle = '#5a3c28'; for (let i = 0; i < 400; i += 37) x.fillRect(i, 150, 8, 35);
    x.fillStyle = '#dc1e1e'; x.beginPath(); x.ellipse(205, 180, 35, 40, 0, 0, 7); x.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  const sceneChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像を開く' }).first().click();
  await (await sceneChooser).setFiles([{ name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(scene, 'base64') }]);
  await page.getByRole('button', { name: 'scene.pngを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(400);
  const aiIdle = () => page.locator('.ai-busy').waitFor({ state: 'detached', timeout: 180000 });
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByRole('button', { name: /被写体を選択/ }).click();
  await aiIdle();
  const [subjectW, subjectH] = await selectionSize();
  assert.ok(subjectW > 55 && subjectW < 110 && subjectH > 60 && subjectH < 120, `the ball is selected as the subject: ${subjectW} × ${subjectH}`);
  await page.screenshot({ path: `${out}/editor-ai-dark.png` });
  await page.getByRole('button', { name: /空を選択/ }).click();
  await page.waitForTimeout(300);
  const [skyW, skyH] = await selectionSize();
  assert.ok(skyW === 400 && skyH > 140 && skyH < 200, `the sky is selected: ${skyW} × ${skyH}`);
  // Remove the ball: select it, then fill the selection from its surroundings.
  await page.getByRole('button', { name: /被写体を選択/ }).click();
  await aiIdle();
  assert.ok(isRed(await pixel(cx + 5, cy + 30)), 'the ball is red before removal');
  await page.keyboard.press('Shift+Delete');
  await page.locator('.ai-busy').waitFor({ timeout: 5000 }).catch(() => {});
  await aiIdle();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);
  const filled = await pixel(cx + 5, cy + 30);
  assert.ok(!isRed(filled) && filled[1] > filled[0], `the ball is replaced by grass: ${filled}`);
  await page.screenshot({ path: `${out}/editor-ai-removed-dark.png` });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert.ok(isRed(await pixel(cx + 5, cy + 30)), 'object removal is one undo step');
  // The removal brush: paint over a fence post.
  await page.keyboard.press('r');
  await drag([cx - 125, cy - 30], [cx - 125, cy + 5], 6);
  await page.locator('.ai-busy').waitFor({ timeout: 5000 }).catch(() => {});
  await aiIdle();
  await page.getByRole('tab', { name: '履歴' }).click();
  await page.getByText('不要物を消去').waitFor();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('h');
  await page.getByRole('tab', { name: 'AI' }).click();
  // Background removal masks the layer instead of deleting pixels.
  await page.getByRole('button', { name: /背景を削除/ }).click();
  await aiIdle();
  await page.waitForTimeout(300);
  const masked = await pixel(cx - 150, cy - 100);
  assert.ok(masked[3] === 0 || (masked[0] > 150 && masked[1] > 150 && masked[2] > 150) || (masked[0] < 80 && masked[1] < 80 && masked[2] < 80), `the sky is hidden after background removal: ${masked}`);
  assert.ok(isRed(await pixel(cx + 5, cy + 30)), 'the subject stays visible');
  await page.keyboard.press('Control+z');
  // Upscaling makes a new image and leaves the original alone.
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByRole('button', { name: '2倍' }).click();
  await page.locator('.doc-title', { hasText: 'scene ×2.png' }).waitFor({ timeout: 300000 });
  assert.match(await page.locator('.doc-title').innerText(), /800 × 600/);
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  await page.waitForTimeout(300);
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
  await page.getByRole('button', { name: 'portrait.pngを開く' }).click();
  await page.locator('.stage canvas').waitFor();
  await page.waitForTimeout(300);
  await page.keyboard.press('b');
  await page.screenshot({ path: `${out}/editor-mobile-light.png` });

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(`UI checks passed. Screenshots in ${out}/`);
} finally { server.kill(); }
