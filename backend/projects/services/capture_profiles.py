from __future__ import annotations

from dataclasses import asdict, dataclass

from django.conf import settings

from projects.models import Capture
from projects.services.capture_adapters import ADAPTERS
from projects.services.capture_permissions import can_create_capture, can_create_project_capture
from projects.utils.accounts import get_contractor_for_user


REGISTRY_VERSION = "capture-profiles.v1"

PROFILE_GROUPS = {
    "quick_lead": "Customer and Change",
    "quick_note": "General",
    "photo": "General",
    "project_update": "Project",
    "progress_photo": "Project",
    "issue": "Project",
    "punch_item": "Project",
    "site_condition": "Project",
    "communication": "Project",
    "document": "Project",
    "equipment": "Equipment and Warranty",
    "warranty_document": "Equipment and Warranty",
    "warranty_concern": "Equipment and Warranty",
    "manual_measurement": "Measurement",
    "change_request": "Customer and Change",
}


@dataclass(frozen=True)
class CaptureProfile:
    profile_key: str
    capture_type: str
    schema_version: str
    display_name: str
    description: str
    required_context: tuple[str, ...]
    optional_context: tuple[str, ...]
    feature_requirements: tuple[str, ...]
    destination_key: str
    application_supported: bool
    artifact_types: tuple[str, ...]
    voice_supported: bool
    review_mode: str
    risk_level: str
    priority: int
    handoff_required: bool = False
    non_effects: str = ""

    def public_dict(self):
        row = asdict(self)
        for key in (
            "required_context", "optional_context", "feature_requirements", "artifact_types"
        ):
            row[key] = list(row[key])
        row.pop("feature_requirements")
        row["group"] = PROFILE_GROUPS.get(self.profile_key, "General")
        row["what_happens_next"] = (
            "Opens an existing form with suggested values for you to review."
            if self.handoff_required
            else "Creates a private Capture draft for the existing review workflow."
        )
        row["consequence_boundary"] = self.non_effects or (
            "Does not apply changes, notify a customer, or authorize work."
        )
        return row


