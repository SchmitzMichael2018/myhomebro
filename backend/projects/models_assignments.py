from django.db import models


class AgreementAssignment(models.Model):
    """
    Assigns an entire Agreement to a ContractorSubAccount.
    All milestones are visible unless overridden.
    """
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="subaccount_assignments",
    )
    subaccount = models.ForeignKey(
        "projects.ContractorSubAccount",
        on_delete=models.CASCADE,
        related_name="agreement_assignments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("agreement", "subaccount")

    def __str__(self):
        return f"AgreementAssignment(agreement={self.agreement_id}, subaccount={self.subaccount_id})"


class MilestoneAssignment(models.Model):
    """
    Explicit assignment of ONE milestone to ONE subaccount.
    Overrides agreement-level assignments.
    """
    milestone = models.OneToOneField(
        "projects.Milestone",
        on_delete=models.CASCADE,
        related_name="subaccount_assignment",
    )
    subaccount = models.ForeignKey(
        "projects.ContractorSubAccount",
        on_delete=models.CASCADE,
        related_name="milestone_assignments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"MilestoneAssignment(milestone={self.milestone_id}, subaccount={self.subaccount_id})"
