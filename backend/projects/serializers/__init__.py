"""
Re-export serializer classes so views can do:
    from projects.serializers import <Name>Serializer

This avoids ImportError at import time. When a specific serializer
module is absent, we provide a safe fallback so the app boots rather
than 500 on import.
"""

from rest_framework import serializers  # for fallbacks
from django.apps import apps


def _model(app_label, name):
    try:
        return apps.get_model(app_label, name)
    except Exception:
        return None


Agreement         = _model("projects", "Agreement")
Milestone         = _model("projects", "Milestone")
Invoice           = _model("projects", "Invoice")
Expense           = _model("projects", "Expense")
HomeownerModel    = _model("projects", "Homeowner")
ContractorModel   = _model("projects", "Contractor")
ProjectModel      = _model("projects", "Project")
DisputeModel      = _model("projects", "Dispute")
MilestoneFileModel   = _model("projects", "MilestoneFile")
MilestoneCommentModel = _model("projects", "MilestoneComment")

# ---------------- Agreement / Milestone ---------------- #
try:
    from .agreement import AgreementSerializer  # noqa: F401
except Exception:
    class AgreementSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = Agreement
            fields = "__all__"

try:
    from .agreement import AgreementDetailSerializer  # noqa: F401
except Exception:
    AgreementDetailSerializer = AgreementSerializer  # type: ignore

try:
    from .milestone import MilestoneSerializer  # noqa: F401
except Exception:
    class MilestoneSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = Milestone
            fields = "__all__"

# ---------------- Milestone files & comments ---------------- #
try:
    from .milestone_file import MilestoneFileSerializer  # noqa: F401
except Exception:
    class MilestoneFileSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = MilestoneFileModel
            fields = "__all__"

try:
    from .milestone_comment import MilestoneCommentSerializer  # noqa: F401
except Exception:
    class MilestoneCommentSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = MilestoneCommentModel
            fields = "__all__"

# ---------------- Invoices / Expenses --------------------- #
try:
    from .invoice import InvoiceSerializer  # noqa: F401
except Exception:
    class InvoiceSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = Invoice
            fields = "__all__"

try:
    from .expense import ExpenseSerializer  # noqa: F401
except Exception:
    class ExpenseSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = Expense
            fields = "__all__"

# ---------------- Attachments (and legacy alias) ----------- #
try:
    from .attachment import AgreementAttachmentSerializer  # noqa: F401
    from .attachment import AgreementAttachmentSerializer as AttachmentSerializer  # noqa: F401
except Exception:
    class AgreementAttachmentSerializer(serializers.Serializer):  # type: ignore
        id = serializers.IntegerField(required=False)
    AttachmentSerializer = AgreementAttachmentSerializer  # type: ignore

# ---------------- Homeowner ------------------------------- #
try:
    from .homeowner import HomeownerSerializer  # noqa: F401
except Exception:
    class HomeownerSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = HomeownerModel
            fields = "__all__"

try:
    from .homeowner import HomeownerWriteSerializer  # noqa: F401
except Exception:
    HomeownerWriteSerializer = HomeownerSerializer  # type: ignore

# ---------------- Contractor (incl. Public) ---------------- #
try:
    from .contractor import ContractorSerializer  # noqa: F401
except Exception:
    class ContractorSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = ContractorModel
            fields = "__all__"

try:
    from .contractor import ContractorWriteSerializer  # noqa: F401
except Exception:
    ContractorWriteSerializer = ContractorSerializer  # type: ignore

try:
    from .contractor import PublicContractorSerializer  # noqa: F401
except Exception:
    PublicContractorSerializer = ContractorSerializer  # type: ignore

# ---------------- Project / Dispute / Notifications ------- #
try:
    from .project import ProjectSerializer  # noqa: F401
except Exception:
    class ProjectSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = ProjectModel
            fields = "__all__"

try:
    from .project import ProjectWriteSerializer  # noqa: F401
except Exception:
    ProjectWriteSerializer = ProjectSerializer  # type: ignore

try:
    from .dispute import DisputeSerializer  # noqa: F401
except Exception:
    class DisputeSerializer(serializers.ModelSerializer):  # type: ignore
        class Meta:
            model = DisputeModel
            fields = "__all__"

try:
    from .notifications import NotificationSerializer  # noqa: F401
except Exception:
    class NotificationSerializer(serializers.Serializer):  # type: ignore
        id = serializers.IntegerField(required=False)
