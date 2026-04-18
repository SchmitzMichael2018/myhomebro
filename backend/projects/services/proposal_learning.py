from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
import re
from typing import Any, Iterable

from django.db import transaction

from projects.models import Agreement, ProjectStatus
from projects.models_learning import AgreementOutcomeSnapshot, AgreementProposalSnapshot


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _first_non_empty(*values: Any) -> str:
    for value in values:
        text = _safe_text(value)
        if text:
            return text
    return ""


def _agreement_source_lead(agreement: Agreement):
    return getattr(agreement, "source_lead", None)


def _proposal_snapshot_payload(
    agreement: Agreement,
    *,
    stage: str,
    is_successful: bool = False,
    success_reason: str = "",
) -> dict[str, Any]:
    source_lead = _agreement_source_lead(agreement)
    source_snapshot = {}
    if source_lead is not None:
        analysis = getattr(source_lead, "ai_analysis", None) or {}
        source_snapshot = analysis.get("request_snapshot") if isinstance(analysis, dict) else {}
        if not isinstance(source_snapshot, dict):
            source_snapshot = {}

    request_signals = _safe_list(source_snapshot.get("request_signals"))
    clarification_summary = _safe_list(source_snapshot.get("clarification_summary"))

    project_title = _first_non_empty(
        getattr(getattr(agreement, "project", None), "title", ""),
        getattr(agreement, "project_title", ""),
        source_snapshot.get("project_title"),
        getattr(source_lead, "project_type", ""),
    )
    project_type = _first_non_empty(
        getattr(agreement, "project_type", ""),
        source_snapshot.get("project_type"),
        getattr(source_lead, "project_type", ""),
    )
    project_subtype = _first_non_empty(
        getattr(agreement, "project_subtype", ""),
        source_snapshot.get("project_subtype"),
    )

    description = _first_non_empty(
        getattr(agreement, "description", ""),
        source_snapshot.get("refined_description"),
        getattr(source_lead, "project_description", ""),
    )

    budget_text = _first_non_empty(
        source_snapshot.get("budget"),
        getattr(source_lead, "budget_text", ""),
        getattr(agreement, "total_cost", ""),
    )
    timeline_text = _first_non_empty(
        source_snapshot.get("timeline"),
        getattr(source_lead, "preferred_timeline", ""),
        getattr(agreement, "total_time_estimate", ""),
    )
    clarification_answers = source_snapshot.get("clarification_answers") or {}
    measurement_handling = _first_non_empty(
        source_snapshot.get("measurement_handling"),
        clarification_answers.get("measurement_handling"),
    )
    photo_count = int(source_snapshot.get("photo_count") or 0)
    request_path_label = _first_non_empty(source_snapshot.get("request_path_label"))

    brand_voice = _brand_voice_payload(contractor=getattr(agreement, "contractor", None))
    brand_tagline = _safe_text(brand_voice.get("brand_tagline"))
    short_company_intro = _safe_text(brand_voice.get("short_company_intro"))
    proposal_tone = _safe_text(brand_voice.get("proposal_tone"))
    preferred_signoff = _safe_text(brand_voice.get("preferred_signoff"))
    brand_primary_color = _safe_text(brand_voice.get("brand_primary_color"))
    brand_voice_applied = bool(
        _safe_text(brand_tagline)
        or _safe_text(short_company_intro)
        or _safe_text(proposal_tone)
        or _safe_text(preferred_signoff)
        or _safe_text(brand_primary_color)
    )

    return {
        "agreement": agreement,
        "contractor": getattr(agreement, "contractor", None),
        "source_lead": source_lead,
        "template": getattr(agreement, "selected_template", None),
        "stage": stage,
        "is_successful": is_successful,
        "success_reason": success_reason,
        "project_title": project_title,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "proposal_text": description,
        "budget_text": budget_text,
        "timeline_text": timeline_text,
        "measurement_handling": measurement_handling,
        "photo_count": photo_count,
        "request_path_label": request_path_label,
        "request_signals": request_signals,
        "clarification_summary": clarification_summary,
        "metadata": {
            "agreement_status": _safe_text(getattr(agreement, "status", "")),
            "final_agreed_total_amount": _safe_text(getattr(agreement, "total_cost", "")),
            "completed_date": _safe_text(getattr(agreement, "completed_at", "")),
            "source_stage": stage,
        },
        "agreement_status": _safe_text(getattr(agreement, "status", "")),
    }


