"""Render every page of a PDF to a PNG.

Usage:
    render_pages.py <pdf> <out_dir> [dpi]
"""
from __future__ import annotations

import sys
from pathlib import Path

import fitz


def main() -> None:
    if len(sys.argv) not in (3, 4):
        print(__doc__)
        sys.exit(1)
    pdf = Path(sys.argv[1])
    out = Path(sys.argv[2])
    dpi = int(sys.argv[3]) if len(sys.argv) == 4 else 200

    out.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf)
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(dpi=dpi)
        dest = out / f"page-{i:02d}.png"
        pix.save(dest)
        print(f"page {i:2d}: {pix.width}x{pix.height} -> {dest}")
    doc.close()


if __name__ == "__main__":
    main()
