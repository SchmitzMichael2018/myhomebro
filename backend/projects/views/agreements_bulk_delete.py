from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, ProjectStatus
from projects.services.agreements.permissions import require_delete_allowed


RETENTION_YEARS = 3


def _coerce_ids(raw):
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.split(",") if part.strip()]
    if not isinstance(raw, (list, tuple, set)):
        raw = [raw]

    ids = []
    for item in raw:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in ids:
            ids.append(value)
    return ids


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _reason_from_exception(exc) -> str:
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        for value in detail.values():
            if isinstance(value, (list, tuple)):
                return " ".join(str(item) for item in value)
            if value:
                return str(value)
    if isinstance(detail, (list, tuple)):
        return " ".join(str(item) for item in detail)
    return str(detail or exc or "Deletion is not allowed for this agreement.")


def _bulk_delete_block_reason(agreement: Agreement) -> str:
    if bool(getattr(agreement, "signed_by_contractor", False)) or bool(
        getattr(agreement, "signed_by_homeowner", False)
    ):
        return "Signed agreements cannot be deleted."

    status = str(getattr(agreement, "status", "") or "").lower()
    if status != ProjectStatus.DRAFT:
        return "Only draft agreements can be deleted."

    if bool(getattr(agreement, "escrow_funded", False)) or _money(
        getattr(agreement, "escrow_funded_amount", 0)
    ) > 0:
        return "Funded agreements cannot be deleted."

    if agreement.invoices.exists():
        return "Agreements with invoices cannot be deleted."

    if agreement.disputes.exists():
        return "Agreements with disputes cannot be deleted."

    if agreement.draw_requests.exists():
        return "Agreements with draw requests cannot be deleted."

    if agreement.external_payment_records.exists():
        return "Agreements with recorded payments cannot be deleted."

    return ""


class BulkDeleteAgreementsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ids = _coerce_ids(
            request.data.get("agreement_ids")
            or request.data.get("ids")
            or request.data.get("selected_ids")
        )
        if not ids:
            return Response({"detail": "Select at least one agreement to delete."}, status=400)

        deleted = []
        skipped = []

        with transaction.atomic():
            agreements = {
                agreement.id: agreement
                for agreement in Agreement.objects.select_for_update()
                .select_related("contractor", "contractor__user")
                .filter(id__in=ids)
            }

            for agreement_id in ids:
                agreement = agreements.get(agreement_id)
                if not agreement:
                    skipped.append({"id": agreement_id, "reason": "Agreement not found."})
                    continue

                try:
                    require_delete_allowed(request.user, agreement, retention_years=RETENTION_YEARS)
                except Exception as exc:
                    skipped.append({"id": agreement_id, "reason": _reason_from_exception(exc)})
                    continue

                reason = _bulk_delete_block_reason(agreement)
                if reason:
                    skipped.append({"id": agreement_id, "reason": reason})
                    continue

                deleted.append({"id": agreement_id})
                agreement.delete()

        return Response(
            {
                "deleted_count": len(deleted),
                "skipped_count": len(skipped),
                "deleted": deleted,
                "skipped": skipped,
            }
        )