def _success_reason(agreement: Agreement, outcome_snapshot: AgreementOutcomeSnapshot | None = None) -> tuple[bool, str]:
    status = _safe_text(getattr(agreement, "status", "")).lower()
    if status != ProjectStatus.COMPLETED:
        return False, "Agreement has not completed."

    if outcome_snapshot is None:
        return False, "Outcome snapshot not available yet."

    if bool(getattr(outcome_snapshot, "has_disputes", False)):
        return False, "Agreement completed with disputes."
    if Decimal(str(getattr(outcome_snapshot, "final_paid_amount", "0") or "0")) <= Decimal("0"):
        return False, "No paid amount recorded."
    return True, "Completed without disputes and with paid milestones."


@transaction.atomic
def capture_agreement_proposal_snapshot(
    agreement: Agreement | int,
    *,
    stage: str = AgreementProposalSnapshot.Stage.DRAFT_CREATED,
) -> AgreementProposalSnapshot:
    if isinstance(agreement, int):
        agreement = Agreement.objects.select_related(
            "contractor",
            "homeowner",
            "selected_template",
            "source_lead",
            "project",
        ).get(pk=agreement)
    else:
        agreement = Agreement.objects.select_related(
            "contractor",
            "homeowner",
            "selected_template",
            "source_lead",
            "project",
        ).get(pk=agreement.pk)

    try:
        outcome_snapshot = agreement.outcome_snapshot
    except Exception:
        outcome_snapshot = None
    success, reason = _success_reason(agreement, outcome_snapshot)
    if stage != AgreementProposalSnapshot.Stage.FINALIZED:
        success = False
        reason = "Draft created."

    payload = _proposal_snapshot_payload(
        agreement,
        stage=stage,
        is_successful=success,
        success_reason=reason,
    )

    snapshot, created = AgreementProposalSnapshot.objects.get_or_create(
        agreement=agreement,
        stage=stage,
        defaults=payload,
    )

    if not created:
        snapshot = AgreementProposalSnapshot.objects.filter(pk=snapshot.pk).first() or snapshot
    return snapshot


def _sentence_parts(text: str) -> list[str]:
    cleaned = _safe_text(text)
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    return [part.strip() for part in parts if part and part.strip()]


def _phrase_count(texts: Iterable[str], needles: Iterable[tuple[str, str]]) -> Counter:
    counter: Counter = Counter()
    for text in texts:
        hay = _safe_text(text).lower()
        if not hay:
            continue
        for key, needle in needles:
            if needle in hay:
                counter[key] += 1
    return counter


def build_successful_proposal_template(
    *,
    contractor=None,
    project_type: str = "",
    project_subtype: str = "",
    request_signals: Iterable[str] | None = None,
    sample_size_threshold: int = 2,
) -> dict[str, Any] | None:
    qs = AgreementProposalSnapshot.objects.filter(
        stage=AgreementProposalSnapshot.Stage.FINALIZED,
        is_successful=True,
    )
    if contractor is not None:
        qs = qs.filter(contractor=contractor)
    if _safe_text(project_type):
        qs = qs.filter(project_type__iexact=project_type)
    if _safe_text(project_subtype):
        qs = qs.filter(project_subtype__iexact=project_subtype)

    snapshots = list(qs.order_by("-snapshot_created_at", "-id")[:12])
    if len(snapshots) < sample_size_threshold:
        return None

    texts = [snap.proposal_text for snap in snapshots if _safe_text(snap.proposal_text)]
    if not texts:
        return None

    opener_candidates = Counter()
    closer_candidates = Counter()
    for text in texts:
        parts = _sentence_parts(text)
        if parts:
            opener_candidates[parts[0]] += 1
            closer_candidates[parts[-1]] += 1

    learned_opening = opener_candidates.most_common(1)[0][0] if opener_candidates else ""
    learned_close = closer_candidates.most_common(1)[0][0] if closer_candidates else ""

    phrase_counter = _phrase_count(
        texts,
        [
            ("verify_measurements", "measure"),
            ("review_photos", "photo"),
            ("confirm_materials", "material"),
            ("confirm_timing", "timeline"),
            ("site_visit", "site visit"),
            ("follow_up_questions", "follow-up"),
            ("scope_review", "scope"),
            ("next_steps", "next step"),
        ],
    )
    highlights = [label.replace("_", " ") for label, count in phrase_counter.most_common(3) if count > 0]

    template_name = " ".join(
        part
        for part in [
            _safe_text(project_type) or "Project",
            _safe_text(project_subtype),
            "successful template",
        ]
        if part
    ).strip()

    return {
        "template_name": template_name,
        "sample_size": len(snapshots),
        "learned_opening": learned_opening,
        "learned_close": learned_close,
        "highlights": highlights,
        "based_on_successful_projects": True,
    }


