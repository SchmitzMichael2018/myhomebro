from projects.services.capture_adapters.base import CaptureAdapterError


def project_for_context(context):
    project = context.capture.project
    if not project or project.contractor_id != context.capture.contractor_id:
        raise CaptureAdapterError("The approved project is unavailable.")
    milestone = context.capture.milestone
    if milestone and milestone.agreement.project_id != project.id:
        raise CaptureAdapterError("The approved milestone does not belong to this project.")
    context.records["project"] = project
    if milestone:
        context.records["milestone"] = milestone
    return project, milestone


def project_draft(context):
    return (context.snapshot.get("structured_draft") or {})


def project_record_url(project):
    agreement = getattr(project, "agreement", None)
    return f"/app/agreements/{agreement.id}" if agreement else "/app/dashboard"
