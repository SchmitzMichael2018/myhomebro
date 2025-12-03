# backend/projects/models.py

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from .models_dispute import Dispute, DisputeAttachment
import uuid
import secrets
from datetime import timedelta

# --- Safe default for warranty snapshot (used if blank/None) ---
DEFAULT_WARRANTY_TEXT = (
    "Standard workmanship warranty: Contractor warrants all labor performed under this "
    "Agreement for one (1) year from substantial completion. Materials are covered by the "
    "manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, "
    "alteration, improper maintenance, or acts of God."
)


# --- TextChoices for status fields ---
class ProjectStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SIGNED = "signed", "Signed"
    FUNDED = "funded", "Funded"
    IN_PROGRESS = "in_progress", "In Progress"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class AgreementProjectType(models.TextChoices):
    REMODEL = "Remodel", "Remodel"
    REPAIR = "Repair", "Repair"
    INSTALLATION = "Installation", "Installation"
    PAINTING = "Painting", "Painting"
    OUTDOOR = "Outdoor", "Outdoor"
    INSPECTION = "Inspection", "Inspection"
    CUSTOM = "Custom", "Custom"
    DIY_HELP = "DIY Help", "DIY Help"


class InvoiceStatus(models.TextChoices):
    INCOMPLETE = "incomplete", "Incomplete"
    PENDING = "pending", "Pending Approval"
    APPROVED = "approved", "Approved"
    DISPUTED = "disputed", "Disputed"
    PAID = "paid", "Paid"


class ExpenseStatus(models.TextChoices):
    PENDING = "pending", "Pending Approval"
    APPROVED = "approved", "Approved"
    DISPUTED = "disputed", "Disputed"
    PAID = "paid", "Paid"


class HomeownerStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    PROSPECT = "prospect", "Prospect"
    ARCHIVED = "archived", "Archived"


# --- Define Skill before Contractor ---
class Skill(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Contractor(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contractor_profile",
    )
    business_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)

    # ➕ Added so City/State persist
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=50, blank=True)

    skills = models.ManyToManyField(Skill, blank=True)
    license_number = models.CharField(max_length=50, blank=True)
    license_expiration = models.DateField(null=True, blank=True)
    logo = models.ImageField(upload_to="logos/", null=True, blank=True)
    license_file = models.FileField(upload_to="licenses/", null=True, blank=True)
    # 🔹 NEW: Insurance document upload
    insurance_file = models.FileField(upload_to="insurance/", null=True, blank=True)

    # --- Stripe / Connect ---
    stripe_account_id = models.CharField(max_length=255, blank=True, db_index=True)
    onboarding_status = models.CharField(max_length=50, blank=True)

    # Status flags
    charges_enabled = models.BooleanField(default=False)
    payouts_enabled = models.BooleanField(default=False)
    details_submitted = models.BooleanField(default=False)
    requirements_due_count = models.IntegerField(default=0)
    stripe_status_updated_at = models.DateTimeField(default=timezone.now)
    stripe_deauthorized_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, default="v1.0")

    class Meta:
        ordering = ["business_name"]

    def __str__(self):
        return (
            self.business_name
            or self.name
            or getattr(self.user, "email", "")
            or f"Contractor {self.pk}"
        )

    @property
    def name(self):
        full = getattr(self.user, "get_full_name", lambda: "")() or ""
        return full or self.business_name or getattr(self.user, "email", "") or ""

    @property
    def email(self):
        return getattr(self.user, "email", "") or ""

    @property
    def public_profile_url(self):
        return f"/contractors/{self.id}/profile"

    @property
    def stripe_connected(self) -> bool:
        return bool(self.charges_enabled or self.payouts_enabled)

    @property
    def stripe_action_required(self) -> bool:
        return int(self.requirements_due_count or 0) > 0


