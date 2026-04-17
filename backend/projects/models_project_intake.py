# backend/projects/models_project_intake.py

from __future__ import annotations

import secrets

from django.db import models


class ProjectIntake(models.Model):
    PROJECT_CLASS_CHOICES = [
        ("residential", "Residential"),
        ("commercial", "Commercial"),
    ]

    LEAD_SOURCE_CHOICES = [
        ("landing_page", "Landing Page"),
        ("public_profile", "Public Profile"),
        ("manual", "Manual"),
        ("qr", "QR"),
        ("contractor_sent_form", "Contractor Sent Form"),
        ("direct", "Direct"),
    ]

    INITIATED_BY_CHOICES = [
        ("contractor", "Contractor"),
        ("homeowner", "Homeowner"),
    ]

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("submitted", "Submitted"),
        ("analyzed", "Analyzed"),
        ("converted", "Converted to Agreement"),
    ]

    POST_SUBMIT_FLOW_CHOICES = [
        ("", "Unselected"),
        ("single_contractor", "Invite One Contractor"),
        ("multi_contractor", "Invite Multiple Contractors"),
    ]

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="project_intakes",
        null=True,
        blank=True,
    )

    public_profile = models.ForeignKey(
        "projects.ContractorPublicProfile",
        on_delete=models.SET_NULL,
        related_name="project_intakes",
        null=True,
        blank=True,
    )

    public_lead = models.OneToOneField(
        "projects.PublicContractorLead",
        on_delete=models.SET_NULL,
        related_name="source_intake",
        null=True,
        blank=True,
    )

    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        related_name="project_intakes",
        null=True,
        blank=True,
    )

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        related_name="source_intakes",
        null=True,
        blank=True,
    )

    initiated_by = models.CharField(
        max_length=20,
        choices=INITIATED_BY_CHOICES,
        default="contractor",
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="draft",
    )

    post_submit_flow = models.CharField(
        max_length=32,
        choices=POST_SUBMIT_FLOW_CHOICES,
        blank=True,
        default="",
    )
    post_submit_flow_selected_at = models.DateTimeField(null=True, blank=True)

    lead_source = models.CharField(
        max_length=20,
        choices=LEAD_SOURCE_CHOICES,
        default="direct",
    )

    # Customer info captured during intake
    customer_name = models.CharField(max_length=255, blank=True, default="")
    customer_email = models.EmailField(blank=True, default="")
    customer_phone = models.CharField(max_length=50, blank=True, default="")

    # Customer home address
    customer_address_line1 = models.CharField(max_length=255, blank=True, default="")
    customer_address_line2 = models.CharField(max_length=255, blank=True, default="")
    customer_city = models.CharField(max_length=120, blank=True, default="")
    customer_state = models.CharField(max_length=50, blank=True, default="")
    customer_postal_code = models.CharField(max_length=20, blank=True, default="")

    # Project address
    same_as_customer_address = models.BooleanField(default=True)

    project_class = models.CharField(
        max_length=20,
        choices=PROJECT_CLASS_CHOICES,
        default="residential",
    )

    project_address_line1 = models.CharField(max_length=255, blank=True, default="")
    project_address_line2 = models.CharField(max_length=255, blank=True, default="")
    project_city = models.CharField(max_length=120, blank=True, default="")
    project_state = models.CharField(max_length=50, blank=True, default="")
    project_postal_code = models.CharField(max_length=20, blank=True, default="")

    # Core intake question
    accomplishment_text = models.TextField(blank=True, default="")

    # AI recommendation results
    ai_project_title = models.CharField(max_length=255, blank=True, default="")
    ai_project_type = models.CharField(max_length=120, blank=True, default="")
    ai_project_subtype = models.CharField(max_length=120, blank=True, default="")
    ai_description = models.TextField(blank=True, default="")
    ai_project_timeline_days = models.PositiveIntegerField(null=True, blank=True)
    ai_project_budget = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    ai_recommended_template_id = models.IntegerField(null=True, blank=True)
    ai_recommendation_confidence = models.CharField(max_length=20, blank=True, default="none")
    ai_recommendation_reason = models.TextField(blank=True, default="")

    ai_milestones = models.JSONField(default=list, blank=True)
    ai_clarification_questions = models.JSONField(default=list, blank=True)
    ai_analysis_payload = models.JSONField(default=dict, blank=True)

    # Public intake send/share flow
    share_token = models.CharField(max_length=64, blank=True, default="", unique=True)
    sent_to_email = models.EmailField(blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    submitted_at = models.DateTimeField(null=True, blank=True)
    analyzed_at = models.DateTimeField(null=True, blank=True)
    converted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Project Intake"
        verbose_name_plural = "Project Intakes"

    def __str__(self):
        return f"Project Intake #{self.pk} - {self.customer_name or self.customer_email or 'Unknown'}"

    def ensure_share_token(self, *, save: bool = True) -> str:
        if self.share_token:
            return self.share_token

        token = secrets.token_urlsafe(32)
        self.share_token = token
        if save:
            self.save(update_fields=["share_token", "updated_at"])
        return token

    @property
    def customer_address_display(self):
        parts = [
            self.customer_address_line1,
            self.customer_address_line2,
            ", ".join(
                p for p in [self.customer_city, self.customer_state, self.customer_postal_code] if p
            ),
        ]
        return "\n".join([p for p in parts if p])

    @property
    def project_address_display(self):
        parts = [
            self.project_address_line1,
            self.project_address_line2,
            ", ".join(
                p for p in [self.project_city, self.project_state, self.project_postal_code] if p
            ),
        ]
        return "\n".join([p for p in parts if p])
