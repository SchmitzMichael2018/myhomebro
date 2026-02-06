# backend/projects/views/agreements/__init__.py
"""Agreement views package.

Legacy elimination pass #1:
- Real implementations live in:
  - projects.views.agreements.viewset (AgreementViewSet)
  - projects.views.agreements.public (function endpoints)

Legacy shim removed. Import directly from this package.
"""

from .viewset import AgreementViewSet
from .public import (
    send_final_agreement_link_view,
    agreement_milestones,
    agreement_pdf,
    agreement_public_sign,
    agreement_public_pdf,
)

__all__ = [
    "AgreementViewSet",
    "send_final_agreement_link_view",
    "agreement_milestones",
    "agreement_pdf",
    "agreement_public_sign",
    "agreement_public_pdf",
]
