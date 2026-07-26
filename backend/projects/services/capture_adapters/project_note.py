from projects.models import ProjectCaptureNote
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter
from projects.services.capture_adapters.project_common import (
    project_draft,
    project_for_context,
    project_record_url,
)


class ProjectNoteAdapter(CaptureDestinationAdapter):
    name = "project_note"
    version = "1"

    def validate(self, context):
        project_for_context(context)
        if not str(project_draft(context).get("body") or "").strip():
            raise CaptureAdapterError("Approved project note text is required.")

    def authorize(self, context):
        project_for_context(context)

    def preview(self, context):
        self.validate(context)
        draft = project_draft(context)
        return {
            "action": "create",
            "record_type": self.name,
            "label": draft.get("title") or "Project note",
            "fields": {
                "project": context.capture.project.title,
                "milestone": getattr(context.capture.milestone, "title", ""),
                "body": draft.get("body", ""),
            },
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = project_draft(context)
        note, _ = ProjectCaptureNote.objects.get_or_create(
            origin_capture=context.capture,
            defaults={
                "project": context.capture.project,
                "milestone": context.capture.milestone,
                "title": str(draft.get("title") or "")[:255],
                "body": str(draft.get("body") or ""),
                "created_by": context.actor,
            },
        )
        context.records[self.name] = note
        context.created_records.append({
            "type": self.name,
            "id": str(note.id),
            "label": note.title or "Project note",
            "url": project_record_url(note.project),
        })
        return note
