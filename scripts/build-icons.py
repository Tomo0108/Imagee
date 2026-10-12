"""Build web and desktop icons from the approved artwork using Pillow."""

from pathlib import Path

from PIL import Image


root = Path(__file__).resolve().parents[1]
icons = root / "public" / "icons"
with Image.open(icons / "artwork.png") as source:
    artwork = source.convert("RGBA")
if artwork.width != artwork.height:
    raise ValueError("Icon artwork must be square")

# Fills behind the artwork where a platform needs an opaque, full-bleed square.
BACKGROUND = (18, 10, 38, 255)


def placed(size, scale, background=None):
    """The artwork scaled to `scale` of a `size` square, centred, on a transparent or solid background."""
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    inner = round(size * scale)
    art = artwork.resize((inner, inner), Image.Resampling.LANCZOS)
    offset = (size - inner) // 2
    canvas.alpha_composite(art, (offset, offset))
    return canvas


for size in (32, 192, 512):
    artwork.resize((size, size), Image.Resampling.LANCZOS).save(icons / f"icon-{size}.png", optimize=True)

# iOS rounds the corners itself and shows transparency as black, so the touch icon is opaque.
placed(180, 0.92, BACKGROUND).save(icons / "icon-180.png", optimize=True)
# Android crops maskable icons to a circle or squircle: keep the artwork inside the 80% safe zone.
placed(512, 0.78, BACKGROUND).save(icons / "icon-maskable-512.png", optimize=True)

artwork.save(icons / "Imagee.ico", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
# macOS app icons sit on Apple's 1024 grid with an 824 px body, so they match other apps in the Dock.
placed(1024, 824 / 1024).save(icons / "Imagee.icns")
print("Generated PNG, ICO and ICNS icons in public/icons/")
