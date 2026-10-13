import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default defineConfig(({ command }) => ({
  plugins: [react(), { name: 'production-csp', transformIndexHtml() {
    if (command !== 'build') return [];
    return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; manifest-src 'self'" }, injectTo: 'head' as const }];
  } }, {
    // Lets the service worker precache this build's scripts and styles, and drop the previous build's.
    name: 'service-worker-manifest', apply: 'build',
    writeBundle(options, bundle) {
      const files = Object.keys(bundle).sort();
      const assets = files.filter(name => /\.(js|mjs|css|wasm)$/.test(name) && !name.endsWith('.map')).map(name => `./${name}`);
      const hash = createHash('sha256').update(files.join('\n'));
      // Public icons have stable filenames, so include their contents to refresh the offline cache.
      for (const icon of ['icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
        hash.update(readFileSync(join(options.dir!, 'icons', icon)));
      }
      const build = hash.digest('hex').slice(0, 12);
      const path = join(options.dir!, 'sw.js');
      const source = readFileSync(path, 'utf8').replace("const BUILD = 'dev';", `const BUILD = '${build}';`).replace('const ASSETS = [];\nconst WASM = [];', `const ASSETS = ${JSON.stringify(assets.filter(name => !name.endsWith('.wasm')))};\nconst WASM = ${JSON.stringify(assets.filter(name => name.endsWith('.wasm')))};`);
      writeFileSync(path, source);
    },
  }],
  base: './',
  worker: { format: 'es' },
  // onnxruntime-web: load its WebAssembly glue as a separate file rather than inlined (smaller worker, cacheable).
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  server: { port: 5173, strictPort: true },
}));