def _brand_voice_payload(*, contractor=None, brand_voice: dict[str, Any] | None = None) -> dict[str, Any]:
    source: dict[str, Any] = {}
    if isinstance(brand_voice, dict):
        source = brand_voice
    else:
        public_profile = getattr(contractor, "public_profile", None) if contractor is not None else None
        if public_profile is not None:
            source = {
                "business_display_name": getattr(public_profile, "business_name_public", "") or "",
                "brand_tagline": getattr(public_profile, "tagline", "") or "",
                "short_company_intro": getattr(public_profile, "bio", "") or "",
                "proposal_tone": getattr(public_profile, "proposal_tone", "") or "",
                "preferred_signoff": getattr(public_profile, "preferred_signoff", "") or "",
                "brand_primary_color": getattr(public_profile, "brand_primary_color", "") or "",
            }

    return {
        "business_display_name": _first_non_empty(
            source.get("business_display_name"),
            source.get("business_name_public"),
            source.get("business_name"),
            getattr(contractor, "business_name", ""),
        ),
        "brand_tagline": _first_non_empty(source.get("brand_tagline"), source.get("tagline")),
        "short_company_intro": _first_non_empty(source.get("short_company_intro"), source.get("bio")),
        "proposal_tone": _first_non_empty(source.get("proposal_tone")),
        "preferred_signoff": _first_non_empty(source.get("preferred_signoff")),
        "brand_primary_color": _first_non_empty(source.get("brand_primary_color")),
    }


def _brand_tone_phrase(proposal_tone: str) -> str:
    tone = _safe_text(proposal_tone).lower()
    mapping = {
        "professional": "professional",
        "friendly": "friendly",
        "straightforward": "straightforward",
        "premium": "polished",
        "warm_and_consultative": "warm and consultative",
    }
    return mapping.get(tone, "")


