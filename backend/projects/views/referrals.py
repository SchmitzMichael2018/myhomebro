from django.http import Http404
from django.shortcuts import get_object_or_404, redirect
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from projects.services.referrals import referral_dashboard
from projects.models import Invoice, Project
from projects.models_referrals import ReferralInvitation, ReferralParticipant, ReferralVisit
from projects.services.referral_payouts import request_cash_out, reserve_project_credit
from projects.services.referrals import participant_for_user


class ReferralDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(referral_dashboard(request.user, request=request))

    def post(self, request):
        action = str(request.data.get("action") or "").strip().lower()
        if action == "cash_out":
            try:
                payout = request_cash_out(
                    participant=participant_for_user(request.user),
                    requested_by=request.user,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            return Response({
                "id": payout.id,
                "status": payout.status,
                "amount_cents": payout.amount_cents,
                "requires_onboarding": payout.status == payout.STATUS_NEEDS_ONBOARDING,
            }, status=status.HTTP_201_CREATED)
        if action == "project_credit":
            project = get_object_or_404(Project, pk=request.data.get("project_id"))
            invoice = None
            if request.data.get("invoice_id"):
                invoice = get_object_or_404(Invoice, pk=request.data.get("invoice_id"), agreement__project=project)
            try:
                credit = reserve_project_credit(
                    participant=participant_for_user(request.user),
                    requested_by=request.user,
                    project=project,
                    invoice=invoice,
                    amount_cents=request.data.get("amount_cents"),
                )
            except (TypeError, ValueError) as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            return Response({
                "id": credit.id,
                "status": credit.status,
                "amount_cents": credit.amount_cents,
                "integration_required": credit.status == credit.STATUS_PENDING_INTEGRATION,
            }, status=status.HTTP_201_CREATED)
        channel = str(request.data.get("channel") or "").strip().lower()
        valid_channels = {value for value, _label in ReferralInvitation.CHANNEL_CHOICES}
        if channel not in valid_channels:
            return Response({"channel": ["Choose a valid sharing channel."]}, status=status.HTTP_400_BAD_REQUEST)
        ReferralInvitation.objects.create(participant=participant_for_user(request.user), channel=channel)
        return Response({"recorded": True}, status=status.HTTP_201_CREATED)


class PublicReferralRedirectView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_referral_link"

    def get(self, request, code):
        normalized = str(code or "").strip().upper()
        participant = ReferralParticipant.objects.filter(code=normalized, is_eligible=True).first()
        if participant is None:
            raise Http404("This referral link is invalid or no longer available.")
        if not request.session.session_key:
            request.session.create()
        now = timezone.now()
        ReferralVisit.objects.get_or_create(
            participant=participant,
            session_key=request.session.session_key or "",
            defaults={
                "referral_code": participant.code,
                "medium": str(request.GET.get("medium") or "link")[:24],
                "landing_page": request.path[:255],
                "first_touch_at": now,
            },
        )
        # First valid referral wins; later generic campaign traffic cannot replace it.
        request.session.setdefault("referral_code", participant.code)
        request.session.setdefault("referral_medium", str(request.GET.get("medium") or "link")[:24])
        request.session.setdefault("referral_first_touch_at", now.isoformat())
        request.session.modified = True
        return redirect(f"/register?ref={participant.code}")
