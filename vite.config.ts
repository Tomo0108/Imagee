import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [react(), { name: 'production-csp', transformIndexHtml() {
    if (command !== 'build') return [];
    return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; manifest-src 'self'" }, injectTo: 'head' as const }];
  } }],
  base: './',
  worker: { format: 'es' },
  // onnxruntime-web: load its WebAssembly glue as a separate file rather than inlined (smaller worker, cacheable).
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  server: { port: 5173, strictPort: true },
}));
