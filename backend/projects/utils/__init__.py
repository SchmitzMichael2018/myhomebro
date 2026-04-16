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

import os

from django.conf import settings

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

CATEGORY_KEYWORDS = {
    "Remodel - Bath": ["bath", "powder room", "washroom", "restroom", "shower", "en-suite"],
    "Remodel - Kitchen": ["kitchen", "galley", "pantry"],
    "Remodel - Basement": ["basement", "cellar"],
    "Painting - Interior": ["interior", "indoor", "walls", "ceiling", "room"],
    "Painting - Exterior": ["exterior", "outdoor", "siding", "trim", "facade"],
    "Repair - Plumbing": ["plumbing", "pipe", "faucet", "leak", "toilet", "drain"],
    "Repair - Electrical": ["electrical", "outlet", "wiring", "switch", "panel"],
    "Installation - Flooring": ["floor", "flooring", "tile", "hardwood", "laminate", "carpet"],
    "Installation - Appliance": ["appliance", "dishwasher", "oven", "fridge"],
    "Outdoor - Deck/Patio": ["deck", "patio", "porch"],
    "Outdoor - Landscaping": ["landscaping", "yard", "garden", "lawn"],
}

TXT_SOURCE_DIR = os.path.join(settings.BASE_DIR, "..", "frontend", "public", "static", "legal")


def categorize_project(project_type, subtype_text):
    if not subtype_text:
        return project_type
    text = subtype_text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if category.startswith(project_type) and any(k in text for k in keywords):
            return category
    return f"{project_type} - {subtype_text.title()}"


def load_legal_text(filename: str) -> str:
    path = os.path.join(TXT_SOURCE_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Legal source file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

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
    "categorize_project",
    "load_legal_text",
    "append_attachments_to_pdf",
    "AttachmentLike",
]
