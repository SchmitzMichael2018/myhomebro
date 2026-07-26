from projects.models import CustomerCommunicationLog
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter
from projects.services.capture_adapters.project_common import project_draft, project_for_context


class CommunicationLogAdapter(CaptureDestinationAdapter):
    name = "communication_log"
    version = "1"

    def validate(self, context):
        project, _ = project_for_context(context)
        if not project.homeowner_id:
            raise CaptureAdapterError("This project needs a customer before communication can be logged.")
        draft = project_draft(context)
        if draft.get("communication_type") not in dict(
            CustomerCommunicationLog.COMMUNICATION_TYPE_CHOICES
        ):
            raise CaptureAdapterError("A confirmed communication type is required.")
        if draft.get("communication_direction") not in dict(
            CustomerCommunicationLog.DIRECTION_CHOICES
        ):
            raise CaptureAdapterError("A confirmed communication direction is required.")
        if not str(draft.get("body") or "").strip():
            raise CaptureAdapterError("Approved communication details are required.")

    def authorize(self, context):
        project_for_context(context)

    def preview(self, context):
        self.validate(context)
        draft = project_draft(context)
        return {
            "action": "create",
            "record_type": self.name,
            "label": draft.get("title") or "Project communication",
            "fields": {
                "project": context.capture.project.title,
                "customer": context.capture.project.homeowner.full_name,
                "type": draft.get("communication_type"),
                "direction": draft.get("communication_direction"),
                "body": draft.get("body"),
            },
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = project_draft(context)
        project = context.capture.project
        row, _ = CustomerCommunicationLog.objects.get_or_create(
            origin_capture=context.capture,
            project=project,
            communication_type=draft["communication_type"],
            defaults={
                "contractor": context.capture.contractor,
                "customer": project.homeowner,
                "direction": draft["communication_direction"],
                "visibility": CustomerCommunicationLog.VISIBILITY_INTERNAL_ONLY,
                "subject": str(draft.get("title") or "Project communication")[:255],
                "body": str(draft.get("body") or ""),
                "created_by": context.actor,
            },
        )
        context.records["customer"] = project.homeowner
        context.records[self.name] = row
        context.created_records.append({
            "type": self.name,
            "id": row.id,
            "label": row.subject,
            "url": f"/app/customers/{project.homeowner_id}",
        })
        return row
