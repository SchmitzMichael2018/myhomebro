from __future__ import annotations

import re
from copy import deepcopy

from django.conf import settings
from django.utils import timezone

from projects.models import Agreement, Capture, CaptureRoutingAttempt, Milestone, Project
from projects.services.capture_permissions import visible_project_capture_projects
from projects.services.capture_profiles import PROFILE_MAP, resolve_profiles
from projects.utils.accounts import get_contractor_for_user


SCHEMA_VERSION = "capture-routing.v1"
MAX_CANDIDATES = 4
MAX_CONTEXTS = 5
MAX_FOLLOW_UP_ROUNDS = 2
UNSUPPORTED_TERMS = {
    "safety incident": "Safety Incident Capture is not available.",
    "time clock": "Labor and time Capture is not available.",
    "payroll": "Payroll Capture is not available.",
    "lidar": "LiDAR Capture is not available.",
    "bluetooth laser": "Bluetooth laser routing is not available.",
}
KEYWORDS = {
    "photo": ("photo attached", "take a photo", "site photo"),
    "change_request": ("add work", "remove work", "change order", "customer wants", "recessed lighting", "substitute"),
    "site_condition": ("found water", "water damage", "behind the wall", "unexpected condition", "discovered"),
    "punch_item": ("punch", "touch up", "still needs", "sticking", "walkthrough"),
    "manual_measurement": ("feet by", "foot by", "inches by", "measure", "measurement", "length", "width"),
    "warranty_concern": ("warranty concern", "warranty issue", "stopped working", "failed"),
    "warranty_document": ("warranty attached", "warranty document", "warranty card"),
    "equipment": ("model", "serial", "furnace", "water heater", "equipment"),
    "progress_photo": ("progress photo", "before photo", "after photo"),
    "project_update": ("project update", "completed today", "work completed", "finished"),
    "communication": ("called", "emailed", "texted", "spoke with", "met with"),
    "document": ("project document", "document attached", "pdf attached"),
    "issue": ("issue", "problem", "damage", "broken", "missing"),
    "quick_lead": ("new lead", "wants an estimate", "met ", "potential customer"),
    "quick_note": ("remember", "note to self", "reminder"),
}


class ConversationalCaptureError(Exception):
    def __init__(self, message, *, code="capture_routing_error"):
        super().__init__(message)
        self.code = code


def append_audit(attempt, event_type, metadata=None):
    events = list(attempt.audit_events or [])
    events.append({
        "event_type": event_type,
        "at": timezone.now().isoformat(),
        "actor_id": attempt.actor_id,
        "metadata": deepcopy(metadata or {}),
    })
    attempt.audit_events = events[-40:]


def resolve_context(*, user, payload):
    contractor = get_contractor_for_user(user)
    projects = visible_project_capture_projects(user)
    if not contractor or projects is None:
        raise ConversationalCaptureError("Contractor account required.", code="contractor_required")
    project = None
    milestone = None
    agreement = None
    project_id = payload.get("project_id")
    if project_id:
        project = projects.filter(pk=project_id).select_related("homeowner").first()
        if not project:
            raise ConversationalCaptureError("Context is unavailable.", code="context_unavailable")
    milestone_id = payload.get("milestone_id")
    if milestone_id:
        milestone = Milestone.objects.select_related("agreement").filter(
            pk=milestone_id,
            agreement__project=project,
            agreement__contractor=contractor,
        ).first()
        if not milestone:
            raise ConversationalCaptureError("Context is unavailable.", code="context_unavailable")
    agreement_id = payload.get("agreement_id")
    if agreement_id:
        agreement = Agreement.objects.filter(
            pk=agreement_id, project=project, contractor=contractor
        ).first()
        if not agreement:
            raise ConversationalCaptureError("Context is unavailable.", code="context_unavailable")
    elif project and hasattr(project, "agreement"):
        agreement = project.agreement
    return contractor, project, milestone, agreement


def _context_candidates(user, text, current_project):
    projects = visible_project_capture_projects(user)
    if projects is None:
        return []
    rows = []
    normalized = text.casefold()
    for project in projects.select_related("homeowner").order_by("-updated_at", "-id")[:100]:
        explicit = bool(project.title and project.title.casefold() in normalized)
        if current_project and project.id == current_project.id:
            reason = "Current project context"
        elif explicit:
            reason = "Project name appears in the description"
        else:
            continue
        rows.append({
            "context_type": "project",
            "project_id": project.id,
            "display_name": project.title or f"Project #{project.id}",
            "reason": reason,
        })
    return rows[:MAX_CONTEXTS]


