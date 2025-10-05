# backend/projects/models.py
from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from .models_dispute import Dispute, DisputeAttachment
import uuid


# --- Safe default for warranty snapshot (used if blank/None) ---
DEFAULT_WARRANTY_TEXT = (
    "Standard workmanship warranty: Contractor warrants all labor performed under this "
    "Agreement for one (1) year from substantial completion. Materials are covered by the "
    "manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, "
    "alteration, improper maintenance, or acts of God."
)


# --- TextChoices for status fields ---
class ProjectStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    SIGNED = 'signed', 'Signed'
    FUNDED = 'funded', 'Funded'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


class AgreementProjectType(models.TextChoices):
    REMODEL = 'Remodel', 'Remodel'
    REPAIR = 'Repair', 'Repair'
    INSTALLATION = 'Installation', 'Installation'
    PAINTING = 'Painting', 'Painting'
    OUTDOOR = 'Outdoor', 'Outdoor'
    INSPECTION = 'Inspection', 'Inspection'
    CUSTOM = 'Custom', 'Custom'
    DIY_HELP = 'DIY Help', 'DIY Help'


class InvoiceStatus(models.TextChoices):
    INCOMPLETE = 'incomplete', 'Incomplete'
    PENDING = 'pending', 'Pending Approval'
    APPROVED = 'approved', 'Approved'
    DISPUTED = 'disputed', 'Disputed'
    PAID = 'paid', 'Paid'


class ExpenseStatus(models.TextChoices):
    PENDING = 'pending', 'Pending Approval'
    APPROVED = 'approved', 'Approved'
    DISPUTED = 'disputed', 'Disputed'
    PAID = 'paid', 'Paid'


class HomeownerStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    PROSPECT = 'prospect', 'Prospect'
    ARCHIVED = 'archived', 'Archived'


# --- CORRECT ORDER: Define Skill before Contractor ---
class Skill(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Contractor(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='contractor_profile'
    )
    business_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    skills = models.ManyToManyField(Skill, blank=True)
    license_number = models.CharField(max_length=50, blank=True)
    license_expiration = models.DateField(null=True, blank=True)
    logo = models.ImageField(upload_to='logos/', null=True, blank=True)
    license_file = models.FileField(upload_to='licenses/', null=True, blank=True)
    stripe_account_id = models.CharField(max_length=255, blank=True, db_index=True)
    onboarding_status = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, default="v1.0")

    class Meta:
        ordering = ['business_name']

    def __str__(self):
        return self.business_name or self.name or getattr(self.user, "email", "") or f"Contractor {self.pk}"

    @property
    def name(self):
        # Full name if present, else business name, else user email
        full = getattr(self.user, "get_full_name", lambda: "")() or ""
        return full or self.business_name or getattr(self.user, "email", "") or ""

    @property
    def email(self):
        # ✅ Return the attribute; do not call email()
        return getattr(self.user, "email", "") or ""

    @property
    def public_profile_url(self):
        return f"/contractors/{self.id}/profile"


