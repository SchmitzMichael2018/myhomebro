from projects.models import CaptureArtifact, ProjectCaptureAttachment
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter
from projects.services.capture_adapters.project_common import (
    project_draft,
    project_for_context,
    project_record_url,
)


class ProjectAttachmentAdapter(CaptureDestinationAdapter):
    name = "project_attachment"
    version = "1"

    def _artifacts(self, context):
        return context.capture.artifacts.filter(retention_state=CaptureArtifact.RETENTION_ACTIVE)

    def validate(self, context):
        project_for_context(context)
        if not self._artifacts(context).exists():
            raise CaptureAdapterError("At least one approved project file is required.")

    def authorize(self, context):
        project_for_context(context)

    def preview(self, context):
        self.validate(context)
        draft = project_draft(context)
        artifacts = self._artifacts(context)
        return {
            "action": "create",
            "record_type": self.name,
            "label": f"{artifacts.count()} project file(s)",
            "fields": {
                "project": context.capture.project.title,
                "files": [row.original_filename for row in artifacts],
                "customer_visible": bool(draft.get("customer_visible", False)),
            },
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = project_draft(context)
        rows = []
        for artifact in self._artifacts(context):
            row, _ = ProjectCaptureAttachment.objects.get_or_create(
                artifact=artifact,
                defaults={
                    "project": context.capture.project,
                    "milestone": context.capture.milestone,
                    "kind": (
                        ProjectCaptureAttachment.KIND_PHOTO
                        if artifact.artifact_type == CaptureArtifact.TYPE_PHOTO
                        else ProjectCaptureAttachment.KIND_DOCUMENT
                    ),
                    "title": artifact.original_filename[:255],
                    "description": str(draft.get("body") or ""),
                    "customer_visible": bool(draft.get("customer_visible", False)),
                    "created_by": context.actor,
                },
            )
            rows.append(row)
            context.created_records.append({
                "type": self.name,
                "id": str(row.id),
                "label": row.title or "Project file",
                "url": project_record_url(row.project),
            })
        context.records[self.name] = rows
        return rows
