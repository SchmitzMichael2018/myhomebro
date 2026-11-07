"""Short-lived, signed plan previews. Nothing is persisted until owner confirmation."""

import json
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


def build_public_plan_preview(template, inputs):
    project = DIYProject(category=template.public_category_slug, **inputs)
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
        snapshot["proposal"] = _normalized_public_plan(payload)
        # Check the complete envelope, including escaped Unicode input and the
        # base64/signature overhead. Every emitted token must fit the save API.
        # No compression: bounded signed JSON avoids decompressing client input.
        token = signing.dumps(snapshot, salt=PREVIEW_SALT)
        if len(token) > PREVIEW_TOKEN_MAX_LENGTH:
            raise ValueError("Plan preview is too large.")
        return token

    try:
        token = sign_plan(build_plan_proposal(project))
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
