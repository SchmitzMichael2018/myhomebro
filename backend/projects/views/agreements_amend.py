# backend/projects/views/agreements_amend.py
# v2025-12-11-final — Amendment creation with correct "fully signed" detection
# - Treats Agreement as fully signed if:
#     (legacy flags) OR (modern flags) OR (status == "signed")
# - Calls mark_agreement_amended() which resets ALL signature state
# - Increments amendment_number
# - Keeps SAME Agreement ID (in-place amendment mode)

from __future__ import annotations

import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from projects.models import Agreement
from projects.serializers.agreement import AgreementSerializer
from projects.utils.accounts import get_contractor_for_user
from projects.services.amendments import mark_agreement_amended

logger = logging.getLogger(__name__)


def _looks_fully_signed(agreement: Agreement) -> bool:
    """
    Determine whether an Agreement should be treated as fully signed.
    This must cover:
      - legacy signature booleans
      - modern signature booleans
      - status field (many older flows rely on status='signed')
    """

    # Legacy booleans
    contractor_legacy = bool(getattr(agreement, "contractor_signed", False))
    homeowner_legacy = bool(getattr(agreement, "homeowner_signed", False))

    # Modern booleans
    contractor_new = bool(getattr(agreement, "signed_by_contractor", False))
    homeowner_new = bool(getattr(agreement, "signed_by_homeowner", False))

    # Status field (CRITICAL — this is why your amendment reset was skipped)
    status_val = (getattr(agreement, "status", "") or "").strip().lower()
    status_signed = status_val == "signed"

    return (contractor_legacy and homeowner_legacy) or (contractor_new and homeowner_new) or status_signed


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_amendment(request, pk: int):
    """
    Put an Agreement into amendment mode (same Agreement row, new amendment_number).

    Behavior:
      - If agreement is fully signed, we:
          * reset all signature state (mark_agreement_amended)
          * increment amendment_number
          * reset escrow_funded
          * mark amended_at
          * return updated agreement
      - If agreement is not fully signed, we return it as-is (idempotent)
    """
    contractor = get_contractor_for_user(request.user)
    if contractor is None:
        return Response(
            {"detail": "No contractor account found for user."},
            status=status.HTTP_403_FORBIDDEN,
        )

    agreement = get_object_or_404(
        Agreement.objects.select_related("project"),
        pk=pk,
        project__contractor=contractor,
    )

    try:
        fully_signed = _looks_fully_signed(agreement)
    except Exception as e:
        logger.exception("Error computing fully-signed state: %s", e)
        fully_signed = False

    # If not fully signed, do nothing (this endpoint is intended for signed docs)
    if not fully_signed:
        serializer = AgreementSerializer(agreement, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    try:
        # Reset signatures and preview flags (your updated mark_agreement_amended clears ALL signature state)
        mark_agreement_amended(
            agreement,
            actor=request.user,
            reason="manual-create-amendment",
        )

        # Increment amendment number
        current_amend = getattr(agreement, "amendment_number", None) or 0
        try:
            current_amend = int(current_amend)
        except Exception:
            current_amend = 0
        agreement.amendment_number = current_amend + 1

        # Reset escrow for this amendment round
        if hasattr(agreement, "escrow_funded"):
            agreement.escrow_funded = False

        # Track amended timestamp
        if hasattr(agreement, "amended_at"):
            agreement.amended_at = timezone.now()

        if hasattr(agreement, "last_amend_reason"):
            agreement.last_amend_reason = "manual-create-amendment"

        # Put the agreement back into draft/editable mode
        if hasattr(agreement, "status"):
            agreement.status = "draft"

        agreement.save()

    except Exception as e:
        logger.exception("create_amendment failed: %s", e)
        return Response(
            {"detail": "Could not create amendment."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    agreement.refresh_from_db()
    serializer = AgreementSerializer(agreement, context={"request": request})
    return Response(serializer.data, status=status.HTTP_200_OK)
