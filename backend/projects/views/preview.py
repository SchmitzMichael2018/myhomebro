# backend/projects/views/preview.py
from __future__ import annotations

import io
from datetime import datetime

from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.encoding import smart_str
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from projects.models import Agreement


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def preview_agreement_pdf(request, pk: int):
    """
    GET  /api/projects/agreements/<pk>/preview_pdf/          -> {"url": "<same endpoint>?stream=1"}
    GET  /api/projects/agreements/<pk>/preview_pdf/?stream=1 -> inline PDF preview (fallback if generator absent)
    """
    stream = request.query_params.get("stream")
    if not stream:
        # Front-end expects a JSON envelope with a URL it can open in a new tab
        return JsonResponse({"url": request.build_absolute_uri("?stream=1")}, status=200)

    ag = get_object_or_404(Agreement, pk=pk)

    # If you have a real preview generator, wire it here and return its bytes.
    # from projects.services.pdfs import render_agreement_preview  # noqa
    # pdf_bytes = render_agreement_preview(ag)

    # Minimal, dependency-free fallback so preview never blocks.
    pdf_bytes = _fallback_pdf_bytes(
        title=f"Agreement Preview #{ag.pk}",
        subtitle=smart_str(getattr(ag, "project_title", None) or getattr(ag, "title", None) or "Project"),
    )

    buf = io.BytesIO(pdf_bytes)
    resp = FileResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="agreement_{ag.pk}_preview.pdf"'
    return resp


def _fallback_pdf_bytes(title: str, subtitle: str) -> bytes:
    """
    Tiny one-page PDF (Helvetica text only). Valid and fast; no 3rd-party deps.
    """
    now_txt = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    page_w, page_h = 612, 792  # Letter
    content = f"""BT
/F1 24 Tf
70 720 Td ({_esc(title)}) Tj
/F1 14 Tf
70 695 Td ({_esc(subtitle)}) Tj
/F1 10 Tf
70 60 Td (Preview generated {now_txt}) Tj
ET
"""

    parts = []
    parts.append(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
    parts.append(b"1 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")  # font
    stream = content.encode("latin-1", "ignore")
    parts.append(f"2 0 obj << /Length {len(stream)} >> stream\n".encode("ascii"))
    parts.append(stream)
    parts.append(b"\nendstream endobj\n")  # content
    parts.append(  # page
        f"3 0 obj << /Type /Page /Parent 4 0 R /MediaBox [0 0 {page_w} {page_h}] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >> endobj\n".encode(
            "ascii"
        )
    )
    parts.append(b"4 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n")  # pages
    parts.append(b"5 0 obj << /Type /Catalog /Pages 4 0 R >> endobj\n")  # catalog

    # Build xref
    offsets = [0]
    cur = 0
    for p in parts:
        offsets.append(cur)
        cur += len(p)
    xref = ["xref\n0 6\n0000000000 65535 f \n"]
    for off in offsets[1:]:
        xref.append(f"{off:010} 00000 n \n")
    xref = "".join(xref).encode("ascii")

    pdf = b"".join(parts)
    trailer = b"trailer << /Size 6 /Root 5 0 R >>\nstartxref\n" + str(len(pdf)).encode("ascii") + b"\n%%EOF"
    return pdf + xref + trailer


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
