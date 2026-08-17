"""Lazy extractor registry — worker-only modules behind importlib.

The api container's pixi env does NOT have pdfplumber / python-docx / python-pptx.
Importing this module is free (it does not load any extractor). The actual
extractor class is only imported when get_extractor() is called, which only
happens inside the worker.

See docs/decisions/001-worker-vs-api-deps.md.
"""
from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass  # AbstractExtractor base lives in app/extract/base.py (Phase 2)


_REGISTRY: dict[str, tuple[str, str]] = {
    "pdf": ("app.extract.pdf", "PdfExtractor"),
    "docx": ("app.extract.docx", "DocxExtractor"),
    "pptx": ("app.extract.pptx", "PptxExtractor"),
    "md": ("app.extract.md", "MarkdownExtractor"),
    "html": ("app.extract.html", "HtmlExtractor"),
}


def known(kind: str) -> bool:
    return kind in _REGISTRY


def get_extractor(kind: str):
    """Lazily import and instantiate the extractor for `kind`.

    Raises KeyError on unknown kind; raises ImportError if invoked from the
    api container (which doesn't ship the worker-only parser libs).
    """
    if kind not in _REGISTRY:
        raise KeyError(f"unknown material kind: {kind}")
    module_path, class_name = _REGISTRY[kind]
    module = importlib.import_module(module_path)
    return getattr(module, class_name)()
