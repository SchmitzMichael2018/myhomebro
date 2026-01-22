from __future__ import annotations

from django.db.models import Q


def get_visible_milestones_for_subaccount(
    subaccount,
    MilestoneModel,
    AgreementAssignmentModel,
    MilestoneAssignmentModel,
):
    """
    Visibility rules for a ContractorSubAccount:

    Visible if:
      A) milestone explicitly assigned to this subaccount (MilestoneAssignment), OR
      B) agreement assigned to this subaccount (AgreementAssignment),
         AND the milestone is NOT explicitly assigned to someone else.

    This implements:
      - Assign agreement => all milestones visible
      - Assign milestone => overrides agreement assignment
    """
    direct_ids = MilestoneAssignmentModel.objects.filter(
        subaccount=subaccount
    ).values_list("milestone_id", flat=True)

    agreement_ids = AgreementAssignmentModel.objects.filter(
        subaccount=subaccount
    ).values_list("agreement_id", flat=True)

    overridden_elsewhere = MilestoneAssignmentModel.objects.exclude(
        subaccount=subaccount
    ).values_list("milestone_id", flat=True)

    return MilestoneModel.objects.filter(
        Q(id__in=direct_ids)
        | (Q(agreement_id__in=agreement_ids) & ~Q(id__in=overridden_elsewhere))
    )