PROFILES = (
    CaptureProfile("quick_lead", Capture.TYPE_QUICK_LEAD, "quick-lead.v1", "Quick Lead", "Save a new lead for review.", (), (), (), "customer", True, (), True, "lead", "medium", 10, True),
    CaptureProfile("quick_note", Capture.TYPE_QUICK_NOTE, "quick-note.v1", "Note", "Save a private note for review.", (), ("customer",), (), "unassigned_note", True, (), True, "note", "low", 20),
    CaptureProfile("photo", Capture.TYPE_PHOTO, "artifact-only.v1", "Photo", "Save a private photo in Capture.", (), ("project",), (), "", False, ("image",), False, "artifact", "low", 30),
    CaptureProfile("project_update", Capture.TYPE_PROJECT_UPDATE, "project-capture.v1", "Project Update", "Record progress or a field update.", ("project",), ("milestone",), (), "project_activity", True, (), True, "project", "low", 40),
    CaptureProfile("progress_photo", Capture.TYPE_PROGRESS_PHOTO, "project-capture.v1", "Progress Photo", "Add private progress evidence.", ("project",), ("milestone",), (), "project_activity", True, ("image",), False, "project", "low", 50),
    CaptureProfile("issue", Capture.TYPE_ISSUE, "project-capture.v1", "Project Issue", "Prepare a project issue for review.", ("project",), ("milestone",), (), "project_issue", True, ("image", "document"), True, "project", "medium", 60, non_effects="Does not create a change order."),
    CaptureProfile("punch_item", Capture.TYPE_ISSUE, "field-findings.v1", "Punch Item", "Prepare completion findings for review.", ("project",), ("milestone",), ("CAPTURE_FIELD_FINDINGS_ENABLED",), "project_issue", True, ("image", "document"), True, "field_findings", "medium", 70),
    CaptureProfile("site_condition", Capture.TYPE_ISSUE, "field-findings.v1", "Site Condition", "Record an observed site condition without diagnosis.", ("project",), ("milestone",), ("CAPTURE_FIELD_FINDINGS_ENABLED",), "project_issue", True, ("image", "document"), True, "field_findings", "high", 80, non_effects="Does not diagnose fault or create a change order."),
    CaptureProfile("communication", Capture.TYPE_COMMUNICATION, "project-capture.v1", "Communication", "Log a project communication.", ("project",), ("milestone", "agreement"), (), "communication_log", True, (), True, "project", "low", 90),
    CaptureProfile("document", Capture.TYPE_DOCUMENT, "project-capture.v1", "Project Document", "Attach a private project document.", ("project",), ("agreement",), (), "project_attachment", True, ("document",), False, "project", "low", 100),
    CaptureProfile("equipment", Capture.TYPE_EQUIPMENT, "equipment-capture.v1", "Equipment", "Prepare an equipment record from evidence.", ("project",), (), ("CAPTURE_EQUIPMENT_ENABLED",), "equipment_record", True, ("image", "document"), True, "equipment", "medium", 110, True),
    CaptureProfile("warranty_document", Capture.TYPE_WARRANTY_DOCUMENT, "warranty-document.v1", "Warranty Document", "Prepare warranty documentation for review.", ("project",), ("agreement",), ("CAPTURE_WARRANTY_ENABLED",), "warranty_document", True, ("image", "document"), True, "warranty", "medium", 120, True),
    CaptureProfile("warranty_concern", Capture.TYPE_WARRANTY_CONCERN, "warranty-concern.v1", "Warranty Concern", "Record a concern for review.", ("project",), ("agreement",), ("CAPTURE_WARRANTY_ENABLED",), "warranty_request", True, ("image", "document"), True, "warranty", "high", 130, True, non_effects="Does not determine warranty coverage."),
    CaptureProfile("manual_measurement", Capture.TYPE_MEASUREMENT, "measurement-capture.v1", "Manual Measurement", "Open the verified measurement form.", ("project",), ("milestone",), ("CAPTURE_MEASUREMENT_ENABLED",), "measurement_session", True, ("image", "document"), True, "measurement", "medium", 140, True, non_effects="Does not calculate pricing, waste, or takeoff."),
    CaptureProfile("change_request", Capture.TYPE_COMMUNICATION, "change-intake.v1", "Change Request", "Prepare a non-binding Amendment Request.", ("project", "agreement"), ("milestone",), ("CAPTURE_CHANGE_REQUEST_ENABLED",), "amendment_request", True, ("image", "document"), True, "change_intake", "high", 150, non_effects="Does not change the agreement or authorize work."),
)

PROFILE_MAP = {row.profile_key: row for row in PROFILES}


def _feature_enabled(name):
    return bool(getattr(settings, name, False))


def _destination_available(profile):
    return not profile.destination_key or profile.destination_key in ADAPTERS


def resolve_profiles(*, user, project=None, milestone=None, agreement=None):
    contractor = get_contractor_for_user(user)
    if not contractor or not can_create_capture(user):
        return []
    context = {
        "project": project,
        "milestone": milestone,
        "agreement": agreement,
    }
    result = []
    for profile in PROFILES:
        if any(not _feature_enabled(flag) for flag in profile.feature_requirements):
            continue
        if not _destination_available(profile):
            continue
        if any(not context.get(key) for key in profile.required_context):
            continue
        if project and project.contractor_id != contractor.id:
            continue
        if agreement and (
            agreement.contractor_id != contractor.id or agreement.project_id != getattr(project, "id", None)
        ):
            continue
        if milestone and (
            not project or milestone.agreement.project_id != project.id
        ):
            continue
        if project and not can_create_project_capture(user, project, milestone):
            continue
        result.append(profile)
    return sorted(result, key=lambda row: row.priority)


def registry_response(*, user, project=None, milestone=None, agreement=None):
    return {
        "registry_version": REGISTRY_VERSION,
        "profiles": [
            row.public_dict()
            for row in resolve_profiles(
                user=user, project=project, milestone=milestone, agreement=agreement
            )
        ],
    }
