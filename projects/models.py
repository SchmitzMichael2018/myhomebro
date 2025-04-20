from django.conf import settings
from django.db import models


class Project(models.Model):
    contractor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='projects')
    homeowner_name = models.CharField(max_length=100)
    homeowner_email = models.EmailField()
    project_title = models.CharField(max_length=255)
    project_description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_signed = models.BooleanField(default=False)
    is_funded = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.project_title} - {self.homeowner_name}"


class Agreement(models.Model):
    project = models.OneToOneField(Project, on_delete=models.CASCADE)
    agreement_text = models.TextField()
    signed_by_homeowner = models.BooleanField(default=False)
    signed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Agreement for {self.project}"


class Invoice(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='invoices')
    title = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    due_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_paid = models.BooleanField(default=False)
    is_disputed = models.BooleanField(default=False)
    auto_release_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Invoice: {self.title} for {self.project}"


class Contractor(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contractor', null=True)
    business_name = models.CharField(max_length=255, blank=True, null=True)
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20)

    def __str__(self):
        return self.name
    
class Agreement(models.Model):
    contractor = models.ForeignKey('Contractor', on_delete=models.CASCADE, related_name='agreements', null=True)
    homeowner_name = models.CharField(max_length=100)
    homeowner_email = models.EmailField()
    project_name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    total_cost = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField()
    end_date = models.DateField()
    is_signed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    

    def __str__(self):
        return f"{self.project_name} - {self.homeowner_name}"

from django.db import models

class Invoice(models.Model):
    agreement = models.ForeignKey(Agreement, on_delete=models.CASCADE, null=True)
    amount_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_paid = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Stripe fields (can be mocked for now)
    stripe_payment_intent = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return f"Invoice #{self.id} for Agreement {self.agreement.id}"


