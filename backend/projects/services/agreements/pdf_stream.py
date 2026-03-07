from __future__ import annotations

import io
import os
import re
import tempfile
from typing import Optional, Callable, Tuple

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.utils.timezone import localtime
from rest_framework.response import Response
from rest_framework import status

from projects.models import Agreement

# ✅ Range support for stored PDF files (fixes iOS/Safari multi-page rendering)
from projects.services.http_range import ranged_file_response


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _parse_range(range_header: str, size: int) -> Optional[Tuple[int, int]]:
    """
    Returns (start, end) inclusive, or None if invalid.
    Supports:
      - bytes=START-END
      - bytes=START-
      - bytes=-SUFFIX
    """
    m = _RANGE_RE.match((range_header or "").strip())
    if not m:
        return None

    start_s, end_s = m.group(1), m.group(2)

    # bytes=-SUFFIX
    if start_s == "" and end_s:
        try:
            suffix = int(end_s)
        except Exception:
            return None
        if suffix <= 0:
            return None
        start = max(0, size - suffix)
        end = size - 1
        return (start, end)

    # bytes=START- or bytes=START-END
    if start_s:
        try:
            start = int(start_s)
        except Exception:
            return None
        if start < 0 or start >= size:
            return None

        if end_s:
            try:
                end = int(end_s)
            except Exception:
                return None
            end = min(end, size - 1)
            if end < start:
                return None
        else:
            end = size - 1

        return (start, end)

    return None


def _base_media_root() -> str:
    """
    MEDIA_ROOT is sometimes empty/misconfigured in deployment.
    Ensure we always have a real writable directory.
    """
    root = getattr(settings, "MEDIA_ROOT", None)
    if root:
        return root

    base_dir = getattr(settings, "BASE_DIR", None)
    if base_dir:
        fallback = os.path.join(str(base_dir), "media")
        os.makedirs(fallback, exist_ok=True)
        return fallback

    # last resort: current working dir
    fallback = os.path.abspath("media")
    os.makedirs(fallback, exist_ok=True)
    return fallback


def _serve_pdf_bytes(pdf_bytes: bytes, *, filename: str) -> FileResponse:
    """
    Default streaming of in-memory PDF bytes.
    """
    buf = io.BytesIO(pdf_bytes)
    buf.seek(0)

    resp = FileResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    resp["Content-Length"] = str(len(pdf_bytes))
    resp["Accept-Ranges"] = "bytes"
    resp["X-Content-Type-Options"] = "nosniff"
    return resp


def _serve_pdf_bytes_range(request, pdf_bytes: bytes, *, filename: str) -> HttpResponse:
    """
    Serve in-memory PDF bytes with HTTP Range support (206 Partial Content).
    Important for iOS/Safari multi-page viewing, even for previews.
    """
    size = len(pdf_bytes)
    try:
        range_header = request.META.get("HTTP_RANGE", "") if request else ""
    except Exception:
        range_header = ""

    disposition = f'inline; filename="{filename}"'

    # No Range -> full response
    if not range_header:
        resp = HttpResponse(pdf_bytes, content_type="application/pdf")
        resp["Content-Disposition"] = disposition
        resp["Content-Length"] = str(size)
        resp["Accept-Ranges"] = "bytes"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp

    parsed = _parse_range(range_header, size)
    if not parsed:
        resp = HttpResponse(status=416)
        resp["Content-Range"] = f"bytes */{size}"
        resp["Accept-Ranges"] = "bytes"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp

    start, end = parsed
    chunk = pdf_bytes[start : end + 1]
    resp = HttpResponse(chunk, status=206, content_type="application/pdf")
    resp["Content-Disposition"] = disposition
    resp["Content-Length"] = str(len(chunk))
    resp["Content-Range"] = f"bytes {start}-{end}/{size}"
    resp["Accept-Ranges"] = "bytes"
    resp["X-Content-Type-Options"] = "nosniff"
    return resp


# ---------------------------------------------------------------------
# ✅ Preview cache (Option B)
# ---------------------------------------------------------------------

def _preview_cache_dir() -> str:
    root = _base_media_root()
    d = os.path.join(root, "agreements", "cache")
    os.makedirs(d, exist_ok=True)
    return d


def _preview_cache_path(ag: Agreement) -> str:
    # Single stable file per agreement; invalidated by updated_at mtime comparison
    return os.path.join(_preview_cache_dir(), f"preview_agreement_{ag.pk}.pdf")