class Homeowner(models.Model):
    created_by = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name="homeowners",
        null=True,
    )
    full_name = models.CharField(max_length=255)
    email = models.EmailField(unique=True, db_index=True)
    phone_number = models.CharField(max_length=20, blank=True)
    street_address = models.CharField(max_length=255)
    address_line_2 = models.CharField(
        max_length=255, blank=True, help_text="e.g., Apt, Suite, Building"
    )
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=50)
    zip_code = models.CharField(max_length=20)
    status = models.CharField(
        max_length=20,
        choices=HomeownerStatus.choices,
        default=HomeownerStatus.ACTIVE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class Project(models.Model):
    number = models.CharField(
        max_length=30, unique=True, editable=False, db_index=True
    )
    contractor = models.ForeignKey(
        Contractor, on_delete=models.CASCADE, related_name="projects"
    )
    homeowner = models.ForeignKey(
        Homeowner,
        on_delete=models.SET_NULL,
        related_name="projects",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    project_street_address = models.CharField(max_length=255, blank=True)
    project_address_line_2 = models.CharField(max_length=255, blank=True)
    project_city = models.CharField(max_length=100, blank=True)
    project_state = models.CharField(max_length=50, blank=True)
    project_zip_code = models.CharField(max_length=20, blank=True)
    status = models.CharField(
        max_length=20,
        choices=ProjectStatus.choices,
        default=ProjectStatus.DRAFT,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = self._generate_project_number()
        super().save(*args, **kwargs)

    def _generate_project_number(self):
        prefix = f'PRJ-{timezone.now().strftime("%Y%m%d")}-'
        with transaction.atomic():
            last_project = (
                Project.objects.filter(number__startswith=prefix)
                .order_by("number")
                .last()
            )
            if last_project:
                last_suffix = int(last_project.number.split("-")[-1])
                new_suffix = last_suffix + 1
            else:
                new_suffix = 1
            return f"{prefix}{new_suffix:04d}"

    def __str__(self):
        homeowner_name = getattr(self.homeowner, "full_name", "N/A")
        return f"[{self.number}] {self.title} ({homeowner_name})"


class Agreement(models.Model):
    project = models.OneToOneField(
        Project, on_delete=models.CASCADE, related_name="agreement"
    )
    contractor = models.ForeignKey(
        Contractor, on_delete=models.SET_NULL, null=True, blank=True
    )
    homeowner = models.ForeignKey(
        Homeowner,
        on_delete=models.CASCADE,
        related_name="agreements",
        null=True,
    )

    # Public identifiers
    project_uid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    # Summary
    description = models.TextField(blank=True)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_time_estimate = models.DurationField(null=True, blank=True)
    milestone_count = models.PositiveIntegerField(default=0)

    # Timeline
    start = models.DateField(null=True, blank=True, db_index=True)
    end = models.DateField(null=True, blank=True, db_index=True)

    # 🔹 EXPLICIT PROJECT ADDRESS FIELDS
    project_address_line1 = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Project street address (e.g., 5202 Texana Drive).",
    )
    project_address_line2 = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Project address line 2 (e.g., Apt/Suite).",
    )
    project_address_city = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Project city.",
    )
    project_address_state = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Project state / region.",
    )
    project_postal_code = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text="Project ZIP / postal code.",
    )

    status = models.CharField(
        max_length=20,
        choices=ProjectStatus.choices,
        default=ProjectStatus.DRAFT,
        db_index=True,
    )

    # Access & classification
    homeowner_access_token = models.UUIDField(
        default=uuid.uuid4, editable=False, db_index=True
    )
    project_type = models.CharField(
        max_length=100, choices=AgreementProjectType.choices, blank=True
    )
    project_subtype = models.CharField(max_length=100, blank=True)
    standardized_category = models.CharField(
        max_length=100, blank=True, db_index=True
    )

    # Legal & escrow
    terms_text = models.TextField(blank=True)
    privacy_text = models.TextField(blank=True)

    # Warranty
    warranty_type = models.CharField(
        max_length=16,
        choices=[("default", "Default"), ("custom", "Custom")],
        default="default",
    )
    warranty_text_snapshot = models.TextField(blank=True, default="")

    escrow_payment_intent_id = models.CharField(max_length=255, blank=True)
    escrow_funded = models.BooleanField(default=False)

    # Review & signatures
    reviewed = models.BooleanField(default=False)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.CharField(max_length=32, null=True, blank=True)

    signed_by_contractor = models.BooleanField(default=False)
    signed_at_contractor = models.DateTimeField(null=True, blank=True)
    signed_by_homeowner = models.BooleanField(default=False)
    signed_at_homeowner = models.DateTimeField(null=True, blank=True)
    contractor_signature_name = models.CharField(max_length=255, blank=True)
    homeowner_signature_name = models.CharField(max_length=255, blank=True)
    contractor_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    homeowner_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    contractor_signature = models.FileField(
        upload_to="signatures/contractor/", null=True, blank=True
    )
    homeowner_signature = models.FileField(
        upload_to="signatures/homeowner/", null=True, blank=True
    )

    # PDF & logs
    pdf_file = models.FileField(
        upload_to="agreements/pdf/", null=True, blank=True
    )
    pdf_version = models.PositiveIntegerField(default=1)
    pdf_archived = models.BooleanField(default=False)
    signature_log = models.TextField(blank=True)

    # Lifecycle
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    amendment_number = models.PositiveIntegerField(default=0, editable=False)
    addendum_file = models.FileField(
        upload_to="agreements/addenda/", null=True, blank=True
    )
    is_archived = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        suffix = (
            f" (Amendment {self.amendment_number})"
            if self.amendment_number
            else ""
        )
        return f"Agreement for {self.project.title}{suffix}"

    @property
    def is_fully_signed(self):
        return self.signed_by_contractor and self.signed_by_homeowner

    def save(self, *args, **kwargs):
        # Auto-link contractor from Project if not set
        if not self.contractor and self.project and self.project.contractor_id:
            self.contractor = self.project.contractor

        # Simple status transitions
        if self.escrow_funded:
            self.status = ProjectStatus.FUNDED
        elif self.is_fully_signed and self.status == ProjectStatus.DRAFT:
            self.status = ProjectStatus.SIGNED

        # Normalize warranty_type
        if self.warranty_type:
            self.warranty_type = str(self.warranty_type).strip().lower()
            if self.warranty_type not in ("default", "custom"):
                self.warranty_type = "default"
        else:
            self.warranty_type = "default"

        # Ensure warranty_text_snapshot never blank
        snap = (self.warranty_text_snapshot or "").strip()
        if not snap:
            self.warranty_text_snapshot = DEFAULT_WARRANTY_TEXT

        super().save(*args, **kwargs)


