from projects.models import ProjectCaptureIssue
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter
from projects.services.capture_adapters.project_common import (
    project_draft,
    project_for_context,
    project_record_url,
)


class ProjectIssueAdapter(CaptureDestinationAdapter):
    name = "project_issue"
    version = "1"

    def validate(self, context):
        project_for_context(context)
        draft = project_draft(context)
        if draft.get("issue_classification") not in dict(
            ProjectCaptureIssue.CLASSIFICATION_CHOICES
        ):
            raise CaptureAdapterError("A confirmed issue classification is required.")
        if not str(draft.get("body") or "").strip():
            raise CaptureAdapterError("Approved issue details are required.")

    def authorize(self, context):
        project_for_context(context)

    def preview(self, context):
        self.validate(context)
        draft = project_draft(context)
        return {
            "action": "create",
            "record_type": self.name,
            "label": draft.get("title") or "Project issue",
            "fields": {
                "project": context.capture.project.title,
                "classification": draft.get("issue_classification"),
                "description": draft.get("body"),
            },
            "warnings": ["This does not create or modify a dispute or warranty request."],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = project_draft(context)
        issue, _ = ProjectCaptureIssue.objects.get_or_create(
            origin_capture=context.capture,
            defaults={
                "project": context.capture.project,
                "milestone": context.capture.milestone,
                "classification": draft["issue_classification"],
                "title": str(draft.get("title") or "Project issue")[:255],
                "description": str(draft.get("body") or ""),
                "created_by": context.actor,
            },
        )
        context.records[self.name] = issue
        context.created_records.append({
            "type": self.name,
            "id": str(issue.id),
            "label": issue.title,
            "url": project_record_url(issue.project),
        })
        return issue
