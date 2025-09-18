# ~/backend/backend/projects/views/agreements_merge.py
from __future__ import annotations

import re
from decimal import Decimal
from typing import Iterable, List, Optional

from django.db import transaction
from django.db.models import Max
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser

from projects.models import Agreement, Milestone, AgreementAmendment


def _coerce_ids(raw: object) -> List[int]:
    vals: Iterable
    if raw is None:
        vals = []
    elif isinstance(raw, (list, tuple, set)):
        vals = raw
    else:
        vals = [raw]

    out: List[int] = []
    for v in vals:
        if v is None:
            continue
        if isinstance(v, int):
            out.append(v); continue
        s = str(v).strip()
        if not s:
            continue
        for tok in re.split(r"[,\s]+", s):
            if not tok:
                continue
            try:
                out.append(int(tok))
            except Exception:
                pass

    seen = set(); uniq: List[int] = []
    for i in out:
        if i not in seen:
            uniq.append(i); seen.add(i)
    return uniq


def _parse_ids_and_primary(request) -> tuple[List[int], Optional[int]]:
    keys_multi = [
        "agreement_ids", "ids",
        "selected", "selected_ids",
        "merge", "merge_ids",
        "agreement_ids[]", "ids[]", "selected[]", "selected_ids[]",
        "merge[]", "merge_ids[]",
    ]
    primary_keys = ["primary_id"]

    def _read_many(src, key):
        try:
            return src.getlist(key)
        except Exception:
            return src.get(key)

    ids: List[int] = []
    # body
    data = getattr(request, "data", {})
    for k in keys_multi:
        v = _read_many(data, k)
        if v is not None:
            ids.extend(_coerce_ids(v))
    # query
    for k in keys_multi:
        v = _read_many(request.query_params, k)
        if v is not None:
            ids.extend(_coerce_ids(v))

    # primary
    primary_id: Optional[int] = None
    for k in primary_keys:
        v = data.get(k) if isinstance(data, dict) else None
        if v is None:
            v = request.query_params.get(k)
        if v is not None:
            try:
                primary_id = int(v)
            except Exception:
                primary_id = None
            break

    if not ids:
        merge_ids = data.get("merge_ids") if isinstance(data, dict) else None
        if merge_ids is None:
            merge_ids = request.query_params.get("merge_ids")
        ids = _coerce_ids(merge_ids)

    # Dedup (stable), drop non-positive
    ids = [i for i in ids if isinstance(i, int) and i > 0]
    if primary_id is not None and primary_id not in ids:
        ids = [primary_id] + ids

    seen = set(); final: List[int] = []
    for i in ids:
        if i not in seen:
            final.append(i); seen.add(i)
    return final, primary_id


class MergeAgreementsView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def post(self, request, *args, **kwargs):
        ids, primary_hint = _parse_ids_and_primary(request)
        return self._merge(ids, primary_hint)

    def get(self, request, *args, **kwargs):
        ids, primary_hint = _parse_ids_and_primary(request)
        return self._merge(ids, primary_hint)

    def _merge(self, ids: List[int], primary_hint: Optional[int]) -> Response:
        # Basic validations up front
        if not isinstance(ids, list) or len(ids) < 2:
            return Response({"detail": "Select at least two agreements.", "received_ids": ids},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(set(ids)) < 2:
            return Response({"detail": "IDs must contain at least two distinct values.", "received_ids": ids},
                            status=status.HTTP_400_BAD_REQUEST)

        order_map = {int(v): i for i, v in enumerate(ids)}

        try:
            with transaction.atomic():
                # Load and verify
                ags = list(Agreement.objects.select_for_update().filter(id__in=ids))
                found = {a.id for a in ags}
                missing = [i for i in ids if i not in found]
                if missing:
                    return Response({"detail": "Some agreement IDs were not found.", "missing": missing},
                                    status=status.HTTP_400_BAD_REQUEST)
                if len(ags) < 2:
                    return Response({"detail": "At least two valid agreements are required."},
                                    status=status.HTTP_400_BAD_REQUEST)

                # Pick primary
                if primary_hint is not None and any(a.id == primary_hint for a in ags):
                    primary = next(a for a in ags if a.id == primary_hint)
                else:
                    fully_signed = [a for a in ags if a.signed_by_contractor and a.signed_by_homeowner]
                    primary = (sorted(fully_signed, key=lambda a: order_map.get(a.id, 10**9))[0]
                               if fully_signed else
                               sorted(ags, key=lambda a: order_map.get(a.id, 10**9))[0])

                children = [a for a in ags if a.id != primary.id]
                if not children:
                    return Response({"detail": "No child agreements to merge after selecting primary."},
                                    status=status.HTTP_400_BAD_REQUEST)

                # Determine current last order
                try:
                    start_order = Milestone.objects.filter(agreement=primary).aggregate(m=Max("order"))["m"] or 0
                except Exception:
                    start_order = 0

                moved_milestones = 0
                total_added = Decimal("0.00")

                for child in children:
                    # Idempotency / re-linking
                    link = AgreementAmendment.objects.filter(child=child).first()
                    if link:
                        if link.parent_id == primary.id:
                            # already linked to this parent — no-op
                            pass
                        else:
                            next_num = (AgreementAmendment.objects
                                        .filter(parent=primary)
                                        .aggregate(m=Max("amendment_number"))["m"] or 0) + 1
                            link.parent = primary
                            link.amendment_number = next_num
                            link.save(update_fields=["parent", "amendment_number"])
                    else:
                        next_num = (AgreementAmendment.objects
                                    .filter(parent=primary)
                                    .aggregate(m=Max("amendment_number"))["m"] or 0) + 1
                        AgreementAmendment.objects.create(parent=primary, child=child, amendment_number=next_num)

                    # Move remaining milestones
                    child_ms = list(
                        Milestone.objects.filter(agreement=child)
                        .order_by("order" if hasattr(Milestone, "order") else "id", "id")
                    )
                    for m in child_ms:
                        start_order += 1
                        m.agreement = primary
                        if hasattr(m, "order"):
                            m.order = start_order
                            m.save(update_fields=["agreement", "order"])
                        else:
                            m.save(update_fields=["agreement"])
                        moved_milestones += 1

                    # Roll up totals
                    try:
                        total_added += Decimal(str(child.total_cost or "0"))
                    except Exception:
                        pass

                    # Archive child
                    child.is_archived = True
                    if primary.status:
                        child.status = primary.status
                    child.save(update_fields=["is_archived", "status"])

                if moved_milestones:
                    primary.milestone_count = (primary.milestone_count or 0) + moved_milestones
                try:
                    primary.total_cost = (Decimal(str(primary.total_cost or "0")) + total_added)
                except Exception:
                    pass
                primary.save(update_fields=["total_cost", "milestone_count"])

                return Response(
                    {
                        "ok": True,
                        "parent_id": primary.id,
                        "merged_ids": [c.id for c in children],
                        "moved_milestones": moved_milestones,
                        "new_total_cost": str(primary.total_cost),
                        "new_milestone_count": primary.milestone_count,
                    },
                    status=status.HTTP_200_OK,
                )
        except Exception as e:
            # Always return JSON with details so the frontend can show it
            return Response({"detail": f"Merge failed: {type(e).__name__}: {e}"}, status=status.HTTP_400_BAD_REQUEST)
