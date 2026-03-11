from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_project_intake import ProjectIntake
from projects.services.intake_public import build_public_intake_url


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

        intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            status="draft",
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