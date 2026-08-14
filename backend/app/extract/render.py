"""Page rasterisation for AI (vision) extraction — worker-only.

Step 1 of two-step AI extraction: turn a binary document into one PNG per
page. PDFs render directly via pdf2image; Office formats are converted to PDF
with headless LibreOffice first. Imported lazily (heavy deps + a system binary).
"""
from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from pathlib import Path

RENDERABLE = {".pdf", ".pptx", ".ppt", ".docx", ".doc"}
_LIBREOFFICE = {".pptx", ".ppt", ".docx", ".doc"}


def _libreoffice_to_pdf(src: Path, out_dir: Path) -> Path:
    """Convert an Office file to a PDF inside `out_dir`; return the PDF path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        # A per-invocation profile dir — headless LibreOffice instances otherwise
        # collide on a shared profile lock when the worker runs jobs in parallel.
        profile = Path(tmp) / "loprofile"
        proc = subprocess.run(
            [
                "libreoffice",
                f"-env:UserInstallation=file://{profile}",
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                tmp,
                str(src),
            ],
            capture_output=True,
            timeout=300,
        )
        pdfs = list(Path(tmp).glob("*.pdf"))
        if not pdfs:
            detail = (proc.stderr or proc.stdout or b"").decode(errors="replace")[:300]
            raise RuntimeError(f"libreoffice produced no pdf: {detail}")
        dest = out_dir / f"{src.stem}.pdf"
        shutil.copyfile(pdfs[0], dest)
        return dest


def ensure_pdf(src: Path, work_dir: Path) -> Path:
    """Return a PDF for `src`: `src` itself if already a PDF, else a LibreOffice
    conversion saved into `work_dir`. Lets a figure be cropped from the PDF source."""
    if src.suffix.lower() == ".pdf":
        return src
    if src.suffix.lower() not in _LIBREOFFICE:
        raise ValueError(f"cannot convert {src.suffix} to pdf")
    return _libreoffice_to_pdf(src, work_dir)


def _pil_to_png(image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def render_pdf(path: Path, dpi: int = 150) -> list[bytes]:
    from pdf2image import convert_from_path

    return [_pil_to_png(im) for im in convert_from_path(str(path), dpi=dpi)]


def render_via_libreoffice(path: Path, dpi: int = 150) -> list[bytes]:
    with tempfile.TemporaryDirectory() as tmp:
        return render_pdf(_libreoffice_to_pdf(path, Path(tmp)), dpi=dpi)


def render_pages(path: Path, dpi: int = 150) -> list[bytes]:
    """Return one PNG per page/slide of a binary document."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return render_pdf(path, dpi)
    if suffix in _LIBREOFFICE:
        return render_via_libreoffice(path, dpi)
    raise ValueError(f"cannot rasterise {suffix} for vision extraction")
