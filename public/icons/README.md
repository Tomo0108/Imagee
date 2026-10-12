App icons go here (designed separately). Expected files:

- `icon-32.png`, `icon-180.png`, `icon-192.png`, `icon-512.png` (web / PWA)
- `Imagee.icns` (macOS), `Imagee.ico` (Windows)

When they are added, list the PNGs in `public/manifest.webmanifest`, link `icon-32.png` / `icon-180.png`
from `index.html`, and set `build.mac.icon` / `build.win.icon` in `package.json`.