# 🔹 NEW: Escrow funding link model
class AgreementFundingLink(models.Model):
    """A short-lived token that lets a homeowner fund escrow for an agreement."""

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="funding_links",
    )
    token = models.CharField(
        max_length=255,
        unique=True,
        db_index=True,
        help_text="Public token used in the /public-fund/:token URL.",
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Escrow amount the homeowner is asked to fund.",
    )
    currency = models.CharField(
        max_length=8,
        default="usd",
        help_text="Currency code for the escrow funding amount.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(
        default=True,
        help_text="If False, token is considered invalid even if not expired.",
    )

    payment_intent_id = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Stripe PaymentIntent id once we create it.",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return (
            f"FundingLink({self.agreement_id}, "
            f"{self.amount} {self.currency}, active={self.is_active})"
        )

    @classmethod
    def generate_token(cls) -> str:
        """Generate a random URL-safe token."""
        return secrets.token_urlsafe(32)

    @classmethod
    def default_expiry(cls) -> timezone.datetime:
        """Default expiry: 7 days from now."""
        return timezone.now() + timedelta(days=7)

    @property
    def is_expired(self) -> bool:
        now = timezone.now()
        return now >= self.expires_at

    def mark_used(self):
        """Mark this link as used/consumed (after successful payment)."""
        self.used_at = timezone.now()
        self.is_active = False
        self.save(update_fields=["used_at", "is_active"])

    def is_valid(self) -> bool:
        """Simple helper for 'valid for funding' checks."""
        if not self.is_active:
            return False
        if self.is_expired:
            return False
        if self.used_at is not None:
            return False
        return True

    @classmethod
    def create_for_agreement(cls, agreement, amount, currency="usd"):
        """Factory to create a fresh funding link for an agreement."""
        token = cls.generate_token()
        link = cls.objects.create(
            agreement=agreement,
            token=token,
            amount=amount,
            currency=currency,
            expires_at=cls.default_expiry(),
        )
        return link


class Milestone(models.Model):
    agreement = models.ForeignKey(
        Agreement, on_delete=models.CASCADE, related_name="milestones"
    )
    order = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    duration = models.DurationField(
        null=True,
        blank=True,
        help_text="Estimated time to complete the milestone.",
    )
    is_invoiced = models.BooleanField(default=False)
    completed = models.BooleanField(default=False)

    class Meta:
        ordering = ["order"]
        unique_together = [("agreement", "order")]

    def __str__(self):
        return f"{self.order}. {self.title} (${self.amount})"

    @property
    def is_late(self):
        return (
            self.completion_date
            and not self.completed
            and timezone.now().date() > self.completion_date
        )


