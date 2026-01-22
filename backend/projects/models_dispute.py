# backend/projects/models_dispute.py
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from django.utils.crypto import get_random_string


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _parse_date(value) -> date | None:
    """
    Accepts:
      - date
      - datetime
      - ISO strings "YYYY-MM-DD" or full datetime strings
    Returns date or None.
    """
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            if len(s) >= 10 and s[4] == "-" and s[7] == "-":
                return date.fromisoformat(s[:10])
        except Exception:
            return None
    return None


def compute_deadline_hours_from_agreement_total(agreement) -> tuple[int, str]:
    """
    Agreement Total tiers:
      <  1,000  -> 48h
      < 10,000  -> 72h
      < 50,000  -> 120h (5d)
      >=50,000  -> 168h (7d)
    """
    total = (
        getattr(agreement, "total_cost", None)
        or getattr(agreement, "total_amount", None)
        or getattr(agreement, "total", None)
        or getattr(agreement, "amount", None)
        or 0
    )
    amt = _dec(total)

    if amt < Decimal("1000"):
        return 48, "small_48h"
    if amt < Decimal("10000"):
        return 72, "medium_72h"
    if amt < Decimal("50000"):
        return 120, "large_120h"
    return 168, "major_168h"


class Dispute(models.Model):
    STATUS_CHOICES = (
        ("initiated", "Initiated"),
        ("open", "Open"),
        ("under_review", "Under Review"),
        ("resolved_contractor", "Resolved - Contractor"),
        ("resolved_homeowner", "Resolved - Homeowner"),
        ("canceled", "Canceled"),
    )

    INITIATOR_CHOICES = (
        ("contractor", "Contractor"),
        ("homeowner", "Homeowner"),
        ("admin", "Admin"),
        ("system", "System"),
    )

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="disputes",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="disputes",
    )

    initiator = models.CharField(max_length=20, choices=INITIATOR_CHOICES)
    reason = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="initiated")

    fee_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    fee_paid = models.BooleanField(default=False)
    fee_paid_at = models.DateTimeField(null=True, blank=True)

    escrow_frozen = models.BooleanField(default=False)

    homeowner_response = models.TextField(blank=True, default="")
    contractor_response = models.TextField(blank=True, default="")
    responded_at = models.DateTimeField(null=True, blank=True)

    admin_notes = models.TextField(blank=True, default="")
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_disputes",
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    # proposal + token
    proposal = models.JSONField(null=True, blank=True)
    proposal_sent_at = models.DateTimeField(null=True, blank=True)
    public_token = models.CharField(max_length=64, unique=True, null=True, blank=True)

    # deadlines / escalation
    response_due_at = models.DateTimeField(null=True, blank=True)
    proposal_due_at = models.DateTimeField(null=True, blank=True)
    deadline_hours = models.IntegerField(null=True, blank=True)
    deadline_tier = models.CharField(max_length=32, blank=True, default="")
    last_activity_at = models.DateTimeField(null=True, blank=True)
    deadline_missed_by = models.CharField(max_length=20, blank=True, default="")  # homeowner/contractor

    def ensure_public_token(self) -> str:
        if self.public_token:
            return self.public_token
        self.public_token = get_random_string(48)
        return self.public_token

    def compute_deadline(self) -> tuple[int, str]:
        return compute_deadline_hours_from_agreement_total(self.agreement)

    def set_response_deadline_now(self):
        hours, tier = self.compute_deadline()
        now = timezone.now()
        self.deadline_hours = hours
        self.deadline_tier = tier
        self.response_due_at = now + timedelta(hours=hours)
        self.last_activity_at = now

    def set_proposal_deadline_now(self):
        hours, tier = self.compute_deadline()
        now = timezone.now()
        self.deadline_hours = hours
        self.deadline_tier = tier
        self.proposal_due_at = now + timedelta(hours=hours)
        self.last_activity_at = now

    def _get_rework_by_date(self) -> date | None:
        """
        Looks for rework due date inside proposal JSON.
        Expected keys:
          - rework_by (recommended)
          - reworkBy (fallback)
        """
        p = self.proposal or {}
        if not isinstance(p, dict):
            return None
        val = (
            p.get("rework_by")
            or p.get("reworkBy")
            or p.get("rework_date")
            or p.get("reworkDate")
        )
        return _parse_date(val)

    def _rework_artifacts_exist(self) -> bool:
        """
        True if:
          - any DisputeWorkOrder with rework_milestone_id set, OR
          - a milestone exists with exact title match
        """
        from projects.models import Milestone  # type: ignore

        linked = (
            DisputeWorkOrder.objects.filter(
                dispute=self, rework_milestone_id__isnull=False
            )
            .exclude(rework_milestone_id=0)
            .exists()
        )
        if linked:
            return True

        title = f"Rework — Dispute #{self.pk}"
        if Milestone.objects.filter(agreement=self.agreement, title=title).exists():
            return True

        return False

    def _fill_required_milestone_fields(self, MilestoneModel, m_kwargs: dict) -> dict:
        """
        Best-effort filler for required Milestone fields (null=False, blank=False, no default).
        This prevents "NOT NULL constraint failed" errors during auto-create.
        """
        field_map = {f.name: f for f in MilestoneModel._meta.fields}
        now = timezone.now()
        today = now.date()

        def has_value(name: str) -> bool:
            v = m_kwargs.get(name, None)
            return v is not None and v != ""

        # Convenient sources
        agreement = self.agreement
        agreement_project = getattr(agreement, "project", None)
        agreement_contractor = getattr(agreement, "contractor", None)
        agreement_homeowner = getattr(agreement, "homeowner", None)

        # Basic candidate values
        fallback_due = self._get_rework_by_date() or (today + timedelta(days=7))

        # Sequence/ordering helper
        def next_int_for(name: str) -> int:
            # Try to set to next available based on agreement milestones count
            try:
                existing_count = getattr(agreement, "milestones", None)
                if existing_count is not None:
                    # related manager
                    return int(agreement.milestones.count()) + 1
            except Exception:
                pass
            return 1

        for name, f in field_map.items():
            if name == "id":
                continue

            # Skip if already set
            if has_value(name):
                continue

            # Determine if required
            required = (not getattr(f, "null", True)) and (not getattr(f, "blank", True))

            # If field has default, it isn't required
            try:
                if f.has_default():
                    required = False
            except Exception:
                # older field types may not have has_default; ignore
                pass

            if not required:
                continue

            # Fill common required fields
            if name in ("agreement",) and agreement:
                m_kwargs[name] = agreement
                continue

            if name in ("project", "project_ref") and agreement_project is not None:
                m_kwargs[name] = agreement_project
                continue

            if name in ("contractor",) and agreement_contractor is not None:
                m_kwargs[name] = agreement_contractor
                continue

            if name in ("homeowner",) and agreement_homeowner is not None:
                m_kwargs[name] = agreement_homeowner
                continue

            # Dates
            if name in ("start_date", "agreement_start", "scheduled_date"):
                m_kwargs[name] = today
                continue

            if name in ("completion_date", "due_date", "end_date", "scheduled_end"):
                m_kwargs[name] = fallback_due
                continue

            # Amounts/fees
            if name in ("amount", "price", "cost", "total"):
                m_kwargs[name] = Decimal("0.00")
                continue

            # Status fields
            if name in ("status",):
                m_kwargs[name] = "incomplete"
                continue

            # Numeric duration
            if name in ("days", "hours", "minutes", "milestone_days", "milestone_hours", "milestone_minutes"):
                m_kwargs[name] = 0
                continue

            # Ordering / numbering
            if name in ("order", "sequence", "milestone_number", "number", "position"):
                m_kwargs[name] = next_int_for(name)
                continue

            # Text fields
            if name in ("title",):
                m_kwargs[name] = f"Rework — Dispute #{self.pk}"
                continue

            if name in ("description", "notes"):
                m_kwargs[name] = f"Rework required from Dispute #{self.pk}."
                continue

            # If it's still required and unknown, we leave it unset; the create will raise,
            # and we will capture the exception into WorkOrder.notes.
        return m_kwargs

    def _create_rework_workorder_and_milestone(self):
        """
        Idempotent creation:
          - create DisputeWorkOrder if missing
          - create rework milestone if missing
          - save milestone id on work order
        If milestone creation fails, writes error into work order notes so it’s visible.
        """
        from projects.models import Milestone  # type: ignore

        rework_by = self._get_rework_by_date()

        # 1) Work order (idempotent)
        wo, _created = DisputeWorkOrder.objects.get_or_create(
            dispute=self,
            agreement=self.agreement,
            defaults={
                "due_date": rework_by,
                "title": f"Rework — Dispute #{self.pk}",
                "notes": "",
                "status": "open",
            },
        )

        # Update work order metadata if improved info exists
        changed = False
        if rework_by and not wo.due_date:
            wo.due_date = rework_by
            changed = True
        if wo.title == "Dispute follow-up":
            wo.title = f"Rework — Dispute #{self.pk}"
            changed = True
        if changed:
            wo.save(update_fields=["due_date", "title"])

        # If already linked, we’re done
        if wo.rework_milestone_id:
            return

        # 2) Find existing milestone if already created
        base_title = f"Rework — Dispute #{self.pk}"
        existing = (
            Milestone.objects.filter(agreement=self.agreement, title=base_title)
            .order_by("-id")
            .first()
            or Milestone.objects.filter(
                agreement=self.agreement, title__icontains=f"Dispute #{self.pk}"
            )
            .order_by("-id")
            .first()
        )
        if existing:
            # ✅ Stamp origin milestone link if this is a rework milestone and field exists
            try:
                if hasattr(existing, 'rework_origin_milestone_id') and not getattr(existing, 'rework_origin_milestone_id', None):
                    if getattr(self, 'milestone_id', None):
                        existing.rework_origin_milestone_id = self.milestone_id
                        existing.save(update_fields=['rework_origin_milestone_id'])
            except Exception:
                pass
            wo.rework_milestone_id = existing.id
            wo.save(update_fields=["rework_milestone_id"])
            return

        # 3) Create new milestone (defensive)
        field_names = {f.name for f in Milestone._meta.get_fields()}

        m_kwargs: dict = {}

        # agreement FK
        if "agreement" in field_names:
            m_kwargs["agreement"] = self.agreement

        # title
        if "title" in field_names:
            m_kwargs["title"] = base_title

        # due date common field in your app is completion_date
        if rework_by:
            if "completion_date" in field_names:
                m_kwargs["completion_date"] = rework_by
            elif "due_date" in field_names:
                m_kwargs["due_date"] = rework_by
            elif "end_date" in field_names:
                m_kwargs["end_date"] = rework_by

        # amount safe default
        if "amount" in field_names:
            m_kwargs["amount"] = Decimal("0.00")

        # status safe default
        if "status" in field_names:
            m_kwargs["status"] = "incomplete"

        # optional description
        if "description" in field_names and "description" not in m_kwargs:
            m_kwargs["description"] = f"Rework required from Dispute #{self.pk}."

        # optional linkage fields (only if present)
        if "dispute_id" in field_names:
            m_kwargs["dispute_id"] = self.pk
        if "rework_of_dispute_id" in field_names:
            m_kwargs["rework_of_dispute_id"] = self.pk
        if "is_rework" in field_names:
            m_kwargs["is_rework"] = True


        # ✅ NEW: link rework milestone back to the original disputed milestone
        # (This field lives on Milestone; added for Option 1)
        if "rework_origin_milestone_id" in field_names:
            m_kwargs["rework_origin_milestone_id"] = getattr(self, "milestone_id", None)

        # ✅ Fill additional required fields if your Milestone model requires them
        m_kwargs = self._fill_required_milestone_fields(Milestone, m_kwargs)

        try:
            new_m = Milestone.objects.create(**m_kwargs)
        except Exception as e:
            # Make the failure visible
            msg = f"[AUTO_CREATE_REWORK_MILESTONE_ERROR] {type(e).__name__}: {e}"
            if wo.notes:
                wo.notes = f"{wo.notes}\n{msg}"
            else:
                wo.notes = msg
            wo.save(update_fields=["notes"])
            return

        wo.rework_milestone_id = new_m.id
        wo.save(update_fields=["rework_milestone_id"])

    def save(self, *args, **kwargs):
        # Determine prior status to detect transitions
        prior_status = None
        if self.pk:
            try:
                prior_status = Dispute.objects.only("status").get(pk=self.pk).status
            except Dispute.DoesNotExist:
                prior_status = None

        self.updated_at = timezone.now()
        if not self.public_token:
            self.ensure_public_token()

        super().save(*args, **kwargs)

        # Ensure rework artifacts exist whenever status is resolved_contractor
        if self.status == "resolved_contractor":
            should_create = (prior_status != "resolved_contractor") or (
                not self._rework_artifacts_exist()
            )
            if should_create:

                def _do_create():
                    self._create_rework_workorder_and_milestone()

                transaction.on_commit(_do_create)

    def __str__(self) -> str:
        return f"Dispute #{self.pk} ({self.status})"