class Homeowner(models.Model):
    created_by = models.ForeignKey(
        Contractor, on_delete=models.CASCADE, related_name='homeowners', null=True
    )
    full_name = models.CharField(max_length=255)
    email = models.EmailField(unique=True, db_index=True)
    phone_number = models.CharField(max_length=20, blank=True)
    street_address = models.CharField(max_length=255)
    address_line_2 = models.CharField(max_length=255, blank=True, help_text="e.g., Apt, Suite, Building")
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=50)
    zip_code = models.CharField(max_length=20)
    status = models.CharField(
        max_length=20, choices=HomeownerStatus.choices,
        default=HomeownerStatus.ACTIVE, db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['full_name']

    def __str__(self):
        return self.full_name


class Project(models.Model):
    number = models.CharField(max_length=30, unique=True, editable=False, db_index=True)
    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name='projects')
    homeowner = models.ForeignKey(Homeowner, on_delete=models.SET_NULL, related_name='projects', null=True, blank=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    project_street_address = models.CharField(max_length=255, blank=True)
    project_address_line_2 = models.CharField(max_length=255, blank=True)
    project_city = models.CharField(max_length=100, blank=True)
    project_state = models.CharField(max_length=50, blank=True)
    project_zip_code = models.CharField(max_length=20, blank=True)
    status = models.CharField(
        max_length=20, choices=ProjectStatus.choices,
        default=ProjectStatus.DRAFT, db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = self._generate_project_number()
        super().save(*args, **kwargs)

    def _generate_project_number(self):
        prefix = f'PRJ-{timezone.now().strftime("%Y%m%d")}-'
        with transaction.atomic():
            last_project = Project.objects.filter(number__startswith=prefix).order_by('number').last()
            if last_project:
                last_suffix = int(last_project.number.split('-')[-1])
                new_suffix = last_suffix + 1
            else:
                new_suffix = 1
            return f"{prefix}{new_suffix:04d}"

    def __str__(self):
        homeowner_name = getattr(self.homeowner, 'full_name', 'N/A')
        return f"[{self.number}] {self.title} ({homeowner_name})"


class Agreement(models.Model):
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name='agreement')
    contractor = models.ForeignKey(Contractor, on_delete=models.SET_NULL, null=True, blank=True)
    homeowner = models.ForeignKey(Homeowner, on_delete=models.CASCADE, related_name='agreements', null=True)

    # Public identifiers
    project_uid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    # Summary
    description = models.TextField(blank=True)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_time_estimate = models.DurationField(null=True, blank=True)
    milestone_count = models.PositiveIntegerField(default=0)

    # NEW: high-level timeline for the agreement (shown in list & editor)
    start = models.DateField(null=True, blank=True, db_index=True)
    end = models.DateField(null=True, blank=True, db_index=True)

    # NEW: agreement status used by filters in UI
    status = models.CharField(
        max_length=20, choices=ProjectStatus.choices,
        default=ProjectStatus.DRAFT, db_index=True
    )

    # Access & classification
    homeowner_access_token = models.UUIDField(default=uuid.uuid4, editable=False, db_index=True)
    project_type = models.CharField(max_length=100, choices=AgreementProjectType.choices, blank=True)
    project_subtype = models.CharField(max_length=100, blank=True)
    standardized_category = models.CharField(max_length=100, blank=True, db_index=True)

    # Legal & escrow
    terms_text = models.TextField(blank=True)
    privacy_text = models.TextField(blank=True)

    # Warranty
    warranty_type = models.CharField(
        max_length=16,
        choices=[("default", "Default"), ("custom", "Custom")],
        default="default",
    )
    # NOTE: DB has NOT NULL constraint from your trace; keep this non-null at runtime.
    warranty_text_snapshot = models.TextField(blank=True, default="")

    escrow_payment_intent_id = models.CharField(max_length=255, blank=True)
    escrow_funded = models.BooleanField(default=False)

    # Review & signatures
    reviewed = models.BooleanField(default=False)  # existing boolean
    reviewed_at = models.DateTimeField(null=True, blank=True)           # NEW
    reviewed_by = models.CharField(max_length=32, null=True, blank=True)  # NEW

    signed_by_contractor = models.BooleanField(default=False)
    signed_at_contractor = models.DateTimeField(null=True, blank=True)
    signed_by_homeowner = models.BooleanField(default=False)
    signed_at_homeowner = models.DateTimeField(null=True, blank=True)
    contractor_signature_name = models.CharField(max_length=255, blank=True)
    homeowner_signature_name = models.CharField(max_length=255, blank=True)
    contractor_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    homeowner_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    contractor_signature = models.FileField(upload_to='signatures/contractor/', null=True, blank=True)
    homeowner_signature = models.FileField(upload_to='signatures/homeowner/', null=True, blank=True)

    # PDF & logs
    pdf_file = models.FileField(upload_to='agreements/pdf/', null=True, blank=True)
    pdf_version = models.PositiveIntegerField(default=1)
    pdf_archived = models.BooleanField(default=False)
    signature_log = models.TextField(blank=True)

    # Lifecycle & housekeeping
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    amendment_number = models.PositiveIntegerField(default=0, editable=False)
    addendum_file = models.FileField(upload_to='agreements/addenda/', null=True, blank=True)
    is_archived = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        suffix = f" (Amendment {self.amendment_number})" if self.amendment_number else ""
        return f"Agreement for {self.project.title}{suffix}"

    @property
    def is_fully_signed(self):
        return self.signed_by_contractor and self.signed_by_homeowner

    def save(self, *args, **kwargs):
        """
        Hardened save:
        - Backfill contractor from project if missing
        - Keep status transitions
        - Normalize warranty_type to ('default'|'custom')
        - Guarantee warranty_text_snapshot is never NULL/empty before persisting
        """
        # Backfill contractor from project if not set
        if not self.contractor and self.project and self.project.contractor_id:
            self.contractor = self.project.contractor

        # Keep status generally sensible without being too clever
        if self.escrow_funded:
            self.status = ProjectStatus.FUNDED
        elif self.is_fully_signed and self.status == ProjectStatus.DRAFT:
            self.status = ProjectStatus.SIGNED

        # --- Normalize & enforce warranty fields ---
        # Normalize type to our lowercase choices to play nice with any UPPERCASE inputs
        if self.warranty_type:
            self.warranty_type = str(self.warranty_type).strip().lower()
            if self.warranty_type not in ("default", "custom"):
                self.warranty_type = "default"
        else:
            self.warranty_type = "default"

        # Ensure snapshot is never None or empty string (DB NOT NULL guard)
        snap = (self.warranty_text_snapshot or "").strip()
        if not snap:
            # If marked default, inject the default text
            if self.warranty_type == "default":
                self.warranty_text_snapshot = DEFAULT_WARRANTY_TEXT
            else:
                # For 'custom' with no snapshot, still guard DB by using default text
                # (alternatively, enforce ValidationError upstream)
                self.warranty_text_snapshot = DEFAULT_WARRANTY_TEXT

        super().save(*args, **kwargs)


class Milestone(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='milestones')
    order = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    duration = models.DurationField(null=True, blank=True, help_text="Estimated time to complete the milestone.")
    is_invoiced = models.BooleanField(default=False)
    completed = models.BooleanField(default=False)

    class Meta:
        ordering = ['order']
        unique_together = [('agreement', 'order')]

    def __str__(self):
        return f"{self.order}. {self.title} (${self.amount})"

    @property
    def is_late(self):
        return self.completion_date and not self.completed and timezone.now().date() > self.completion_date


class MilestoneFile(models.Model):
    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name='files')
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    file = models.FileField(upload_to='milestone_uploads/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"File {self.id} for milestone {self.milestone.title}"


class MilestoneComment(models.Model):
    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        author_name = "Deleted User"
        if self.author:
            author_name = self.author.get_full_name()
    #        return f"Comment by {author_name} on {self.created_at.strftime('%Y-%m-%d')}"
        return f"Comment by {author_name} on {self.created_at.strftime('%Y-%m-%d')}"


class Invoice(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='invoices')
    invoice_number = models.CharField(max_length=32, unique=True, editable=False, db_index=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    status = models.CharField(
        max_length=20, choices=InvoiceStatus.choices,
        default=InvoiceStatus.INCOMPLETE, db_index=True
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
        choices=[('contractor', 'Contractor'), ('homeowner', 'Homeowner')],
        blank=True
    )
    disputed_at = models.DateTimeField(null=True, blank=True)
    marked_complete_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.invoice_number:
            self.invoice_number = self._generate_invoice_number()
        super().save(*args, **kwargs)

    def _generate_invoice_number(self):
        prefix = f'INV-{timezone.now().strftime("%Y%m%d")}-'
        with transaction.atomic():
            last_invoice = Invoice.objects.filter(invoice_number__startswith=prefix).order_by('invoice_number').last()
            if last_invoice:
                last_suffix = int(last_invoice.invoice_number.split('-')[-1])
                new_suffix = last_suffix + 1
            else:
                new_suffix = 1
            return f"{prefix}{new_suffix:04d}"

    def __str__(self):
        return f"Invoice {self.invoice_number} (${self.amount})"


class Expense(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='misc_expenses')
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    incurred_date = models.DateField(default=timezone.now)
    status = models.CharField(
        max_length=20, choices=ExpenseStatus.choices,
        default=ExpenseStatus.PENDING, db_index=True
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    category = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-incurred_date']

    def __str__(self):
        return f"{self.description} – ${self.amount}"


class AgreementAmendment(models.Model):
    """
    Links a child Agreement as an Amendment to a primary (parent) Agreement.
    - child: the Agreement that is considered the amendment
    - parent: the primary Agreement
    - amendment_number: 1, 2, 3... (unique per parent)
    """
    parent = models.ForeignKey("Agreement", on_delete=models.CASCADE, related_name="amendments")
    child = models.OneToOneField("Agreement", on_delete=models.CASCADE, related_name="as_amendment")
    amendment_number = models.PositiveIntegerField(default=1)

    class Meta:
        verbose_name = "Agreement Amendment"
        verbose_name_plural = "Agreement Amendments"
        unique_together = (("parent", "amendment_number"),)

    def __str__(self):
        return f"Amendment #{self.amendment_number} to Agreement #{self.parent_id} (child #{self.child_id})"


# 🔗 IMPORTANT: ensure Django registers AgreementAttachment from models_attachments.py
from .models_attachments import AgreementAttachment  # noqa: E402,F401
