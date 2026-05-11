from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable

from projects.services.milestone_roles import detect_restricted_trade_categories
from projects.services.payment_protection import build_payment_protection_summary


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return _safe_text(value).lower() in {"1", "true", "yes", "on"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, "", []):
            return default
        return int(value)
    except Exception:
        return default


def _safe_decimal(value: Any, default: Decimal | None = None) -> Decimal | None:
    try:
        if value in (None, "", []):
            return default
        return Decimal(str(value))
    except Exception:
        return default


def _normalize_text(value: Any) -> str:
    return _safe_text(value).lower().replace("&", " and ").replace("-", " ").replace("_", " ")


def _tokenize(*parts: Any) -> set[str]:
    tokens: set[str] = set()
    for part in parts:
        text = _normalize_text(part)
        if not text:
            continue
        for bit in text.replace("/", " ").replace(",", " ").split():
            cleaned = "".join(ch for ch in bit if ch.isalnum())
            if len(cleaned) >= 3:
                tokens.add(cleaned)
    return tokens


def _collect_text_bits(values: Iterable[Any]) -> list[str]:
    bits: list[str] = []
    for value in values:
        text = _safe_text(value)
        if text:
            bits.append(text)
    return bits


def _mode_label(mode: str) -> str:
    normalized = _safe_text(mode).lower().replace("-", "_").replace(" ", "_")
    labels = {
        "full_service": "Full Service",
        "assisted_diy": "Assisted DIY",
        "consultation": "Consultation",
        "inspection_only": "Inspection Only",
    }
    return labels.get(normalized, "Full Service")


def _project_family_text(payload: dict[str, Any]) -> str:
    bits = _collect_text_bits(
        [
            payload.get("project_title"),
            payload.get("project_type"),
            payload.get("project_subtype"),
            payload.get("description"),
            payload.get("project_scope_summary"),
            payload.get("homeowner_participation_notes"),
            payload.get("homeowner_task_summary"),
            payload.get("homeowner_assistance_summary"),
            payload.get("project_class"),
        ]
    )
    return " ".join(bits).strip()


