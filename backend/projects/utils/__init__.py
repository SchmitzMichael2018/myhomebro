# backend/projects/utils/__init__.py
"""
Compatibility shim that re-exports PDF generators and helpers.

Guarantees these names always exist:
  - build_agreement_pdf_bytes
  - generate_full_agreement_pdf
  - generate_invoice_pdf
  - append_attachments_to_pdf
  - AttachmentLike

We try multiple module paths so legacy imports continue working.
"""

from __future__ import annotations

# -------------------------
# Defaults (always defined)
# -------------------------
def _missing(*_args, **_kwargs):  # pragma: no cover
    raise RuntimeError(
        "Requested PDF function is not available. "
        "Check your projects.services/pdf modules and imports."
    )

build_agreement_pdf_bytes = _missing
generate_full_agreement_pdf = _missing
generate_invoice_pdf = _missing

# -------------------------
# Try likely implementations
# -------------------------
# 1) Consolidated service module
try:
    from projects.services.pdf import (  # type: ignore
        build_agreement_pdf_bytes as _b1,
        generate_full_agreement_pdf as _g1,
        generate_invoice_pdf as _i1,
    )
    build_agreement_pdf_bytes = _b1
    generate_full_agreement_pdf = _g1
    generate_invoice_pdf = _i1
except Exception:
    pass

# 2) Older single module: projects.pdf
try:
    from projects.pdf import (  # type: ignore
        build_agreement_pdf_bytes as _b2,
        generate_full_agreement_pdf as _g2,
    )
    build_agreement_pdf_bytes = _b2
    generate_full_agreement_pdf = _g2
except Exception:
    pass

# 3) Split modules
try:
    from projects.services.agreement_pdf import (  # type: ignore
        build_agreement_pdf_bytes as _b3,
        generate_full_agreement_pdf as _g3,
    )
    build_agreement_pdf_bytes = _b3
    generate_full_agreement_pdf = _g3
except Exception:
    pass

try:
    from projects.services.invoice_pdf import (  # type: ignore
        generate_invoice_pdf as _i3,
    )
    generate_invoice_pdf = _i3
except Exception:
    pass

# -------------------------
# Attachment merge helpers
# -------------------------
try:
    from .pdf_merge_helpers import (  # type: ignore
        append_attachments_to_pdf,
        AttachmentLike,
    )
except Exception:  # provide harmless stubs
    append_attachments_to_pdf = None  # type: ignore

    class AttachmentLike:  # type: ignore
        def __init__(self, *args, **kwargs):
            raise RuntimeError("AttachmentLike helper not available")

__all__ = [
    "build_agreement_pdf_bytes",
    "generate_full_agreement_pdf",
    "generate_invoice_pdf",
    "append_attachments_to_pdf",
    "AttachmentLike",
]
