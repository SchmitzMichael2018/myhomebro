"""
Re-export serializer classes so views can do:
    from projects.serializers import <Name>Serializer

Hardened version:
- Only constructs a ModelSerializer when the model exists.
- Otherwise provides a minimal plain Serializer fallback.
- Avoids runtime crashes if app load order or migrations delay model registration.
- Provides a single, explicit __all__ export list for predictability.
"""

from django.apps import apps
from rest_framework import serializers


def _model(app_label: str, name: str):
    try:
        return apps.get_model(app_label, name)
    except Exception:
        return None


def _mk_model_or_plain_serializer(name: str, model):
    """
    If model is available, return a ModelSerializer subclass bound to that model.
    Otherwise, return a minimal plain Serializer so imports don't crash at startup.
    """
    if model is not None:
        return type(
            name,
            (serializers.ModelSerializer,),
            {"Meta": type("Meta", (), {"model": model, "fields": "__all__"})},
        )
    # Plain serializer with a simple id field so DRF doesn't choke on emptiness.
    return type(
        name,
        (serializers.Serializer,),
        {"id": serializers.IntegerField(required=False)},
    )


# ---------------- Resolve models (safe if not yet loaded) ---------------- #
Agreement              = _model("projects", "Agreement")
Milestone              = _model("projects", "Milestone")
Invoice                = _model("projects", "Invoice")
Expense                = _model("projects", "Expense")
HomeownerModel         = _model("projects", "Homeowner")
ContractorModel        = _model("projects", "Contractor")
ProjectModel           = _model("projects", "Project")
DisputeModel           = _model("projects", "Dispute")
MilestoneFileModel     = _model("projects", "MilestoneFile")
MilestoneCommentModel  = _model("projects", "MilestoneComment")


# ---------------- Agreement / Milestone ---------------- #
try:
    from .agreement import AgreementSerializer, AgreementDetailSerializer  # type: ignore
except Exception:
    AgreementSerializer = _mk_model_or_plain_serializer("AgreementSerializer", Agreement)
    AgreementDetailSerializer = AgreementSerializer

try:
    from .milestone import MilestoneSerializer  # type: ignore
except Exception:
    MilestoneSerializer = _mk_model_or_plain_serializer("MilestoneSerializer", Milestone)


# ---------------- Milestone files & comments ---------------- #
try:
    from .milestone_file import MilestoneFileSerializer  # type: ignore
except Exception:
    MilestoneFileSerializer = _mk_model_or_plain_serializer("MilestoneFileSerializer", MilestoneFileModel)

try:
    from .milestone_comment import MilestoneCommentSerializer  # type: ignore
except Exception:
    MilestoneCommentSerializer = _mk_model_or_plain_serializer("MilestoneCommentSerializer", MilestoneCommentModel)


# ---------------- Invoices / Expenses --------------------- #
try:
    from .invoice import InvoiceSerializer  # type: ignore
except Exception:
    InvoiceSerializer = _mk_model_or_plain_serializer("InvoiceSerializer", Invoice)

try:
    from .expense import ExpenseSerializer  # type: ignore
except Exception:
    ExpenseSerializer = _mk_model_or_plain_serializer("ExpenseSerializer", Expense)


# ---------------- Attachments (and legacy alias) ----------- #
try:
    from .attachment import AgreementAttachmentSerializer  # type: ignore
    # Keep legacy alias for older imports
    AttachmentSerializer = AgreementAttachmentSerializer
except Exception:
    AgreementAttachmentSerializer = _mk_model_or_plain_serializer("AgreementAttachmentSerializer", None)
    AttachmentSerializer = AgreementAttachmentSerializer


# ---------------- Homeowner ------------------------------- #
try:
    from .homeowner import HomeownerSerializer, HomeownerWriteSerializer  # type: ignore
except Exception:
    HomeownerSerializer = _mk_model_or_plain_serializer("HomeownerSerializer", HomeownerModel)
    HomeownerWriteSerializer = HomeownerSerializer


# ---------------- Contractor (incl. Public) ---------------- #
# Prefer explicit contractor module if present
try:
    from .contractor import (
        ContractorSerializer,
        ContractorWriteSerializer,
        PublicContractorSerializer,
    )  # type: ignore
except Exception:
    ContractorSerializer = _mk_model_or_plain_serializer("ContractorSerializer", ContractorModel)
    ContractorWriteSerializer = ContractorSerializer
    PublicContractorSerializer = ContractorSerializer


# ---------------- Project / Dispute / Notifications ------- #
try:
    from .project import ProjectSerializer, ProjectWriteSerializer  # type: ignore
except Exception:
    ProjectSerializer = _mk_model_or_plain_serializer("ProjectSerializer", ProjectModel)
    ProjectWriteSerializer = ProjectSerializer

try:
    from .dispute import DisputeSerializer  # type: ignore
except Exception:
    DisputeSerializer = _mk_model_or_plain_serializer("DisputeSerializer", DisputeModel)

try:
    from .notifications import NotificationSerializer  # type: ignore
except Exception:
    NotificationSerializer = _mk_model_or_plain_serializer("NotificationSerializer", None)


# ---------------- Public exports -------------------------- #
__all__ = [
    # Agreement / Milestones
    "AgreementSerializer",
    "AgreementDetailSerializer",
    "MilestoneSerializer",
    "MilestoneFileSerializer",
    "MilestoneCommentSerializer",
    # Financial
    "InvoiceSerializer",
    "ExpenseSerializer",
    # Attachments (and legacy alias)
    "AgreementAttachmentSerializer",
    "AttachmentSerializer",
    # Homeowner
    "HomeownerSerializer",
    "HomeownerWriteSerializer",
    # Contractor + public
    "ContractorSerializer",
    "ContractorWriteSerializer",
    "PublicContractorSerializer",
    # Project / Dispute / Notifications
    "ProjectSerializer",
    "ProjectWriteSerializer",
    "DisputeSerializer",
    "NotificationSerializer",
]