def build_contractor_compatibility_profile(contractor, profile=None) -> dict[str, Any]:
    profile = profile or getattr(contractor, "public_profile", None)
    skills = [getattr(skill, "name", "") for skill in getattr(contractor, "skills", []).all()] if contractor else []
    specialties = list(getattr(profile, "specialties", []) or []) if profile is not None else []
    work_types = list(getattr(profile, "work_types", []) or []) if profile is not None else []

    text_bits = _collect_text_bits(
        [
            getattr(contractor, "business_name", ""),
            getattr(contractor, "name", ""),
            getattr(contractor, "city", ""),
            getattr(contractor, "state", ""),
            getattr(contractor, "license_number", ""),
            getattr(profile, "tagline", "") if profile is not None else "",
            getattr(profile, "bio", "") if profile is not None else "",
            getattr(profile, "service_area_text", "") if profile is not None else "",
            *skills,
            *specialties,
            *work_types,
        ]
    )
    text_blob = " ".join(text_bits)
    normalized_blob = _normalize_text(text_blob)
    collaboration_score = 20
    badges: list[str] = []
    ways_i_work: list[dict[str, Any]] = []
    reasons: list[str] = []

    accepts_diy_assistance = bool(getattr(contractor, "accepts_diy_assistance", False))
    accepts_consultation_only = bool(getattr(contractor, "accepts_consultation_only", False))
    accepts_hourly_help = bool(getattr(contractor, "accepts_hourly_help", False))
    accepts_inspection_only = bool(getattr(contractor, "accepts_inspection_only", False))
    accepts_homeowner_participation = bool(getattr(contractor, "accepts_homeowner_participation", False))

    if accepts_diy_assistance:
        badges.append("DIY Assistance Available")
        ways_i_work.append(
            {
                "key": "assisted_diy",
                "label": "DIY Assistance Available",
                "description": "Guided DIY assistance available.",
            }
        )
        collaboration_score += 20
        reasons.append("Comfortable working alongside homeowners.")
    if accepts_consultation_only:
        badges.append("Consultation Available")
        ways_i_work.append(
            {
                "key": "consultation",
                "label": "Consultation Available",
                "description": "Advice, planning, and guidance are available.",
            }
        )
        collaboration_score += 12
        reasons.append("Offers planning and guidance support.")
    if accepts_hourly_help:
        badges.append("Hourly Help")
        ways_i_work.append(
            {
                "key": "hourly_help",
                "label": "Hourly Help Available",
                "description": "Can help with targeted labor, troubleshooting, and finish work.",
            }
        )
        collaboration_score += 8
        reasons.append("Can step in for partial or hourly assistance.")
    if accepts_inspection_only:
        badges.append("Inspection Services")
        ways_i_work.append(
            {
                "key": "inspection_only",
                "label": "Inspection Services",
                "description": "Inspection and reporting are available.",
            }
        )
        collaboration_score += 12
        reasons.append("Supports inspection and review work.")
    if accepts_homeowner_participation:
        badges.append("Homeowner Participation Welcome")
        ways_i_work.append(
            {
                "key": "homeowner_participation",
                "label": "Homeowner Participation Welcome",
                "description": "Homeowner participation is welcome on collaborative projects.",
            }
        )
        collaboration_score += 10
        reasons.append("Welcomes homeowner participation on the job.")

    if any(term in normalized_blob for term in ["escrow", "milestone payment", "milestone payments", "payment protection"]):
        reasons.append("Mentions protected milestone payments.")
    if any(term in normalized_blob for term in ["finish", "rescue", "take over", "punch list", "repair", "remodel"]):
        reasons.append("Comfortable with finish, repair, or rescue-style work.")
    if any(term in normalized_blob for term in ["inspection", "inspect", "review", "compliance"]):
        reasons.append("Works in inspection and review oriented projects.")
        collaboration_score += 8
        if "Inspection Services" not in badges:
            badges.append("Inspection Services")
    if any(term in normalized_blob for term in ["emergency", "24/7", "after hours", "urgent"]):
        badges.append("Emergency Service")
        reasons.append("Can support urgent or emergency service needs.")
    if any(term in normalized_blob for term in ["large project", "commercial", "whole home", "full remodel"]):
        reasons.append("Appears comfortable with larger or multi-step projects.")
    if any(term in normalized_blob for term in ["small project", "service call", "repair", "hourly"]):
        reasons.append("Appears comfortable with smaller or targeted work.")

    escrow_friendly = any(term in normalized_blob for term in ["escrow", "milestone", "protected payment"]) or accepts_diy_assistance or accepts_consultation_only or accepts_inspection_only
    escrow_required = any(term in normalized_blob for term in ["escrow only", "escrow required", "milestone only"])
    rescue_project_friendly = any(term in normalized_blob for term in ["finish", "rescue", "take over", "partial completion", "punch list", "help finishing"])
    inspection_capable = accepts_inspection_only or any(term in normalized_blob for term in ["inspection", "inspect", "review", "compliance"])
    prefers_full_service_only = not any(
        [accepts_diy_assistance, accepts_consultation_only, accepts_hourly_help, accepts_inspection_only, accepts_homeowner_participation]
    )
    prefers_small_projects = accepts_hourly_help or accepts_consultation_only or any(term in normalized_blob for term in ["small project", "service call", "repair", "hourly"])
    prefers_large_projects = any(term in normalized_blob for term in ["large project", "commercial", "whole home", "full remodel"])
    emergency_service = any(term in normalized_blob for term in ["emergency", "24/7", "after hours", "urgent"])

    if accepts_diy_assistance or accepts_homeowner_participation:
        badges.append("Collaborative Projects")
    if escrow_friendly:
        badges.append("Escrow Friendly")
    if rescue_project_friendly:
        badges.append("Rescue Project Assistance")
    if inspection_capable and "Inspection Services" not in badges:
        badges.append("Inspection Services")
    if accepts_consultation_only and "Consultation Available" not in badges:
        badges.append("Consultation Available")

    collaboration_score = max(0, min(collaboration_score, 100))
    if collaboration_score >= 70:
        summary = "Good fit for collaborative projects and homeowner participation."
        tier = "Strong Match"
    elif collaboration_score >= 45:
        summary = "Comfortable with collaborative projects and guided project support."
        tier = "Good Match"
    else:
        summary = "Primarily focused on standard contractor-led project delivery."
        tier = "Limited Match"

    if escrow_friendly and "Escrow milestone payments" not in reasons:
        reasons.append("Comfortable with escrow milestone payments.")
    if rescue_project_friendly and "Supports finish-my-project work." not in reasons:
        reasons.append("Supports rescue or finish-my-project work.")
    if inspection_capable and "Supports inspection checkpoints." not in reasons:
        reasons.append("Supports inspection checkpoints.")

    reasons = list(dict.fromkeys(reasons))
    ways_i_work = list({item["key"]: item for item in ways_i_work}.values())
    badges = list(dict.fromkeys(badges))

    return {
        "contractor_id": getattr(contractor, "id", None),
        "contractor_name": getattr(contractor, "name", "") or getattr(contractor, "business_name", ""),
        "business_name": getattr(contractor, "business_name", ""),
        "service_radius_miles": _safe_int(getattr(contractor, "service_radius_miles", 0), 0),
        "accepts_diy_assistance": accepts_diy_assistance,
        "accepts_consultation": accepts_consultation_only,
        "accepts_inspection_only": accepts_inspection_only,
        "accepts_homeowner_participation": accepts_homeowner_participation,
        "escrow_friendly": escrow_friendly,
        "escrow_required": escrow_required,
        "rescue_project_friendly": rescue_project_friendly,
        "inspection_capable": inspection_capable,
        "prefers_full_service_only": prefers_full_service_only,
        "prefers_small_projects": prefers_small_projects,
        "prefers_large_projects": prefers_large_projects,
        "emergency_service": emergency_service,
        "homeowner_collaboration_score": collaboration_score,
        "tier": tier,
        "badges": badges,
        "ways_i_work": ways_i_work,
        "summary": summary,
        "reasons": reasons[:8],
        "license_number": _safe_text(getattr(contractor, "license_number", "")),
    }