class DisputeAttachment(models.Model):
    KIND_CHOICES = (
        ("agreement", "Agreement"),
        ("milestone", "Milestone"),
        ("photo", "Photo"),
        ("receipt", "Receipt"),
        ("other", "Other"),
    )

    dispute = models.ForeignKey(Dispute, on_delete=models.CASCADE, related_name="attachments")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="other")
    file = models.FileField(upload_to="disputes/%Y/%m/")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"Attachment #{self.pk} ({self.kind}) for dispute #{self.dispute_id}"


class DisputeReminderLog(models.Model):
    dispute = models.ForeignKey(Dispute, on_delete=models.CASCADE, related_name="reminder_logs")
    kind = models.CharField(
        max_length=32,
        default="response_due",
        help_text="response_due, proposal_due, escalation, etc.",
    )
    sent_to = models.CharField(
        max_length=32,
        help_text="homeowner / contractor / admin",
    )
    sent_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"Reminder {self.kind} → {self.sent_to} (dispute #{self.dispute_id})"


class DisputeWorkOrder(models.Model):
    STATUS_CHOICES = (
        ("open", "Open"),
        ("completed", "Completed"),
        ("canceled", "Canceled"),
    )

    dispute = models.ForeignKey(Dispute, on_delete=models.CASCADE, related_name="work_orders")
    agreement = models.ForeignKey("projects.Agreement", on_delete=models.CASCADE, related_name="dispute_work_orders")
    due_date = models.DateField(null=True, blank=True)

    title = models.CharField(max_length=200, default="Dispute follow-up")
    notes = models.TextField(blank=True, default="")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")

    created_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)

    # stores created rework milestone id (no FK dependency)
    rework_milestone_id = models.BigIntegerField(null=True, blank=True)

    def __str__(self) -> str:
        return f"WorkOrder #{self.pk} dispute={self.dispute_id} status={self.status}"
