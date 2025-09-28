# backend/projects/views/agreement.py
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import permissions, viewsets, decorators, status
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from projects.models import Agreement, Milestone, ProjectStatus
from projects.serializers import AgreementSerializer

import os
from pathlib import Path

try:
    from weasyprint import HTML
    HAVE_WEASY = True
except Exception:
    HAVE_WEASY = False


class IsAgreementOwner(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        # Contractor must own the Agreement via Project/Contractor.user
        try:
            proj = getattr(obj, "project", None)
            contractor = getattr(proj, "contractor", None)
            return contractor and contractor.user_id == request.user.id
        except Exception:
            return False

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)


class AgreementViewSet(viewsets.ModelViewSet):
    """
    /api/projects/agreements/
    - GET: list only my agreements
    - PATCH: allow edits while DRAFT (type/subtype/description/title/warranty)
    - Actions:
        * preview_html (GET)  -> raw HTML preview
        * preview_pdf  (POST) -> generates + stores a PDF, returns {"pdf_url": "..."}
    """
    serializer_class = AgreementSerializer
    permission_classes = [IsAgreementOwner]

    def get_queryset(self):
        # Limit to agreements that belong to the logged-in contractor
        return Agreement.objects.filter(project__contractor__user=self.request.user).order_by("-updated_at")

    def partial_update(self, request, *args, **kwargs):
        ag: Agreement = self.get_object()

        # Enforce "edits only in DRAFT"
        if ag.status != ProjectStatus.DRAFT:
            raise ValidationError("Agreement is not in DRAFT. Create an amendment to change details.")

        return super().partial_update(request, *args, **kwargs)

    # ---------- Preview (HTML) ----------
    @decorators.action(detail=True, methods=["get"], url_path="preview_html")
    def preview_html(self, request, pk=None):
        ag = self.get_object()
        ms = ag.milestones.all().order_by("order", "id")
        html = render_to_string("agreements/preview.html", {
            "agreement": ag,
            "milestones": ms,
            "generated_at": timezone.now(),
        })
        return HttpResponse(html, content_type="text/html; charset=utf-8")

    # ---------- Preview (PDF) ----------
    @decorators.action(detail=True, methods=["post"], url_path="preview_pdf")
    def preview_pdf(self, request, pk=None):
        """
        Builds a PDF and saves it under MEDIA_ROOT/agreements/pdf/.
        Returns: {"pdf_url": "<MEDIA_URL>/agreements/pdf/agreement_<id>_preview_v<version>.pdf"}
        """
        ag = self.get_object()
        ms = ag.milestones.all().order_by("order", "id")

        # Render HTML using the same template as HTML preview
        html_str = render_to_string("agreements/preview.html", {
            "agreement": ag,
            "milestones": ms,
            "generated_at": timezone.now(),
        })

        # Ensure target dir
        media_root = Path(getattr(settings, "MEDIA_ROOT", "media"))
        rel_dir = Path("agreements") / "pdf"
        out_dir = media_root / rel_dir
        out_dir.mkdir(parents=True, exist_ok=True)

        # Versioning for preview artifacts
        version = int(getattr(ag, "pdf_version", 1) or 1)
        out_name = f"agreement_{ag.id}_preview_v{version}.pdf"
        out_path = out_dir / out_name

        if not HAVE_WEASY:
            # Fallback: store HTML instead so user still gets a preview artifact
            out_name = f"agreement_{ag.id}_preview_v{version}.html"
            out_path = out_dir / out_name
            out_path.write_text(html_str, encoding="utf-8")
            pdf_url = f"{getattr(settings,'MEDIA_URL','/media/')}{rel_dir.as_posix()}/{out_name}"
            return JsonResponse({"pdf_url": pdf_url})

        # Generate PDF
        HTML(string=html_str, base_url=request.build_absolute_uri("/")).write_pdf(target=str(out_path))

        # Return URL
        media_url = getattr(settings, "MEDIA_URL", "/media/")
        pdf_url = f"{media_url}{rel_dir.as_posix()}/{out_name}"

        # Optionally bump preview version so each click overwrites a fresh file name next time
        try:
            ag.pdf_version = version + 1
            ag.save(update_fields=["pdf_version", "updated_at"])
        except Exception:
            pass

        return JsonResponse({"pdf_url": pdf_url}, status=status.HTTP_200_OK)
