from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Page:
    no: int
    text_md: str
    images: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)


@dataclass
class ExtractedDoc:
    pages: list[Page]
    title: str | None = None
    detected_language: str | None = None
    word_count: int = 0
    extraction_method: str = ""

    def to_markdown(self) -> str:
        out: list[str] = []
        for page in self.pages:
            out.append(f"## Page {page.no}\n")
            out.append(page.text_md.rstrip())
            out.append("")
        return "\n".join(out).rstrip() + "\n"

    def to_plain_text(self) -> str:
        return "\n\n".join(p.text_md for p in self.pages if p.text_md.strip())


class AbstractExtractor:
    method: str = ""

    def extract(self, path: Path) -> ExtractedDoc:
        raise NotImplementedError