def _candidate(profile, confidence, evidence):
    return {
        **profile.public_dict(),
        "profile_key": profile.profile_key,
        "destination": profile.destination_key or "Private Capture artifact",
        "confidence_category": confidence,
        "evidence": evidence[:4],
        "warnings": [profile.non_effects] if profile.non_effects else [],
        "handoff_required": profile.handoff_required,
    }


def _question(key, question_type, prompt, *, context_type="", max_length=None):
    return {
        "question_key": key,
        "type": question_type,
        "prompt": prompt,
        "label": prompt,
        "help_text": (
            "Only records you are authorized to use will be shown."
            if context_type else ""
        ),
        "required": True,
        "allowed_values": [],
        "context_type": context_type,
        "validation": {"max_length": max_length} if max_length else {},
        "max_length": max_length,
        "sensitive": False,
    }


def deterministic_candidates(text, available_profile_keys, artifact_metadata=None):
    """Pure deterministic classifier used by routing and the offline evaluation harness."""
    normalized = str(text or "").casefold()
    unsupported = next(
        (message for phrase, message in UNSUPPORTED_TERMS.items() if phrase in normalized),
        "",
    )
    if unsupported:
        return {"unsupported": unsupported, "ordered": [], "scores": {}, "evidence": {}}
    allowed = set(available_profile_keys)
    scores = {}
    evidence = {}
    for key, terms in KEYWORDS.items():
        if key not in allowed:
            continue
        matches = [term for term in terms if term in normalized]
        if matches:
            scores[key] = len(matches) * 3
            evidence[key] = [f'Description includes "{term.strip()}".' for term in matches[:3]]
    artifacts = artifact_metadata or []
    image_count = sum(
        1 for row in artifacts if str(row.get("mime_type", "")).startswith("image/")
    )
    pdf_count = sum(1 for row in artifacts if row.get("mime_type") == "application/pdf")
    if image_count:
        for key in ("photo", "progress_photo", "issue", "equipment", "warranty_concern"):
            if key in allowed:
                scores[key] = scores.get(key, 0) + 1
                evidence.setdefault(key, []).append("Image evidence is attached.")
    if pdf_count and "document" in allowed:
        scores["document"] = scores.get("document", 0) + 2
        evidence.setdefault("document", []).append("A PDF is attached.")
    ordered = sorted(
        scores,
        key=lambda key: (-scores[key], PROFILE_MAP[key].priority),
    )
    return {
        "unsupported": "",
        "ordered": ordered,
        "scores": scores,
        "evidence": evidence,
    }


