"""Short-lived, signed plan previews. Nothing is persisted until owner confirmation."""

import json
import textwrap
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core import signing
from django.db import transaction
from django.utils import timezone

from projects.models_diy_planner import DIYProject, DIYProjectAIProposal
from projects.services.diy_planner import (
    _fallback_plan,
    apply_plan_proposal,
    build_plan_proposal,
    clean_text,
    validate_plan_payload,
)


PREVIEW_SALT = "projects.public-improvement-plan.v1"
PREVIEW_MAX_AGE = 24 * 60 * 60
PREVIEW_TOKEN_MAX_LENGTH = 256 * 1024
PREVIEW_PLAN_MAX_BYTES = 128_000


def _normalized_public_plan(payload):
    plan = validate_plan_payload(payload)
    for p_index, phase in enumerate(plan["phases"], start=1):
        # Application keys must be unique even when a provider repeats its keys.
        phase["client_id"] = f"phase-{p_index}"
        for t_index, task in enumerate(phase["tasks"], start=1):
            task["client_id"] = f"task-{p_index}-{t_index}"
            try:
                cost = Decimal(task["estimated_cost"])
                if not cost.is_finite() or not Decimal("0") <= cost <= Decimal("9999999999.99"):
                    raise ValueError("Out-of-range estimate")
                task["estimated_cost"] = str(cost.quantize(Decimal("0.01")))
            except (TypeError, ValueError, InvalidOperation):
                task["estimated_cost"] = None
    if len(json.dumps(plan).encode("utf-8")) > PREVIEW_PLAN_MAX_BYTES:
        raise ValueError("Plan preview is too large.")
    return plan


GUIDE_REFERENCE_MAX_BYTES = 24_000
GUIDE_REFERENCE_FIELDS = (
    ("safety_guidance", "Review guide safety before affected work"),
    ("preparation", "Review preparation for the confirmed scope"),
    ("pro_guidance", "Review when qualified help is needed"),
)


class GuideSafetyReferenceError(ValueError):
    """Reviewed source guidance cannot fit safely; user answers are not the cause."""


def _reviewed_guide_context(template):
    """Use public editorial references, never contractor or unreviewed content."""
    if not (template.is_public_improvement and template.is_active
            and template.public_reviewed_at and template.public_reviewed_by_id):
        return {}
    references = {
        field: clean_text(getattr(template, field), PREVIEW_PLAN_MAX_BYTES + 1)
        for field, _ in GUIDE_REFERENCE_FIELDS
    }
    if not any(references.values()):
        return {}
    # Fail rather than silently dropping reviewed safety text. Chunking below
    # keeps each reference inside task validation limits without truncating it.
    if len(json.dumps(references).encode("utf-8")) > GUIDE_REFERENCE_MAX_BYTES:
        raise GuideSafetyReferenceError("Guide safety references are too large for a plan preview.")
    return {
        "source_template_id": template.pk,
        "title": clean_text(template.public_title or template.name, 255),
        "reviewed_at": str(template.public_reviewed_at),
        **references,
    }


