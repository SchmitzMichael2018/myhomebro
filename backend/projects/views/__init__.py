# backend/backend/projects/views/__init__.py

# ViewSets
from .project import ProjectViewSet
from .contractor import ContractorViewSet
from .homeowner import HomeownerViewSet
from .agreements import AgreementViewSet
from .invoice import InvoiceViewSet
from .expense import ExpenseViewSet
from .milestone import (
    MilestoneViewSet,
    MilestoneFileViewSet,
    MilestoneCommentViewSet,
)

# Magic Views
from .magic_invoice import (
    MagicInvoiceView,
    MagicInvoiceApproveView,
    MagicInvoiceDisputeView,
)
from .public_sign import (
    AgreementSignView,
    AgreementSignSuccessView,
    AgreementMagicPdfView,
    MagicAccessView,
    MagicFundEscrowView,
)

# Calendar Views (milestones only — agreements removed)
from .calendar import MilestoneCalendarView

# Webhooks
from .stripe_webhook import stripe_webhook

__all__ = [
    "ProjectViewSet",
    "ContractorViewSet",
    "HomeownerViewSet",
    "AgreementViewSet",
    "InvoiceViewSet",
    "ExpenseViewSet",
    "MilestoneViewSet",
    "MilestoneFileViewSet",
    "MilestoneCommentViewSet",
    "MagicInvoiceView",
    "MagicInvoiceApproveView",
    "MagicInvoiceDisputeView",
    "AgreementSignView",
    "AgreementSignSuccessView",
    "AgreementMagicPdfView",
    "MagicAccessView",
    "MagicFundEscrowView",
    "MilestoneCalendarView",
    "stripe_webhook",
]