def route_attempt(attempt, *, explicit_profile=""):
    text = str(attempt.raw_user_text or "").strip()
    contractor, project, milestone, agreement = resolve_context(
        user=attempt.actor, payload=attempt.context_payload or {}
    )
    available = resolve_profiles(
        user=attempt.actor, project=project, milestone=milestone, agreement=agreement
    )
    available_map = {row.profile_key: row for row in available}
    classified = deterministic_candidates(
        text, available_map, attempt.artifact_metadata or []
    )
    unsupported = classified["unsupported"]
    if unsupported:
        result = {
            "schema_version": SCHEMA_VERSION,
            "status": "unsupported",
            "summary": "That workflow is not available in Capture.",
            "candidate_profiles": [],
            "recommended_profile": "",
            "candidate_contexts": _context_candidates(attempt.actor, text, project),
            "recommended_context": {},
            "missing_information": [],
            "follow_up_questions": [],
            "unsupported_intent": unsupported,
            "safe_fallback_profiles": [
                row.public_dict() for row in available if row.profile_key == "quick_note"
            ],
        }
        source, version, fallback = "deterministic", "routing-rules.v1", ""
    else:
        scores = classified["scores"]
        evidence = classified["evidence"]
        artifacts = attempt.artifact_metadata or []
        if explicit_profile:
            if explicit_profile not in available_map:
                raise ConversationalCaptureError(
                    "The selected Capture profile is unavailable in this context.",
                    code="profile_unavailable",
                )
            scores[explicit_profile] = 100
            evidence[explicit_profile] = ["You selected this Capture profile."]
        ordered = classified["ordered"]
        if explicit_profile:
            ordered = [explicit_profile, *[key for key in ordered if key != explicit_profile]]
        candidates = []
        for key in ordered[:MAX_CANDIDATES]:
            confidence = "high" if scores[key] >= 6 else "medium" if scores[key] >= 3 else "low"
            candidates.append(_candidate(available_map[key], confidence, evidence.get(key, [])))
        missing = []
        questions = []
        if not text and not artifacts:
            missing.append("description_or_artifact")
            questions.append(_question(
                "description", "long_text", "What happened?", max_length=5000
            ))
        if not candidates:
            missing.append("capture_profile")
            questions.append(_question(
                "profile", "profile_select", "Which kind of Capture do you want to create?"
            ))
        elif len(candidates) > 1 and candidates[0]["confidence_category"] == candidates[1]["confidence_category"]:
            missing.append("capture_profile")
            questions.append(_question(
                "profile", "profile_select",
                "More than one workflow fits. Which should Project Assistant prepare?",
            ))
        recommended = candidates[0]["profile_key"] if candidates and "capture_profile" not in missing else ""
        recommended_profile = available_map.get(recommended)
        if recommended_profile:
            for required in recommended_profile.required_context:
                if not {"project": project, "agreement": agreement, "milestone": milestone}.get(required):
                    missing.append(f"{required}_id")
                    questions.append(_question(
                        required, f"{required}_select",
                        f"Which {required} is this for?", context_type=required,
                    ))
        result = {
            "schema_version": SCHEMA_VERSION,
            "status": "needs_information" if missing else "suggested",
            "summary": (
                f"Project Assistant suggests {candidates[0]['display_name']}."
                if candidates else
                "Choose an available Capture workflow."
            ),
            "candidate_profiles": candidates,
            "recommended_profile": recommended,
            "candidate_contexts": _context_candidates(attempt.actor, text, project),
            "recommended_context": (
                {"project_id": project.id, "display_name": project.title}
                if project else {}
            ),
            "missing_information": list(dict.fromkeys(missing))[:8],
            "follow_up_questions": questions[:3],
            "unsupported_intent": "",
            "safe_fallback_profiles": [
                row.public_dict() for row in available if row.profile_key == "quick_note"
            ],
        }
        source, version, fallback = "deterministic", "routing-rules.v1", "provider_not_configured"
        provider = (
            getattr(settings, "CAPTURE_ROUTING_PROVIDER", None)
            if getattr(settings, "CAPTURE_CONVERSATIONAL_PROVIDER_ENABLED", False)
            else None
        )
        if callable(provider) and not explicit_profile:
            try:
                proposed = provider(
                    schema_version=SCHEMA_VERSION,
                    text=text[:5000],
                    available_profiles=[row.profile_key for row in available],
                    context={
                        "has_project_context": bool(project),
                        "has_agreement_context": bool(agreement),
                        "has_milestone_context": bool(milestone),
                        "artifact_mime_types": [row.get("mime_type", "") for row in artifacts[:10]],
                    },
                    policy={
                        "content_is_untrusted": True,
                        "tools_allowed": False,
                        "actions_allowed": False,
                        "must_use_available_profiles": True,
                        "confirmation_required": True,
                    },
                )
                key = proposed.get("recommended_profile") if isinstance(proposed, dict) else ""
                if key in available_map:
                    result["candidate_profiles"] = [
                        _candidate(
                            available_map[key],
                            proposed.get("confidence_category")
                            if proposed.get("confidence_category") in {"low", "medium", "high"}
                            else "low",
                            [
                                str(item)[:160]
                                for item in proposed.get("evidence", [])[:4]
                                if isinstance(item, str)
                            ],
                        ),
                        *[row for row in result["candidate_profiles"] if row["profile_key"] != key],
                    ][:MAX_CANDIDATES]
                    result["recommended_profile"] = key
                    result["summary"] = f"Project Assistant suggests {available_map[key].display_name}."
                    source, version, fallback = "project_assistant", "routing-provider.v1", ""
                else:
                    append_audit(attempt, "ai_routing_failed", {
                        "fallback": "deterministic",
                        "reason": "provider_output_rejected",
                    })
                    fallback = "provider_output_rejected"
            except Exception:
                append_audit(attempt, "ai_routing_failed", {"fallback": "deterministic"})
                fallback = "provider_unavailable"
    attempt.routing_result = result
    attempt.status = result["status"]
    attempt.classifier_source = source
    attempt.classifier_version = version
    attempt.fallback_reason = fallback
    attempt.version += 1
    append_audit(attempt, "routing_completed", {
        "status": result["status"],
        "candidate_profiles": [row["profile_key"] for row in result["candidate_profiles"]],
        "context_count": len(result["candidate_contexts"]),
        "fallback_used": bool(fallback),
    })
    attempt.save()
    return result


def parse_dimensions(text):
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:feet|foot|ft)?\s+by\s+(\d+(?:\.\d+)?)", text.casefold())
    return {"length": match.group(1), "width": match.group(2)} if match else {}