def build_project_compatibility_requirements(payload: Any) -> dict[str, Any]:
    data = dict(payload) if isinstance(payload, dict) else {
        "project_mode": getattr(payload, "project_mode", ""),
        "project_type": getattr(payload, "project_type", ""),
        "project_subtype": getattr(payload, "project_subtype", ""),
        "description": getattr(payload, "description", ""),
        "project_scope_summary": getattr(payload, "project_scope_summary", ""),
        "payment_preference": getattr(payload, "payment_preference", ""),
        "project_city": getattr(payload, "project_city", ""),
        "project_state": getattr(payload, "project_state", ""),
    }

    project_mode = _safe_text(data.get("project_mode")).lower().replace("-", "_").replace(" ", "_") or "full_service"
    payment_preference = _safe_text(data.get("payment_preference")).lower().replace("-", "_").replace(" ", "_") or "escrow"
    project_text = _project_family_text(data)
    restricted_trade_categories = detect_restricted_trade_categories(project_text, project_mode=project_mode)
    milestones = data.get("milestones") if isinstance(data.get("milestones"), list) else []
    milestone_count = len(milestones)
    milestone_roles = [str(row.get("milestone_role") or row.get("role") or "").strip() for row in milestones if isinstance(row, dict)]
    homeowner_started = _safe_bool(data.get("homeowner_started_work"))
    participation_notes = _safe_text(data.get("homeowner_participation_notes"))
    homeowner_task_summary = _safe_text(data.get("homeowner_task_summary"))
    homeowner_assistance_summary = _safe_text(data.get("homeowner_assistance_summary"))
    rescue_project = homeowner_started or any(
        term in _normalize_text(" ".join([participation_notes, homeowner_task_summary, homeowner_assistance_summary, project_text]))
        for term in ["already started", "partial completion", "finish", "rescue", "take over", "stuck", "help finishing", "punch list"]
    )
    inspection_required = project_mode == "inspection_only" or bool(restricted_trade_categories) or any(
        term in _normalize_text(project_text) for term in ["inspection", "inspect", "review", "permit", "code"]
    )
    homeowner_participation_level = "none"
    if project_mode == "assisted_diy" or participation_notes or homeowner_task_summary or homeowner_assistance_summary:
        homeowner_participation_level = "medium"
        if homeowner_started or homeowner_task_summary:
            homeowner_participation_level = "high"
    if project_mode == "consultation":
        homeowner_participation_level = "low"
    collaboration_complexity = "low"
    if project_mode in {"assisted_diy", "consultation", "inspection_only"}:
        collaboration_complexity = "medium"
    if rescue_project or inspection_required or milestone_count >= 5:
        collaboration_complexity = "high"
    project_budget = _safe_decimal(data.get("project_budget"))
    project_size = "medium"
    if milestone_count <= 3 and (project_budget is None or project_budget < Decimal("15000")):
        project_size = "small"
    elif milestone_count >= 6 or (project_budget is not None and project_budget >= Decimal("50000")):
        project_size = "large"
    project_risk = "low"
    if restricted_trade_categories:
        project_risk = "high"
    elif inspection_required or rescue_project or project_mode in {"assisted_diy", "consultation"}:
        project_risk = "medium"

    return {
        "project_mode": project_mode,
        "payment_preference": payment_preference,
        "project_text": project_text,
        "restricted_trade_categories": restricted_trade_categories,
        "inspection_required": inspection_required,
        "rescue_project": rescue_project,
        "homeowner_started_work": homeowner_started,
        "homeowner_participation_level": homeowner_participation_level,
        "collaboration_complexity": collaboration_complexity,
        "milestone_count": milestone_count,
        "milestone_roles": [role for role in milestone_roles if role],
        "project_size": project_size,
        "project_risk": project_risk,
        "project_city": _safe_text(data.get("project_city")),
        "project_state": _safe_text(data.get("project_state")),
        "project_scope_summary": _safe_text(data.get("project_scope_summary") or data.get("description")),
        "payment_summary": build_payment_protection_summary(
            project_mode=project_mode,
            payment_preference=payment_preference,
            milestones=milestones,
        ),
    }


