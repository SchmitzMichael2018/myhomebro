# backend/projects/pdf_utils.py
import os
from typing import Iterable, Optional

# Prefer PyPDF2, fall back to pypdf if available
try:
    from PyPDF2 import PdfReader, PdfWriter
except Exception:
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
    except Exception as e:
        raise ImportError(
            "PyPDF2 is required for PDF merging.\n"
            "Install with:\n"
            "  source ~/backend/venv/bin/activate && pip install PyPDF2\n"
            "Alternatively, install 'pypdf' and this module will use it."
        ) from e


def append_pdf_attachments(base_pdf_path: str, attachment_filepaths: Iterable[str]) -> Optional[str]:
    """
    Appends each PDF in `attachment_filepaths` to `base_pdf_path`.
    Returns the output pdf path (same directory with '-with-attachments.pdf' suffix).
    Silently skips non-PDF files and missing paths.
    """
    if not os.path.exists(base_pdf_path):
        return None

    writer = PdfWriter()

    # Add base
    with open(base_pdf_path, "rb") as f:
        base_reader = PdfReader(f)
        for page in list(getattr(base_reader, "pages", [])):
            writer.add_page(page)

    # Append attachments
    for p in attachment_filepaths:
        if not p or not os.path.exists(p):
            continue
        if not p.lower().endswith(".pdf"):
            continue
        try:
            with open(p, "rb") as af:
                ar = PdfReader(af)
                for page in list(getattr(ar, "pages", [])):
                    writer.add_page(page)
        except Exception:
            # Skip a single bad PDF rather than failing the whole merge
            continue

    out_path = base_pdf_path.replace(".pdf", "-with-attachments.pdf")
    with open(out_path, "wb") as out:
        writer.write(out)
    return out_path
