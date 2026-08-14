"""HTML extractor — course descriptions and other simple HTML documents.

Worker-only, but stdlib-only (`html.parser`) so it carries no extra dependency.
Imported lazily via app.extract.registry.
"""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

from app.extract.base import AbstractExtractor, ExtractedDoc, Page

_SKIP_TAGS = {"script", "style", "noscript", "nav", "header", "footer", "aside"}
_BLOCK_TAGS = {
    "p", "div", "section", "article", "header", "footer", "br",
    "ul", "ol", "table", "tr", "blockquote",
}
_HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


class _HtmlToMarkdown(HTMLParser):
    """Flattens HTML into heading-aware Markdown-ish text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.headings: list[str] = []
        self.title: str | None = None
        self._skip = 0
        self._heading_level: int | None = None
        self._in_title = False
        self._buf: list[str] = []

    def _take(self) -> str:
        text = " ".join("".join(self._buf).split())
        self._buf = []
        return text

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = True
        elif tag in _HEADING_TAGS:
            self._append(self._take())
            self._heading_level = _HEADING_TAGS[tag]
        elif tag == "li":
            self._append(self._take())
        elif tag in _BLOCK_TAGS:
            self._append(self._take())

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if not self._skip and tag == "br":
            self._append(self._take())

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = False
        elif tag in _HEADING_TAGS:
            text = self._take()
            if text:
                self.lines.append(f"{'#' * (self._heading_level or 1)} {text}")
                self.headings.append(text)
            self._heading_level = None
        elif tag == "li":
            text = self._take()
            if text:
                self.lines.append(f"- {text}")
        elif tag in _BLOCK_TAGS:
            self._append(self._take())

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._in_title:
            stripped = data.strip()
            if stripped and not self.title:
                self.title = stripped
            return
        self._buf.append(data)

    def _append(self, text: str) -> None:
        if text:
            self.lines.append(text)

    def result(self) -> str:
        self._append(self._take())
        return "\n\n".join(self.lines).strip()


class HtmlExtractor(AbstractExtractor):
    method = "stdlib-html.parser"

    def extract(self, path: Path) -> ExtractedDoc:
        raw = path.read_text(encoding="utf-8", errors="replace")
        parser = _HtmlToMarkdown()
        parser.feed(raw)
        parser.close()
        body = parser.result()
        title = parser.title or (parser.headings[0] if parser.headings else None)
        page = Page(no=1, text_md=body, headings=parser.headings)
        return ExtractedDoc(
            pages=[page],
            title=title,
            word_count=len(body.split()),
            extraction_method=self.method,
        )
