from django.conf import settings
from django.db import models
from django.utils import timezone
import uuid

class Homeowner(models.Model):
    name       = models.CharField(max_length=255)
    email      = models.EmailField(unique=True)
    address    = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class Contractor(models.Model):
    user              = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='contractor_profile',
        null=True,
        blank=True
    )
    business_name     = models.CharField(max_length=255, blank=True, null=True)
    name              = models.CharField(max_length=255)
    email             = models.EmailField(unique=True)
    phone             = models.CharField(max_length=20)
    skills            = models.TextField(blank=True, null=True)
    stripe_account_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text='Stripe Connect Account ID'
    )
    onboarding_status = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text='Stripe onboarding status (e.g. "incomplete", "completed")'
    )
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.business_name or self.name

class Project(models.Model):
    number = models.CharField(
        max_length=30,
        unique=True,
        editable=False,
        help_text="Auto-generated project code"
    )
    contractor   = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='projects'
    )
    homeowner    = models.ForeignKey(
        Homeowner,
        on_delete=models.CASCADE,
        related_name='projects',
        null=True,
        blank=True
    )
    title        = models.CharField(max_length=255)
    description  = models.TextField(blank=True)
    status       = models.CharField(
        max_length=20,
        choices=[
            ('draft',     'Draft'),
            ('signed',    'Signed'),
            ('funded',    'Funded'),
            ('completed', 'Completed'),
        ],
        default='draft'
    )
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.number:
            today_str = timezone.now().strftime('%Y%m%d')
            count = Project.objects.filter(
                created_at__date=timezone.now().date()
            ).count() + 1
            self.number = f'PRJ-{today_str}-{count:04d}'
        super().save(*args, **kwargs)

    def __str__(self):
        homeowner = self.homeowner.name if self.homeowner else 'Unknown'
        return f"[{self.number}] {self.title} (Homeowner: {homeowner})"

class Agreement(models.Model):
    contractor               = models.ForeignKey(
        Contractor,
        on_delete=models.CASCADE,
        related_name='agreements'
    )
    homeowner                = models.ForeignKey(
        Homeowner,
        on_delete=models.CASCADE,
        related_name='agreements'
    )
    project                  = models.OneToOneField(
        Project,
        on_delete=models.CASCADE,
        related_name='agreement'
    )
    project_uid              = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    description              = models.TextField(blank=True)
    total_cost               = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_time_estimate      = models.DurationField(null=True, blank=True)
    escrow_payment_intent_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text='Stripe PaymentIntent ID'
    )
    signed_by_contractor     = models.BooleanField(default=False)
    signed_by_homeowner      = models.BooleanField(default=False)
    signed_at_contractor     = models.DateTimeField(null=True, blank=True)
    signed_at_homeowner      = models.DateTimeField(null=True, blank=True)
    contractor_signature     = models.FileField(
        upload_to='signatures/contractor/',
        null=True,
        blank=True,
        help_text='Contractor signature image'
    )
    homeowner_signature      = models.FileField(
        upload_to='signatures/homeowner/',
        null=True,
        blank=True,
        help_text='Homeowner signature image'
    )
    escrow_funded            = models.BooleanField(default=False)
    pdf_file                 = models.FileField(
        upload_to='agreements/pdf/',
        null=True,
        blank=True
    )
    created_at               = models.DateTimeField(auto_now_add=True)
    updated_at               = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Agreement #{self.id} for {self.project.title}"

class Milestone(models.Model):
    agreement       = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name='milestones'
    )
    order           = models.PositiveIntegerField()
    title           = models.CharField(max_length=255)
    description     = models.TextField(blank=True)
    amount          = models.DecimalField(max_digits=10, decimal_places=2)
    start_date      = models.DateField(
        null=True,
        blank=True,
        help_text='Anticipated start date'
    )
    completion_date = models.DateField(
        null=True,
        blank=True,
        help_text='Anticipated completion date'
    )
    days            = models.IntegerField(default=0)
    hours           = models.IntegerField(default=0)
    minutes         = models.IntegerField(default=0)
    is_invoiced     = models.BooleanField(default=False)
    completed       = models.BooleanField(default=False)

    class Meta:
        ordering = ['order']
        unique_together = [('agreement', 'order')]

    def __str__(self):
        return f"{self.order}. {self.title} (${self.amount})"

class Invoice(models.Model):
    milestone    = models.ForeignKey(
        Milestone,
        on_delete=models.CASCADE,
        related_name='invoices',
        null=True,
        blank=True
    )
    agreement    = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name='invoices',
        null=True,
        blank=True
    )
    amount_due   = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due_date     = models.DateField(null=True, blank=True)

    STATUS_CHOICES = [
        ('pending',   'Pending'),
        ('completed', 'Completed'),
        ('approved',  'Approved'),
        ('disputed',  'Disputed'),
        ('paid',      'Paid'),
    ]
    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-due_date']

    def __str__(self):
        proj = self.agreement.project.title if self.agreement and self.agreement.project else 'Unknown'
        return f"Invoice #{self.id} for {proj}"

class Message(models.Model):
    agreement   = models.ForeignKey(
        Agreement,
        on_delete=models.CASCADE,
        related_name='messages'
    )
    sender      = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_messages'
    )
    content     = models.TextField()
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        ts = self.created_at.strftime("%Y-%m-%d %H:%M")
        return f"Message by {self.sender} @ {ts}"












