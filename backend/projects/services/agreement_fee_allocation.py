from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Sum

from payments.fees import calculate_total_allowed_fee_cents_for_agreement_total
from projects.models import Agreement, Milestone


def _to_cents(amount) -> int:
    if amount in (None, ""):
        return 0
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return int((amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _current_amendment_number(agreement: Agreement) -> int:
    try:
        return max(int(getattr(agreement, "amendment_number", 0) or 0), 0)
    except Exception:
        return 0


def _allocate_cents(total_cents: int, milestones: list[Milestone]) -> dict[int, int]:
    if total_cents <= 0 or not milestones:
        return {milestone.id: 0 for milestone in milestones}

    amounts = [max(_to_cents(getattr(milestone, "amount", Decimal("0.00"))), 0) for milestone in milestones]
    total_amount_cents = sum(amounts)
    if total_amount_cents <= 0:
        base = total_cents // len(milestones)
        remainder = total_cents % len(milestones)
        return {
            milestone.id: base + (1 if idx < remainder else 0)
            for idx, milestone in enumerate(milestones)
        }

    allocations: dict[int, int] = {}
    consumed = 0
    remainders: list[tuple[int, int]] = []
    for idx, milestone in enumerate(milestones):
        raw = total_cents * amounts[idx]
        cents = raw // total_amount_cents
        remainder = raw % total_amount_cents
        allocations[milestone.id] = cents
        consumed += cents
        remainders.append((remainder, milestone.id))

    remainder_cents = total_cents - consumed
    for _remainder, milestone_id in sorted(remainders, reverse=True)[:remainder_cents]:
        allocations[milestone_id] += 1

    return allocations


@transaction.atomic
def refresh_agreement_fee_allocations(agreement: Agreement | int) -> dict[str, int]:
    agreement_id = agreement.id if isinstance(agreement, Agreement) else int(agreement)
    locked_agreement = Agreement.objects.select_for_update().select_related("contractor").get(pk=agreement_id)
    current_amendment = _current_amendment_number(locked_agreement)

    milestones = list(
        Milestone.objects.select_for_update()
        .filter(agreement_id=agreement_id)
        .order_by("order", "id")
    )

    total_cost = (
        Milestone.objects.filter(agreement_id=agreement_id).aggregate(total=Sum("amount")).get("total")
        or Decimal("0.00")
    )
    contract_amount_cents = _to_cents(total_cost)
    total_allowed_fee_cents = calculate_total_allowed_fee_cents_for_agreement_total(
        contract_amount_cents=contract_amount_cents,
        contractor=locked_agreement.contractor,
        is_high_risk=False,
    )

    if current_amendment <= 0:
        target_milestones = milestones
        prior_allocated_cents = 0
    else:
        target_milestones = [
            milestone for milestone in milestones
            if int(getattr(milestone, "amendment_number_snapshot", 0) or 0) == current_amendment
        ]
        prior_allocated_cents = sum(
            int(getattr(milestone, "agreement_fee_allocation_cents", 0) or 0)
            for milestone in milestones
            if int(getattr(milestone, "amendment_number_snapshot", 0) or 0) < current_amendment
        )

    amendment_fee_delta_cents = max(total_allowed_fee_cents - prior_allocated_cents, 0)
    allocations = _allocate_cents(amendment_fee_delta_cents, target_milestones)

    for milestone in target_milestones:
        new_value = int(allocations.get(milestone.id, 0) or 0)
        if int(getattr(milestone, "agreement_fee_allocation_cents", 0) or 0) != new_value:
            milestone.agreement_fee_allocation_cents = new_value
            milestone.save(update_fields=["agreement_fee_allocation_cents"])

    allocated_total_cents = prior_allocated_cents + sum(int(value or 0) for value in allocations.values())
    agreement_update_fields = []
    if locked_agreement.total_cost != total_cost:
        locked_agreement.total_cost = total_cost
        agreement_update_fields.append("total_cost")
    if int(getattr(locked_agreement, "agreement_fee_total_cents", 0) or 0) != total_allowed_fee_cents:
        locked_agreement.agreement_fee_total_cents = total_allowed_fee_cents
        agreement_update_fields.append("agreement_fee_total_cents")
    if int(getattr(locked_agreement, "agreement_fee_allocated_cents", 0) or 0) != allocated_total_cents:
        locked_agreement.agreement_fee_allocated_cents = allocated_total_cents
        agreement_update_fields.append("agreement_fee_allocated_cents")
    if agreement_update_fields:
        locked_agreement.save(update_fields=agreement_update_fields)

    return {
        "agreement_fee_total_cents": total_allowed_fee_cents,
        "agreement_fee_allocated_cents": allocated_total_cents,
        "amendment_fee_delta_cents": amendment_fee_delta_cents,
    }
