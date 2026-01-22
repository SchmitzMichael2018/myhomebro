# backend/projects/services/ai/evidence_context.py
from __future__ import annotations

from typing import Any, Dict, List, Optional

from django.utils import timezone

from ...models_dispute import Dispute
from ...models import Milestone


def _safe_dt(val):
    """
    Keep timestamps JSON-friendly. DRF can serialize datetimes/dates.
    We intentionally do not cast to strings here to preserve native types.
    """
    return val


def _get_model_field_names(obj) -> set[str]:
    try:
        return {f.name for f in obj._meta.fields}
    except Exception:
        return set()


def _milestone_is_rework(m: Milestone) -> bool:
    """
    Best-effort rework detection until you add a dedicated boolean field.
    """
    title = (getattr(m, "title", "") or "").strip().lower()
    return title.startswith("rework") or "rework" in title


def build_dispute_evidence_context(dispute: Dispute) -> Dict[str, Any]:
    """
    Read-only, deterministic evidence snapshot for AI / mediation.

    Rules:
    - NO side effects
    - NO AI calls
    - NO money logic
    - Best-effort field access (schema varies across your app history)

    This payload is designed to be:
    - stable
    - auditable
    - safe for downstream AI summarization and recommendations
    """
    agreement = getattr(dispute, "agreement", None)
    dispute_milestone = getattr(dispute, "milestone", None)

    # ──────────────────────────────────────────────────────────────────────────
    # Agreement snapshot (best-effort schema)
    # ──────────────────────────────────────────────────────────────────────────
    agreement_data: Optional[Dict[str, Any]] = None
    if agreement:
        agreement_data = {
            "id": getattr(agreement, "id", None),
            "title": getattr(agreement, "project_title", None) or getattr(agreement, "title", None),
            "agreement_number": getattr(agreement, "agreement_number", None) or getattr(agreement, "number", None),
            "homeowner_name": getattr(agreement, "homeowner_name", None),
            "homeowner_email": getattr(agreement, "homeowner_email", None),
            "contractor_name": getattr(agreement, "contractor_name", None),
            "contractor_email": getattr(agreement, "contractor_email", None),
            "total_amount": getattr(agreement, "total_cost", None) or getattr(agreement, "total_amount", None),
            "start_date": _safe_dt(getattr(agreement, "start_date", None)),
            "end_date": _safe_dt(getattr(agreement, "end_date", None)),
            "created_at": _safe_dt(getattr(agreement, "created_at", None)),
            "updated_at": _safe_dt(getattr(agreement, "updated_at", None)),
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Milestones snapshot (all milestones on agreement)
    # ──────────────────────────────────────────────────────────────────────────
    milestones_data: List[Dict[str, Any]] = []
    if agreement:
        qs = Milestone.objects.filter(agreement=agreement).order_by("order", "id")
        for m in qs:
            field_names = _get_model_field_names(m)
            milestones_data.append({
                "id": m.id,
                "title": getattr(m, "title", "") or "",
                "description": getattr(m, "description", "") or "",
                "amount": getattr(m, "amount", None),
                "order": getattr(m, "order", None),
                "completed": getattr(m, "completed", None),
                "status": getattr(m, "status", None) if "status" in field_names else None,
                "due_date": _safe_dt(getattr(m, "due_date", None)),
                "completion_date": _safe_dt(getattr(m, "completion_date", None)),
                "is_rework": _milestone_is_rework(m),
                # If you later add explicit flags like is_billable/is_invoiced, these will populate:
                "is_billable": getattr(m, "is_billable", None) if "is_billable" in field_names else getattr(m, "billable", None) if "billable" in field_names else None,
                "is_invoiced": getattr(m, "is_invoiced", None) if "is_invoiced" in field_names else getattr(m, "invoiced", None) if "invoiced" in field_names else None,
            })

    # ──────────────────────────────────────────────────────────────────────────
    # Invoices snapshot (best-effort)
    # NOTE: Your schema may relate invoices differently. We stay conservative:
    # - If a milestone has an invoice attribute, we include it.
    # - If not, we return an empty list (no guessing across unknown models).
    # ──────────────────────────────────────────────────────────────────────────
    invoices_data: List[Dict[str, Any]] = []
    if dispute_milestone is not None and hasattr(dispute_milestone, "invoice"):
        try:
            inv = dispute_milestone.invoice
            invoices_data.append({
                "id": getattr(inv, "id", None),
                "invoice_number": getattr(inv, "invoice_number", None) or getattr(inv, "number", None),
                "amount": getattr(inv, "amount", None),
                "status": getattr(inv, "status", None),
                "display_status": getattr(inv, "display_status", None),
                "created_at": _safe_dt(getattr(inv, "created_at", None)),
                "sent_at": _safe_dt(getattr(inv, "sent_at", None) or getattr(inv, "email_sent_at", None)),
                "approved_at": _safe_dt(getattr(inv, "approved_at", None)),
                "paid_at": _safe_dt(getattr(inv, "paid_at", None)),
                "released_at": _safe_dt(getattr(inv, "released_at", None)),
                "disputed": getattr(inv, "disputed", None),
            })
        except Exception:
            # fail safe
            pass

    # ──────────────────────────────────────────────────────────────────────────
    # Attachments / evidence (metadata only)
    # ──────────────────────────────────────────────────────────────────────────
    evidence_data: List[Dict[str, Any]] = []
    try:
        for att in dispute.attachments.all():
            evidence_data.append({
                "id": getattr(att, "id", None),
                "kind": getattr(att, "kind", None),
                "file": att.file.name if getattr(att, "file", None) else None,
                "uploaded_by": getattr(getattr(att, "uploaded_by", None), "email", None),
                "uploaded_at": _safe_dt(getattr(att, "created_at", None)),
            })
    except Exception:
        pass

    # ──────────────────────────────────────────────────────────────────────────
    # Dispute snapshot (core fields)
    # ──────────────────────────────────────────────────────────────────────────
    dispute_data: Dict[str, Any] = {
        "id": getattr(dispute, "id", None),
        "status": getattr(dispute, "status", None),
        "initiator": getattr(dispute, "initiator", None),
        "category": getattr(dispute, "category", None),
        "complaint": getattr(dispute, "complaint", None),
        "proposal": getattr(dispute, "proposal", None),
        "contractor_response": getattr(dispute, "contractor_response", None),
        "homeowner_response": getattr(dispute, "homeowner_response", None),
        "admin_notes": getattr(dispute, "admin_notes", None),
        "fee_paid": getattr(dispute, "fee_paid", None),
        "fee_paid_at": _safe_dt(getattr(dispute, "fee_paid_at", None)),
        "escrow_frozen": getattr(dispute, "escrow_frozen", None),
        "response_due_at": _safe_dt(getattr(dispute, "response_due_at", None)),
        "proposal_due_at": _safe_dt(getattr(dispute, "proposal_due_at", None)),
        "created_at": _safe_dt(getattr(dispute, "created_at", None)),
        "responded_at": _safe_dt(getattr(dispute, "responded_at", None)),
        "resolved_at": _safe_dt(getattr(dispute, "resolved_at", None)),
        "last_activity_at": _safe_dt(getattr(dispute, "last_activity_at", None)),
    }

    return {
        "meta": {
            "generated_at": timezone.now(),
            "dispute_id": dispute.id,
            "agreement_id": getattr(agreement, "id", None) if agreement else None,
        },
        "agreement": agreement_data,
        "milestones": milestones_data,
        "invoices": invoices_data,
        "dispute": dispute_data,
        "evidence": evidence_data,
    }
