# backend/projects/services/agreements/pdf_loader.py
from __future__ import annotations

import os
from typing import Optional, Tuple, Callable

from django.conf import settings
from django.core.files.base import ContentFile

from projects.models import Agreement


def _abs_media_path(rel_path: str) -> Optional[str]:
    if not rel_path:
        return None
    mr = getattr(settings, "MEDIA_ROOT", "") or ""
    return os.path.join(mr, rel_path)


def load_pdf_services() -> Tuple[Optional[Callable[..., bytes]], Optional[Callable[..., None]]]:
    """Return (build_agreement_pdf_bytes, generate_full_agreement_pdf).

    Prefers projects.services.pdf, falls back to projects.utils.pdf adapter.
    """
    build_agreement_pdf_bytes = None
    generate_full_agreement_pdf = None

    # Preferred service
    try:
        from projects.services.pdf import (  # type: ignore
            build_agreement_pdf_bytes as _svc_build_bytes,
            generate_full_agreement_pdf as _svc_generate_full,
        )
        build_agreement_pdf_bytes = _svc_build_bytes
        generate_full_agreement_pdf = _svc_generate_full
        return build_agreement_pdf_bytes, generate_full_agreement_pdf
    except Exception:
        pass

    # Fallback utils adapter
    try:
        from projects.utils.pdf import generate_full_agreement_pdf as _utils_generate_full  # type: ignore
        from django.core.files.base import ContentFile as _CF  # local alias

        def _fallback_build_bytes(ag: Agreement, is_preview: bool = True) -> bytes:
            rel_path = _utils_generate_full(ag.id, preview=True)
            abs_path = _abs_media_path(rel_path)
            if not abs_path or not os.path.exists(abs_path):
                return b"%PDF-1.4\n% Empty preview\n"
            with open(abs_path, "rb") as fh:
                return fh.read()

        def _fallback_generate_full(ag: Agreement):
            version = int(getattr(ag, "pdf_version", 0) or 0) + 1
            rel_path = _utils_generate_full(ag.id, preview=False)
            abs_path = _abs_media_path(rel_path)
            if not abs_path or not os.path.exists(abs_path):
                raise RuntimeError("PDF generator returned a path that does not exist.")
            with open(abs_path, "rb") as fh:
                content = _CF(fh.read(), name=os.path.basename(abs_path))
                ag.pdf_file.save(content.name, content, save=True)
            if hasattr(ag, "pdf_version"):
                ag.pdf_version = version
                ag.save(update_fields=["pdf_version", "pdf_file"])

        build_agreement_pdf_bytes = _fallback_build_bytes
        generate_full_agreement_pdf = _fallback_generate_full
        return build_agreement_pdf_bytes, generate_full_agreement_pdf
    except Exception:
        return None, None
