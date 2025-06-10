from django.conf import settings
from django.db import models, IntegrityError
from django.utils import timezone
import uuid


class Homeowner(models.Model):
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    address = models.TextField(blank=True)
    project_address = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, default="v1.0")

    def __str__(self):
        return self.name


class Contractor(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='contractor_profile',
        null=True,
        blank=True
    )
    business_name = models.CharField(max_length=255, blank=True, null=True)
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20)
    address = models.TextField(blank=True, null=True)  # ✅ NEW FIELD
    skills = models.TextField(blank=True, null=True)
    license_number = models.CharField(max_length=50, blank=True, null=True)
    stripe_account_id = models.CharField(max_length=255, blank=True, null=True)
    onboarding_status = models.CharField(max_length=50, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, default="v1.0")

    def __str__(self):
        return self.business_name or self.name


class Project(models.Model):
    number = models.CharField(max_length=30, unique=True, editable=False)
    contractor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='projects'
    )
    homeowner = models.ForeignKey(
        'Homeowner',
        on_delete=models.CASCADE,
        related_name='projects',
        null=True, blank=True
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    project_address = models.TextField(blank=True, null=True)
    status = models.CharField(
        max_length=20,
        choices=[
            ('draft', 'Draft'),
            ('signed', 'Signed'),
            ('funded', 'Funded'),
            ('completed', 'Completed'),
        ],
        default='draft'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        # Only generate a number if one isn’t set yet
        if not self.number:
            today_str = timezone.now().strftime('%Y%m%d')
            prefix = f'PRJ-{today_str}-'

            # 1) Read all existing numbers that start with this prefix
            existing = Project.objects.filter(number__startswith=prefix).values_list('number', flat=True)

            # 2) Extract the numeric suffixes and pick the max
            max_suffix = 0
            for num in existing:
                # num looks like "PRJ-20250606-0003"
                suffix_part = num.replace(prefix, '')  # e.g. "0003"
                if suffix_part.isdigit():
                    suffix_val = int(suffix_part)
                    if suffix_val > max_suffix:
                        max_suffix = suffix_val

            next_suffix = max_suffix + 1
            self.number = prefix + f"{next_suffix:04d}"

        # 3) Now do the single save; if a collision still occurs, it raises IntegrityError
        super().save(*args, **kwargs)

    def __str__(self):
        homeowner_name = getattr(self.homeowner, "name", "Unknown")
        return f"[{self.number}] {self.title} (Homeowner: {homeowner_name})"


class Agreement(models.Model):
    contractor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='agreements'
    )
    project = models.OneToOneField(
        Project,
        on_delete=models.CASCADE,
        related_name='agreement'
    )
    project_uid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    description = models.TextField(blank=True)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_time_estimate = models.DurationField(null=True, blank=True)
    milestone_count = models.PositiveIntegerField(default=0)
    homeowner_access_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)

    project_type = models.CharField(
        max_length=100,
        choices=[
            ('Remodel', 'Remodel'),
            ('Repair', 'Repair'),
            ('Installation', 'Installation'),
            ('Painting', 'Painting'),
            ('Outdoor', 'Outdoor'),
            ('Inspection', 'Inspection'),
            ('Custom', 'Custom'),
            ('DIY Help', 'DIY Help'),
        ],
        blank=True,
        null=True
    )
    project_subtype = models.CharField(max_length=100, blank=True, null=True)

    terms_text = models.TextField(blank=True, null=True)
    privacy_text = models.TextField(blank=True, null=True)

    homeowner_access_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)

    escrow_payment_intent_id = models.CharField(max_length=255, blank=True, null=True)

    # ─── New field ───────────────────────────────────────────────────────────────
    reviewed = models.BooleanField(default=False)

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

    escrow_funded = models.BooleanField(default=False)
    pdf_file = models.FileField(upload_to='agreements/pdf/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    pdf_version = models.PositiveIntegerField(default=1)
    pdf_archived = models.BooleanField(default=False)  # prevent overwrites
    signature_log = models.TextField(blank=True, null=True)

    reviewed = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Agreement #{self.id} for {self.project.title}"

    @property
    def project_signed(self):
        return self.signed_by_contractor and self.signed_by_homeowner

    @property
    def homeowner(self):
        return self.project.homeowner


class Milestone(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='milestones')
    order = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    days = models.IntegerField(default=0)
    hours = models.IntegerField(default=0)
    minutes = models.IntegerField(default=0)
    is_invoiced = models.BooleanField(default=False)
    completed = models.BooleanField(default=False)

    class Meta:
        ordering = ['order']
        unique_together = [('agreement', 'order')]

    def __str__(self):
        return f"{self.order}. {self.title} (${self.amount})"

    @property
    def due_date(self):
        return self.completion_date

    @property
    def is_late(self):
        if self.completion_date and not self.completed:
            return timezone.now().date() > self.completion_date
        return False


class MilestoneFile(models.Model):
    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name="files")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    file = models.FileField(upload_to="milestone_uploads/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.file.name} for milestone {self.milestone_id}"


class Invoice(models.Model):
    milestone = models.ForeignKey(Milestone, on_delete=models.CASCADE, related_name='invoices', null=True, blank=True)
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='invoices', null=True, blank=True)
    amount_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due_date = models.DateField(null=True, blank=True)
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('completed', 'Completed'),
        ('approved', 'Approved'),
        ('disputed', 'Disputed'),
        ('paid', 'Paid'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-due_date']

    def __str__(self):
        proj_title = self.agreement.project.title if (self.agreement and self.agreement.project) else 'Unknown'
        return f"Invoice #{self.id} for {proj_title}"


class Message(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        ts = self.created_at.strftime("%Y-%m-%d %H:%M")
        return f"Message by {self.sender} @ {ts}"


class Expense(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='misc_expenses')
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    incurred_date = models.DateField(auto_now_add=True)
    STATUS_CHOICES = [
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('disputed', 'Disputed'),
        ('paid', 'Paid'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    category = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-incurred_date']

    def __str__(self):
        return f"{self.description} – ${self.amount}"


class MilestoneComment(models.Model):
    milestone = models.ForeignKey("Milestone", on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Comment by {self.author} on milestone {self.milestone_id}"
