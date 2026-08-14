"""Figure cropping for AI extraction — worker-only.

Step of figure-aware AI extraction: the vision model marks each figure on a page
with a fractional bounding box; this crops that rectangle straight out of the PDF
vector source, sharp at high DPI, so the figure becomes its own image attachment.
PyMuPDF is imported lazily — heavy, worker-only.
"""
from __future__ import annotations

from pathlib import Path

Bbox = tuple[float, float, float, float]

_MIN_SIZE = 0.02  # reject a degenerate box smaller than 2% of the page


def crop_region(pdf_path: Path, page_no: int, bbox: Bbox, dpi: int = 220) -> bytes:
    """Crop a fractional rectangle (x0, y0, x1, y1 in 0..1, top-left origin) from
    one page of a PDF and return PNG bytes. Raises ValueError on a degenerate box."""
    import fitz

    x0, y0, x1, y1 = bbox
    x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
    y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
    if x1 - x0 < _MIN_SIZE or y1 - y0 < _MIN_SIZE:
        raise ValueError(f"degenerate crop box {bbox}")

    doc = fitz.open(pdf_path)
    try:
        if not 1 <= page_no <= doc.page_count:
            raise ValueError(f"page {page_no} out of range 1..{doc.page_count}")
        page = doc[page_no - 1]
        r = page.rect
        clip = fitz.Rect(
            r.x0 + x0 * r.width,
            r.y0 + y0 * r.height,
            r.x0 + x1 * r.width,
            r.y0 + y1 * r.height,
        )
        return page.get_pixmap(dpi=dpi, clip=clip).tobytes("png")
    finally:
        doc.close()
