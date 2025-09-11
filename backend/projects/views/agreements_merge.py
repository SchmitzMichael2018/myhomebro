# backend/backend/projects/views/agreements_merge.py
from typing import List, Optional
import logging

from django.db import transaction, IntegrityError
from django.db.models import Max
from django.db.utils import ProgrammingError, OperationalError
from django.core.exceptions import FieldError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions

from ..models import Agreement, Milestone

logger = logging.getLogger(__name__)

def _get_amendment_model():
    """Import AgreementAmendment lazily so the view doesn't crash if migration isn't applied."""
    try:
        from ..models import AgreementAmendment  # type: ignore
        return AgreementAmendment
    except Exception:
        return None

def _as_int_list(vals) -> List[int]:
    out = []
    for v in vals or []:
        try:
            out.append(int(v))
        except Exception:
            pass
    return out

def _safe_contractor_profile(user) -> Optional[object]:
    """Return contractor_profile or None without raising DoesNotExist."""
    try:
        return user.contractor_profile
    except Exception:
        return None

def _move_milestones_safely(primary: Agreement, others: List[Agreement]) -> float:
    """
    Move milestones from 'others' into 'primary' without violating unique(order, agreement).
    Returns total rolled-up cost.
    """
    max_order = Milestone.objects.filter(agreement=primary).aggregate(Max("order")).get("order__max") or 0
    try:
        max_order = int(max_order)
    except Exception:
        max_order = 0

    total_roll = 0.0
    for ag in others:
        try:
            total_roll += float(ag.total_cost or 0)
        except Exception:
            pass

        to_move = list(
            Milestone.objects.select_for_update().filter(agreement=ag).order_by("order", "id")
        )
        for m in to_move:
            max_order += 1
            m.order = max_order
            m.agreement = primary
            m.save(update_fields=["agreement", "order"])
    return total_roll


@method_decorator(csrf_exempt, name="dispatch")
class MergeAgreementsView(APIView):
    """
    POST /api/projects/agreements/merge/
    {
      "primary_id": 12,
      "merge_ids": [13, 14]
    }

    - If none are fully signed: move milestones into primary (safe re-numbering), roll up total cost, archive others.
    - If any is fully signed: ensure a signed primary; others become amendments (keep their milestones).
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        primary_id_raw = data.get("primary_id")
        merge_ids_raw = data.get("merge_ids")

        # input validation
        try:
            primary_id = int(primary_id_raw)
        except Exception:
            return Response({"detail": "primary_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(merge_ids_raw, list) or not merge_ids_raw:
            return Response({"detail": "merge_ids must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

        merge_ids = [i for i in _as_int_list(merge_ids_raw) if i != primary_id]
        if not merge_ids:
            return Response({"detail": "merge_ids cannot be empty or include primary_id."}, status=status.HTTP_400_BAD_REQUEST)

        # ownership
        contractor = _safe_contractor_profile(request.user)
        if contractor is None:
            return Response({"detail": "No contractor profile for current user."}, status=status.HTTP_403_FORBIDDEN)

        try:
            with transaction.atomic():
                try:
                    primary = Agreement.objects.select_for_update().get(
                        pk=primary_id, project__contractor=contractor
                    )
                except Agreement.DoesNotExist:
                    return Response({"detail": "Primary agreement not found or not permitted."},
                                    status=status.HTTP_404_NOT_FOUND)

                others = list(
                    Agreement.objects.select_for_update().filter(pk__in=merge_ids, project__contractor=contractor)
                )
                if not others:
                    return Response({"detail": "No mergeable agreements found for this user."},
                                    status=status.HTTP_400_BAD_REQUEST)

                any_signed = bool(getattr(primary, "is_fully_signed", False)) or any(
                    getattr(a, "is_fully_signed", False) for a in others
                )

                # if any signed and primary isn't, promote a signed agreement as primary
                if any_signed and not getattr(primary, "is_fully_signed", False):
                    signed_parent = next((a for a in others if getattr(a, "is_fully_signed", False)), None)
                    if signed_parent:
                        others = [a for a in others if a.pk != signed_parent.pk] + [primary]
                        primary = signed_parent

                # CASE A: none signed → merge into primary (safe resequencing)
                if not any_signed:
                    total_roll = _move_milestones_safely(primary, others)

                    for ag in others:
                        if hasattr(ag, "is_archived"):
                            try:
                                ag.is_archived = True
                                ag.save(update_fields=["is_archived"])
                            except Exception:
                                pass

                    try:
                        primary.total_cost = float(primary.total_cost or 0) + total_roll
                        primary.save(update_fields=["total_cost"])
                    except Exception:
                        pass

                    return Response(
                        {"status": "merged", "mode": "unsigned_rollup",
                         "primary_id": primary.pk, "moved_from": [a.pk for a in others]},
                        status=status.HTTP_200_OK,
                    )

                # CASE B: at least one signed → others become amendments
                Amendment = _get_amendment_model()
                if Amendment is None:
                    return Response(
                        {"detail": "Amendment support is not active (apply latest migrations for AgreementAmendment)."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE,
                    )

                # Pre-collect used numbers to avoid unique collisions
                used = set(Amendment.objects.filter(parent=primary).values_list("amendment_number", flat=True))
                def next_free():
                    n = 1
                    if used:
                        n = max(used) + 1
                    while n in used:
                        n += 1
                    used.add(n)
                    return n

                amended = []
                for ag in others:
                    # if already linked as amendment to this parent, keep its number
                    link = getattr(ag, "as_amendment", None)
                    if link and getattr(link, "parent_id", None) == primary.id:
                        num = int(getattr(link, "amendment_number", 0) or 0)
                        if num in used:
                            # already accounted
                            pass
                        else:
                            used.add(num if num > 0 else next_free())
                    else:
                        num = next_free()
                        Amendment.objects.update_or_create(
                            child=ag,
                            defaults={"parent": primary, "amendment_number": num},
                        )

                    # Mirror onto Agreement.amendment_number if present
                    if hasattr(ag, "amendment_number"):
                        try:
                            if getattr(ag, "amendment_number") != num:
                                ag.amendment_number = num
                                if hasattr(ag, "is_archived") and ag.is_archived:
                                    ag.is_archived = False
                                    ag.save(update_fields=["amendment_number", "is_archived"])
                                else:
                                    ag.save(update_fields=["amendment_number"])
                        except Exception as e:
                            logger.warning("Failed to mirror amendment_number on Agreement #%s: %s", ag.pk, e)

                    amended.append({"child_id": ag.pk, "amendment_number": num})

                return Response(
                    {"status": "amended", "primary_id": primary.pk, "amendments": amended},
                    status=status.HTTP_200_OK,
                )

        except (ProgrammingError, OperationalError) as db_err:
            logger.exception("DB error during merge: %s", db_err)
            return Response(
                {"detail": "Database error (likely missing migration/table).", "error": str(db_err)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except IntegrityError as ie:
            logger.exception("Integrity error during merge: %s", ie)
            return Response(
                {"detail": "Integrity error (unique constraint or relation issue).", "error": str(ie)},
                status=status.HTTP_409_CONFLICT,
            )
        except FieldError as fe:
            logger.exception("Field error during merge: %s", fe)
            return Response(
                {"detail": "Field error (model fields mismatch).", "error": str(fe)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            logger.exception("Unexpected error during merge: %s", e)
            return Response(
                {"detail": "Unexpected error during merge.", "error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
