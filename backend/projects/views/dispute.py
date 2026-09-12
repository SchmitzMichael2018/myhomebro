# backend/projects/views/dispute.py
from __future__ import annotations

import hashlib
import json
from datetime import datetime

from django.conf import settings
from django.core.exceptions import FieldError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework.response import Response

from ..models_dispute import (
    Dispute,
    DisputeAttachment,
    DisputeEscrowAllocation,
    DisputePaymentHold,
    DisputeWorkOrder,
    DisputeWorkPauseRequest,
)
from ..models_dispute import (
    ResolutionAgreement,
    ResolutionAgreementSignature,
    ResolutionCaseTimelineEvent,
    ResolutionDocument,
    ResolutionProposal,
)
from ..services.dispute_status import is_terminal_dispute_status
from ..services.dispute_allocation_execution import execute_dispute_escrow_allocation
from ..services.dispute_workflow import (
    active_dispute_for_source,
    assess_dispute_qualification,
    close_payment_hold,
    extend_qualification_deadline,
    initialize_dispute_workflow,
    infer_hold_amount_cents,
    override_dispute_qualification,
)
from ..serializers.dispute import (
    DisputeSerializer,
    DisputeCreateSerializer,
    DisputeRespondSerializer,
    DisputeQualificationExtensionSerializer,
    DisputeQualificationOverrideSerializer,
    DisputeQualificationUpdateSerializer,
    DisputeWorkPauseRequestSerializer,
    DisputeWorkPauseResponseSerializer,
    DisputeAllocationCreateSerializer,
    DisputeAllocationAuthorizeSerializer,
    DisputeEscrowAllocationSerializer,
    DisputeClaimAccessSerializer,
    DisputeClaimResponseSerializer,
    DisputeResolveSerializer,
    DisputeAttachmentSerializer,
    DisputePublicSerializer,
    ResolutionAgreementSerializer,
    ResolutionAgreementSignatureSerializer,
    ResolutionCaseTimelineEventSerializer,
    ResolutionPartyStatementSerializer,
    ResolutionProposalSerializer,
    ResolutionDocumentSerializer,
)
from ..services.resolution_workspace import (
    create_party_statement,
    create_resolution_agreement_from_proposal,
    create_resolution_proposal,
    ensure_case_created_event,
    generate_resolution_pdf_package,
    index_evidence,
    record_timeline_event,
    sign_resolution_agreement,
)

# ✅ Import your Milestone model (lives in projects.models)
from ..models import Milestone

# ✅ Phase 1: Evidence Context (read-only, deterministic, safe)
from ..services.ai.evidence_context import build_dispute_evidence_context

# ✅ Phase 2: AI summary (read-only, evidence-based)
from ..services.ai.dispute_summary import generate_dispute_ai_summary
from ..models import Notification
from ..services.workflow_notifications import notify_dispute_event

# Optional emails (safe to import if you have them)
try:
    from ..services.dispute_notifications import (
        email_homeowner_proposal_sent,
        email_contractor_status_update,
        email_admin_dispute_update,
        notify_homeowner_qualification,
    )
except Exception:
    email_homeowner_proposal_sent = None
    email_contractor_status_update = None
    email_admin_dispute_update = None
    notify_homeowner_qualification = None

PROPOSAL_PREFIX = "MHB_PROPOSAL_V1:"
DISPUTE_TERMINAL_MESSAGE = "This dispute is resolved and can no longer be modified."


def _q_is_valid(qs, clause: Q) -> bool:
    """
    Validate a Q() clause against queryset. Schema mismatches may raise:
    - FieldError (bad path/lookup)
    - ValueError/TypeError (wrong object type in FK comparisons)
    """
    try:
        _ = qs.filter(clause).query
        return True
    except (FieldError, ValueError, TypeError):
        return False


def _best_effort_dispute_queryset_for_user(user):
    qs = Dispute.objects.select_related("agreement", "milestone").prefetch_related("attachments")

    if not user or not getattr(user, "is_authenticated", False):
        return qs.none()

    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return qs

    email = (getattr(user, "email", "") or "").strip()
    filters = Q(created_by=user)

    # Homeowner email paths (schema varies)
    if email:
        candidate_clauses = [
            Q(agreement__homeowner_email__iexact=email),
            Q(agreement__homeowner__email__iexact=email),
            Q(agreement__homeowner_email__email__iexact=email),
        ]
        for clause in candidate_clauses:
            if _q_is_valid(qs, clause):
                filters |= clause

    # Contractor paths (schema varies)
    contractor_clauses = [
        Q(agreement__contractor__user=user),
        Q(agreement__contractor_user=user),
    ]
    for clause in contractor_clauses:
        if _q_is_valid(qs, clause):
            filters |= clause

    if email:
        contractor_email_clauses = [
            Q(agreement__contractor__email__iexact=email),
            Q(agreement__contractor_email__iexact=email),
        ]
        for clause in contractor_email_clauses:
            if _q_is_valid(qs, clause):
                filters |= clause

    return qs.filter(filters)


