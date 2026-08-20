# backend/projects/views/calendar.py
# v2026-01-07 — Calendar endpoints (fixed for real Milestone fields)

from __future__ import annotations

from rest_framework.views import APIView
from datetime import timedelta
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Milestone, Agreement
from projects.models_contractor_discovery import OpportunityEstimateAppointment
from projects.models_proposals import Proposal
from projects.services.estimate_appointments import is_hold_expired
from ..serializers_calendar import CalendarMilestoneSerializer
from projects.services.milestone_lifecycle import should_show_active_calendar_entry


def _get_contractor_from_user(user):
    contractor = getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)
    if contractor:
        return contractor

    sub = getattr(user, "subaccount", None)
    if sub is not None:
        return getattr(sub, "contractor", None) or getattr(sub, "parent_contractor", None)

    return None


class MilestoneCalendarView(APIView):
    """
    GET /api/projects/milestones/calendar/
    Returns milestones enriched with escrow/invoice truth.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _get_contractor_from_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor context not found."}, status=403)

        qs = (
            Milestone.objects.filter(agreement__contractor=contractor)
            .select_related("agreement", "agreement__homeowner", "invoice")
            .order_by("start_date", "order", "id")
        )
        milestones = [milestone for milestone in qs if should_show_active_calendar_entry(milestone)]
        return Response(CalendarMilestoneSerializer(milestones, many=True).data)


class AgreementCalendarView(APIView):
    """
    GET /api/projects/agreements/calendar/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _get_contractor_from_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor context not found."}, status=403)

        qs = Agreement.objects.filter(contractor=contractor).order_by("-id")[:500]

        results = []
        for a in qs:
            escrow_funded = bool(
                getattr(a, "escrow_funded", False) or getattr(a, "escrow_funded_at", None)
            )
            results.append(
                {
                    "id": a.id,
                    "agreement_number": getattr(a, "agreement_number", None) or a.id,
                    "project_title": getattr(a, "project_title", "") or getattr(a, "title", "") or "",
                    "escrow_funded": escrow_funded,
                }
            )

        return Response({"results": results})


class EstimateAppointmentCalendarView(APIView):
    """Authoritative Estimate appointments for the contractor Calendar workspace."""

    permission_classes = [IsAuthenticated]
    active_statuses = {
        OpportunityEstimateAppointment.STATUS_SCHEDULED,
        OpportunityEstimateAppointment.STATUS_CONFIRMED,
        OpportunityEstimateAppointment.STATUS_REQUESTED,
        OpportunityEstimateAppointment.STATUS_PROPOSED,
    }
    cancelled_estimate_statuses = {
        Proposal.STATUS_CANCELLED,
        Proposal.STATUS_DECLINED,
        Proposal.STATUS_EXPIRED,
    }

    @staticmethod
    def _boundary(value):
        parsed = parse_datetime(value or "")
        if parsed is None:
            return None
        return timezone.make_aware(parsed, timezone.get_current_timezone()) if timezone.is_naive(parsed) else parsed

    def get(self, request):
        contractor = _get_contractor_from_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor context not found."}, status=403)

        range_start = self._boundary(request.query_params.get("start"))
        range_end = self._boundary(request.query_params.get("end"))
        if bool(range_start) != bool(range_end) or (range_start and range_start >= range_end):
            return Response({"detail": "Choose a valid calendar date range."}, status=400)

        qs = (
            OpportunityEstimateAppointment.objects.filter(contractor=contractor, status__in=self.active_statuses)
            .select_related("direct_proposal", "contractor_opportunity")
            .prefetch_related("proposals")
            .order_by("scheduled_start", "id")
        )
        if range_end:
            qs = qs.filter(scheduled_start__lt=range_end)

        events = []
        for appointment in qs:
            end = appointment.scheduled_start + timedelta(minutes=appointment.duration_minutes)
            if range_start and end <= range_start:
                continue
            if is_hold_expired(appointment):
                continue

            linked_proposals = list(appointment.proposals.all())
            proposal = appointment.direct_proposal or next(
                (row for row in linked_proposals if row.status not in self.cancelled_estimate_statuses),
                linked_proposals[0] if linked_proposals else None,
            )
            if appointment.direct_proposal_id and appointment.direct_proposal.status in self.cancelled_estimate_statuses:
                continue
            if linked_proposals and all(row.status in self.cancelled_estimate_statuses for row in linked_proposals):
                continue

            tentative = appointment.status in {
                OpportunityEstimateAppointment.STATUS_REQUESTED,
                OpportunityEstimateAppointment.STATUS_PROPOSED,
            }
            display_status = {
                OpportunityEstimateAppointment.STATUS_REQUESTED: "Customer requested — awaiting contractor confirmation",
                OpportunityEstimateAppointment.STATUS_PROPOSED: "Awaiting customer confirmation",
                OpportunityEstimateAppointment.STATUS_SCHEDULED: "Scheduled",
                OpportunityEstimateAppointment.STATUS_CONFIRMED: "Confirmed",
            }[appointment.status]
            opportunity_id = appointment.contractor_opportunity_id
            navigation_target = (
                f"/app/estimates/{proposal.id}#appointment"
                if proposal else
                f"/app/opportunities?opportunity={opportunity_id}"
                if opportunity_id else "/app/opportunities"
            )
            project_name = getattr(proposal, "project_title", "") or appointment.opportunity_title or "Estimate appointment"
            events.append({
                "id": f"estimate-appointment-{appointment.id}",
                "title": "Estimate appointment",
                "start": appointment.scheduled_start.isoformat(),
                "end": end.isoformat(),
                "allDay": False,
                "extendedProps": {
                    "type": "estimate_appointment",
                    "source": "estimate_appointment",
                    "appointment_id": appointment.id,
                    "appointment_timezone": appointment.timezone,
                    "status": appointment.status,
                    "display_status": display_status,
                    "tentative": tentative,
                    "appointment_type": appointment.appointment_type,
                    "appointment_type_label": appointment.get_appointment_type_display(),
                    "estimate_name": project_name,
                    "customer_name": appointment.customer_name,
                    "location": appointment.service_location,
                    "proposal_id": getattr(proposal, "id", None),
                    "opportunity_id": opportunity_id,
                    "contractor_id": contractor.id,
                    "navigation_target": navigation_target,
                },
            })
        return Response({"events": events})
