from projects.models import ProjectCaptureActivity
from projects.services.capture_adapters.base import CaptureDestinationAdapter
from projects.services.capture_adapters.project_common import (
    project_draft,
    project_for_context,
    project_record_url,
)


class ProjectActivityAdapter(CaptureDestinationAdapter):
    name = "project_activity"
    version = "1"

    def validate(self, context):
        project_for_context(context)

    def authorize(self, context):
        project_for_context(context)

    def preview(self, context):
        self.validate(context)
        draft = project_draft(context)
        return {
            "action": "create",
            "record_type": self.name,
            "label": draft.get("title") or "Project activity",
            "fields": {
                "project": context.capture.project.title,
                "milestone": getattr(context.capture.milestone, "title", ""),
                "customer_visible": bool(draft.get("customer_visible", False)),
            },
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = project_draft(context)
        activity, _ = ProjectCaptureActivity.objects.get_or_create(
            origin_capture=context.capture,
            defaults={
                "project": context.capture.project,
                "milestone": context.capture.milestone,
                "activity_type": context.capture.capture_type,
                "title": str(draft.get("title") or "Project activity")[:255],
                "body": str(draft.get("body") or draft.get("description") or ""),
                "customer_visible": bool(draft.get("customer_visible", False)),
                "actor": context.actor,
                "metadata": {
                    "schema_version": draft.get("schema_version", ""),
                    "artifact_count": context.capture.artifacts.count(),
                },
            },
        )
        context.records[self.name] = activity
        context.created_records.append({
            "type": self.name,
            "id": str(activity.id),
            "label": activity.title,
            "url": project_record_url(activity.project),
        })
        return activity
