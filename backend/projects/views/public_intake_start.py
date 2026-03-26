from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ContractorPublicProfile, PublicContractorLead
from projects.models_project_intake import ProjectIntake
from projects.services.intake_public import build_public_intake_url
from projects.services.public_lead_pipeline import normalize_public_lead_source


class PublicIntakeStartView(APIView):
    """
    Starts a brand-new public intake from the landing page.

    POST /api/projects/public-intake/start/

    Creates a draft intake, generates a share token, and returns the tokenized public URL.
    """
    permission_classes = []

    def post(self, request, *args, **kwargs):
        customer_name = (request.data.get("customer_name") or "").strip()
        customer_email = (request.data.get("customer_email") or "").strip()
        customer_phone = (request.data.get("customer_phone") or "").strip()
        contractor_slug = (
            request.data.get("contractor_slug")
            or request.data.get("contractor")
            or request.data.get("slug")
            or ""
        ).strip()
        lead_source = normalize_public_lead_source(
            request.data.get("source"),
            default=PublicContractorLead.SOURCE_LANDING_PAGE,
        )

        profile = None
        contractor = None
        if contractor_slug:
            profile = ContractorPublicProfile.objects.filter(
                slug=contractor_slug,
                is_public=True,
            ).select_related("contractor").first()
            if profile is None:
                return Response(
                    {"detail": "Contractor profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            contractor = profile.contractor

        intake = ProjectIntake.objects.create(
            contractor=contractor,
            public_profile=profile,
            initiated_by="homeowner",
            status="draft",
            lead_source=lead_source,
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=customer_phone,
        )

        intake.ensure_share_token(save=True)
        public_url = build_public_intake_url(intake)

        return Response(
            {
                "ok": True,
                "intake_id": intake.id,
                "token": intake.share_token,
                "status": intake.status,
                "public_url": public_url,
            },
            status=status.HTTP_201_CREATED,
        )
