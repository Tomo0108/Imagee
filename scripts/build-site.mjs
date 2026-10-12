// Assembles the distribution site: the landing page at the root and the web app (dist/) under app/.
// Usage: npm run build && node scripts/build-site.mjs   → site-dist/
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';

if (!existsSync('dist/index.html')) throw new Error('Run `npm run build` first.');
rmSync('site-dist', { recursive: true, force: true });
cpSync('site', 'site-dist', { recursive: true });
cpSync('public/icons', 'site-dist/icons', { recursive: true });
cpSync('dist', 'site-dist/app', { recursive: true });
writeFileSync('site-dist/.nojekyll', '');
console.log('Site ready in site-dist/');