def build_proposal_draft(
    *,
    agreement: Agreement | None = None,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    description: str = "",
    request_signals: Iterable[str] | None = None,
    budget_text: str = "",
    timeline_text: str = "",
    measurement_handling: str = "",
    photo_count: int = 0,
    request_path_label: str = "",
    clarification_summary: Iterable[dict[str, Any]] | None = None,
    brand_voice: dict[str, Any] | None = None,
    contractor=None,
) -> dict[str, Any]:
    source_title = _first_non_empty(
        project_title,
        getattr(getattr(agreement, "project", None), "title", ""),
        getattr(agreement, "project_title", ""),
    )
    source_type = _first_non_empty(project_type, getattr(agreement, "project_type", ""))
    source_subtype = _first_non_empty(project_subtype, getattr(agreement, "project_subtype", ""))
    source_description = _first_non_empty(description, getattr(agreement, "description", ""))
    brand_voice_payload = _brand_voice_payload(
        contractor=contractor or getattr(agreement, "contractor", None),
        brand_voice=brand_voice,
    )
    business_display_name = _safe_text(brand_voice_payload.get("business_display_name"))
    brand_tagline = _safe_text(brand_voice_payload.get("brand_tagline"))
    short_company_intro = _safe_text(brand_voice_payload.get("short_company_intro"))
    proposal_tone = _safe_text(brand_voice_payload.get("proposal_tone"))
    preferred_signoff = _safe_text(brand_voice_payload.get("preferred_signoff"))
    brand_primary_color = _safe_text(brand_voice_payload.get("brand_primary_color"))
    tone_phrase = _brand_tone_phrase(proposal_tone)
    brand_voice_applied = bool(
        brand_tagline or short_company_intro or proposal_tone or preferred_signoff or brand_primary_color
    )

    template = build_successful_proposal_template(
        contractor=contractor or getattr(agreement, "contractor", None),
        project_type=source_type,
        project_subtype=source_subtype,
        request_signals=request_signals,
    )

    intro_line = (
        template["learned_opening"]
        if template and template.get("learned_opening")
        else f"Thanks for sharing the details for {source_title}."
    )
    brand_intro_bits = []
    if business_display_name and brand_tagline:
        brand_intro_bits.append(f"{business_display_name} - {brand_tagline}.")
    elif business_display_name:
        brand_intro_bits.append(f"{business_display_name} is ready to help review the scope and next steps.")
    elif short_company_intro:
        brand_intro_bits.append(short_company_intro)
    if brand_intro_bits:
        intro_line = " ".join([intro_line, *brand_intro_bits]).strip()

    if template:
        review_line = (
            "I reviewed similar successful projects and put together a starting proposal draft you can edit before sending."
        )
    elif tone_phrase:
        review_line = (
            f"I reviewed the request and put together a starting proposal draft in a {tone_phrase} style you can edit before sending."
        )
    else:
        review_line = "I reviewed the request and put together a starting proposal draft you can edit before sending."

    scope_lines: list[str] = []
    if source_type or source_subtype:
        scope_lines.append(
            f"Scope focus: {' - '.join([part for part in [source_type, source_subtype] if part])}."
        )
    if source_description:
        scope_lines.append(f"Project summary: {source_description}")
    if photo_count > 0:
        scope_lines.append(
            f"{photo_count} photo{'s' if photo_count != 1 else ''} attached, which helps confirm the scope."
        )
    if request_path_label:
        scope_lines.append(f"Request type: {request_path_label}.")
    if request_signals:
        signals = [str(signal).strip() for signal in request_signals if str(signal).strip()]
        if signals:
            scope_lines.append(f"Helpful signals: {', '.join(signals[:4])}.")
    if clarification_summary:
        labels = [
            _safe_text(row.get("label") or row.get("key"))
            for row in clarification_summary
            if _safe_text((row or {}).get("value"))
        ]
        labels = [label for label in labels if label]
        if labels:
            scope_lines.append(f"Clarifications already captured: {', '.join(labels[:3])}.")
    if not scope_lines:
        scope_lines.append("Review the project details and confirm the scope before sending.")

    confirmation_lines = []
    confirmation_lines.append(
        "Measurements may need a site visit before final pricing."
        if measurement_handling == "site_visit_required"
        else "Measurements were provided, but I would still confirm them against the final scope."
        if measurement_handling == "provided"
        else "Measurements are still uncertain, so a quick verification step may help before pricing."
        if measurement_handling == "not_sure"
        else "Measurements may still need to be verified before pricing is finalized."
    )
    if budget_text:
        confirmation_lines.append(f"Budget guidance was shared: {budget_text}.")
    if timeline_text:
        confirmation_lines.append(f"Timing guidance: {timeline_text}.")
    else:
        confirmation_lines.append("The timeline can be reviewed and adjusted with the customer if needed.")

    if template and template.get("highlights"):
        highlight_text = ", ".join(template["highlights"][:3])
        confirmation_lines.append(f"Similar successful bids often confirmed {highlight_text} up front.")
    else:
        confirmation_lines.append("Materials responsibility should be confirmed before the bid is finalized.")

    close_line = (
        template["learned_close"]
        if template and template.get("learned_close")
        else "If this looks right, I’m happy to review the next steps and refine the bid with you."
    )

    signoff_line = preferred_signoff or (f"Best, {business_display_name}" if business_display_name else "")

    text = "\n".join(
        [
            "Opening",
            intro_line,
            review_line,
            "",
            "Scope understanding",
            *[f"- {line}" for line in scope_lines],
            "",
            "Important confirmation points",
            *[f"- {line}" for line in confirmation_lines],
            "",
            "Close",
            close_line,
            *([signoff_line] if signoff_line else []),
        ]
    ).strip()

    return {
        "title": source_title or "Project Proposal",
        "text": text,
        "summary": {
            "projectTitle": source_title,
            "projectType": source_type,
            "projectSubtype": source_subtype,
            "refinedDescription": source_description,
            "budget": budget_text,
            "timeline": timeline_text,
            "measurementHandling": measurement_handling,
            "photoCount": int(photo_count or 0),
            "requestPathLabel": request_path_label,
            "requestSignals": list(request_signals or [])[:4],
            "clarificationCount": len([row for row in (clarification_summary or []) if _safe_text((row or {}).get("value"))]),
            "learningTemplateName": template["template_name"] if template else "",
            "basedOnSuccessfulProjects": bool(template),
            "brandVoiceApplied": brand_voice_applied,
            "brandBusinessName": business_display_name,
            "brandTone": proposal_tone,
        },
        "learning": template or {
            "template_name": "",
            "sample_size": 0,
            "learned_opening": "",
            "learned_close": "",
            "highlights": [],
            "based_on_successful_projects": False,
        },
    }