def score_contractor_project_match(contractor, project_payload: Any, profile=None) -> dict[str, Any]:
    project = build_project_compatibility_requirements(project_payload)
    compatibility = build_contractor_compatibility_profile(contractor, profile=profile)
    project_text = _normalize_text(project.get("project_text", ""))
    way_bits = [
        item.get("label") or item.get("description") or item.get("key")
        for item in compatibility.get("ways_i_work", [])
        if isinstance(item, dict)
    ]
    skill_names = [getattr(skill, "name", "") for skill in getattr(contractor, "skills", []).all()] if contractor is not None else []
    specialty_names = list(getattr(profile, "specialties", []) or []) if profile is not None else []
    work_type_names = list(getattr(profile, "work_types", []) or []) if profile is not None else []
    contractor_blob = _normalize_text(
        " ".join(
            _collect_text_bits(
                [
                    compatibility.get("contractor_name", ""),
                    compatibility.get("business_name", ""),
                    getattr(contractor, "license_number", ""),
                    getattr(contractor, "city", ""),
                    getattr(contractor, "state", ""),
                    *way_bits,
                    *compatibility.get("badges", []),
                    *skill_names,
                    *specialty_names,
                    *work_type_names,
                    getattr(profile, "tagline", "") if profile is not None else "",
                    getattr(profile, "bio", "") if profile is not None else "",
                ]
            )
        )
    )
    contractor_tokens = _tokenize(contractor_blob)
    project_tokens = _tokenize(
        project_text,
        project.get("project_scope_summary", ""),
        project.get("project_mode", ""),
    )

    score = 0
    reasons: list[str] = []
    reasons_detail: list[dict[str, Any]] = []

    def add(points: int, reason: str, category: str) -> None:
        nonlocal score
        if points <= 0:
            return
        score += points
        reasons.append(reason)
        reasons_detail.append({"category": category, "points": points, "reason": reason})

    overlap = len(contractor_tokens.intersection(project_tokens))
    if overlap:
        add(min(22, overlap * 4), "Trade and scope keywords overlap.", "trade_match")
    if any(term in project_text for term in ["electrical", "plumbing", "roofing", "hvac", "inspection", "consultation", "rescue"]):
        project_hint_points = 0
        if any(term in contractor_blob for term in ["electrical", "plumbing", "roofing", "hvac", "inspection", "consultation"]):
            project_hint_points = 8
        if project_hint_points:
            add(project_hint_points, "Relevant trade experience appears in the contractor profile.", "trade_match")

    contractor_city = _normalize_text(getattr(contractor, "city", ""))
    contractor_state = _normalize_text(getattr(contractor, "state", ""))
    project_city = _normalize_text(project.get("project_city", ""))
    project_state = _normalize_text(project.get("project_state", ""))
    if project_city and contractor_city and project_city == contractor_city:
        add(10, "Service area matches the project city.", "radius")
    elif project_state and contractor_state and project_state == contractor_state:
        add(6, "Service area matches the project state.", "radius")
    elif project_state and not contractor_state:
        add(2, "The project location is in range conceptually, but the contractor profile is still sparse.", "radius")

    mode = project.get("project_mode", "full_service")
    if mode == "assisted_diy":
        if compatibility.get("accepts_diy_assistance"):
            add(18, "Offers Assisted DIY support.", "mode")
        elif compatibility.get("accepts_homeowner_participation"):
            add(12, "Comfortable with homeowner participation.", "mode")
        elif compatibility.get("prefers_full_service_only"):
            add(0, "Primarily focused on full-service delivery.", "mode")
        else:
            add(4, "May still fit a collaborative project with some adjustment.", "mode")
    elif mode == "consultation":
        if compatibility.get("accepts_consultation"):
            add(18, "Offers consultation and guidance.", "mode")
        elif compatibility.get("prefers_small_projects"):
            add(8, "Comfortable with smaller advisory work.", "mode")
    elif mode == "inspection_only":
        if compatibility.get("accepts_inspection_only") or compatibility.get("inspection_capable"):
            add(18, "Inspection checkpoints are supported.", "mode")
        else:
            add(0, "Inspection-led work may need a better fit.", "mode")
    else:
        if compatibility.get("prefers_full_service_only") or not any(
            [compatibility.get("accepts_diy_assistance"), compatibility.get("accepts_consultation"), compatibility.get("accepts_inspection_only")]
        ):
            add(10, "Standard full-service delivery looks aligned.", "mode")

    payment_preference = project.get("payment_preference", "escrow")
    payment_summary = project.get("payment_summary") or {}
    payment_label = _safe_text(payment_summary.get("label"))
    if payment_preference in {"escrow", "discuss"}:
        if compatibility.get("escrow_friendly") or compatibility.get("accepts_diy_assistance") or compatibility.get("accepts_inspection_only"):
            add(12, "Accepts escrow milestone payments.", "payment")
        elif compatibility.get("escrow_required"):
            add(6, "Prefers structured milestone payments.", "payment")
        else:
            add(2, "Escrow still looks workable for this project.", "payment")
    elif payment_preference == "direct":
        add(8, "Direct payment preference is easy to accommodate.", "payment")
    if payment_label == "Escrow Required" and not compatibility.get("escrow_friendly"):
        add(0, "Escrow is recommended or required for this project.", "payment")

    if project.get("rescue_project"):
        if compatibility.get("rescue_project_friendly"):
            add(16, "Supports rescue or finish-my-project work.", "rescue")
        else:
            add(3, "Could still fit partial-completion work with review.", "rescue")

    if project.get("inspection_required"):
        if compatibility.get("inspection_capable"):
            add(12, "Inspection checkpoints are supported.", "inspection")
        else:
            add(0, "Inspection support would need review.", "inspection")

    if project.get("restricted_trade_categories"):
        if compatibility.get("inspection_capable") or getattr(contractor, "license_number", "") or bool(getattr(profile, "show_license_public", False)):
            add(12, "Licensed trade work appears supported.", "safety")
        else:
            add(0, "Restricted work may need a more licensed contractor profile.", "safety")

    collaboration_level = _safe_int(compatibility.get("homeowner_collaboration_score"), 20)
    if project.get("project_mode") in {"assisted_diy", "consultation"}:
        add(max(0, min(12, collaboration_level // 10)), "Experienced with collaborative projects.", "collaboration")
    if project.get("homeowner_participation_level") in {"medium", "high"}:
        if compatibility.get("accepts_homeowner_participation") or compatibility.get("accepts_diy_assistance"):
            add(10, "Homeowner participation is welcome.", "collaboration")
    if project.get("project_size") == "small" and compatibility.get("prefers_small_projects"):
        add(6, "Small-project focus looks aligned.", "preference")
    if project.get("project_size") == "large" and compatibility.get("prefers_large_projects"):
        add(6, "Large-project focus looks aligned.", "preference")
    if project.get("project_risk") == "high" and (compatibility.get("inspection_capable") or getattr(contractor, "license_number", "")):
        add(4, "High-risk work is better suited to a licensed contractor.", "safety")

    score = max(0, min(score, 100))
    if score >= 75:
        tier = "Strong Match"
    elif score >= 45:
        tier = "Good Match"
    else:
        tier = "Limited Match"

    positive_reason_labels = []
    for reason in reasons:
        normalized = reason.lower()
        if "assisted diy" in normalized:
            positive_reason_labels.append(reason)
        elif "collaborative" in normalized:
            positive_reason_labels.append(reason)
        elif "escrow" in normalized:
            positive_reason_labels.append(reason)
        elif "rescue" in normalized:
            positive_reason_labels.append(reason)
        elif "inspection" in normalized:
            positive_reason_labels.append(reason)
        elif "licensed" in normalized:
            positive_reason_labels.append(reason)
    if not positive_reason_labels:
        positive_reason_labels = reasons[:4]

    badge_labels = list(dict.fromkeys([
        *compatibility.get("badges", []),
        "Escrow Friendly" if compatibility.get("escrow_friendly") else None,
        "Rescue Project Assistance" if compatibility.get("rescue_project_friendly") else None,
        "Inspection Services" if compatibility.get("inspection_capable") else None,
    ]))
    badge_labels = [badge for badge in badge_labels if badge]

    if tier == "Strong Match":
        summary = "Strong fit for this project and working style."
    elif tier == "Good Match":
        summary = "Good fit with a few considerations to confirm."
    else:
        summary = "Limited match unless the scope or preferences change."

    project_requirements = {
        "project_mode": project.get("project_mode", "full_service"),
        "payment_preference": project.get("payment_preference", "escrow"),
        "restricted_trade_categories": project.get("restricted_trade_categories", []),
        "inspection_required": bool(project.get("inspection_required")),
        "rescue_project": bool(project.get("rescue_project")),
        "homeowner_started_work": bool(project.get("homeowner_started_work")),
        "homeowner_participation_level": project.get("homeowner_participation_level", "none"),
        "collaboration_complexity": project.get("collaboration_complexity", "low"),
        "milestone_count": _safe_int(project.get("milestone_count"), 0),
        "milestone_roles": list(project.get("milestone_roles") or []),
        "project_size": project.get("project_size", "medium"),
        "project_risk": project.get("project_risk", "low"),
        "payment_summary": payment_summary,
    }

    return {
        "score": score,
        "tier": tier,
        "summary": summary,
        "reasons": positive_reason_labels[:6],
        "reasons_detail": reasons_detail[:8],
        "badges": badge_labels[:8],
        "compatibility_profile": compatibility,
        "project_requirements": project_requirements,
        "why_this_project_matches_you": summary,
        "is_strong_match": tier == "Strong Match",
        "is_good_match": tier == "Good Match",
        "is_limited_match": tier == "Limited Match",
    }
