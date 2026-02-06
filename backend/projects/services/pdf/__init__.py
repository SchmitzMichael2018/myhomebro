# backend/projects/services/pdf/__init__.py
"""
PDF service package.

We intentionally re-export the public functions so callers can do:

  from projects.services.pdf import build_agreement_pdf_bytes, generate_full_agreement_pdf
"""

from .agreement_pdf import build_agreement_pdf_bytes, generate_full_agreement_pdf  # noqa: F401

__all__ = [
  "build_agreement_pdf_bytes",
  "generate_full_agreement_pdf",
]
