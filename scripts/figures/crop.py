"""Crop a rectangular region out of one page of a PDF.

The region is given as FRACTIONS of the page (0.0 - 1.0), measured from the
top-left corner. The crop is rendered straight from the PDF vector source at
high DPI, so figures stay sharp.

Usage:
    python crop.py <pdf> <page> <x0> <y0> <x1> <y1> <out.png> [dpi]

  pdf         path to the source PDF
  page        1-indexed page number (page 1 = first page)
  x0 y0       top-left corner of the region, as fractions of page width/height
  x1 y1       bottom-right corner, as fractions
  out.png     destination path
  dpi         optional render DPI, default 220

Example (lower-right quarter of page 4 at 240 dpi):
    python crop.py mat.pdf 4 0.5 0.5 1.0 1.0 attachments/p04-fig.png 240
"""
from __future__ import annotations

import sys
from pathlib import Path

import fitz


def main() -> None:
    if len(sys.argv) not in (8, 9):
        print(__doc__)
        sys.exit(1)

    PDF = Path(sys.argv[1])
    page_no = int(sys.argv[2])
    x0, y0, x1, y1 = (float(v) for v in sys.argv[3:7])
    out = Path(sys.argv[7])
    dpi = int(sys.argv[8]) if len(sys.argv) == 9 else 220

    for name, v in (("x0", x0), ("y0", y0), ("x1", x1), ("y1", y1)):
        if not 0.0 <= v <= 1.0:
            print(f"error: {name}={v} must be between 0 and 1")
            sys.exit(1)
    if x1 <= x0 or y1 <= y0:
        print("error: need x1>x0 and y1>y0")
        sys.exit(1)

    doc = fitz.open(PDF)
    if not 1 <= page_no <= doc.page_count:
        print(f"error: page {page_no} out of range 1..{doc.page_count}")
        sys.exit(1)

    page = doc[page_no - 1]
    r = page.rect
    clip = fitz.Rect(
        r.x0 + x0 * r.width,
        r.y0 + y0 * r.height,
        r.x0 + x1 * r.width,
        r.y0 + y1 * r.height,
    )
    pix = page.get_pixmap(dpi=dpi, clip=clip)
    out.parent.mkdir(parents=True, exist_ok=True)
    pix.save(out)
    doc.close()
    print(f"saved {out}  ({pix.width}x{pix.height} px, page {page_no}, dpi {dpi})")


if __name__ == "__main__":
    main()