def _is_contractor_actor_for_dispute(user, dispute: Dispute) -> bool:
    """
    Decide which side the current authenticated user represents.
    This fixes the earlier issue where responses were stored based on initiator.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return False

    # Admin behaves as contractor-side
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return True

    if getattr(dispute, "created_by_id", None) == getattr(user, "id", None):
        return getattr(dispute, "initiator", "") != "homeowner"

    # Best-effort: compare against agreement contractor relationship
    email = (getattr(user, "email", "") or "").strip().lower()
    ag = getattr(dispute, "agreement", None)
    if not ag:
        return False

    try:
        contractor = getattr(ag, "contractor", None)
        if contractor:
            if getattr(contractor, "user_id", None) == getattr(user, "id", None):
                return True
            c_email = (getattr(contractor, "email", "") or "").strip().lower()
            if email and c_email == email:
                return True
    except Exception:
        pass

    try:
        if getattr(ag, "contractor_user_id", None) == getattr(user, "id", None):
            return True
    except Exception:
        pass

    try:
        c_email2 = (getattr(ag, "contractor_email", "") or "").strip().lower()
        if email and c_email2 == email:
            return True
    except Exception:
        pass

    return False


def _agreement_customer_email(agreement) -> str:
    homeowner = getattr(agreement, "homeowner", None)
    project = getattr(agreement, "project", None)
    project_homeowner = getattr(project, "homeowner", None) if project is not None else None
    return (
        str(getattr(homeowner, "email", "") or "").strip()
        or str(getattr(project_homeowner, "email", "") or "").strip()
        or str(getattr(agreement, "homeowner_email", "") or "").strip()
    ).lower()


def _user_can_create_dispute_for_agreement(user, agreement) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return True

    user_id = getattr(user, "id", None)
    email = str(getattr(user, "email", "") or "").strip().lower()

    contractor = getattr(agreement, "contractor", None)
    if contractor is not None:
        if getattr(contractor, "user_id", None) == user_id:
            return True
        contractor_email = str(getattr(contractor, "email", "") or "").strip().lower()
        contractor_user_email = str(getattr(getattr(contractor, "user", None), "email", "") or "").strip().lower()
        if email and email in {contractor_email, contractor_user_email}:
            return True

    if getattr(agreement, "contractor_user_id", None) == user_id:
        return True

    if email and _agreement_customer_email(agreement) == email:
        return True

    return False


def _parse_rework_by_date(proposal: dict):
    """
    proposal['rework_by'] expected as YYYY-MM-DD.
    Return datetime.date or None.
    """
    if not isinstance(proposal, dict):
        return None
    val = proposal.get("rework_by")
    if not val:
        return None
    try:
        return datetime.strptime(str(val), "%Y-%m-%d").date()
    except Exception:
        return None


def _proposal_is_rework(dispute: Dispute) -> bool:
    proposal = dispute.proposal or {}
    if not isinstance(proposal, dict):
        return False
    return str(proposal.get("proposal_type") or "").strip().lower() == "rework"


def _get_latest_workorder(dispute: Dispute) -> DisputeWorkOrder | None:
    try:
        return (
            DisputeWorkOrder.objects.filter(dispute=dispute)
            .order_by("-id")
            .first()
        )
    except Exception:
        return None


def _try_fetch_rework_milestone_id(dispute: Dispute) -> int | None:
    """
    Best-effort: pull rework_milestone_id from DisputeWorkOrder if created,
    else try to find an agreement milestone with a matching dispute title.
    """
    wo = _get_latest_workorder(dispute)
    if wo and getattr(wo, "rework_milestone_id", None):
        try:
            return int(wo.rework_milestone_id)
        except Exception:
            return None

    # Fallback heuristic (should be rare once workorders are canonical)
    try:
        m = (
            Milestone.objects.filter(agreement=dispute.agreement, title__icontains=f"Dispute #{dispute.id}")
            .order_by("-id")
            .first()
        )
        return int(m.id) if m else None
    except Exception:
        return None


def _block_if_terminal(dispute: Dispute):
    if is_terminal_dispute_status(getattr(dispute, "status", "")):
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)
    return None


def _resolution_type_from_legacy_outcome(outcome: str) -> str:
    outcome = str(outcome or "").strip().lower()
    if outcome == "contractor":
        return Dispute.RESOLUTION_CONTRACTOR_PREVAILS
    if outcome == "homeowner":
        return Dispute.RESOLUTION_CUSTOMER_PREVAILS
    if outcome == "canceled":
        return Dispute.RESOLUTION_ADMIN_CLOSURE
    return ""


def _default_financial_disposition(resolution_type: str) -> str:
    mapping = {
        Dispute.RESOLUTION_CONTRACTOR_PREVAILS: Dispute.FINANCIAL_ELIGIBLE_RELEASE,
        Dispute.RESOLUTION_CUSTOMER_PREVAILS: Dispute.FINANCIAL_ELIGIBLE_REFUND,
        Dispute.RESOLUTION_PARTIAL: Dispute.FINANCIAL_PARTIAL_MANUAL,
        Dispute.RESOLUTION_REWORK_REQUIRED: Dispute.FINANCIAL_MANUAL_REVIEW,
        Dispute.RESOLUTION_ADMIN_CLOSURE: Dispute.FINANCIAL_NO_ACTION,
    }
    return mapping.get(resolution_type, Dispute.FINANCIAL_MANUAL_REVIEW)


def _status_for_resolution_type(resolution_type: str, fallback_outcome: str = "") -> str:
    mapping = {
        Dispute.RESOLUTION_CONTRACTOR_PREVAILS: "resolved_contractor",
        Dispute.RESOLUTION_CUSTOMER_PREVAILS: "resolved_homeowner",
        Dispute.RESOLUTION_PARTIAL: "under_review",
        Dispute.RESOLUTION_REWORK_REQUIRED: "under_review",
        Dispute.RESOLUTION_ADMIN_CLOSURE: "canceled",
    }
    if resolution_type in mapping:
        return mapping[resolution_type]
    fallback_outcome = str(fallback_outcome or "").strip().lower()
    if fallback_outcome == "contractor":
        return "resolved_contractor"
    if fallback_outcome == "homeowner":
        return "resolved_homeowner"
    return "canceled"


def _ensure_rework_work_order(dispute: Dispute, *, notes: str = "", linked_milestone_id: int | None = None):
    title = f"Rework required - Dispute #{dispute.id}"
    origin_title = str(getattr(getattr(dispute, "milestone", None), "title", "") or "").strip()
    if origin_title:
        title = f"Rework - {origin_title} (Dispute #{dispute.id})"
    work_order, _created = DisputeWorkOrder.objects.get_or_create(
        dispute=dispute,
        agreement=dispute.agreement,
        defaults={
            "title": title,
            "notes": notes,
            "status": "open",
        },
    )
    update_fields = []
    if notes and notes not in str(work_order.notes or ""):
        work_order.notes = "\n\n".join(part for part in [work_order.notes, notes] if str(part or "").strip())
        update_fields.append("notes")
    if linked_milestone_id and not work_order.rework_milestone_id:
        work_order.rework_milestone_id = linked_milestone_id
        update_fields.append("rework_milestone_id")
    if update_fields:
        work_order.save(update_fields=update_fields)
    return work_order


def _block_if_archived(dispute: Dispute):
    if bool(getattr(dispute, "is_archived", False)):
        return Response({"detail": "This dispute is archived and cannot be modified."}, status=400)
    return None


class DisputeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = Dispute.objects.all().order_by("-created_at")

    def get_queryset(self):
        qs = _best_effort_dispute_queryset_for_user(self.request.user)
        include_archived = str(self.request.query_params.get("include_archived", "")).lower() in ("1", "true", "yes")
        if not include_archived and self.action not in {"retrieve", "archive"}:
            qs = qs.filter(is_archived=False)
        return qs.order_by("-created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return DisputeCreateSerializer
        return DisputeSerializer

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()

        mine = str(request.query_params.get("mine", "")).lower() in ("1", "true", "yes")
        initiator = (request.query_params.get("initiator") or "").strip().lower()

        if mine:
            qs = qs.filter(initiator="contractor")
        if initiator:
            qs = qs.filter(initiator=initiator)

        return Response(DisputeSerializer(qs, many=True, context={"request": request}).data)

    def retrieve(self, request, *args, **kwargs):
        dispute = self.get_object()
        ensure_case_created_event(dispute, actor=getattr(dispute, "created_by", None))
        return Response(DisputeSerializer(dispute, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="workspace")
    def workspace(self, request, pk=None):
        dispute: Dispute = self.get_object()
        ensure_case_created_event(dispute, actor=getattr(dispute, "created_by", None))
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    # ─────────────────────────────────────────────
    # Phase 1: Evidence Context (read-only)
    # ─────────────────────────────────────────────
    @action(detail=True, methods=["get"], url_path="evidence-context")
    def evidence_context(self, request, pk=None):
        dispute: Dispute = self.get_object()
        payload = build_dispute_evidence_context(dispute)
        return Response(payload, status=200)

    # ─────────────────────────────────────────────
    # Phase 2: AI Summary (read-only, evidence-based)
    # POST /api/projects/disputes/<id>/ai-summary/
    # ─────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="ai-summary")
    def ai_summary(self, request, pk=None):
        dispute: Dispute = self.get_object()

        try:
            data = generate_dispute_ai_summary(dispute)
            return Response(data, status=200)
        except Exception as e:
            return Response(
                {"ok": False, "error": "AI summary failed.", "detail": str(e)},
                status=500,
            )

    def create(self, request, *args, **kwargs):
        ser = DisputeCreateSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        agreement = ser.validated_data.get("agreement")
        if not _user_can_create_dispute_for_agreement(request.user, agreement):
            return Response({"detail": "You cannot open a dispute for this agreement."}, status=403)
        source = active_dispute_for_source(
            agreement=agreement,
            milestone=ser.validated_data.get("milestone"),
            invoice=ser.validated_data.get("payment_request"),
            draw_request=ser.validated_data.get("draw_request"),
            expense=ser.validated_data.get("expense"),
        )
        if source:
            return Response(
                {"detail": "An active dispute already exists for this payment source.", "dispute_id": source.id},
                status=409,
            )
        dispute = initialize_dispute_workflow(ser.save())
        ensure_case_created_event(dispute, actor=request.user)

        if email_admin_dispute_update:
            from django.conf import settings as dj_settings
            email_admin_dispute_update(dispute, getattr(dj_settings, "DISPUTE_ADMIN_EMAIL", "") or "", "Dispute created")
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_OPENED,
                actor_user=request.user,
            )
        except Exception:
            pass
        if notify_homeowner_qualification:
            notify_homeowner_qualification(dispute, "submitted")

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        dispute: Dispute = self.get_object()

        if bool(getattr(dispute, "is_archived", False)):
            return Response({"detail": "Dispute already archived."}, status=200)

        if not is_terminal_dispute_status(getattr(dispute, "status", "")):
            return Response({"detail": "Only terminal disputes can be archived."}, status=400)

        dispute.is_archived = True
        dispute.updated_at = timezone.now()
        dispute.save(update_fields=["is_archived", "updated_at"])

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], url_path="pay-fee")
    def pay_fee(self, request, pk=None):
        dispute: Dispute = self.get_object()

        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked

        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked

        # Backward-compatible endpoint for older clients. Opening and
        # participating in a dispute no longer requires a fee.
        dispute = initialize_dispute_workflow(dispute)
        return Response(
            {
                **DisputeSerializer(dispute, context={"request": request}).data,
                "detail": "No dispute fee is required. The case workflow is active.",
            },
            status=200,
        )

    @action(detail=True, methods=["patch"], url_path="qualification")
    def qualification(self, request, pk=None):
        dispute: Dispute = self.get_object()
        prior_qualification_status = dispute.qualification_status
        blocked = _block_if_archived(dispute) or _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        if _is_contractor_actor_for_dispute(request.user, dispute) and not request.user.is_staff:
            return Response({"detail": "Customer qualification information must be supplied by the customer."}, status=403)
        ser = DisputeQualificationUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        for field_name, value in ser.validated_data.items():
            setattr(dispute, field_name, value)
        dispute.save(update_fields=[*ser.validated_data.keys(), "updated_at"])
        dispute = assess_dispute_qualification(dispute, actor=request.user)
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
            "Dispute qualification information updated",
            actor=request.user,
            description=dispute.qualification_explanation,
            related_object=dispute,
            metadata={
                "qualification_status": dispute.qualification_status,
                "missing_information": dispute.missing_information,
            },
        )
        if dispute.qualification_status == Dispute.QUALIFICATION_QUALIFIED and prior_qualification_status != Dispute.QUALIFICATION_QUALIFIED:
            try:
                notify_dispute_event(dispute=dispute, event_type=Notification.EVENT_DISPUTE_UPDATED, actor_user=request.user)
            except Exception:
                pass
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser], url_path="qualification-extension")
    def qualification_extension(self, request, pk=None):
        dispute: Dispute = self.get_object()
        ser = DisputeQualificationExtensionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        dispute = extend_qualification_deadline(
            dispute,
            reason=ser.validated_data["reason"],
            business_days=ser.validated_data["business_days"],
            actor=request.user,
        )
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
            "Qualification deadline extended",
            actor=request.user,
            description=ser.validated_data["reason"],
            related_object=dispute,
            metadata={"qualification_due_at": dispute.qualification_due_at.isoformat()},
        )
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser], url_path="qualification-override")
    def qualification_override(self, request, pk=None):
        dispute: Dispute = self.get_object()
        ser = DisputeQualificationOverrideSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            dispute = override_dispute_qualification(dispute, **ser.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
            "Human qualification override recorded",
            actor=request.user,
            description=ser.validated_data["reason"],
            related_object=dispute,
            metadata={
                "qualification_status": dispute.qualification_status,
                "source_hold_reactivated": ser.validated_data["reactivate_source_hold"],
                "funds_moved": False,
            },
        )
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], url_path=r"claims/(?P<claim_id>[^/.]+)/respond")
    def claim_respond(self, request, pk=None, claim_id=None):
        dispute: Dispute = self.get_object()
        if not _is_contractor_actor_for_dispute(request.user, dispute):
            return Response({"detail": "Only the contractor may submit a claim response."}, status=403)
        if dispute.qualification_status != Dispute.QUALIFICATION_QUALIFIED:
            return Response({"detail": "This claim must qualify before the contractor response stage."}, status=400)
        claim = dispute.claims.filter(pk=claim_id).first()
        if not claim:
            return Response({"detail": "Claim not found."}, status=404)
        ser = DisputeClaimResponseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        claim.contractor_position = ser.validated_data["contractor_position"]
        claim.contractor_response = ser.validated_data["response"].strip()
        claim.access_required = ser.validated_data.get("access_required")
        claim.cure_proposal = ser.validated_data.get("cure_proposal") or {}
        claim.save()
        dispute.contractor_response = "\n\n".join(
            f"Claim {row.sequence}: {row.contractor_response}"
            for row in dispute.claims.exclude(contractor_response="").order_by("sequence", "id")
        )
        dispute.responded_at = timezone.now()
        dispute.last_activity_at = dispute.responded_at
        dispute.save(update_fields=["contractor_response", "responded_at", "last_activity_at", "updated_at"])
        create_party_statement(
            dispute,
            author=request.user,
            text=claim.contractor_response,
            party_role="contractor",
            metadata={"claim_id": claim.id, "contractor_position": claim.contractor_position},
        )
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], url_path=r"claims/(?P<claim_id>[^/.]+)/access")
    def claim_access(self, request, pk=None, claim_id=None):
        dispute: Dispute = self.get_object()
        if _is_contractor_actor_for_dispute(request.user, dispute) and not request.user.is_staff:
            return Response({"detail": "The customer must record the access decision."}, status=403)
        claim = dispute.claims.filter(pk=claim_id).first()
        if not claim:
            return Response({"detail": "Claim not found."}, status=404)
        if claim.access_required is not True:
            return Response({"detail": "The contractor has not requested access for this claim."}, status=400)
        ser = DisputeClaimAccessSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        claim.customer_access_response = ser.validated_data["access_permitted"]
        claim.customer_access_notes = ser.validated_data.get("notes", "")
        claim.save()
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
            "Customer recorded site-access decision",
            actor=request.user,
            description=claim.customer_access_notes,
            related_object=claim,
            metadata={"access_permitted": claim.customer_access_response},
        )
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["get", "post"], url_path="work-pauses")
    def work_pauses(self, request, pk=None):
        dispute: Dispute = self.get_object()
        if request.method == "GET":
            return Response(DisputeWorkPauseRequestSerializer(dispute.work_pause_requests.all(), many=True).data)
        blocked = _block_if_archived(dispute) or _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        ser = DisputeWorkPauseRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        pause = ser.save(dispute=dispute, requested_by=request.user)
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_WORK_PAUSE_UPDATED,
            "Work pause requested",
            actor=request.user,
            description=pause.explanation,
            related_object=pause,
            metadata={"reason_type": pause.reason_type, "scope": pause.scope, "payment_hold_unchanged": True},
        )
        return Response(DisputeWorkPauseRequestSerializer(pause).data, status=201)

    @action(detail=True, methods=["post"], url_path=r"work-pauses/(?P<pause_id>[^/.]+)/respond")
    def work_pause_respond(self, request, pk=None, pause_id=None):
        dispute: Dispute = self.get_object()
        pause = dispute.work_pause_requests.filter(pk=pause_id).first()
        if not pause:
            return Response({"detail": "Work pause request not found."}, status=404)
        ser = DisputeWorkPauseResponseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        decision = ser.validated_data["decision"]
        if pause.requested_by_id == request.user.id and not request.user.is_staff and decision != "end":
            return Response({"detail": "The requesting party cannot accept its own work-pause request."}, status=403)
        if decision == "end" and pause.status != DisputeWorkPauseRequest.STATUS_ACCEPTED:
            return Response({"detail": "Only an accepted work pause can be ended."}, status=400)
        pause.status = {
            "accept": DisputeWorkPauseRequest.STATUS_ACCEPTED,
            "decline": DisputeWorkPauseRequest.STATUS_DECLINED,
            "end": DisputeWorkPauseRequest.STATUS_ENDED,
        }[decision]
        pause.responded_by = request.user
        pause.response_reason = ser.validated_data.get("reason", "")
        pause.responded_at = timezone.now()
        if decision == "end":
            pause.ended_at = pause.responded_at
        pause.save(update_fields=["status", "responded_by", "response_reason", "responded_at", "ended_at"])
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_WORK_PAUSE_UPDATED,
            f"Work pause {pause.status}",
            actor=request.user,
            description=pause.response_reason,
            related_object=pause,
            metadata={"payment_hold_unchanged": True},
        )
        return Response(DisputeWorkPauseRequestSerializer(pause).data, status=200)

    @action(detail=True, methods=["get", "post"], url_path="escrow-allocations")
    def escrow_allocations(self, request, pk=None):
        dispute: Dispute = self.get_object()
        if request.method == "GET":
            return Response(DisputeEscrowAllocationSerializer(dispute.escrow_allocations.all(), many=True).data)
        blocked = _block_if_archived(dispute) or _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        try:
            hold = dispute.payment_hold
        except DisputePaymentHold.DoesNotExist:
            return Response({"detail": "This case has no platform-held payment source to allocate."}, status=400)
        if hold.status == DisputePaymentHold.STATUS_NO_HOLD or hold.amount_cents <= 0:
            return Response({"detail": "This case has no platform-held payment source to allocate."}, status=400)
        ser = DisputeAllocationCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        external_document = ser.validated_data.get("external_authority_document")
        if external_document and external_document.dispute_id != dispute.id:
            return Response({"detail": "The authority document must belong to this dispute."}, status=400)
        contractor_cents = ser.validated_data["contractor_amount_cents"]
        homeowner_cents = ser.validated_data["homeowner_amount_cents"]
        if contractor_cents + homeowner_cents != hold.amount_cents:
            return Response(
                {"detail": "Allocation must exactly equal the held amount.", "held_amount_cents": hold.amount_cents},
                status=400,
            )
        allocation = DisputeEscrowAllocation.objects.create(
            dispute=dispute,
            payment_hold=hold,
            source_amount_cents=hold.amount_cents,
            contractor_amount_cents=contractor_cents,
            homeowner_amount_cents=homeowner_cents,
            currency=hold.currency.upper(),
            explanation=ser.validated_data["explanation"],
            external_authority_document=external_document,
            proposed_by=request.user,
            status=DisputeEscrowAllocation.STATUS_AWAITING_AUTHORIZATION,
        )
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_ESCROW_ALLOCATION_UPDATED,
            "Escrow allocation proposed",
            actor=request.user,
            description=allocation.explanation,
            related_object=allocation,
            metadata={
                "source_amount_cents": allocation.source_amount_cents,
                "contractor_amount_cents": allocation.contractor_amount_cents,
                "homeowner_amount_cents": allocation.homeowner_amount_cents,
            },
        )
        return Response(DisputeEscrowAllocationSerializer(allocation).data, status=201)

    @action(detail=True, methods=["post"], url_path=r"escrow-allocations/(?P<allocation_id>[^/.]+)/authorize")
    def escrow_allocation_authorize(self, request, pk=None, allocation_id=None):
        dispute: Dispute = self.get_object()
        allocation = dispute.escrow_allocations.filter(pk=allocation_id).first()
        if not allocation:
            return Response({"detail": "Allocation not found."}, status=404)
        if allocation.status != DisputeEscrowAllocation.STATUS_AWAITING_AUTHORIZATION:
            return Response({"detail": "This allocation is no longer awaiting party authorization."}, status=400)
        ser = DisputeAllocationAuthorizeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if not ser.validated_data["attestation"]:
            return Response({"detail": "Explicit authorization attestation is required."}, status=400)
        if ser.validated_data["authorization"] == "reject":
            allocation.status = DisputeEscrowAllocation.STATUS_CANCELED
            allocation.updated_at = timezone.now()
            allocation.save(update_fields=["status", "updated_at"])
        else:
            now = timezone.now()
            if _is_contractor_actor_for_dispute(request.user, dispute):
                allocation.contractor_authorized_by = request.user
                allocation.contractor_authorized_at = now
                update_fields = ["contractor_authorized_by", "contractor_authorized_at"]
            else:
                allocation.homeowner_authorized_by = request.user
                allocation.homeowner_authorized_at = now
                update_fields = ["homeowner_authorized_by", "homeowner_authorized_at"]
            if allocation.homeowner_authorized_at and allocation.contractor_authorized_at:
                allocation.status = DisputeEscrowAllocation.STATUS_AUTHORIZED
            allocation.updated_at = now
            allocation.save(update_fields=[*update_fields, "status", "updated_at"])
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_ESCROW_ALLOCATION_UPDATED,
            f"Escrow allocation {allocation.status}",
            actor=request.user,
            related_object=allocation,
        )
        return Response(DisputeEscrowAllocationSerializer(allocation).data, status=200)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser], url_path=r"escrow-allocations/(?P<allocation_id>[^/.]+)/confirm")
    def escrow_allocation_confirm(self, request, pk=None, allocation_id=None):
        dispute: Dispute = self.get_object()
        allocation = dispute.escrow_allocations.filter(pk=allocation_id).first()
        if not allocation:
            return Response({"detail": "Allocation not found."}, status=404)
        has_mutual_authority = bool(allocation.homeowner_authorized_at and allocation.contractor_authorized_at)
        has_external_authority = bool(allocation.external_authority_document_id)
        if not allocation.is_balanced:
            return Response({"detail": "Allocation no longer balances to the held source amount."}, status=400)
        if not (has_mutual_authority or has_external_authority):
            return Response({"detail": "Mutual authorization or a dispute-linked external authority document is required."}, status=400)
        allocation.status = DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION
        allocation.staff_confirmed_by = request.user
        allocation.staff_confirmed_at = timezone.now()
        allocation.updated_at = allocation.staff_confirmed_at
        allocation.save(update_fields=["status", "staff_confirmed_by", "staff_confirmed_at", "updated_at"])
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_ESCROW_ALLOCATION_UPDATED,
            "Escrow allocation validated for execution",
            actor=request.user,
            description="Dollar totals and authority were validated. No funds were moved by this confirmation.",
            related_object=allocation,
        )
        return Response(DisputeEscrowAllocationSerializer(allocation).data, status=200)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser], url_path=r"escrow-allocations/(?P<allocation_id>[^/.]+)/execute")
    def escrow_allocation_execute(self, request, pk=None, allocation_id=None):
        dispute: Dispute = self.get_object()
        allocation = dispute.escrow_allocations.filter(pk=allocation_id).first()
        if not allocation:
            return Response({"detail": "Allocation not found."}, status=404)
        if allocation.status == DisputeEscrowAllocation.STATUS_EXECUTED:
            return Response(DisputeEscrowAllocationSerializer(allocation).data, status=200)
        try:
            allocation = execute_dispute_escrow_allocation(allocation.id, actor=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=409)
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_ESCROW_ALLOCATION_UPDATED,
            "Authorized escrow allocation executed",
            actor=request.user,
            description="The exact-dollar allocation was executed through the separately authorized payment action.",
            related_object=allocation,
            metadata={
                "homeowner_refund_id": allocation.homeowner_refund_id,
                "contractor_transfer_id": allocation.contractor_transfer_id,
                "source_amount_cents": allocation.source_amount_cents,
            },
        )
        return Response(DisputeEscrowAllocationSerializer(allocation).data, status=200)

    @action(detail=True, methods=["patch"], url_path="respond")
    def respond(self, request, pk=None):
        dispute: Dispute = self.get_object()

        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked

        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked

        ser = DisputeRespondSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        response_text = str(ser.validated_data["response"]).strip()
        if not response_text:
            return Response({"detail": "Response is required."}, status=400)

        now = timezone.now()
        dispute.responded_at = now
        dispute.last_activity_at = now

        actor_is_contractor = _is_contractor_actor_for_dispute(request.user, dispute)
        if actor_is_contractor:
            dispute.contractor_response = response_text
        else:
            dispute.homeowner_response = response_text

        proposal_obj = None
        if response_text.startswith(PROPOSAL_PREFIX):
            raw = response_text[len(PROPOSAL_PREFIX):].strip()
            try:
                proposal_obj = json.loads(raw)
            except Exception:
                proposal_obj = None

        proposal_sent = False
        if proposal_obj is not None and actor_is_contractor:
            dispute.proposal = proposal_obj
            dispute.proposal_sent_at = now
            proposal_sent = True

            if hasattr(dispute, "set_proposal_deadline_now"):
                dispute.set_proposal_deadline_now()

        if dispute.status in ("initiated", "open"):
            dispute.status = "under_review"

        dispute.save(update_fields=[
            "homeowner_response", "contractor_response",
            "responded_at", "last_activity_at",
            "proposal", "proposal_sent_at",
            "proposal_due_at", "deadline_hours", "deadline_tier",
            "status", "updated_at"
        ])
        create_party_statement(
            dispute,
            author=request.user,
            text=response_text,
            party_role="contractor" if actor_is_contractor else "customer",
            metadata={"legacy_field": "contractor_response" if actor_is_contractor else "homeowner_response"},
        )

        if proposal_sent and email_homeowner_proposal_sent:
            email_homeowner_proposal_sent(dispute)
        if proposal_sent:
            create_resolution_proposal(
                dispute,
                proposed_by=request.user,
                problem_statement=proposal_obj.get("problem_statement") or dispute.description or dispute.reason,
                proposed_solution=proposal_obj.get("notes") or proposal_obj.get("solution") or response_text,
                required_actions=proposal_obj.get("required_actions") or [],
                deadlines=proposal_obj.get("deadlines") or [],
                payment_impact=proposal_obj.get("payment_impact") or {},
                warranty_impact=proposal_obj.get("warranty_impact") or "",
                evidence_relied_upon=proposal_obj.get("evidence_relied_upon") or [],
                status=ResolutionProposal.STATUS_PROPOSED,
                metadata={"legacy_proposal": proposal_obj},
            )
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_UPDATED,
                actor_user=request.user,
                customer_message=response_text if actor_is_contractor and not proposal_sent else "",
            )
        except Exception:
            pass

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["patch"], url_path="cancel")
    def cancel(self, request, pk=None):
        dispute: Dispute = self.get_object()

        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked

        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked

        now = timezone.now()
        dispute.status = "canceled"
        dispute.escrow_frozen = False
        dispute.resolved_at = now
        dispute.last_activity_at = now
        dispute.save(update_fields=["status", "escrow_frozen", "resolved_at", "last_activity_at", "updated_at"])
        close_payment_hold(dispute, reason="The dispute was canceled by an authorized user.", now=now)
        dispute.refresh_from_db()
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_CASE_CLOSED,
            "Resolution case canceled",
            actor=request.user,
            description="Case was canceled by a human user. Any payment actions remain separate.",
            related_object=dispute,
        )
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_RESOLVED,
                actor_user=request.user,
            )
        except Exception:
            pass

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], url_path="attachments")
    def attachments(self, request, pk=None):
        dispute: Dispute = self.get_object()

        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked

        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked

        file = request.FILES.get("file")
        kind = (request.data.get("kind") or "other").strip()

        if not file:
            return Response({"detail": "Missing file."}, status=400)

        att = DisputeAttachment.objects.create(
            dispute=dispute,
            kind=kind,
            file=file,
            uploaded_by=request.user,
        )
        index_evidence(
            dispute,
            att,
            actor=request.user,
            description=(request.data.get("description") or "").strip(),
            category=(request.data.get("category") or "").strip(),
        )

        dispute.last_activity_at = timezone.now()
        dispute.save(update_fields=["last_activity_at", "updated_at"])
        if dispute.qualification_status in {
            Dispute.QUALIFICATION_PENDING,
            Dispute.QUALIFICATION_INFORMATION_NEEDED,
        }:
            dispute = assess_dispute_qualification(dispute, actor=request.user)
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_UPDATED,
                actor_user=request.user,
            )
        except Exception:
            pass

        return Response(DisputeAttachmentSerializer(att, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="external-documents")
    def external_documents(self, request, pk=None):
        dispute: Dispute = self.get_object()
        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"detail": "Missing file."}, status=400)
        document_type = str(request.data.get("document_type") or "external_decision").strip()
        allowed = {
            "external_decision",
            "mutual_instructions",
            "inspection_report",
            "other",
        }
        if document_type not in allowed:
            return Response({"detail": "Unsupported external document type."}, status=400)
        digest = hashlib.sha256()
        for chunk in uploaded.chunks():
            digest.update(chunk)
        uploaded.seek(0)
        from ..models_dispute import ResolutionDocument
        document = ResolutionDocument.objects.create(
            dispute=dispute,
            document_type=document_type,
            title=str(request.data.get("title") or getattr(uploaded, "name", "External resolution document"))[:255],
            file=uploaded,
            generated_by=request.user,
            sha256=digest.hexdigest(),
            metadata={
                "uploaded_as_external_authority": document_type in {"external_decision", "mutual_instructions"},
                "legal_effect_not_interpreted_by_platform": True,
            },
        )
        dispute.workflow_stage = Dispute.STAGE_EXTERNAL_RESOLUTION
        dispute.last_activity_at = timezone.now()
        dispute.save(update_fields=["workflow_stage", "last_activity_at", "updated_at"])
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_EVIDENCE_UPLOADED,
            "External resolution document uploaded",
            actor=request.user,
            description=document.title,
            related_object=document,
            metadata={"document_type": document.document_type, "sha256": document.sha256},
        )
        return Response(ResolutionDocumentSerializer(document, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser], url_path="resolve")
    def resolve(self, request, pk=None):
        dispute: Dispute = self.get_object()

        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked

        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked

        ser = DisputeResolveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        outcome = ser.validated_data.get("outcome", "")
        resolution_type = ser.validated_data.get("resolution_type") or _resolution_type_from_legacy_outcome(outcome)
        admin_notes = (ser.validated_data.get("admin_notes") or "").strip()
        resolution_notes = (ser.validated_data.get("resolution_notes") or admin_notes).strip()
        financial_disposition = (
            ser.validated_data.get("financial_disposition")
            or _default_financial_disposition(resolution_type)
        )
        linked_rework_milestone_id = ser.validated_data.get("linked_rework_milestone_id")

        partial_allocation_cents = None
        if resolution_type == Dispute.RESOLUTION_PARTIAL:
            try:
                hold = dispute.payment_hold
            except DisputePaymentHold.DoesNotExist:
                if dispute.escrow_frozen and (dispute.milestone_id or dispute.payment_request_id):
                    hold = DisputePaymentHold.objects.create(
                        dispute=dispute,
                        milestone=dispute.milestone,
                        invoice=dispute.payment_request,
                        amount_cents=infer_hold_amount_cents(dispute),
                        status=DisputePaymentHold.STATUS_CONTINUED,
                    )
                else:
                    return Response({"detail": "A partial allocation requires a platform-held payment source."}, status=400)
            approved_cents = int(ser.validated_data["approved_amount"] * 100)
            homeowner_cents = int(ser.validated_data["disputed_remainder"] * 100)
            if approved_cents + homeowner_cents != hold.amount_cents:
                return Response(
                    {
                        "detail": "The contractor award and customer return must exactly equal the held amount.",
                        "held_amount_cents": hold.amount_cents,
                    },
                    status=400,
                )
            partial_allocation_cents = (approved_cents, homeowner_cents, hold)

        now = timezone.now()
        dispute.admin_notes = admin_notes
        dispute.resolution_type = resolution_type
        dispute.resolution_notes = resolution_notes
        dispute.resolved_by = request.user
        dispute.financial_disposition = financial_disposition
        dispute.approved_amount = ser.validated_data.get("approved_amount")
        dispute.disputed_remainder = ser.validated_data.get("disputed_remainder")
        dispute.linked_rework_milestone_id = linked_rework_milestone_id

        dispute.status = _status_for_resolution_type(resolution_type, outcome)
        dispute.escrow_frozen = resolution_type in {Dispute.RESOLUTION_REWORK_REQUIRED, Dispute.RESOLUTION_PARTIAL}
        dispute.resolved_at = now
        dispute.last_activity_at = now
        if resolution_type == Dispute.RESOLUTION_REWORK_REQUIRED:
            work_order = _ensure_rework_work_order(
                dispute,
                notes=resolution_notes,
                linked_milestone_id=linked_rework_milestone_id,
            )
            if not linked_rework_milestone_id and getattr(work_order, "rework_milestone_id", None):
                dispute.linked_rework_milestone_id = work_order.rework_milestone_id
        dispute.save(update_fields=[
            "admin_notes", "resolution_type", "resolution_notes", "resolved_by",
            "financial_disposition", "approved_amount", "disputed_remainder",
            "linked_rework_milestone_id", "status", "escrow_frozen", "resolved_at",
            "last_activity_at", "updated_at"
        ])
        if partial_allocation_cents:
            approved_cents, homeowner_cents, hold = partial_allocation_cents
            DisputeEscrowAllocation.objects.filter(
                dispute=dispute,
                status__in=[
                    DisputeEscrowAllocation.STATUS_DRAFT,
                    DisputeEscrowAllocation.STATUS_AWAITING_AUTHORIZATION,
                    DisputeEscrowAllocation.STATUS_AUTHORIZED,
                    DisputeEscrowAllocation.STATUS_READY_FOR_EXECUTION,
                ],
            ).update(status=DisputeEscrowAllocation.STATUS_CANCELED, updated_at=now)
            allocation = DisputeEscrowAllocation.objects.create(
                dispute=dispute,
                payment_hold=hold,
                source_amount_cents=hold.amount_cents,
                contractor_amount_cents=approved_cents,
                homeowner_amount_cents=homeowner_cents,
                explanation=resolution_notes or "Partial allocation entered for party authorization.",
                status=DisputeEscrowAllocation.STATUS_AWAITING_AUTHORIZATION,
                proposed_by=request.user,
            )
            record_timeline_event(
                dispute,
                ResolutionCaseTimelineEvent.EVENT_ESCROW_ALLOCATION_UPDATED,
                "Partial allocation entered for party authorization",
                actor=request.user,
                description=allocation.explanation,
                related_object=allocation,
                metadata={
                    "contractor_amount_cents": approved_cents,
                    "homeowner_amount_cents": homeowner_cents,
                    "money_moved": False,
                },
            )
        if not dispute.escrow_frozen:
            close_payment_hold(dispute, reason=f"Human resolution recorded: {resolution_type}.", now=now)
            dispute.refresh_from_db()
        event_type = (
            ResolutionCaseTimelineEvent.EVENT_PAYMENT_HOLD_RELEASED
            if not dispute.escrow_frozen
            else ResolutionCaseTimelineEvent.EVENT_HUMAN_DECISION_RECORDED
        )
        record_timeline_event(
            dispute,
            event_type,
            "Human decision recorded",
            actor=request.user,
            description=resolution_notes or admin_notes,
            related_object=dispute,
            metadata={
                "resolution_type": resolution_type,
                "financial_disposition": financial_disposition,
                "approved_amount": str(dispute.approved_amount or ""),
                "disputed_remainder": str(dispute.disputed_remainder or ""),
            },
        )
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_RESOLVED,
                actor_user=request.user,
            )
        except Exception:
            pass

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["get", "post"], url_path="timeline")
    def timeline(self, request, pk=None):
        dispute: Dispute = self.get_object()
        ensure_case_created_event(dispute, actor=getattr(dispute, "created_by", None))
        if request.method.lower() == "get":
            qs = dispute.timeline_events.all()
            return Response(ResolutionCaseTimelineEventSerializer(qs, many=True, context={"request": request}).data, status=200)
        title = (request.data.get("title") or "").strip()
        if not title:
            return Response({"detail": "Title is required."}, status=400)
        event = record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_MANUAL,
            title,
            actor=request.user,
            description=(request.data.get("description") or "").strip(),
            related_object=dispute,
            visibility=(request.data.get("visibility") or ResolutionCaseTimelineEvent.VISIBILITY_ALL).strip(),
            metadata={"manual": True},
        )
        return Response(ResolutionCaseTimelineEventSerializer(event, context={"request": request}).data, status=201)

    @action(detail=True, methods=["get", "post"], url_path="party-statements")
    def party_statements(self, request, pk=None):
        dispute: Dispute = self.get_object()
        if request.method.lower() == "get":
            qs = dispute.party_statements.all()
            return Response(ResolutionPartyStatementSerializer(qs, many=True, context={"request": request}).data, status=200)
        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        text = (request.data.get("text") or request.data.get("response") or "").strip()
        if not text:
            return Response({"detail": "Statement text is required."}, status=400)
        statement = create_party_statement(
            dispute,
            author=request.user,
            text=text,
            party_role=(request.data.get("party_role") or "").strip() or None,
            statement_type=(request.data.get("statement_type") or "").strip() or None,
            visibility=(request.data.get("visibility") or ResolutionCaseTimelineEvent.VISIBILITY_ALL).strip(),
        )
        return Response(ResolutionPartyStatementSerializer(statement, context={"request": request}).data, status=201)

    @action(detail=True, methods=["get", "post"], url_path="resolution-proposals")
    def resolution_proposals(self, request, pk=None):
        dispute: Dispute = self.get_object()
        if request.method.lower() == "get":
            qs = dispute.resolution_proposals.all()
            return Response(ResolutionProposalSerializer(qs, many=True, context={"request": request}).data, status=200)
        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        proposed_solution = (request.data.get("proposed_solution") or request.data.get("solution") or "").strip()
        if not proposed_solution:
            return Response({"detail": "Proposed solution is required."}, status=400)
        proposal = create_resolution_proposal(
            dispute,
            proposed_by=request.user,
            problem_statement=(request.data.get("problem_statement") or "").strip(),
            proposed_solution=proposed_solution,
            required_actions=request.data.get("required_actions") or [],
            deadlines=request.data.get("deadlines") or [],
            payment_impact=request.data.get("payment_impact") or {},
            warranty_impact=(request.data.get("warranty_impact") or "").strip(),
            evidence_relied_upon=request.data.get("evidence_relied_upon") or [],
            status=request.data.get("status") or ResolutionProposal.STATUS_PROPOSED,
        )
        return Response(ResolutionProposalSerializer(proposal, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="resolution-proposals/(?P<proposal_id>[^/.]+)/status")
    def resolution_proposal_status(self, request, pk=None, proposal_id=None):
        dispute: Dispute = self.get_object()
        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        try:
            proposal = dispute.resolution_proposals.get(id=proposal_id)
        except ResolutionProposal.DoesNotExist:
            return Response({"detail": "Resolution proposal not found."}, status=404)
        status_value = (request.data.get("status") or "").strip()
        allowed = {choice[0] for choice in ResolutionProposal.STATUS_CHOICES}
        if status_value not in allowed:
            return Response({"detail": "Invalid proposal status."}, status=400)
        before = proposal.status
        proposal.status = status_value
        proposal.save(update_fields=["status", "updated_at"])
        record_timeline_event(
            dispute,
            ResolutionCaseTimelineEvent.EVENT_HUMAN_DECISION_RECORDED,
            f"Resolution proposal marked {status_value.replace('_', ' ')}",
            actor=request.user,
            description=(request.data.get("note") or "").strip(),
            related_object=proposal,
            metadata={"proposal_id": proposal.id, "before": before, "after": status_value},
        )
        return Response(ResolutionProposalSerializer(proposal, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], url_path="resolution-proposals/(?P<proposal_id>[^/.]+)/agreement")
    def create_resolution_agreement(self, request, pk=None, proposal_id=None):
        dispute: Dispute = self.get_object()
        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked
        try:
            proposal = dispute.resolution_proposals.get(id=proposal_id)
        except ResolutionProposal.DoesNotExist:
            return Response({"detail": "Resolution proposal not found."}, status=404)
        agreement = create_resolution_agreement_from_proposal(
            proposal,
            created_by=request.user,
            human_decision_summary=(request.data.get("human_decision_summary") or "").strip(),
        )
        return Response(ResolutionAgreementSerializer(agreement, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="resolution-agreements/(?P<resolution_agreement_id>[^/.]+)/sign")
    def sign_resolution(self, request, pk=None, resolution_agreement_id=None):
        dispute: Dispute = self.get_object()
        try:
            resolution_agreement = dispute.resolution_agreements.get(id=resolution_agreement_id)
        except ResolutionAgreement.DoesNotExist:
            return Response({"detail": "Resolution agreement not found."}, status=404)
        signer_role = (request.data.get("signer_role") or "").strip()
        allowed_roles = {choice[0] for choice in ResolutionAgreementSignature.ROLE_CHOICES}
        if signer_role not in allowed_roles:
            return Response({"detail": "Valid signer_role is required."}, status=400)
        signer_name = (request.data.get("signer_name") or getattr(request.user, "get_full_name", lambda: "")() or getattr(request.user, "email", "") or "").strip()
        if not signer_name:
            return Response({"detail": "Signer name is required."}, status=400)
        try:
            signature = sign_resolution_agreement(
                resolution_agreement,
                signer=request.user,
                signer_role=signer_role,
                signer_name=signer_name,
                ip_address=request.META.get("REMOTE_ADDR") or "",
                user_agent=request.META.get("HTTP_USER_AGENT") or "",
                signature_text=(request.data.get("signature_text") or "").strip(),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(ResolutionAgreementSignatureSerializer(signature, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="resolution-agreements/(?P<resolution_agreement_id>[^/.]+)/pdf-package")
    def generate_resolution_pdf(self, request, pk=None, resolution_agreement_id=None):
        dispute: Dispute = self.get_object()
        try:
            resolution_agreement = dispute.resolution_agreements.get(id=resolution_agreement_id)
        except ResolutionAgreement.DoesNotExist:
            return Response({"detail": "Resolution agreement not found."}, status=404)
        try:
            document = generate_resolution_pdf_package(resolution_agreement, generated_by=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(ResolutionDocumentSerializer(document, context={"request": request}).data, status=201)


# ─────────────────────────────────────────────
# Public (token-based) endpoints for Decision page
# ─────────────────────────────────────────────

def _get_dispute_by_public_token(dispute_id: int, token: str):
    try:
        return Dispute.objects.select_related("agreement", "milestone").prefetch_related("attachments").get(
            id=dispute_id,
            public_token=token,
        )
    except Dispute.DoesNotExist:
        return None


@api_view(["GET"])
@permission_classes([AllowAny])
def public_dispute_detail(request, dispute_id: int):
    token = (request.query_params.get("token") or "").strip()
    if not token:
        return Response({"detail": "Missing token."}, status=400)

    dispute = _get_dispute_by_public_token(dispute_id, token)
    if not dispute:
        return Response({"detail": "Not found."}, status=404)

    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)


@api_view(["PATCH"])
@permission_classes([AllowAny])
def public_dispute_qualification(request, dispute_id: int):
    token = (request.query_params.get("token") or "").strip()
    dispute = _get_dispute_by_public_token(dispute_id, token) if token else None
    if not dispute:
        return Response({"detail": "Not found."}, status=404)
    if is_terminal_dispute_status(dispute.status) or dispute.is_archived:
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)
    prior_qualification_status = dispute.qualification_status
    ser = DisputeQualificationUpdateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    for field_name, value in ser.validated_data.items():
        setattr(dispute, field_name, value)
    dispute.save(update_fields=[*ser.validated_data.keys(), "updated_at"])
    dispute = assess_dispute_qualification(dispute)
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
        "Customer updated qualification information",
        metadata={"qualification_status": dispute.qualification_status, "missing_information": dispute.missing_information},
    )
    if notify_homeowner_qualification and dispute.qualification_status == Dispute.QUALIFICATION_QUALIFIED and prior_qualification_status != Dispute.QUALIFICATION_QUALIFIED:
        notify_homeowner_qualification(dispute, "qualified")
    if dispute.qualification_status == Dispute.QUALIFICATION_QUALIFIED and prior_qualification_status != Dispute.QUALIFICATION_QUALIFIED:
        try:
            notify_dispute_event(dispute=dispute, event_type=Notification.EVENT_DISPUTE_UPDATED, actor_user=None)
        except Exception:
            pass
    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_dispute_allocation_authorize(request, dispute_id: int, allocation_id: int):
    token = (request.query_params.get("token") or "").strip()
    dispute = _get_dispute_by_public_token(dispute_id, token) if token else None
    if not dispute:
        return Response({"detail": "Not found."}, status=404)
    if is_terminal_dispute_status(dispute.status) or dispute.is_archived:
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)
    allocation = dispute.escrow_allocations.filter(pk=allocation_id).first()
    if not allocation:
        return Response({"detail": "Allocation not found."}, status=404)
    if allocation.status != DisputeEscrowAllocation.STATUS_AWAITING_AUTHORIZATION:
        return Response({"detail": "This allocation is no longer awaiting customer authorization."}, status=400)
    ser = DisputeAllocationAuthorizeSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    if not ser.validated_data["attestation"]:
        return Response({"detail": "Explicit authorization attestation is required."}, status=400)
    allocation.updated_at = timezone.now()
    if ser.validated_data["authorization"] == "reject":
        allocation.status = DisputeEscrowAllocation.STATUS_CANCELED
        allocation.save(update_fields=["status", "updated_at"])
    else:
        allocation.homeowner_authorized_at = allocation.updated_at
        allocation.status = (
            DisputeEscrowAllocation.STATUS_AUTHORIZED
            if allocation.contractor_authorized_at
            else DisputeEscrowAllocation.STATUS_AWAITING_AUTHORIZATION
        )
        allocation.save(update_fields=["homeowner_authorized_at", "status", "updated_at"])
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_ESCROW_ALLOCATION_UPDATED,
        f"Customer {ser.validated_data['authorization']}d escrow allocation",
        related_object=allocation,
    )
    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_dispute_work_pause_respond(request, dispute_id: int, pause_id: int):
    token = (request.query_params.get("token") or "").strip()
    dispute = _get_dispute_by_public_token(dispute_id, token) if token else None
    if not dispute:
        return Response({"detail": "Not found."}, status=404)
    if is_terminal_dispute_status(dispute.status) or dispute.is_archived:
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)
    pause = dispute.work_pause_requests.filter(pk=pause_id).first()
    if not pause:
        return Response({"detail": "Work pause request not found."}, status=404)
    ser = DisputeWorkPauseResponseSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    decision = ser.validated_data["decision"]
    if (
        decision != "end"
        and pause.requested_by
        and not _is_contractor_actor_for_dispute(pause.requested_by, dispute)
    ):
        return Response(
            {"detail": "The requesting party cannot accept its own work-pause request."},
            status=403,
        )
    if decision != "end" and pause.status != DisputeWorkPauseRequest.STATUS_REQUESTED:
        return Response({"detail": "This work-pause request has already been answered."}, status=400)
    if decision == "end" and pause.status != DisputeWorkPauseRequest.STATUS_ACCEPTED:
        return Response({"detail": "Only an accepted work pause can be ended."}, status=400)
    pause.status = {"accept": "accepted", "decline": "declined", "end": "ended"}[decision]
    pause.response_reason = ser.validated_data.get("reason", "")
    pause.responded_at = timezone.now()
    pause.ended_at = pause.responded_at if decision == "end" else pause.ended_at
    pause.save(update_fields=["status", "response_reason", "responded_at", "ended_at"])
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_WORK_PAUSE_UPDATED,
        f"Customer {decision}ed work pause",
        description=pause.response_reason,
        related_object=pause,
        metadata={"payment_hold_unchanged": True},
    )
    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_dispute_claim_access(request, dispute_id: int, claim_id: int):
    token = (request.query_params.get("token") or "").strip()
    dispute = _get_dispute_by_public_token(dispute_id, token) if token else None
    if not dispute:
        return Response({"detail": "Not found."}, status=404)
    if is_terminal_dispute_status(dispute.status) or dispute.is_archived:
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)
    claim = dispute.claims.filter(pk=claim_id, access_required=True).first()
    if not claim:
        return Response({"detail": "Claim with an active access request not found."}, status=404)
    ser = DisputeClaimAccessSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    claim.customer_access_response = ser.validated_data["access_permitted"]
    claim.customer_access_notes = ser.validated_data.get("notes", "")
    claim.save()
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
        "Customer recorded site-access decision",
        description=claim.customer_access_notes,
        related_object=claim,
        metadata={"access_permitted": claim.customer_access_response},
    )
    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_dispute_external_document(request, dispute_id: int):
    token = (request.query_params.get("token") or "").strip()
    dispute = _get_dispute_by_public_token(dispute_id, token) if token else None
    if not dispute:
        return Response({"detail": "Not found."}, status=404)
    if is_terminal_dispute_status(dispute.status) or dispute.is_archived:
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)
    uploaded = request.FILES.get("file")
    if not uploaded:
        return Response({"detail": "Missing file."}, status=400)
    document_type = str(request.data.get("document_type") or "external_decision").strip()
    if document_type not in {"external_decision", "mutual_instructions", "inspection_report", "other"}:
        return Response({"detail": "Unsupported external document type."}, status=400)
    digest = hashlib.sha256()
    for chunk in uploaded.chunks():
        digest.update(chunk)
    uploaded.seek(0)
    document = ResolutionDocument.objects.create(
        dispute=dispute,
        document_type=document_type,
        title=str(request.data.get("title") or getattr(uploaded, "name", "External resolution document"))[:255],
        file=uploaded,
        generated_by=None,
        sha256=digest.hexdigest(),
        metadata={
            "uploaded_as_external_authority": document_type in {"external_decision", "mutual_instructions"},
            "uploaded_by_party": "customer",
            "legal_effect_not_interpreted_by_platform": True,
        },
    )
    dispute.workflow_stage = Dispute.STAGE_EXTERNAL_RESOLUTION
    dispute.last_activity_at = timezone.now()
    dispute.save(update_fields=["workflow_stage", "last_activity_at", "updated_at"])
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_EVIDENCE_UPLOADED,
        "Customer uploaded outside documentation",
        description=document.title,
        related_object=document,
        metadata={"document_type": document.document_type, "sha256": document.sha256},
    )
    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
@transaction.atomic
def public_dispute_message(request, dispute_id: int):
    token = (request.query_params.get("token") or "").strip()
    body = (
        request.data.get("body")
        or request.data.get("message")
        or request.data.get("response")
        or ""
    ).strip()

    if not token:
        return Response({"detail": "Missing token."}, status=400)

    dispute = _get_dispute_by_public_token(dispute_id, token)
    if not dispute:
        return Response({"detail": "Not found."}, status=404)

    if bool(getattr(dispute, "is_archived", False)):
        return Response({"detail": "This dispute is archived and cannot be modified."}, status=400)

    if is_terminal_dispute_status(dispute.status):
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)

    files = []
    try:
        files.extend(request.FILES.getlist("files[]"))
        files.extend(request.FILES.getlist("files"))
    except Exception:
        files = []

    if not body and not files:
        return Response({"detail": "Message or attachment is required."}, status=400)

    now = timezone.now()
    if body:
        tag = f"PUBLIC MESSAGE: {body}".strip()
        dispute.homeowner_response = (dispute.homeowner_response or "") + (
            ("\n\n" if dispute.homeowner_response else "") + tag
        )

    if dispute.status in ("initiated", "open"):
        dispute.status = "under_review"
    dispute.last_activity_at = now
    dispute.save(update_fields=["homeowner_response", "status", "last_activity_at", "updated_at"])

    for file_obj in files:
        requested_kind = (request.data.get("kind") or "").strip().lower()
        content_type = str(getattr(file_obj, "content_type", "") or "").lower()
        attachment_kind = requested_kind if requested_kind in dict(DisputeAttachment.KIND_CHOICES) else "other"
        if attachment_kind == "other" and content_type.startswith("image/"):
            attachment_kind = "photo"
        att = DisputeAttachment.objects.create(
            dispute=dispute,
            kind=attachment_kind,
            file=file_obj,
            uploaded_by=None,
        )
        index_evidence(
            dispute,
            att,
            actor=None,
            description=(request.data.get("description") or "").strip(),
            related_party="customer",
        )

    if files and dispute.qualification_status in {Dispute.QUALIFICATION_PENDING, Dispute.QUALIFICATION_INFORMATION_NEEDED}:
        dispute = assess_dispute_qualification(dispute)

    if body:
        create_party_statement(
            dispute,
            author=None,
            text=body,
            party_role="customer",
            metadata={"public_token_message": True},
        )

    try:
        notify_dispute_event(
            dispute=dispute,
            event_type=Notification.EVENT_DISPUTE_UPDATED,
            actor_user=None,
        )
    except Exception:
        pass

    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_dispute_accept(request, dispute_id: int):
    token = (request.query_params.get("token") or "").strip()
    note = (request.data.get("note") or "").strip()

    if not token:
        return Response({"detail": "Missing token."}, status=400)

    dispute = _get_dispute_by_public_token(dispute_id, token)
    if not dispute:
        return Response({"detail": "Not found."}, status=404)

    if bool(getattr(dispute, "is_archived", False)):
        return Response({"detail": "This dispute is archived and cannot be modified."}, status=400)

    if is_terminal_dispute_status(dispute.status):
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)

    now = timezone.now()
    tag = f"HOMEOWNER ACCEPTED PROPOSAL: {note}".strip()
    dispute.homeowner_response = (dispute.homeowner_response or "") + (
        ("\n\n" if dispute.homeowner_response else "") + tag
    )

    # ✅ Canonical resolution: set status to resolved_contractor and let Dispute.save()
    # create the DisputeWorkOrder + rework milestone on_commit (models_dispute.py).
    dispute.status = "resolved_contractor"
    dispute.escrow_frozen = False
    dispute.resolved_at = now
    dispute.last_activity_at = now

    dispute.save(update_fields=[
        "homeowner_response", "status", "escrow_frozen", "resolved_at",
        "last_activity_at", "updated_at"
    ])
    close_payment_hold(dispute, reason="The customer accepted the recorded resolution proposal.", now=now)
    dispute.refresh_from_db()
    accepted_proposal = dispute.resolution_proposals.order_by("-created_at", "-id").first()
    if accepted_proposal is not None:
        accepted_proposal.status = ResolutionProposal.STATUS_ACCEPTED_CUSTOMER
        accepted_proposal.save(update_fields=["status", "updated_at"])
    create_party_statement(
        dispute,
        author=None,
        text=tag,
        party_role="customer",
        metadata={
            "public_token_accept": True,
            "proposal_id": getattr(accepted_proposal, "id", None),
        },
    )
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_HUMAN_DECISION_RECORDED,
        "Customer accepted resolution proposal",
        actor=None,
        description=note,
        related_object=dispute,
        metadata={"public_token_accept": True},
    )

    # Attempt to resolve rework milestone linkage now (best-effort).
    # NOTE: the actual milestone creation is scheduled via transaction.on_commit in Dispute.save().
    # In practice, with autocommit this will often be immediate; if not, UI can refresh.
    rework_mid = None
    try:
        rework_mid = _try_fetch_rework_milestone_id(dispute)
    except Exception:
        rework_mid = None

    # Contractor + admin confirmation emails (optional)
    if email_contractor_status_update:
        contractor_email = ""
        if dispute.created_by and getattr(dispute.created_by, "email", ""):
            contractor_email = dispute.created_by.email
        email_contractor_status_update(dispute, contractor_email, "Homeowner accepted proposal")

    try:
        notify_dispute_event(
            dispute=dispute,
            event_type=Notification.EVENT_DISPUTE_RESOLVED,
            actor_user=None,
        )
    except Exception:
        pass

    if email_admin_dispute_update:
        from django.conf import settings as dj_settings
        email_admin_dispute_update(dispute, getattr(dj_settings, "DISPUTE_ADMIN_EMAIL", "") or "", "Homeowner accepted proposal")

    payload = DisputePublicSerializer(dispute, context={"request": request}).data
    payload["rework_milestone_created"] = bool(rework_mid)
    payload["rework_milestone_id"] = rework_mid

    return Response(payload, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_dispute_reject(request, dispute_id: int):
    token = (request.query_params.get("token") or "").strip()
    note = (request.data.get("note") or "").strip()

    if not token:
        return Response({"detail": "Missing token."}, status=400)

    dispute = _get_dispute_by_public_token(dispute_id, token)
    if not dispute:
        return Response({"detail": "Not found."}, status=404)

    if bool(getattr(dispute, "is_archived", False)):
        return Response({"detail": "This dispute is archived and cannot be modified."}, status=400)

    if is_terminal_dispute_status(dispute.status):
        return Response({"detail": DISPUTE_TERMINAL_MESSAGE}, status=400)

    now = timezone.now()
    tag = f"HOMEOWNER REJECTED PROPOSAL: {note}".strip()
    dispute.homeowner_response = (dispute.homeowner_response or "") + (
        ("\n\n" if dispute.homeowner_response else "") + tag
    )

    dispute.status = "under_review"
    try:
        dispute.escrow_frozen = dispute.payment_hold.status in {
            DisputePaymentHold.STATUS_TEMPORARY,
            DisputePaymentHold.STATUS_CONTINUED,
            DisputePaymentHold.STATUS_EXPIRATION_PENDING,
        }
    except DisputePaymentHold.DoesNotExist:
        dispute.escrow_frozen = False
    dispute.last_activity_at = now
    dispute.save(update_fields=["homeowner_response", "status", "escrow_frozen", "last_activity_at", "updated_at"])
    create_party_statement(
        dispute,
        author=None,
        text=tag,
        party_role="customer",
        metadata={"public_token_reject": True},
    )
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_HUMAN_DECISION_RECORDED,
        "Customer rejected resolution proposal",
        actor=None,
        description=note,
        related_object=dispute,
        metadata={"public_token_reject": True},
    )

    if email_contractor_status_update:
        contractor_email = ""
        if dispute.created_by and getattr(dispute.created_by, "email", ""):
            contractor_email = dispute.created_by.email
        email_contractor_status_update(dispute, contractor_email, "Homeowner rejected proposal")

    try:
        notify_dispute_event(
            dispute=dispute,
            event_type=Notification.EVENT_DISPUTE_UPDATED,
            actor_user=None,
        )
    except Exception:
        pass

    if email_admin_dispute_update:
        from django.conf import settings as dj_settings
        email_admin_dispute_update(dispute, getattr(dj_settings, "DISPUTE_ADMIN_EMAIL", "") or "", "Homeowner rejected proposal")

    return Response(DisputePublicSerializer(dispute, context={"request": request}).data, status=200)
