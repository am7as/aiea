from __future__ import annotations

from pathlib import Path

import docx

from app.extract.base import AbstractExtractor, ExtractedDoc, Page


_HEADING_STYLES = {
    "Heading 1": 1,
    "Heading 2": 2,
    "Heading 3": 3,
    "Heading 4": 4,
    "Heading 5": 5,
    "Heading 6": 6,
}


class DocxExtractor(AbstractExtractor):
    method = "python-docx"

    def extract(self, path: Path) -> ExtractedDoc:
        document = docx.Document(str(path))
        lines: list[str] = []
        title: str | None = None
        for para in document.paragraphs:
            text = (para.text or "").rstrip()
            if not text:
                lines.append("")
                continue
            level = _HEADING_STYLES.get(para.style.name if para.style else "")
            if level:
                if level == 1 and title is None:
                    title = text
                lines.append(f"{'#' * level} {text}")
            else:
                lines.append(text)
        body = "\n".join(lines).strip()
        page = Page(no=1, text_md=body)
        return ExtractedDoc(
            pages=[page],
            title=title,
            word_count=len(body.split()),
            extraction_method=self.method,
        )
