from __future__ import annotations

from decimal import Decimal

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import AgreementProjectClass, PublicContractorLead
from projects.models_project_intake import ProjectIntake
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.bid_workflow import (
    bid_next_action,
    bid_status_group,
    bid_status_label,
    format_money,
    infer_project_class,
    normalize_bid_status,
    parse_money_like_text,
    project_class_label,
)


def _resolve_contractor(user):
    return resolve_contractor_for_user(user)


def _safe_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _format_date(value):
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return None


def _agreement_label(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", ""))
        or _safe_text(getattr(agreement, "project_title", ""))
        or f"Agreement #{agreement.id}"
    )


def _agreement_reference(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    project_number = _safe_text(getattr(project, "number", ""))
    if project_number:
        return f"Agreement {project_number}"
    return f"Agreement #{agreement.id}"


def _milestone_preview(payload) -> list[str]:
    items = payload if isinstance(payload, list) else []
    out: list[str] = []
    for row in items[:3]:
        if isinstance(row, dict):
            title = _safe_text(row.get("title") or row.get("name"))
            if title:
                out.append(title)
    return out


def _estimate_amount_from_payload(payload) -> Decimal | None:
    if not isinstance(payload, dict):
        return None
    estimate = payload.get("estimate_preview")
    if not isinstance(estimate, dict):
        return None
    return parse_money_like_text(estimate.get("suggested_total_price"))


def _format_bid_amount(amount: Decimal | None) -> str:
    if amount is None:
        return "-"
    return f"${amount:,.2f}"


def _contractor_status_label(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "expired":
        return "Not Selected"
    return bid_status_label(normalized)


def _contractor_status_note(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "follow_up":
        return "This lead is saved for later review."
    if normalized == "expired":
        return "Another contractor was selected for this project."
    if normalized == "declined":
        return "This bid was declined."
    return ""


def _measurement_label(value) -> str:
    normalized = _safe_text(value).lower()
    if normalized == "provided":
        return "Provided"
    if normalized == "site_visit_required":
        return "Site visit required"
    if normalized == "not_sure":
        return "Not sure"
    return ""


def _request_path_label(intake) -> str:
    flow = _safe_text(getattr(intake, "post_submit_flow", "")).lower()
    if flow == "multi_contractor":
        return "Multi-quote request"
    if flow == "single_contractor":
        return "Single contractor request"
    return "Project request"


def _clarification_summary(source_intake) -> list[dict]:
    if source_intake is None:
        return []
    questions = getattr(source_intake, "ai_clarification_questions", None)
    answers = getattr(source_intake, "ai_clarification_answers", None)
    if not isinstance(questions, list) or not isinstance(answers, dict):
        return []

    rows: list[dict] = []
    for question in questions:
        if len(rows) >= 6 or not isinstance(question, dict):
            continue
        key = _safe_text(question.get("key"))
        if not key:
            continue
        raw_value = answers.get(key)
        if isinstance(raw_value, list):
            value = ", ".join(_safe_text(item) for item in raw_value if _safe_text(item))
        else:
            value = _safe_text(raw_value)
        if not value:
            continue
        label = _safe_text(question.get("label") or question.get("question") or key)
        rows.append({"key": key, "label": label, "value": value})
    return rows


def _request_signals(*, source_intake, snapshot: dict) -> list[str]:
    signals: list[str] = []

    if snapshot.get("guided_intake_completed"):
        signals.append("Guided Intake")
    if snapshot.get("photo_count", 0):
        signals.append("Photos")
    if snapshot.get("budget"):
        signals.append("Budget Provided")
    if snapshot.get("timeline"):
        signals.append("Timeline Provided")
    if snapshot.get("measurement_handling"):
        signals.append("Measurements Noted")
    if snapshot.get("clarification_count", 0):
        signals.append("Clarifications Answered")
    if _request_path_label(source_intake) == "Multi-quote request":
        signals.append("Multi-Quote Request")
    return signals


def _snapshot_from_intake(*, source_intake, lead=None, analysis=None, request=None) -> dict:
    if source_intake is None and lead is None:
        return {}

    analysis = analysis if isinstance(analysis, dict) else {}
    source_intake = source_intake or None
    lead = lead or None

    photos = []
    if source_intake is not None:
        try:
            photo_rows = list(source_intake.clarification_photos.all().order_by("-uploaded_at", "-id"))
        except Exception:
            photo_rows = []
        for photo in photo_rows[:6]:
            image = getattr(photo, "image", None)
            image_url = ""
            try:
                image_url = request.build_absolute_uri(image.url) if request and image else getattr(image, "url", "")
            except Exception:
                image_url = ""
            photos.append(
                {
                    "id": getattr(photo, "id", None),
                    "image_url": image_url,
                    "original_name": _safe_text(getattr(photo, "original_name", "")),
                    "caption": _safe_text(getattr(photo, "caption", "")),
                    "uploaded_at": _format_date(getattr(photo, "uploaded_at", None)),
                }
            )

    clarification_summary = _clarification_summary(source_intake)
    clarification_answers = getattr(source_intake, "ai_clarification_answers", {}) if source_intake else {}
    measurement_handling = _measurement_label(
        getattr(source_intake, "measurement_handling", "")
        or clarification_answers.get("measurement_handling", "")
    )
    budget_value = getattr(source_intake, "ai_project_budget", None) if source_intake else None
    budget_label = (
        f"${Decimal(str(budget_value)).quantize(Decimal('0.01')):,.2f}"
        if budget_value not in {None, ""}
        else _safe_text(getattr(lead, "budget_text", ""))
        or _safe_text(analysis.get("suggested_total_price"))
    )
    timeline_value = getattr(source_intake, "ai_project_timeline_days", None) if source_intake else None
    timeline_label = (
        f"{int(timeline_value)} days"
        if timeline_value not in {None, ""}
        else _safe_text(getattr(lead, "preferred_timeline", ""))
    )
    project_title = (
        _safe_text(getattr(source_intake, "ai_project_title", ""))
        or _safe_text(analysis.get("suggested_title"))
        or _safe_text(getattr(lead, "project_type", ""))
        or _safe_text(getattr(lead, "project_description", ""))
        or "Project Request"
    )
    project_type = _safe_text(getattr(source_intake, "ai_project_type", "")) or _safe_text(analysis.get("project_type"))
    project_subtype = _safe_text(getattr(source_intake, "ai_project_subtype", "")) or _safe_text(analysis.get("project_subtype"))
    refined_description = (
        _safe_text(getattr(source_intake, "ai_description", ""))
        or _safe_text(analysis.get("suggested_description"))
        or _safe_text(getattr(lead, "project_description", ""))
    )
    project_address = getattr(source_intake, "project_address_display", "") if source_intake else ""
    if not project_address:
        project_address = "\n".join(
            part
            for part in [
                _safe_text(getattr(lead, "project_address", "")),
                ", ".join(
                    p
                    for p in [
                        _safe_text(getattr(lead, "city", "")),
                        _safe_text(getattr(lead, "state", "")),
                        _safe_text(getattr(lead, "zip_code", "")),
                    ]
                    if p
                ),
            ]
            if part
        )
    location = _safe_text(project_address)
    if not location and source_intake is not None:
        location = "\n".join(
            part
            for part in [
                _safe_text(getattr(source_intake, "project_address_line1", "")),
                _safe_text(getattr(source_intake, "project_address_line2", "")),
                ", ".join(
                    p
                    for p in [
                        _safe_text(getattr(source_intake, "project_city", "")),
                        _safe_text(getattr(source_intake, "project_state", "")),
                        _safe_text(getattr(source_intake, "project_postal_code", "")),
                    ]
                    if p
                ),
            ]
            if part
        )
    request_path_label = _request_path_label(source_intake)
    clarification_count = len([row for row in clarification_summary if row.get("value")])
    project_phases = _milestone_preview(analysis.get("milestones") or getattr(source_intake, "ai_milestones", []) or [])
    snapshot = {
        "project_title": project_title,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "refined_description": refined_description,
        "location": location,
        "request_path_label": request_path_label,
        "measurement_handling": measurement_handling,
        "timeline": timeline_label,
        "budget": budget_label,
        "clarification_summary": clarification_summary,
        "clarification_count": clarification_count,
        "photo_count": len(photos),
        "photos": photos,
        "milestones": project_phases,
        "guided_intake_completed": bool(
            source_intake
            and (
                getattr(source_intake, "ai_clarification_questions", None)
                or getattr(source_intake, "ai_clarification_answers", None)
                or getattr(source_intake, "clarification_photos", None)
            )
        ),
        "materials_status": next(
            (
                row["value"]
                for row in clarification_summary
                if "material" in _safe_text(row.get("key", "")).lower()
                or "material" in _safe_text(row.get("label", "")).lower()
            ),
            "",
        ),
    }
    snapshot["request_signals"] = _request_signals(source_intake=source_intake, snapshot=snapshot)
    return snapshot


def _workspace_stage(status: str, source_kind: str) -> str:
    normalized_status = _safe_text(status).lower()
    if normalized_status in {"declined", "expired"}:
        return "closed"
    if normalized_status == "follow_up":
        return "follow_up"
    if _safe_text(source_kind).lower() == "lead" and normalized_status in {"draft", "submitted"}:
        return "new_lead"
    return "active_bid"


def _workspace_stage_label(stage: str) -> str:
    normalized = _safe_text(stage).lower()
    if normalized == "new_lead":
        return "New Lead"
    if normalized == "follow_up":
        return "Follow-Up"
    if normalized == "closed":
        return "Closed / Archived"
    return "Active Bid"


def _bid_row_from_lead(lead, request=None) -> dict:
    linked_agreement = getattr(lead, "converted_agreement", None)
    source_intake = getattr(lead, "source_intake", None)
    if linked_agreement is None and getattr(source_intake, "agreement_id", None):
        linked_agreement = source_intake.agreement

    analysis = (
        getattr(source_intake, "ai_analysis_payload", None)
        or getattr(lead, "ai_analysis", None)
        or {}
    )
    snapshot = _snapshot_from_intake(source_intake=source_intake, lead=lead, analysis=analysis, request=request)
    project_title = (
        _safe_text(snapshot.get("project_title"))
        or _safe_text(analysis.get("suggested_title"))
        or _safe_text(lead.project_type)
        or _safe_text(lead.project_description)
        or f"Lead #{lead.id}"
    )
    project_notes = (
        _safe_text(snapshot.get("refined_description"))
        or _safe_text(analysis.get("suggested_description"))
        or _safe_text(lead.project_description)
        or _safe_text(lead.project_type)
    )
    project_class = (
        _safe_text(getattr(linked_agreement, "project_class", ""))
        or infer_project_class(
            _safe_text(snapshot.get("project_type")) or lead.project_type,
            _safe_text(snapshot.get("project_subtype")) or lead.project_description,
            _safe_text(snapshot.get("timeline")) or lead.preferred_timeline,
            _safe_text(snapshot.get("budget")) or lead.budget_text,
            analysis.get("project_type"),
            analysis.get("project_subtype"),
            project_notes,
        )
    )
    status = normalize_bid_status(
        raw_status=lead.status,
        has_agreement=bool(getattr(linked_agreement, "id", None)),
        record_kind="lead",
    )
    submitted_at = (
        getattr(lead, "accepted_at", None)
        or getattr(source_intake, "submitted_at", None)
        or getattr(source_intake, "completed_at", None)
        or lead.converted_at
        or lead.created_at
    )
    bid_amount = (
        getattr(linked_agreement, "total_cost", None)
        or parse_money_like_text(snapshot.get("budget"))
        or parse_money_like_text(lead.budget_text)
        or parse_money_like_text(analysis.get("suggested_total_price"))
    )
    workspace_stage = _workspace_stage(status, "lead")

    return {
        "bid_id": f"lead-{lead.id}",
        "record_id": lead.id,
        "source_kind": "lead",
        "source_kind_label": "Lead",
        "workspace_stage": workspace_stage,
        "workspace_stage_label": _workspace_stage_label(workspace_stage),
        "source_id": lead.id,
        "source_reference": f"Lead #{lead.id}",
        "project_title": project_title,
        "customer_name": _safe_text(lead.full_name) or "Unknown Customer",
        "customer_email": _safe_text(lead.email),
        "customer_phone": _safe_text(lead.phone),
        "location": _safe_text(snapshot.get("location")) or _safe_text(lead.city) or _safe_text(lead.project_address),
        "project_type": _safe_text(snapshot.get("project_type")) or _safe_text(lead.project_type),
        "project_subtype": _safe_text(snapshot.get("project_subtype")),
        "request_path_label": _safe_text(snapshot.get("request_path_label")),
        "measurement_handling": _safe_text(snapshot.get("measurement_handling")),
        "photo_count": int(snapshot.get("photo_count") or 0),
        "request_signals": snapshot.get("request_signals") or [],
        "request_snapshot": snapshot,
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
        "bid_amount_label": _format_bid_amount(bid_amount),
        "submitted_at": _format_date(submitted_at),
        "updated_at": _format_date(getattr(lead, "updated_at", None)),
        "status": status,
        "status_label": _contractor_status_label(status),
        "status_group": bid_status_group(status),
        "status_note": _contractor_status_note(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": project_notes,
        "timeline": _safe_text(snapshot.get("timeline")) or _safe_text(lead.preferred_timeline),
        "budget_text": _safe_text(snapshot.get("budget")) or _safe_text(lead.budget_text),
        "milestone_preview": _milestone_preview(analysis.get("milestones") or snapshot.get("milestones") or []),
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="lead",
        ),
    }


def _bid_row_from_intake(intake, request=None) -> dict:
    if getattr(intake, "public_lead_id", None):
        return {}

    linked_agreement = getattr(intake, "agreement", None)
    analysis = intake.ai_analysis_payload or {}
    snapshot = _snapshot_from_intake(source_intake=intake, analysis=analysis, request=request)
    project_title = (
        _safe_text(snapshot.get("project_title"))
        or _safe_text(intake.ai_project_title)
        or _safe_text(analysis.get("project_title"))
        or _safe_text(intake.accomplishment_text)
        or f"Intake #{intake.id}"
    )
    project_notes = (
        _safe_text(snapshot.get("refined_description"))
        or _safe_text(intake.ai_description)
        or _safe_text(intake.accomplishment_text)
        or _safe_text(intake.ai_project_subtype)
        or _safe_text(intake.ai_project_type)
    )
    project_class = (
        _safe_text(getattr(linked_agreement, "project_class", ""))
        or infer_project_class(
            _safe_text(snapshot.get("project_type")) or intake.ai_project_type,
            _safe_text(snapshot.get("project_subtype")) or intake.ai_project_subtype,
            _safe_text(snapshot.get("refined_description")) or intake.ai_description,
            intake.accomplishment_text,
            intake.customer_name,
            project_notes,
        )
    )
    status = normalize_bid_status(
        raw_status=intake.status,
        has_agreement=bool(getattr(linked_agreement, "id", None)),
        record_kind="intake",
    )
    submitted_at = intake.submitted_at or intake.analyzed_at or intake.converted_at or intake.created_at
    bid_amount = (
        getattr(linked_agreement, "total_cost", None)
        or parse_money_like_text(snapshot.get("budget"))
        or _estimate_amount_from_payload(analysis)
    )
    workspace_stage = _workspace_stage(status, "intake")

    return {
        "bid_id": f"intake-{intake.id}",
        "record_id": intake.id,
        "source_kind": "intake",
        "source_kind_label": "Intake",
        "workspace_stage": workspace_stage,
        "workspace_stage_label": _workspace_stage_label(workspace_stage),
        "source_id": intake.id,
        "source_reference": f"Intake #{intake.id}",
        "project_title": project_title,
        "customer_name": _safe_text(intake.customer_name) or "Unknown Customer",
        "customer_email": _safe_text(intake.customer_email),
        "customer_phone": _safe_text(intake.customer_phone),
        "location": _safe_text(snapshot.get("location")) or _safe_text(intake.project_address_display),
        "project_type": _safe_text(snapshot.get("project_type")) or _safe_text(intake.ai_project_type),
        "project_subtype": _safe_text(snapshot.get("project_subtype")) or _safe_text(intake.ai_project_subtype),
        "request_path_label": _safe_text(snapshot.get("request_path_label")),
        "measurement_handling": _safe_text(snapshot.get("measurement_handling")) or _safe_text(intake.measurement_handling),
        "photo_count": int(snapshot.get("photo_count") or 0),
        "request_signals": snapshot.get("request_signals") or [],
        "request_snapshot": snapshot,
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
        "bid_amount_label": _format_bid_amount(bid_amount),
        "submitted_at": _format_date(submitted_at),
        "updated_at": _format_date(getattr(intake, "updated_at", None)),
        "status": status,
        "status_label": _contractor_status_label(status),
        "status_group": bid_status_group(status),
        "status_note": _contractor_status_note(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": project_notes,
        "timeline": _safe_text(snapshot.get("timeline")),
        "budget_text": _safe_text(snapshot.get("budget")),
        "milestone_preview": _milestone_preview(analysis.get("milestones") or snapshot.get("milestones") or intake.ai_milestones or []),
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="intake",
        ),
    }


def _filter_rows(rows: list[dict], *, status_filter: str = "", project_class_filter: str = "", search: str = "") -> list[dict]:
    status_value = _safe_text(status_filter).lower()
    class_value = _safe_text(project_class_filter).lower()
    query = _safe_text(search).lower()

    out = []
    for row in rows:
        if status_value and status_value != "all" and row.get("status") != status_value:
            continue
        if class_value and class_value != "all" and row.get("project_class") != class_value:
            continue
        if query:
            haystack = " ".join(
                [
                    _safe_text(row.get("project_title")),
                    _safe_text(row.get("customer_name")),
                    _safe_text(row.get("customer_email")),
                    _safe_text(row.get("customer_phone")),
                    _safe_text(row.get("location")),
                    _safe_text(row.get("notes")),
                    _safe_text(row.get("budget_text")),
                    _safe_text(row.get("status_label")),
                    _safe_text(row.get("source_reference")),
                    _safe_text(row.get("linked_agreement_reference")),
                    " ".join(_safe_text(signal) for signal in (row.get("request_signals") or [])),
                ]
            ).lower()
            if query not in haystack:
                continue
        out.append(row)
    return out


class ContractorBidsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        leads = list(
            contractor.public_leads.select_related(
                "converted_agreement",
                "source_intake",
                "source_intake__agreement",
            )
            .prefetch_related("source_intake__clarification_photos")
            .order_by("-created_at", "-id")
        )
        intakes = list(
            ProjectIntake.objects.filter(contractor=contractor)
            .select_related("agreement", "public_lead", "public_lead__converted_agreement")
            .prefetch_related("clarification_photos")
            .order_by("-created_at", "-id")
        )

        rows: list[dict] = []
        linked_intake_ids = set()
        for lead in leads:
            source_intake = getattr(lead, "source_intake", None)
            if source_intake is not None:
                linked_intake_ids.add(source_intake.id)
            row = _bid_row_from_lead(lead, request=request)
            rows.append(row)

        for intake in intakes:
            if intake.id in linked_intake_ids or getattr(intake, "public_lead_id", None):
                continue
            row = _bid_row_from_intake(intake, request=request)
            if row:
                rows.append(row)

        rows.sort(
            key=lambda row: (
                row.get("submitted_at") or "",
                row.get("bid_id") or 0,
            ),
            reverse=True,
        )

        status_filter = _safe_text(request.GET.get("status", "")).lower()
        project_class_filter = _safe_text(request.GET.get("project_class", "")).lower()
        search = _safe_text(request.GET.get("search", ""))
        filtered_rows = _filter_rows(
            rows,
            status_filter=status_filter,
            project_class_filter=project_class_filter,
            search=search,
        )

        summary = {
            "total_bids": len(filtered_rows),
            "follow_up_leads": sum(1 for row in filtered_rows if row.get("workspace_stage") == "follow_up"),
            "open_bids": sum(1 for row in filtered_rows if row.get("status_group") == "open"),
            "under_review_bids": sum(1 for row in filtered_rows if row.get("status_group") == "under_review"),
            "awarded_bids": sum(1 for row in filtered_rows if row.get("status_group") == "awarded"),
            "declined_expired_bids": sum(
                1 for row in filtered_rows if row.get("status_group") == "declined_expired"
            ),
            "residential_count": sum(
                1 for row in filtered_rows if row.get("project_class") == AgreementProjectClass.RESIDENTIAL
            ),
            "commercial_count": sum(
                1 for row in filtered_rows if row.get("project_class") == AgreementProjectClass.COMMERCIAL
            ),
        }

        return Response(
            {
                "results": filtered_rows,
                "summary": summary,
                "filters": {
                    "status": status_filter or "all",
                    "project_class": project_class_filter or "all",
                    "search": search,
                },
            },
            status=200,
        )
