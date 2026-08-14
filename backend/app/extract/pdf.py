from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import pdfplumber

from app.extract.base import AbstractExtractor, ExtractedDoc, Page

_CID = re.compile(r"\(cid:\d+\)")

# Spacing accent glyph -> {base vowel: precomposed letter}. Many PDFs encode
# å/ä/ö as a base vowel plus a separate accent glyph that pdfplumber drops
# right beside (before or after) the vowel instead of on it.
_ACCENT_BASE: dict[str, dict[str, str]] = {
    "¨": {"a": "ä", "o": "ö", "u": "ü", "e": "ë", "A": "Ä", "O": "Ö", "U": "Ü", "E": "Ë"},
    "˚": {"a": "å", "A": "Å"},
    "°": {"a": "å", "A": "Å"},
    "´": {"a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú",
               "A": "Á", "E": "É", "I": "Í", "O": "Ó", "U": "Ú"},
    "ˆ": {"a": "â", "e": "ê", "i": "î", "o": "ô", "u": "û"},
    "˜": {"a": "ã", "n": "ñ", "o": "õ"},
}


def _fix_accents(text: str) -> str:
    """Recombine a spacing accent glyph with the vowel immediately beside it."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        amap = _ACCENT_BASE.get(text[i])
        if amap is not None:
            nxt = text[i + 1] if i + 1 < n else ""
            if nxt in amap:  # accent sits before its vowel
                out.append(amap[nxt])
                i += 2
                continue
            if out and out[-1] in amap:  # accent sits after its vowel
                out[-1] = amap[out[-1]]
                i += 1
                continue
        out.append(text[i])
        i += 1
    return "".join(out)


def _clean(text: str) -> str:
    """Drop unmapped-glyph artifacts and repair displaced accents."""
    text = _CID.sub("", text)  # pdfplumber emits (cid:NNN) for unmapped glyphs
    text = "".join(ch for ch in text if not 0xE000 <= ord(ch) <= 0xF8FF)  # private-use glyphs
    text = _fix_accents(text)
    return unicodedata.normalize("NFC", text)


class PdfExtractor(AbstractExtractor):
    method = "pdfplumber"

    def extract(self, path: Path) -> ExtractedDoc:
        pages: list[Page] = []
        title: str | None = None
        with pdfplumber.open(str(path)) as pdf:
            meta = pdf.metadata or {}
            raw_title = meta.get("Title") if isinstance(meta, dict) else None
            if isinstance(raw_title, str) and raw_title.strip():
                title = raw_title.strip()
            for idx, page in enumerate(pdf.pages, start=1):
                # x_tolerance=1 — many LaTeX / exported PDFs omit space glyphs;
                # the default tolerance (3) then runs whole words together.
                text = page.extract_text(x_tolerance=1) or ""
                pages.append(Page(no=idx, text_md=_clean(text).strip()))
        word_count = sum(len(p.text_md.split()) for p in pages)
        return ExtractedDoc(
            pages=pages,
            title=title,
            word_count=word_count,
            extraction_method=self.method,
        )
