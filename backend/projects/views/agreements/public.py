# backend/projects/views/agreements/public.py
from __future__ import annotations

from django.http import Http404
from django.shortcuts import get_object_or_404

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from projects.models import Agreement, AgreementAttachment, AgreementFundingLink, Milestone
from projects.serializers.base import AgreementDetailPublicSerializer
from projects.services.agreements.public_sign import (
    unsign_public_token,
    apply_homeowner_signature,
    maybe_send_final_copy_after_homeowner_sign,
)
from projects.services.agreements.pdf_stream import serve_public_pdf
from projects.services.agreements.pdf_loader import load_pdf_services
from projects.views.funding import send_funding_link_for_agreement

# ✅ Range support helper (fixes iOS/Safari "only first page" PDF rendering)
from projects.services.http_range import ranged_file_response

build_agreement_pdf_bytes, generate_full_agreement_pdf = load_pdf_services()


def _contractor_rating_payload(contractor) -> dict:
    if contractor is None:
        return {"average_rating": None, "review_count": 0, "display_label": "New on MyHomeBro"}

    review_count = int(getattr(contractor, "review_count", 0) or 0)
    average_rating = getattr(contractor, "average_rating", None)
    if review_count <= 0:
        ratings = list(
            getattr(contractor, "public_reviews", None)
            and contractor.public_reviews.filter(is_verified=True, is_public=True).values_list("rating", flat=True)
            or []
        )
        if ratings:
            review_count = len(ratings)
            average_rating = sum(ratings) / review_count
    if review_count <= 0:
        return {"average_rating": None, "review_count": 0, "display_label": "New on MyHomeBro"}
    try:
        avg = float(average_rating or 0)
    except Exception:
        avg = 0.0
    return {
        "average_rating": round(avg, 2) if avg else None,
        "review_count": review_count,
        "display_label": f"{avg:.2f} average rating",
    }


def _agreement_visible_attachments(agreement) -> list[dict]:
    rows = []
    try:
        attachments = AgreementAttachment.objects.filter(
            agreement=agreement, visible_to_homeowner=True
        ).order_by("-uploaded_at", "-id")
    except Exception:
        return rows

    for attachment in attachments:
        file_obj = getattr(attachment, "file", None)
        file_url = ""
        try:
            file_url = getattr(file_obj, "url", "") or ""
        except Exception:
            file_url = ""
        rows.append(
            {
                "id": attachment.id,
                "title": getattr(attachment, "title", "") or "Attachment",
                "category": getattr(attachment, "category", "") or "OTHER",
                "url": file_url,
                "visible_to_homeowner": bool(getattr(attachment, "visible_to_homeowner", False)),
            }
        )
    return rows


def _active_public_funding_link(agreement) -> AgreementFundingLink | None:
    try:
        return (
            AgreementFundingLink.objects.filter(
                agreement=agreement,
                is_active=True,
                used_at__isnull=True,
            )
            .order_by("-created_at", "-id")
            .first()
        )
    except Exception:
        return None


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
        return Response(
            {"detail": f"Unexpected error: {type(e).__name__}: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


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
    """
    Serve the final agreement PDF (authenticated).
    ✅ Uses HTTP Range support when possible to fix mobile multi-page rendering (iOS/Safari).
    """
    ag = get_object_or_404(Agreement, pk=agreement_id)

    # If missing, try generating a full PDF first
    if (not getattr(ag, "pdf_file", None)) or (not getattr(ag.pdf_file, "name", "")):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(ag)
                ag.refresh_from_db()
            except Exception:
                pass

    if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
        try:
            # Prefer ranged response if storage provides a filesystem path (most common on PythonAnywhere)
            pdf_path = getattr(getattr(ag, "pdf_file", None), "path", None)
            if pdf_path:
                return ranged_file_response(
                    request,
                    pdf_path,
                    content_type="application/pdf",
                    filename=f"agreement_{ag.id}.pdf",
                    inline=True,
                )

            # Fallback: stream without ranges if .path not available (e.g., remote storage)
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
        project = getattr(ag, "project", None)
        funding_link = _active_public_funding_link(ag)

        review_payload = AgreementDetailPublicSerializer(ag, context={"request": request}).data
        milestone_rows = [
            {
                "id": m.id,
                "order": m.order,
                "title": getattr(m, "title", "") or f"Milestone {m.order}",
                "description": getattr(m, "description", "") or "",
                "amount": str(getattr(m, "amount", "") or "0.00"),
                "start_date": getattr(m, "start_date", None),
                "completion_date": getattr(m, "completion_date", None),
            }
            for m in Milestone.objects.filter(agreement=ag).order_by("order", "id")
        ]

        pdf_url = request.build_absolute_uri(
            f"/api/projects/agreements/public_pdf/?token={token}&stream=1&preview=1"
        )

        data = dict(review_payload)
        data.update(
            {
                "id": ag.id,
                "project_title": getattr(ag, "project_title", None)
                or getattr(ag, "title", None)
                or getattr(project, "title", None)
                or f"Agreement #{ag.id}",
                "project_summary": getattr(ag, "scope_summary", None)
                or getattr(ag, "description", None)
                or getattr(project, "description", None)
                or "",
                "homeowner_name": getattr(ag, "homeowner_name", None)
                or getattr(homeowner, "full_name", None)
                or "",
                "homeowner_email": getattr(homeowner, "email", None) or "",
                "contractor_name": getattr(contractor, "business_name", None)
                or getattr(contractor, "full_name", None)
                or "",
                "contractor_email": getattr(getattr(contractor, "user", None), "email", "")
                or getattr(contractor, "email", "")
                or "",
                "contractor_rating": _contractor_rating_payload(contractor),
                "status": getattr(ag, "status", "draft"),
                "pdf_url": pdf_url,
                "milestones": milestone_rows,
                "attachments": _agreement_visible_attachments(ag),
                "funding_token": getattr(funding_link, "token", "") if funding_link else "",
                "public_fund_url": (
                    request.build_absolute_uri(f"/public-fund/{funding_link.token}")
                    if funding_link
                    else ""
                ),
                "is_fully_signed": bool(
                    getattr(ag, "signed_by_contractor", False)
                    and getattr(ag, "signed_by_homeowner", False)
                ),
            }
        )
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
        if (
            bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))
            and not getattr(ag, "escrow_funded", False)
        ):
            auto_funding = send_funding_link_for_agreement(ag, request=request)
    except ValueError:
        auto_funding = None
    except Exception:
        auto_funding = None

    resp = {"ok": True}
    if auto_funding:
        resp["funding_link_sent"] = True
        resp["funding"] = auto_funding
        resp["funding_token"] = auto_funding.get("public_fund_url", "").rstrip("/").rsplit("/", 1)[-1]
        resp["public_fund_url"] = auto_funding.get("public_fund_url", "")

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
        # Note: serve_public_pdf() may still need Range support internally as well.
        # If mobile still only shows page 1 on the PUBLIC preview URL, we'll patch pdf_stream.py next.
        return serve_public_pdf(
            ag,
            preview_flag=preview_flag,
            build_agreement_pdf_bytes=build_agreement_pdf_bytes,
            generate_full_agreement_pdf=generate_full_agreement_pdf,
            request=request,
        )
    except Http404 as e:
        raise e
    except Exception as e:
        return Response({"detail": f"PDF error: {e}"}, status=500)