def _preserve_guide_safety(payload, guide):
    """Provider omissions cannot erase the guide's visible, saved checkpoints."""
    plan = _normalized_public_plan(payload)
    if not guide:
        return plan
    # Reserve a phase for trusted references. An overfull provider plan uses the
    # normal fallback instead of having either safety or its last phase cut off.
    if len(plan["phases"]) >= 20:
        raise ValueError("Plan needs room for guide safety checkpoints.")
    tasks = [{
        "title": "Confirm local requirements before affected work",
        "description": (
            "For the confirmed scope, determine applicable permits, licensing, and required inspections or tests "
            "with the local authority or a qualified professional before affected work starts. Arrange any required "
            "clearance before covering that work. This review does not add work to your project."
        ),
        "participation_type": "NEED_GUIDANCE",
        "professional_review_recommended": True,
        "reason": "Local requirements depend on the actual scope and jurisdiction.",
    }]
    for field, title in GUIDE_REFERENCE_FIELDS:
        for index, part in enumerate(textwrap.wrap(
            guide[field], width=1700, replace_whitespace=False, drop_whitespace=True,
        ), start=1):
            tasks.append({
                "title": title if index == 1 else f"{title} (continued {index})",
                "description": (
                    "Conditional guide reference: apply only to your confirmed scope. "
                    "Do not add the guide's other work to your project.\n\n" + part
                ),
                "participation_type": "NEED_GUIDANCE",
                "professional_review_recommended": True,
                "reason": "Preserved from the reviewed Improvement Library guide; not safety or code approval.",
                "prerequisite_notes": (
                    "Review before the affected work. Keep applicable stop points, inspections, and tests before "
                    "disturbance or concealment as the guide specifies. If applicability is unclear, pause for "
                    "qualified advice instead of assuming approval."
                ),
            })
    if len(tasks) > 40:
        raise GuideSafetyReferenceError("Guide safety references are too large for a plan preview.")
    plan["phases"].insert(0, {
        "title": "Review applicable guide safety checkpoints",
        "description": (
            "Resolve these conditional checks before the affected work, and keep later inspection or testing "
            "hold points open until the corresponding work is ready. This is planning guidance, not permission "
            "to proceed or a requirement to carry out the guide's entire project."
        ),
        "tasks": tasks,
    })
    # The visible review phase already preserves the guide's notice. Add its
    # reminder only when it cannot displace a validated provider safety warning.
    if len(plan["warnings"]) < 10:
        plan["warnings"].insert(0, {
            "level": "professional_review",
            "message": (
                "The reviewed guide's safety references remain part of this plan. Apply them only to the confirmed "
                "scope, resolve uncertain requirements locally, and do not treat this plan as safety or code approval."
            ),
        })
    return _normalized_public_plan(plan)


def build_public_plan_preview(template, inputs):
    project = DIYProject(category=template.public_category_slug, **inputs)
    guide = _reviewed_guide_context(template)
    expires_at = timezone.now() + timedelta(seconds=PREVIEW_MAX_AGE)
    snapshot = {
        "version": 1,
        "preview_id": str(uuid.uuid4()),
        "source_template_id": template.pk,
        "category": template.public_category_slug,
        "inputs": inputs,
        "expires_at": expires_at.isoformat(),
    }

    def sign_plan(payload):
        snapshot["proposal"] = _preserve_guide_safety(payload, guide)
        # Check the complete envelope, including escaped Unicode input and the
        # base64/signature overhead. Every emitted token must fit the save API.
        # No compression: bounded signed JSON avoids decompressing client input.
        token = signing.dumps(snapshot, salt=PREVIEW_SALT)
        if len(token) > PREVIEW_TOKEN_MAX_LENGTH:
            raise ValueError("Plan preview is too large.")
        return token

    try:
        token = sign_plan(build_plan_proposal(project, reviewed_guide=guide))
    except (TypeError, ValueError, InvalidOperation):
        token = sign_plan(_fallback_plan(project))
    return {
        "source_template_id": template.pk,
        "inputs": inputs,
        "proposal": snapshot["proposal"],
        "preview_token": token,
        "expires_at": snapshot["expires_at"],
    }


def read_public_plan_preview(token):
    if not isinstance(token, str) or not token or len(token) > PREVIEW_TOKEN_MAX_LENGTH:
        raise signing.BadSignature("Invalid preview")
    snapshot = signing.loads(token, salt=PREVIEW_SALT, max_age=PREVIEW_MAX_AGE)
    if not isinstance(snapshot, dict) or snapshot.get("version") != 1:
        raise signing.BadSignature("Invalid preview")
    uuid.UUID(snapshot["preview_id"])
    snapshot["proposal"] = _normalized_public_plan(snapshot["proposal"])
    return snapshot


@transaction.atomic
def save_public_plan_preview(*, email, snapshot, template, property_profile=None):
    # Existing UUID PK supplies a DB-enforced idempotency constraint without a
    # migration. The namespace is a server-signed random nonce; ownership is
    # always checked independently. UUID5 stays stable across signing-key rotation.
    owner = email.strip().lower()
    project_id = uuid.uuid5(uuid.UUID(snapshot["preview_id"]), owner)
    project, created = DIYProject.objects.get_or_create(
        id=project_id,
        owner_email=owner,
        defaults={
            **snapshot["inputs"],
            "category": snapshot["category"],
            "source_template": template,
            "property_profile": property_profile,
            "ai_summary": snapshot["proposal"]["summary"],
        },
    )
    if created:
        proposal = DIYProjectAIProposal.objects.create(project=project, payload=snapshot["proposal"])
        apply_plan_proposal(proposal, [phase["client_id"] for phase in snapshot["proposal"]["phases"]])
    return project, created
