from __future__ import annotations

import io
import mimetypes
from dataclasses import dataclass
from typing import Iterable, Optional

from django.core.files.storage import default_storage

from PyPDF2 import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
PDF_EXTS = {".pdf"}


@dataclass
class AttachmentLike:
    """Minimal interface we need from your Attachment model instances."""
    title: str
    visible: bool
    file_path: str   # storage path or absolute path


def _guess_ext(path: str) -> str:
    path = (path or "").lower()
    for ext in PDF_EXTS | IMAGE_EXTS:
        if path.endswith(ext):
            return ext
    # fallback using mimetypes
    mt, _ = mimetypes.guess_type(path)
    if (mt or "").startswith("image/"):
        return ".png"
    return ".pdf"


def _image_to_single_page_pdf(image_bytes: bytes, title: Optional[str] = None) -> bytes:
    """
    Convert an image (bytes) into a 1-page PDF (letter size).
    Keeps aspect ratio and centers on the page.
    """
    # Load with PIL to get dimensions
    img = Image.open(io.BytesIO(image_bytes))
    img_width, img_height = img.size

    # Create a PDF page
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    page_w, page_h = letter

    # Fit image within margins keeping aspect
    max_w = page_w - 72  # 0.5" margins
    max_h = page_h - 108  # leave top space for optional title
    scale = min(max_w / img_width, max_h / img_height, 1.0)
    draw_w = img_width * scale
    draw_h = img_height * scale
    x = (page_w - draw_w) / 2
    y = (page_h - draw_h) / 2 - 18  # nudge a bit lower if we render title

    # Optional title
    if title:
      c.setFont("Helvetica-Bold", 11)
      c.drawCentredString(page_w/2, page_h - 54, title.strip())

    # Save PIL image to temporary bytes that reportlab can draw
    tmp = io.BytesIO()
    fmt = "PNG"  # normalize to PNG for reportlab
    img.convert("RGB").save(tmp, format=fmt)
    tmp.seek(0)

    # Draw
    c.drawImage(tmp, x, y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask='auto')
    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()


def append_attachments_to_pdf(
    base_pdf_bytes: bytes,
    attachments: Iterable[AttachmentLike],
) -> bytes:
    """
    Return a new PDF: [base_pdf] + [each visible attachment as pages].
    - PDFs are concatenated as-is.
    - Images are converted to single-page PDFs first.
    """
    writer = PdfWriter()

    # Start with the base agreement PDF
    base_reader = PdfReader(io.BytesIO(base_pdf_bytes))
    for p in base_reader.pages:
        writer.add_page(p)

    # Append each visible attachment
    for att in attachments:
        if not att.visible:
            continue

        path = att.file_path
        if not path:
            continue

        # Retrieve bytes from your storage
        try:
            with default_storage.open(path, "rb") as f:
                raw = f.read()
        except Exception:
            # Skip if not readable
            continue

        ext = _guess_ext(path)

        try:
            if ext in PDF_EXTS:
                reader = PdfReader(io.BytesIO(raw))
                for p in reader.pages:
                    writer.add_page(p)
            elif ext in IMAGE_EXTS:
                one_page_pdf = _image_to_single_page_pdf(raw, title=att.title)
                reader = PdfReader(io.BytesIO(one_page_pdf))
                for p in reader.pages:
                    writer.add_page(p)
            else:
                # Unknown => try to treat as PDF
                reader = PdfReader(io.BytesIO(raw))
                for p in reader.pages:
                    writer.add_page(p)
        except Exception:
            # If any individual attachment fails, skip it and continue
            continue

    out = io.BytesIO()
    writer.write(out)
    out.seek(0)
    return out.read()
