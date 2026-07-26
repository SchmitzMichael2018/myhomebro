from projects.models import MeasurementEvent, MeasurementSession, PropertyProfile, Proposal
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class MeasurementSessionAdapter(CaptureDestinationAdapter):
    name = "measurement_session"

    def validate(self, context):
        draft = context.snapshot["structured_draft"]
        if context.capture.project_id != draft.get("project_id"):
            raise CaptureAdapterError("The approved measurement project is unavailable.")
        if not draft.get("room", {}).get("name"):
            raise CaptureAdapterError("An area name is required.")

    def authorize(self, context):
        if context.capture.project.contractor_id != context.capture.contractor_id:
            raise CaptureAdapterError("Measurement project access is not authorized.")

    def preview(self, context):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        return {
            "action": "create", "record_type": "measurement_session",
            "label": f"Create measurement session: {draft['room']['name']}",
            "fields": {
                "project": context.capture.project.title,
                "estimate_id": draft.get("estimate_id"),
                "purpose": draft["purpose"],
                "entry_count": len(draft["entries"]),
            },
            "warnings": draft.get("warnings", []),
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        self.authorize(context)
        draft = context.snapshot["structured_draft"]
        proposal = None
        if draft.get("estimate_id"):
            proposal = Proposal.objects.filter(
                id=draft["estimate_id"], contractor=context.capture.contractor,
            ).first()
            if proposal is None:
                raise CaptureAdapterError("The selected estimate is unavailable.")
        property_profile = PropertyProfile.objects.filter(
            homeowner=context.capture.customer,
        ).order_by("-is_primary", "-updated_at").first()
        session, created = MeasurementSession.objects.get_or_create(
            source_capture=context.capture,
            defaults={
                "contractor": context.capture.contractor,
                "project": context.capture.project,
                "proposal": proposal,
                "customer": context.capture.customer,
                "property_profile": property_profile,
                "room_name": draft["room"]["name"],
                "room_type": draft["room"]["type"],
                "purpose": draft["purpose"],
                "guided_profile": draft["guided_profile"],
                "default_unit_system": draft["default_unit_system"],
                "status": MeasurementSession.STATUS_NEEDS_REVIEW,
                "notes": draft.get("notes", ""),
                "captured_by": context.actor,
            },
        )
        if created:
            MeasurementEvent.objects.create(
                session=session, event_type="session_created", actor=context.actor,
                session_version=session.version,
                metadata={"origin_capture_id": str(context.capture.id)},
            )
            context.created_records.append({
                "type": "measurement_session", "id": session.id,
                "label": session.room_name,
                "url": f"/app/measurements/{session.id}",
            })
        context.records["measurement_session"] = session
        return session
