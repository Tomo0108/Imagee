Imagee's approved smooth violet glass `I` icon (without ribbon creases or a photograph symbol).

- `icon-32.png`, `icon-180.png`, `icon-192.png`, `icon-512.png` (web / PWA)
- `icon-maskable-512.png` (Android / maskable PWA)
- `Imagee.icns` (macOS), `Imagee.ico` (Windows)
- `artwork.png` is the original transparent PNG source.

The icons are connected to the web manifest, favicon, Apple touch icon, Electron
window, desktop packages, library sidebar, settings and distribution site.

To regenerate after updating `artwork.png`, install Python 3 and Pillow, then run
from the project root:

```sh
python -m pip install Pillow
python scripts/build-icons.py
```

Generated files are checked in; normal builds do not require Python or Pillow.
