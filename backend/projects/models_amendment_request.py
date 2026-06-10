from django.conf import settings
from django.db import models
from django.utils import timezone
from decimal import Decimal


class AmendmentRequest(models.Model):
    """
    A lightweight 'change request' record. This does NOT change the agreement/milestone.
    It captures intent and justification, and can be used to route into the amendment flow.
    """

    class ChangeType(models.TextChoices):
        DATE_CHANGE = "date_change", "Date Change"
        AMOUNT_CHANGE = "amount_change", "Amount Change"
        SCOPE_PRODUCT_CHANGE = "scope_product_change", "Product/Scope Change"
        DESCOPE_REMOVE_WORK = "descope_remove_work", "De-scope / Remove Work"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ROUTED_TO_AMENDMENT = "routed_to_amendment", "Routed to Amendment"
        CLOSED = "closed", "Closed"

    class RefundEligibilityStatus(models.TextChoices):
        NOT_APPLICABLE = "not_applicable", "Not Applicable"
        ESTIMATE_ONLY = "estimate_only", "Estimate Only"
        ELIGIBLE_AFTER_SIGNED = "eligible_after_signed", "Eligible After Signed Amendment"
        ELIGIBLE = "eligible", "Refund Eligible"

    class ResponseState(models.TextChoices):
        PENDING = "pending", "Pending Response"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        COUNTERED = "countered", "Countered"

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="amendment_requests",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="amendment_requests",
        help_text="Optional. Some amendment requests may be agreement-level.",
    )
    affected_milestones = models.ManyToManyField(
        "projects.Milestone",
        blank=True,
        related_name="affected_amendment_requests",
        help_text="Milestones directly affected by this amendment request.",
    )

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="amendment_requests",
    )

    change_type = models.CharField(
        max_length=64,
        choices=ChangeType.choices,
        default=ChangeType.OTHER,
    )

    # flexible payload describing requested changes (new_date, new_amount, new_scope, etc.)
    requested_changes = models.JSONField(default=dict, blank=True)

    justification = models.TextField(blank=True, default="")

    original_project_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    revised_project_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    escrow_funded_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    estimated_refundable_escrow_surplus = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    refund_eligibility_status = models.CharField(
        max_length=64,
        choices=RefundEligibilityStatus.choices,
        default=RefundEligibilityStatus.NOT_APPLICABLE,
        help_text="De-scope requests start as estimates. Eligibility is only created after the amendment/addendum is approved and signed.",
    )
    refund_eligible_at = models.DateTimeField(null=True, blank=True)

    initiated_by_role = models.CharField(max_length=32, blank=True, default="")
    response_state = models.CharField(
        max_length=32,
        choices=ResponseState.choices,
        default=ResponseState.PENDING,
        db_index=True,
    )
    response_note = models.TextField(blank=True, default="")
    counter_proposal = models.JSONField(default=dict, blank=True)
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="responded_amendment_requests",
    )
    responded_at = models.DateTimeField(null=True, blank=True)
    response_due_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(
        max_length=64,
        choices=Status.choices,
        default=Status.OPEN,
    )

    def mark_refund_eligible_after_signed_amendment(self, *, amendment_agreement=None, save=True) -> bool:
        """
        Promote a de-scope surplus estimate to refund-eligible only after the
        related amendment/addendum agreement is signature-satisfied.

        This does not move money or create a refund. It only marks the surplus
        as eligible for homeowner refund review after both-party approval/signing.
        """
        if self.change_type != self.ChangeType.DESCOPE_REMOVE_WORK:
            return False
        if self.estimated_refundable_escrow_surplus <= Decimal("0.00"):
            return False
        signed = False
        if amendment_agreement is not None:
            requested_changes = self.requested_changes or {}
            try:
                requested_on_amendment_number = int(requested_changes.get("requested_on_amendment_number"))
            except Exception:
                requested_on_amendment_number = None
            try:
                signed_amendment_number = int(getattr(amendment_agreement, "amendment_number", 0) or 0)
            except Exception:
                signed_amendment_number = 0
            if requested_on_amendment_number is None or signed_amendment_number <= requested_on_amendment_number:
                return False
            try:
                signature_satisfied = getattr(amendment_agreement, "signature_is_satisfied", False)
                signed = signature_satisfied() if callable(signature_satisfied) else bool(signature_satisfied)
            except Exception:
                signed = bool(
                    getattr(amendment_agreement, "signed_by_contractor", False)
                    and getattr(amendment_agreement, "signed_by_homeowner", False)
                )
        if not signed:
            return False
        self.refund_eligibility_status = self.RefundEligibilityStatus.ELIGIBLE
        self.refund_eligible_at = timezone.now()
        if save:
            self.save(update_fields=["refund_eligibility_status", "refund_eligible_at", "updated_at"])
        return True

    def mark_responded(self, *, response_state: str, actor=None, note: str = "", counter_proposal: dict | None = None) -> None:
        self.response_state = response_state
        self.responded_by = actor
        self.responded_at = timezone.now()
        self.response_note = note or ""
        if counter_proposal is not None:
            self.counter_proposal = counter_proposal
        if response_state == self.ResponseState.ACCEPTED:
            self.status = self.Status.ROUTED_TO_AMENDMENT
        if response_state == self.ResponseState.REJECTED:
            self.status = self.Status.CLOSED
        self.save(
            update_fields=[
                "response_state",
                "responded_by",
                "responded_at",
                "response_note",
                "counter_proposal",
                "status",
                "updated_at",
            ]
        )

    def __str__(self):
        return f"AmendmentRequest #{self.pk} — Agreement {self.agreement_id} — {self.change_type}"


