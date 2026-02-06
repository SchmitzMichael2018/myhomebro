# backend/projects/services/agreements/pdf_stream.py
from __future__ import annotations

import io
from typing import Optional, Callable

from django.http import FileResponse, Http404
from rest_framework.response import Response
from rest_framework import status

from projects.models import Agreement


def _serve_pdf_bytes(pdf_bytes: bytes, *, filename: str) -> FileResponse:
    buf = io.BytesIO(pdf_bytes)
    resp = FileResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    return resp


def serve_agreement_preview_or_final(
    agreement: Agreement,
    *,
    stream: bool,
    force_preview: bool,
    build_agreement_pdf_bytes: Optional[Callable[..., bytes]],
    generate_full_agreement_pdf: Optional[Callable[..., None]],
) -> Response | FileResponse:
    """Shared logic for preview_pdf endpoint.

    Rules:
      - If fully signed and not force_preview: serve FINAL (stored file or generated).
      - Otherwise: serve PREVIEW bytes (watermark).
      - If stream is false: return a JSON response with a ?stream=1 url is handled by caller.
    """
    if not stream:
        # Caller should handle the url wrapper; return sentinel Response.
        return Response({"detail": "stream_required"}, status=status.HTTP_200_OK)

    def _serve_final_pdf_file(ag: Agreement):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(ag)
                ag.refresh_from_db()
            except Exception as e:
                return Response({"detail": f"Could not generate final PDF: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
            try:
                return FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
            except Exception:
                raise Http404("Final PDF not available")

        if build_agreement_pdf_bytes:
            try:
                pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=False)
                return _serve_pdf_bytes(pdf_bytes, filename=f"agreement_{ag.pk}_final.pdf")
            except Exception:
                pass

        raise Http404("Final PDF not available")

    if bool(getattr(agreement, "signed_by_contractor", False) and getattr(agreement, "signed_by_homeowner", False)) and not force_preview:
        return _serve_final_pdf_file(agreement)

    if not build_agreement_pdf_bytes:
        return Response({"detail": "PDF preview not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    try:
        pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=True)
    except Exception as e:
        return Response({"detail": f"Could not generate preview: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return _serve_pdf_bytes(pdf_bytes, filename=f"agreement_{agreement.pk}_preview.pdf")


def serve_public_pdf(
    agreement: Agreement,
    *,
    preview_flag: bool,
    build_agreement_pdf_bytes: Optional[Callable[..., bytes]],
    generate_full_agreement_pdf: Optional[Callable[..., None]],
) -> FileResponse:
    """Shared logic for agreement_public_pdf endpoint."""
    if preview_flag or not bool(getattr(agreement, "signed_by_contractor", False) and getattr(agreement, "signed_by_homeowner", False)):
        if not build_agreement_pdf_bytes:
            raise Http404("PDF preview not available.")
        pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=True)
        return _serve_pdf_bytes(pdf_bytes, filename=f"agreement_{agreement.pk}_preview.pdf")

    # final
    if (not getattr(agreement, "pdf_file", None)) or (not getattr(agreement.pdf_file, "name", "")):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(agreement)
                agreement.refresh_from_db()
            except Exception:
                pass

    if getattr(agreement, "pdf_file", None) and getattr(agreement.pdf_file, "name", ""):
        try:
            return FileResponse(agreement.pdf_file.open("rb"), content_type="application/pdf")
        except Exception:
            raise Http404("PDF not available")

    raise Http404("PDF not available")
