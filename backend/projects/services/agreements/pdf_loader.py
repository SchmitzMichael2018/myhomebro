# backend/projects/services/agreements/pdf_loader.py
from __future__ import annotations

import os
import logging
import traceback
from typing import Optional, Tuple, Callable

from django.conf import settings
from projects.models import Agreement

logger = logging.getLogger(__name__)


def _safe_media_root() -> str:
    """
    Ensure MEDIA_ROOT is always an absolute, writable directory.
    PythonAnywhere deployments sometimes leave MEDIA_ROOT empty.
    """
    mr = getattr(settings, "MEDIA_ROOT", None)
    if mr:
        try:
            os.makedirs(mr, exist_ok=True)
        except Exception:
            pass
        return mr

    base_dir = getattr(settings, "BASE_DIR", None)
    if base_dir:
        fallback = os.path.join(str(base_dir), "media")
        os.makedirs(fallback, exist_ok=True)
        return fallback

    fallback = os.path.abspath("media")
    os.makedirs(fallback, exist_ok=True)
    return fallback


def _abs_media_path(rel_path: str) -> Optional[str]:
    if not rel_path:
        return None
    rel_path = str(rel_path).lstrip("/").lstrip("\\")
    mr = _safe_media_root()
    return os.path.join(mr, rel_path)


def load_pdf_services() -> Tuple[Optional[Callable[..., bytes]], Optional[Callable[..., None]]]:
    """
    Return (build_agreement_pdf_bytes, generate_full_agreement_pdf).

    This version logs real import failures instead of swallowing them,
    and avoids returning invalid "fake PDF bytes" that break viewers.
    """

    # ------------------------------------------------------------------
    # Preferred service: projects.services.pdf
    # ------------------------------------------------------------------
    try:
        from projects.services.pdf import (
            build_agreement_pdf_bytes as _svc_build_bytes,
            generate_full_agreement_pdf as _svc_generate_full,
        )

        if not callable(_svc_build_bytes):
            raise RuntimeError("projects.services.pdf.build_agreement_pdf_bytes is not callable")
        # _svc_generate_full may be optional, but if present should be callable
        if _svc_generate_full is not None and not callable(_svc_generate_full):
            raise RuntimeError("projects.services.pdf.generate_full_agreement_pdf is not callable")

        logger.info("PDF services loaded from projects.services.pdf")
        return _svc_build_bytes, _svc_generate_full

    except Exception as e:
        logger.error("PDF import failed: projects.services.pdf")
        logger.error("Exception: %r", e)
        traceback.print_exc()

    # ------------------------------------------------------------------
    # Fallback adapter: projects.utils.pdf.generate_full_agreement_pdf
    # ------------------------------------------------------------------
    try:
        from projects.utils.pdf import generate_full_agreement_pdf as _utils_generate_full
        from django.core.files.base import ContentFile

        if not callable(_utils_generate_full):
            raise RuntimeError("projects.utils.pdf.generate_full_agreement_pdf is not callable")

        def _fallback_build_bytes(ag: Agreement, is_preview: bool = True) -> bytes:
            """
            Expect _utils_generate_full to return a RELATIVE media path.
            """
            rel_path = _utils_generate_full(ag.id, preview=bool(is_preview))  # ✅ FIXED
            abs_path = _abs_media_path(rel_path)

            if not abs_path or not os.path.exists(abs_path):
                raise RuntimeError(
                    f"PDF generator returned a path that does not exist. rel_path={rel_path!r} abs_path={abs_path!r}"
                )

            with open(abs_path, "rb") as fh:
                data = fh.read()

            # basic sanity check: should start with %PDF
            if not (data[:4] == b"%PDF"):
                raise RuntimeError(
                    f"Generated file is not a valid PDF (missing %PDF header). abs_path={abs_path!r}"
                )

            return data

        def _fallback_generate_full(ag: Agreement):
            version = int(getattr(ag, "pdf_version", 0) or 0) + 1

            rel_path = _utils_generate_full(ag.id, preview=False)
            abs_path = _abs_media_path(rel_path)

            if not abs_path or not os.path.exists(abs_path):
                raise RuntimeError(
                    f"PDF generator returned a path that does not exist. rel_path={rel_path!r} abs_path={abs_path!r}"
                )

            with open(abs_path, "rb") as fh:
                data = fh.read()

            if not (data[:4] == b"%PDF"):
                raise RuntimeError(
                    f"Generated file is not a valid PDF (missing %PDF header). abs_path={abs_path!r}"
                )

            content = ContentFile(data, name=os.path.basename(abs_path))
            ag.pdf_file.save(content.name, content, save=True)

            if hasattr(ag, "pdf_version"):
                ag.pdf_version = version
                ag.save(update_fields=["pdf_version", "pdf_file"])

        logger.warning("PDF services loaded from projects.utils.pdf fallback")
        return _fallback_build_bytes, _fallback_generate_full

    except Exception as e:
        logger.error("Fallback PDF import failed: projects.utils.pdf")
        logger.error("Exception: %r", e)
        traceback.print_exc()

    logger.critical("PDF services could not be loaded — preview will 503.")
    return None, None