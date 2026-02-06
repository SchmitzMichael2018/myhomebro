# backend/projects/views/agreements/public.py
from __future__ import annotations

from django.http import Http404
from django.shortcuts import get_object_or_404

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from projects.models import Agreement, Milestone
from projects.services.agreements.public_sign import (
    unsign_public_token,
    apply_homeowner_signature,
    maybe_send_final_copy_after_homeowner_sign,
)
from projects.services.agreements.pdf_stream import serve_public_pdf
from projects.services.agreements.pdf_loader import load_pdf_services
from projects.views.funding import send_funding_link_for_agreement

build_agreement_pdf_bytes, generate_full_agreement_pdf = load_pdf_services()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def send_final_agreement_link_view(request, agreement_id: int):
    # Manual resend ALWAYS sends; the final_link service has its own guard for non-force.
    from projects.services.agreements.final_link import send_final_link_for_agreement

    ag = get_object_or_404(Agreement, pk=agreement_id)
    try:
        payload = send_final_link_for_agreement(ag, force_send=True)
        return Response(payload, status=status.HTTP_200_OK)
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response({"detail": f"Unexpected error: {type(e).__name__}: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_milestones(request, pk: int):
    ag = get_object_or_404(Agreement, pk=pk)
    qs = Milestone.objects.filter(agreement=ag).order_by("order")
    data = [
        {
            "id": m.id,
            "order": m.order,
            "title": m.title,
            "description": m.description,
            "amount": str(m.amount),
            "start_date": m.start_date,
            "completion_date": m.completion_date,
            "duration": m.duration.total_seconds() if m.duration else None,
            "is_invoiced": m.is_invoiced,
            "completed": m.completed,
        }
        for m in qs
    ]
    return Response(data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_pdf(request, agreement_id: int):
    ag = get_object_or_404(Agreement, pk=agreement_id)
    if (not getattr(ag, "pdf_file", None)) or (not getattr(ag.pdf_file, "name", "")):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(ag)
                ag.refresh_from_db()
            except Exception:
                pass

    if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
        try:
            from django.http import FileResponse
            return FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
        except Exception:
            raise Http404("PDF not available")

    raise Http404("PDF not available")


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def agreement_public_sign(request):
    if request.method == "GET":
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "Missing token."}, status=400)

        ag = unsign_public_token(token)
        homeowner = getattr(ag, "homeowner", None)
        contractor = getattr(ag, "contractor", None)

        pdf_url = request.build_absolute_uri(
            f"/api/projects/agreements/public_pdf/?token={token}&stream=1&preview=1"
        )

        data = {
            "id": ag.id,
            "project_title": getattr(ag, "project_title", None)
            or getattr(ag, "title", None)
            or getattr(getattr(ag, "project", None), "title", None)
            or f"Agreement #{ag.id}",
            "homeowner_name": getattr(ag, "homeowner_name", None)
            or getattr(homeowner, "full_name", None)
            or "",
            "contractor_name": getattr(contractor, "business_name", None)
            or getattr(contractor, "full_name", None)
            or "",
            "status": getattr(ag, "status", "draft"),
            "pdf_url": pdf_url,
            "is_fully_signed": bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False)),
        }
        return Response(data, status=200)

    token = request.data.get("token")
    if not token:
        return Response({"detail": "Missing token."}, status=400)

    ag = unsign_public_token(token)

    typed_name = (request.data.get("typed_name") or "").strip()
    if not typed_name:
        return Response({"detail": "Typed name (signature) is required."}, status=400)

    signature_file = request.FILES.get("signature")
    data_url = request.data.get("signature_data_url")

    ip = (
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR")
    )

    try:
        ag, meta = apply_homeowner_signature(
            ag,
            typed_name=typed_name,
            signature_file=signature_file,
            signature_data_url=data_url,
            signed_ip=ip or None,
        )
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    was_homeowner_signed = bool(meta.get("was_homeowner_signed"))

    # After homeowner signs, generate a final PDF if available
    if generate_full_agreement_pdf:
        try:
            generate_full_agreement_pdf(ag)
        except Exception:
            pass

    # Auto-send final copy (guarded)
    maybe_send_final_copy_after_homeowner_sign(ag, was_homeowner_signed=was_homeowner_signed)

    auto_funding = None
    try:
        if bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False)) and not getattr(ag, "escrow_funded", False):
            auto_funding = send_funding_link_for_agreement(ag, request=request)
    except ValueError:
        auto_funding = None
    except Exception:
        auto_funding = None

    resp = {"ok": True}
    if auto_funding:
        resp["funding_link_sent"] = True
        resp["funding"] = auto_funding

    return Response(resp, status=200)


@api_view(["GET"])
@permission_classes([AllowAny])
def agreement_public_pdf(request):
    token = request.query_params.get("token")
    if not token:
        return Response({"detail": "Missing token."}, status=400)

    ag = unsign_public_token(token)
    preview_flag = (request.query_params.get("preview") or "").strip() == "1"
    try:
        return serve_public_pdf(
            ag,
            preview_flag=preview_flag,
            build_agreement_pdf_bytes=build_agreement_pdf_bytes,
            generate_full_agreement_pdf=generate_full_agreement_pdf,
        )
    except Http404 as e:
        raise e
    except Exception as e:
        return Response({"detail": f"PDF error: {e}"}, status=500)
