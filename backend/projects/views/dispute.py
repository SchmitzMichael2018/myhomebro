# backend/projects/views/dispute.py
from __future__ import annotations

import json
from datetime import datetime

from django.conf import settings
from django.core.exceptions import FieldError
from django.db.models import Q
from django.utils import timezone

from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework.response import Response

from ..models_dispute import Dispute, DisputeAttachment, DisputeWorkOrder
from ..services.dispute_status import is_terminal_dispute_status
from ..serializers.dispute import (
    DisputeSerializer,
    DisputeCreateSerializer,
    DisputeRespondSerializer,
    DisputeResolveSerializer,
    DisputeAttachmentSerializer,
    DisputePublicSerializer,
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
    )
except Exception:
    email_homeowner_proposal_sent = None
    email_contractor_status_update = None
    email_admin_dispute_update = None

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

    # Creator of dispute is contractor side (your contractor console)
    if getattr(dispute, "created_by_id", None) == getattr(user, "id", None):
        return True

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
        return Response(DisputeSerializer(dispute, context={"request": request}).data)

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
        dispute = ser.save()

        dispute.ensure_public_token()
        dispute.last_activity_at = timezone.now()
        dispute.save(update_fields=["public_token", "last_activity_at", "updated_at"])

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

        if dispute.fee_paid:
            return Response({"detail": "Fee already paid."}, status=200)

        now = timezone.now()
        dispute.fee_paid = True
        dispute.fee_paid_at = now
        dispute.status = "open"
        dispute.escrow_frozen = True

        if hasattr(dispute, "set_response_deadline_now"):
            dispute.set_response_deadline_now()
        else:
            dispute.last_activity_at = now

        dispute.save(update_fields=[
            "fee_paid", "fee_paid_at", "status", "escrow_frozen",
            "response_due_at", "deadline_hours", "deadline_tier", "last_activity_at",
            "updated_at"
        ])

        if email_admin_dispute_update:
            from django.conf import settings as dj_settings
            email_admin_dispute_update(dispute, getattr(dj_settings, "DISPUTE_ADMIN_EMAIL", "") or "", "Fee paid / escrow frozen")
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_UPDATED,
                actor_user=request.user,
            )
        except Exception:
            pass

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)

    @action(detail=True, methods=["patch"], url_path="respond")
    def respond(self, request, pk=None):
        dispute: Dispute = self.get_object()

        blocked = _block_if_archived(dispute)
        if blocked is not None:
            return blocked

        blocked = _block_if_terminal(dispute)
        if blocked is not None:
            return blocked

        if not dispute.fee_paid:
            return Response({"detail": "Dispute fee must be paid before responses."}, status=400)

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

        if proposal_sent and email_homeowner_proposal_sent:
            email_homeowner_proposal_sent(dispute)
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_UPDATED,
                actor_user=request.user,
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

        dispute.last_activity_at = timezone.now()
        dispute.save(update_fields=["last_activity_at", "updated_at"])
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_UPDATED,
                actor_user=request.user,
            )
        except Exception:
            pass

        return Response(DisputeAttachmentSerializer(att, context={"request": request}).data, status=201)

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

        outcome = ser.validated_data["outcome"]
        admin_notes = (ser.validated_data.get("admin_notes") or "").strip()

        now = timezone.now()
        dispute.admin_notes = admin_notes

        if outcome == "contractor":
            dispute.status = "resolved_contractor"
        elif outcome == "homeowner":
            dispute.status = "resolved_homeowner"
        else:
            dispute.status = "canceled"

        dispute.escrow_frozen = False
        dispute.resolved_at = now
        dispute.last_activity_at = now
        dispute.save(update_fields=[
            "admin_notes", "status", "escrow_frozen", "resolved_at",
            "last_activity_at", "updated_at"
        ])
        try:
            notify_dispute_event(
                dispute=dispute,
                event_type=Notification.EVENT_DISPUTE_RESOLVED,
                actor_user=request.user,
            )
        except Exception:
            pass

        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=200)


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


@api_view(["POST"])
@permission_classes([AllowAny])
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
        DisputeAttachment.objects.create(
            dispute=dispute,
            kind=(request.data.get("kind") or "other").strip(),
            file=file_obj,
            uploaded_by=None,
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
    dispute.escrow_frozen = True
    dispute.last_activity_at = now
    dispute.save(update_fields=["homeowner_response", "status", "escrow_frozen", "last_activity_at", "updated_at"])

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
