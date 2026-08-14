from __future__ import annotations

from pathlib import Path

import frontmatter

from app.extract.base import AbstractExtractor, ExtractedDoc, Page


class MarkdownExtractor(AbstractExtractor):
    method = "python-frontmatter"

    def extract(self, path: Path) -> ExtractedDoc:
        post = frontmatter.load(str(path))
        body = (post.content or "").strip()
        title: str | None = None
        meta_title = post.metadata.get("title") if isinstance(post.metadata, dict) else None
        if isinstance(meta_title, str) and meta_title.strip():
            title = meta_title.strip()
        elif body.startswith("# "):
            title = body.splitlines()[0].lstrip("# ").strip() or None
        page = Page(no=1, text_md=body)
        return ExtractedDoc(
            pages=[page],
            title=title,
            word_count=len(body.split()),
            extraction_method=self.method,
        )