def _agreement_updated_ts(ag: Agreement) -> float:
    """
    Cache invalidation uses agreement.updated_at.
    IMPORTANT: if you update milestones without touching agreement.updated_at,
    preview cache will not invalidate. In that case, touch agreement on milestone save.
    """
    dt = getattr(ag, "updated_at", None) or getattr(ag, "modified", None) or None
    if not dt:
        return 0.0
    try:
        return float(localtime(dt).timestamp())
    except Exception:
        try:
            return float(dt.timestamp())
        except Exception:
            return 0.0


def _file_mtime(path: str) -> float:
    try:
        return float(os.path.getmtime(path))
    except Exception:
        return 0.0


def _atomic_write_bytes(dest_path: str, data: bytes) -> None:
    d = os.path.dirname(dest_path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="._preview_", suffix=".pdf", dir=d)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, dest_path)
    finally:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass


def _serve_file_inline(path: str, *, filename: str) -> FileResponse:
    """
    Basic file response with inline headers (non-range fallback).
    """
    f = open(path, "rb")
    resp = FileResponse(f, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    try:
        resp["Content-Length"] = str(os.path.getsize(path))
    except Exception:
        pass
    resp["Accept-Ranges"] = "bytes"
    resp["X-Content-Type-Options"] = "nosniff"
    return resp


def _serve_cached_file(request, path: str, *, filename: str) -> HttpResponse | FileResponse:
    """
    Stream a cached file. Prefer ranged_file_response when request is present.
    Fall back gracefully if ranged_file_response fails.
    """
    if not path or not os.path.exists(path):
        raise Http404("PDF not available")

    if request is not None:
        try:
            return ranged_file_response(
                request,
                path,
                content_type="application/pdf",
                filename=filename,
                inline=True,
            )
        except Exception:
            # If range handler errors, still serve something
            return _serve_file_inline(path, filename=filename)

    return _serve_file_inline(path, filename=filename)


def _serve_preview_cached(
    agreement: Agreement,
    *,
    request=None,
    build_agreement_pdf_bytes: Callable[..., bytes],
    force_regen: bool = False,
) -> HttpResponse | FileResponse | Response:
    """
    Cache-first preview:
      - Use cached file if newer than agreement.updated_at AND non-empty
      - Else regenerate preview bytes, write cache, stream
    """
    cache_path = _preview_cache_path(agreement)

    # ✅ FIX: treat stale/empty/missing cache as needing regeneration
    need_regen = bool(force_regen)

    if not need_regen:
        if not os.path.exists(cache_path):
            need_regen = True
        else:
            try:
                size_ok = os.path.getsize(cache_path) > 0
                fresh_ok = _file_mtime(cache_path) >= _agreement_updated_ts(agreement)
                if size_ok and fresh_ok:
                    return _serve_cached_file(
                        request,
                        cache_path,
                        filename=f"agreement_{agreement.pk}_preview.pdf",
                    )
                # stale or empty => regen
                need_regen = True
            except Exception:
                need_regen = True

    # Regenerate
    try:
        pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=True)
    except Exception as e:
        return Response(
            {"detail": f"Could not generate preview: {type(e).__name__}: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    try:
        _atomic_write_bytes(cache_path, pdf_bytes)
        return _serve_cached_file(
            request,
            cache_path,
            filename=f"agreement_{agreement.pk}_preview.pdf",
        )
    except Exception:
        # Cache write failed; still serve bytes directly
        if request is not None:
            return _serve_pdf_bytes_range(request, pdf_bytes, filename=f"agreement_{agreement.pk}_preview.pdf")
        return _serve_pdf_bytes(pdf_bytes, filename=f"agreement_{agreement.pk}_preview.pdf")


# ---------------------------------------------------------------------
# Existing main service (now uses preview cache)
# ---------------------------------------------------------------------

def serve_agreement_preview_or_final(
    agreement: Agreement,
    *,
    stream: bool,
    force_preview: bool,
    build_agreement_pdf_bytes: Optional[Callable[..., bytes]],
    generate_full_agreement_pdf: Optional[Callable[..., None]],
    request=None,  # ✅ optional; enables Range support for mobile
) -> Response | FileResponse | HttpResponse:
    """Shared logic for preview_pdf endpoint.

    Rules:
      - If fully signed and not force_preview: serve FINAL (stored file or generated).
      - Otherwise: serve PREVIEW (cached on disk; regenerate only when agreement changed).
      - If stream is false: do NOT return 200 JSON (frontend might treat it as PDF).
    """
    if not stream:
        return Response(
            {"detail": "stream_required", "hint": "Call this endpoint with ?stream=1"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _serve_final_pdf_file(ag: Agreement):
        # ✅ DO NOT regenerate final if already stored; only generate if missing
        if (not getattr(ag, "pdf_file", None)) or (not getattr(getattr(ag, "pdf_file", None), "name", "")):
            if generate_full_agreement_pdf:
                try:
                    generate_full_agreement_pdf(ag)
                    ag.refresh_from_db()
                except Exception as e:
                    return Response(
                        {"detail": f"Could not generate final PDF: {type(e).__name__}: {e}"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

        if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
            try:
                pdf_path = getattr(getattr(ag, "pdf_file", None), "path", None)
                if request is not None and pdf_path:
                    try:
                        return ranged_file_response(
                            request,
                            pdf_path,
                            content_type="application/pdf",
                            filename=f"agreement_{ag.pk}_final.pdf",
                            inline=True,
                        )
                    except Exception:
                        return _serve_file_inline(pdf_path, filename=f"agreement_{ag.pk}_final.pdf")

                try:
                    pdf_path = getattr(ag.pdf_file, "path", None)
                    if pdf_path and os.path.exists(pdf_path):
                        return _serve_file_inline(pdf_path, filename=f"agreement_{ag.pk}_final.pdf")
                except Exception:
                    pass

                resp = FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
                resp["Content-Disposition"] = f'inline; filename="agreement_{ag.pk}_final.pdf"'
                resp["Accept-Ranges"] = "bytes"
                resp["X-Content-Type-Options"] = "nosniff"
                return resp
            except Exception:
                raise Http404("Final PDF not available")

        if build_agreement_pdf_bytes:
            try:
                pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=False)
                if request is not None:
                    return _serve_pdf_bytes_range(request, pdf_bytes, filename=f"agreement_{ag.pk}_final.pdf")
                return _serve_pdf_bytes(pdf_bytes, filename=f"agreement_{ag.pk}_final.pdf")
            except Exception:
                pass

        raise Http404("Final PDF not available")

    is_fully_signed = bool(
        getattr(agreement, "signed_by_contractor", False)
        and getattr(agreement, "signed_by_homeowner", False)
    )
    if is_fully_signed and not force_preview:
        return _serve_final_pdf_file(agreement)

    if not build_agreement_pdf_bytes:
        return Response(
            {"detail": "PDF preview not available.", "hint": "build_agreement_pdf_bytes not configured."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return _serve_preview_cached(
        agreement,
        request=request,
        build_agreement_pdf_bytes=build_agreement_pdf_bytes,
        force_regen=bool(force_preview),
    )


def serve_public_pdf(
    agreement: Agreement,
    *,
    preview_flag: bool,
    build_agreement_pdf_bytes: Optional[Callable[..., bytes]],
    generate_full_agreement_pdf: Optional[Callable[..., None]],
    request=None,  # ✅ optional; enables Range support for mobile
) -> FileResponse | HttpResponse:
    """Shared logic for agreement_public_pdf endpoint."""
    is_fully_signed = bool(
        getattr(agreement, "signed_by_contractor", False)
        and getattr(agreement, "signed_by_homeowner", False)
    )

    if preview_flag or not is_fully_signed:
        if not build_agreement_pdf_bytes:
            raise Http404("PDF preview not available.")
        pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=True)
        if request is not None:
            return _serve_pdf_bytes_range(request, pdf_bytes, filename=f"agreement_{agreement.pk}_preview.pdf")
        return _serve_pdf_bytes(pdf_bytes, filename=f"agreement_{agreement.pk}_preview.pdf")

    if (not getattr(agreement, "pdf_file", None)) or (not getattr(agreement.pdf_file, "name", "")):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(agreement)
                agreement.refresh_from_db()
            except Exception:
                pass

    if getattr(agreement, "pdf_file", None) and getattr(agreement.pdf_file, "name", ""):
        try:
            pdf_path = getattr(getattr(agreement, "pdf_file", None), "path", None)

            if request is not None and pdf_path:
                try:
                    return ranged_file_response(
                        request,
                        pdf_path,
                        content_type="application/pdf",
                        filename=f"agreement_{agreement.pk}_final.pdf",
                        inline=True,
                    )
                except Exception:
                    return _serve_file_inline(pdf_path, filename=f"agreement_{agreement.pk}_final.pdf")

            if pdf_path and os.path.exists(pdf_path):
                return _serve_file_inline(pdf_path, filename=f"agreement_{agreement.pk}_final.pdf")

            resp = FileResponse(agreement.pdf_file.open("rb"), content_type="application/pdf")
            resp["Content-Disposition"] = f'inline; filename="agreement_{agreement.pk}_final.pdf"'
            resp["Accept-Ranges"] = "bytes"
            resp["X-Content-Type-Options"] = "nosniff"
            return resp
        except Exception:
            raise Http404("PDF not available")

    raise Http404("PDF not available")