from urllib.parse import urlparse

from django.conf import settings
from django.http import Http404
from django.shortcuts import redirect
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from projects.models_attribution import MarketingCampaign
from projects.services.attribution import acquisition_report, capture_visit, record_event


def safe_campaign_destination(value):
    value = str(value or "/").strip()
    if any(ord(character) < 32 for character in value):
        return "/"
    if value.startswith("/") and not value.startswith("//"):
        return value
    parsed = urlparse(value)
    allowed = {"myhomebro.com", "www.myhomebro.com"}
    allowed.update(str(host).split(":", 1)[0].lower() for host in settings.ALLOWED_HOSTS if host and host != "*")
    if parsed.scheme == "https" and (parsed.hostname or "").lower() in allowed:
        return value
    return "/"


class PublicCampaignRedirectView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_campaign_link"

    def get(self, request, code):
        campaign = MarketingCampaign.objects.filter(public_code=str(code or "").lower()).first()
        if campaign is None or not campaign.is_available(timezone.now()):
            raise Http404("This campaign link is invalid or no longer available.")
        visit = capture_visit(request, campaign=campaign, landing_page=request.path)
        record_event(
            "landing_view",
            visitor=visit,
            object_type="campaign",
            object_id=campaign.public_code,
        )
        return redirect(safe_campaign_destination(campaign.destination))


class PublicAttributionEventView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_attribution_event"

    def post(self, request):
        event_type = str(request.data.get("event_type") or "").strip()
        landing_page = str(request.data.get("landing_page") or request.path)
        visit = capture_visit(request, landing_page=landing_page, params=request.data)
        user = request.user if request.user.is_authenticated else None
        try:
            event = record_event(
                event_type,
                visitor=visit,
                user=user,
                role=str(request.data.get("role") or ""),
                object_type=str(request.data.get("object_type") or ""),
                object_id=str(request.data.get("object_id") or ""),
                metadata=request.data.get("metadata") if isinstance(request.data.get("metadata"), dict) else {},
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"recorded": True, "event_id": event.pk}, status=201)


class AttributionReportView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(acquisition_report())
