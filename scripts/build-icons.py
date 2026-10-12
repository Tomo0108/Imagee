"""Build web and desktop icons from the approved artwork using Pillow."""

from pathlib import Path

from PIL import Image


root = Path(__file__).resolve().parents[1]
icons = root / "public" / "icons"
with Image.open(icons / "artwork.png") as source:
    artwork = source.convert("RGBA")
if artwork.width != artwork.height:
    raise ValueError("Icon artwork must be square")

for size in (32, 180, 192, 512):
    artwork.resize((size, size), Image.Resampling.LANCZOS).save(
        icons / f"icon-{size}.png", optimize=True
    )

artwork.save(
    icons / "Imagee.ico",
    sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
)
artwork.resize((1024, 1024), Image.Resampling.LANCZOS).save(
    icons / "Imagee.icns"
)
print("Generated PNG, ICO and ICNS icons in public/icons/")
