from projects.models import AmendmentRequest
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


CATEGORY_TO_CHANGE_TYPE = {
    "remove_scope": AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK,
    "schedule_impact": AmendmentRequest.ChangeType.DATE_CHANGE,
    "other": AmendmentRequest.ChangeType.OTHER,
}


class AmendmentRequestAdapter(CaptureDestinationAdapter):
    name = "amendment_request"
    version = "1"

    def _draft(self, context):
        draft = (context.snapshot or {}).get("structured_draft") or {}
        if draft.get("schema_version") != "change-intake.v1":
            raise CaptureAdapterError("Approved Change Intake schema is required.")
        return draft

    def validate(self, context):
        draft = self._draft(context)
        capture = context.capture
        if draft.get("decision_boundary") != "change_request":
            raise CaptureAdapterError("Only an explicit change request can create an Amendment Request.")
        if draft.get("proposed_destination") != self.name:
            raise CaptureAdapterError("Approved Change Intake destination is invalid.")
        if not capture.agreement_id or capture.agreement.project_id != capture.project_id:
            raise CaptureAdapterError("The approved agreement is unavailable for this project.")
        if AmendmentRequest.objects.filter(source_capture=capture).exists():
            return
        decision = ((context.snapshot or {}).get("review_decisions") or {}).get("duplicate") or {}
        if decision.get("decision") == "link_existing":
            candidate = AmendmentRequest.objects.filter(
                pk=decision.get("candidate_id"),
                agreement=capture.agreement,
            ).exclude(status=AmendmentRequest.Status.CLOSED).first()
            if not candidate:
                raise CaptureAdapterError("The approved duplicate Amendment Request is unavailable.")

    def authorize(self, context):
        self.validate(context)

    def preview(self, context):
        self.validate(context)
        draft = self._draft(context)
        decision = ((context.snapshot or {}).get("review_decisions") or {}).get("duplicate") or {}
        action = "link" if decision.get("decision") == "link_existing" else "create"
        return {
            "action": action,
            "record_type": self.name,
            "label": draft["title"],
            "fields": {
                "status": AmendmentRequest.Status.OPEN,
                "response_state": AmendmentRequest.ResponseState.PENDING,
                "project": context.capture.project.title,
                "agreement": str(context.capture.agreement),
                "requester": draft["requester"]["display_name"],
                "actor_type": draft["actor_type"],
                "category": draft["change_kind"],
                "requested_change": draft["requested_change"],
                "attachments": len(draft.get("artifact_ids") or []),
                "notifications": "None from Capture application",
                "non_effects": [
                    "Agreement scope and total unchanged",
                    "Milestones and payment schedule unchanged",
                    "Dates unchanged",
                    "No signature or invoice created",
                    "No work authorization created",
                ],
            },
            "warnings": [
                "This creates a non-binding request for the existing amendment workflow."
            ],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        capture = context.capture
        draft = self._draft(context)
        existing = AmendmentRequest.objects.filter(source_capture=capture).first()
        if existing:
            context.records[self.name] = existing
            context.linked_records.append({
                "type": self.name, "id": existing.id,
                "label": (existing.requested_changes or {}).get("title") or f"Amendment Request #{existing.id}",
                "url": f"/app/agreements/{existing.agreement_id}",
            })
            return existing
        decision = ((context.snapshot or {}).get("review_decisions") or {}).get("duplicate") or {}
        if decision.get("decision") == "link_existing":
            existing = AmendmentRequest.objects.get(
                pk=decision["candidate_id"], agreement=capture.agreement
            )
            context.records[self.name] = existing
            context.linked_records.append({
                "type": self.name, "id": existing.id,
                "label": (existing.requested_changes or {}).get("title") or f"Amendment Request #{existing.id}",
                "url": f"/app/agreements/{existing.agreement_id}",
            })
            return existing
        change_type = CATEGORY_TO_CHANGE_TYPE.get(
            draft["change_kind"], AmendmentRequest.ChangeType.SCOPE_PRODUCT_CHANGE
        )
        requested_changes = {
            "schema_version": "change-intake-destination.v1",
            "title": draft["title"],
            "requested_change": draft["requested_change"],
            "reason": draft["reason"],
            "location_or_scope_area": draft["location_or_scope_area"],
            "requested_timing_assertion": draft["requested_timing"],
            "customer_priority": draft["customer_priority"],
            "price_expectation_assertion": draft["known_price_expectation"],
            "schedule_expectation_assertion": draft["known_schedule_expectation"],
            "change_intake_category": draft["change_kind"],
            "decision_boundary": "change_request",
            "related_issue_id": draft.get("related_issue_id"),
            "related_milestone_id": draft.get("related_milestone_id"),
            "capture_provenance": {
                "capture_id": str(capture.id),
                "approved_capture_version": context.snapshot.get("capture_version"),
                "approved_schema_version": context.snapshot.get("schema_version"),
                "adapter_version": self.version,
                "actor_type": draft["actor_type"],
                "submission_channel": capture.capture_method,
            },
        }
        row = AmendmentRequest.objects.create(
            agreement=capture.agreement,
            milestone=capture.milestone,
            requested_by=capture.captured_by,
            change_type=change_type,
            requested_changes=requested_changes,
            justification=draft["reason"],
            initiated_by_role=draft["actor_type"],
            response_state=AmendmentRequest.ResponseState.PENDING,
            status=AmendmentRequest.Status.OPEN,
            refund_eligibility_status=AmendmentRequest.RefundEligibilityStatus.NOT_APPLICABLE,
            source_capture=capture,
            change_intake_category=draft["change_kind"],
            source_actor_type=draft["actor_type"],
        )
        row.source_artifacts.set(
            capture.artifacts.filter(id__in=draft.get("artifact_ids") or [])
        )
        context.records[self.name] = row
        context.created_records.append({
            "type": self.name, "id": row.id,
            "label": draft["title"],
            "url": f"/app/agreements/{capture.agreement_id}",
        })
        return row
