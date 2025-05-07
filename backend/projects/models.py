# models.py
from django.conf import settings
from django.db import models
import uuid

class Homeowner(models.Model):
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    address = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Contractor(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='contractor',
        null=True
    )
    business_name = models.CharField(max_length=255, blank=True, null=True)
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20)
    skills = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.business_name or self.name


class Lead(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField()
    phone = models.CharField(max_length=20, blank=True)
    project_interest = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} - {self.email}"


class Project(models.Model):
    contractor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='projects')
    homeowner = models.ForeignKey(Homeowner, on_delete=models.CASCADE, related_name="projects", null=True)
    project_title = models.CharField(max_length=255)
    project_description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_signed = models.BooleanField(default=False)
    is_funded = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.project_title} - {self.homeowner.name if self.homeowner else 'Unknown'}"


class Agreement(models.Model):
    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name='agreements', null=True)
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name='agreement', null=True)
    homeowner = models.ForeignKey(Homeowner, on_delete=models.SET_NULL, null=True, blank=True)

    project_name = models.CharField(max_length=200)
    project_uid = models.CharField(max_length=50, unique=True, default=uuid.uuid4)
    description = models.TextField(blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    total_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    milestone_count = models.PositiveIntegerField(default=1)
    total_duration_days = models.IntegerField(default=0)

    # Terms and Conditions
    terms = models.TextField(blank=True)
    liability_waiver = models.TextField(blank=True)
    dispute_resolution = models.TextField(blank=True)

    # Digital Signatures
    contractor_signed = models.BooleanField(default=False)
    homeowner_signed = models.BooleanField(default=False)
    contractor_signed_at = models.DateTimeField(null=True, blank=True)
    homeowner_signed_at = models.DateTimeField(null=True, blank=True)
    contractor_signature = models.TextField(blank=True, null=True)  # Base64 signature image
    homeowner_signature = models.TextField(blank=True, null=True)   # Base64 signature image

    # Escrow and PDF Management
    escrow_funded = models.BooleanField(default=False)
    pdf_url = models.CharField(max_length=500, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.project_name} - {self.homeowner.name if self.homeowner else 'Unknown'}"



class Milestone(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='milestones')
    title = models.CharField(max_length=255)
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    is_complete = models.BooleanField(default=False)
    pending_approval = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.title} - {self.agreement.project_name}"


class Invoice(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, related_name='invoices', null=True)
    milestone = models.OneToOneField(Milestone, on_delete=models.CASCADE, related_name='invoice', null=True)
    amount_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due_date = models.DateField(null=True, blank=True)

    is_paid = models.BooleanField(default=False)
    is_disputed = models.BooleanField(default=False)
    is_complete = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=False)
    pending_approval = models.BooleanField(default=False)

    auto_release_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    stripe_payment_intent = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return f"Invoice #{self.id} for Agreement {self.agreement.project_name}"