class MilestoneFile(models.Model):
    milestone = models.ForeignKey(
        Milestone, on_delete=models.CASCADE, related_name="files"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    file = models.FileField(upload_to="milestone_uploads/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"File {self.id} for milestone {self.milestone.title}"


class MilestoneComment(models.Model):
    milestone = models.ForeignKey(
        Milestone, on_delete=models.CASCADE, related_name="comments"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        author_name = "Deleted User"
        if self.author:
            author_name = self.author.get_full_name()
        return f"Comment by {author_name} on {self.created_at.strftime('%Y-%m-%d')}"


class Invoice(models.Model):
    agreement = models.ForeignKey(
        Agreement, on_delete=models.CASCADE, related_name="invoices"
    )
    invoice_number = models.CharField(
        max_length=32, unique=True, editable=False, db_index=True, blank=True
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    status = models.CharField(
        max_length=20,
        choices=InvoiceStatus.choices,
        default=InvoiceStatus.INCOMPLETE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    escrow_released = models.BooleanField(default=False)
    escrow_released_at = models.DateTimeField(null=True, blank=True)
    stripe_transfer_id = models.CharField(max_length=255, blank=True)
    disputed = models.BooleanField(default=False)
    dispute_reason = models.TextField(blank=True)
    dispute_by = models.CharField(
        max_length=20,
        choices=[("contractor", "Contractor"), ("homeowner", "Homeowner")],
        blank=True,
    )
    disputed_at = models.DateTimeField(null=True, blank=True)
    marked_complete_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.invoice_number:
            self.invoice_number = self._generate_invoice_number()
        super().save(*args, **kwargs)

    def _generate_invoice_number(self):
        prefix = f'INV-{timezone.now().strftime("%Y%m%d")}-'
        with transaction.atomic():
            last_invoice = (
                Invoice.objects.filter(invoice_number__startswith=prefix)
                .order_by("invoice_number")
                .last()
            )
            if last_invoice:
                last_suffix = int(last_invoice.invoice_number.split("-")[-1])
                new_suffix = last_suffix + 1
            else:
                new_suffix = 1
            return f"{prefix}{new_suffix:04d}"

    def __str__(self):
        return f"Invoice {self.invoice_number} (${self.amount})"


class Expense(models.Model):
    agreement = models.ForeignKey(
        Agreement, on_delete=models.CASCADE, related_name="misc_expenses"
    )
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    incurred_date = models.DateField(default=timezone.now)
    status = models.CharField(
        max_length=20,
        choices=ExpenseStatus.choices,
        default=ExpenseStatus.PENDING,
        db_index=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    category = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-incurred_date"]

    def __str__(self):
        return f"{self.description} – ${self.amount}"


class AgreementAmendment(models.Model):
    parent = models.ForeignKey(
        "Agreement",
        on_delete=models.CASCADE,
        related_name="amendments",
    )
    child = models.OneToOneField(
        "Agreement",
        on_delete=models.CASCADE,
        related_name="as_amendment",
    )
    amendment_number = models.PositiveIntegerField(default=1)

    class Meta:
        verbose_name = "Agreement Amendment"
        verbose_name_plural = "Agreement Amendments"
        unique_together = (("parent", "amendment_number"),)

    def __str__(self):
        return (
            f"Amendment #{self.amendment_number} "
            f"to Agreement #{self.parent_id} (child #{self.child_id})"
        )


class ContractorSubAccount(models.Model):
    """
    Employee-style sub-account that belongs to a primary Contractor.

    Each sub-account is backed by a regular Django auth user but is linked to a
    parent Contractor. The Contractor can have many sub-accounts; each sub-account
    has exactly one user.
    """

    ROLE_EMPLOYEE_READONLY = "employee_readonly"
    ROLE_EMPLOYEE_MILESTONES = "employee_milestones"

    ROLE_CHOICES = (
        (ROLE_EMPLOYEE_READONLY, "Read-only employee"),
        (ROLE_EMPLOYEE_MILESTONES, "Milestones employee"),
    )

    parent_contractor = models.ForeignKey(
        Contractor,
        related_name="subaccounts",
        on_delete=models.CASCADE,
        help_text="The primary Contractor this employee belongs to.",
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        related_name="contractor_subaccount",
        on_delete=models.CASCADE,
        help_text="The Django auth user for this employee.",
    )

    display_name = models.CharField(
        max_length=255,
        help_text="Name to show on the Employee Dashboard (e.g., 'Alex').",
    )

    role = models.CharField(
        max_length=32,
        choices=ROLE_CHOICES,
        default=ROLE_EMPLOYEE_READONLY,
        help_text="Controls whether employee can only view or also mark milestones complete.",
    )

    is_active = models.BooleanField(
        default=True,
        help_text="Soft on/off switch for this sub-account.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    notes = models.TextField(
        blank=True,
        help_text="Optional internal notes about this employee.",
    )

    class Meta:
        verbose_name = "Contractor Sub-Account"
        verbose_name_plural = "Contractor Sub-Accounts"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.display_name} ({self.get_role_display()}) for {self.parent_contractor}"


# ensure AgreementAttachment is registered
from .models_attachments import AgreementAttachment  # noqa: E402,F401