def mark_signed_descoped_amendment_refund_eligibility(agreement) -> list[int]:
    """
    Mark pending de-scope surplus estimates as refund-eligible once the related
    agreement/amendment is signature-satisfied. This is intentionally separate
    from refund creation and money movement.
    """
    if agreement is None or not getattr(agreement, "id", None):
        return []
    try:
        signature_satisfied = getattr(agreement, "signature_is_satisfied", False)
        signed = signature_satisfied() if callable(signature_satisfied) else bool(signature_satisfied)
    except Exception:
        signed = bool(
            getattr(agreement, "signed_by_contractor", False)
            and getattr(agreement, "signed_by_homeowner", False)
        )
    if not signed:
        return []

    updated_ids: list[int] = []
    requests = AmendmentRequest.objects.filter(
        agreement=agreement,
        change_type=AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK,
        refund_eligibility_status=AmendmentRequest.RefundEligibilityStatus.ELIGIBLE_AFTER_SIGNED,
        estimated_refundable_escrow_surplus__gt=Decimal("0.00"),
    ).exclude(status=AmendmentRequest.Status.CLOSED)
    for amendment_request in requests:
        if amendment_request.mark_refund_eligible_after_signed_amendment(amendment_agreement=agreement):
            updated_ids.append(amendment_request.id)
    return updated_ids


def open_descoped_amendment_for_milestone(milestone) -> AmendmentRequest | None:
    if milestone is None or not getattr(milestone, "id", None):
        return None
    return (
        AmendmentRequest.objects.filter(
            change_type=AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK,
            response_state__in=[AmendmentRequest.ResponseState.PENDING, AmendmentRequest.ResponseState.COUNTERED],
            affected_milestones=milestone,
        )
        .exclude(status=AmendmentRequest.Status.CLOSED)
        .order_by("-created_at", "-id")
        .first()
    )


def apply_descoped_milestone_hold(amendment_request: AmendmentRequest) -> None:
    if amendment_request.change_type != AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK:
        return
    for milestone in amendment_request.affected_milestones.all():
        update_fields = []
        if hasattr(milestone, "amendment_review_status"):
            milestone.amendment_review_status = "pending"
            update_fields.append("amendment_review_status")
        if hasattr(milestone, "amendment_review_request"):
            milestone.amendment_review_request = amendment_request
            update_fields.append("amendment_review_request")
        if update_fields:
            milestone.save(update_fields=update_fields)
