import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [react(), { name: 'production-csp', transformIndexHtml() {
    if (command !== 'build') return [];
    return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; manifest-src 'self'" }, injectTo: 'head' as const }];
  } }],
  base: './',
  server: { port: 5173, strictPort: true },
}));
