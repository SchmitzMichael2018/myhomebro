from __future__ import annotations

from django.db import models


class SMSConsent(models.Model):
    OPT_IN_SOURCE_SIGNUP = "signup"
    OPT_IN_SOURCE_AGREEMENT = "agreement"
    OPT_IN_SOURCE_INBOUND_START = "inbound_start"
    OPT_IN_SOURCE_ADMIN = "admin"

    OPT_OUT_SOURCE_INBOUND_STOP = "inbound_stop"
    OPT_OUT_SOURCE_API = "api"
    OPT_OUT_SOURCE_ADMIN = "admin"
    OPT_OUT_SOURCE_TWILIO_ERROR = "twilio_error"

    OPT_IN_SOURCE_CHOICES = (
        (OPT_IN_SOURCE_SIGNUP, "Signup"),
        (OPT_IN_SOURCE_AGREEMENT, "Agreement"),
        (OPT_IN_SOURCE_INBOUND_START, "Inbound START"),
        (OPT_IN_SOURCE_ADMIN, "Admin"),
    )
    OPT_OUT_SOURCE_CHOICES = (
        (OPT_OUT_SOURCE_INBOUND_STOP, "Inbound STOP"),
        (OPT_OUT_SOURCE_API, "API"),
        (OPT_OUT_SOURCE_ADMIN, "Admin"),
        (OPT_OUT_SOURCE_TWILIO_ERROR, "Twilio Error"),
    )

    phone_number_e164 = models.CharField(max_length=32, unique=True, db_index=True)
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_consents",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_consents",
    )
    can_send_sms = models.BooleanField(default=False)
    opted_out = models.BooleanField(default=False)
    opted_out_at = models.DateTimeField(null=True, blank=True)
    opted_in_at = models.DateTimeField(null=True, blank=True)
    opted_in_source = models.CharField(max_length=32, blank=True, default="", choices=OPT_IN_SOURCE_CHOICES)
    opted_out_source = models.CharField(max_length=32, blank=True, default="", choices=OPT_OUT_SOURCE_CHOICES)
    last_inbound_keyword = models.CharField(max_length=32, blank=True, default="")
    consent_text_snapshot = models.TextField(blank=True, default="")
    consent_source_page = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self) -> str:
        return f"SMSConsent(phone={self.phone_number_e164}, can_send={self.can_send_sms}, opted_out={self.opted_out})"


class SMSAutomationDecision(models.Model):
    class ChannelDecision(models.TextChoices):
        SMS = "sms", "SMS"
        DASHBOARD_ONLY = "dashboard_only", "Dashboard Only"
        SUPPRESSED = "suppressed", "Suppressed"
        NONE = "none", "None"

    class Priority(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    event_type = models.CharField(max_length=100, db_index=True)
    phone_number_e164 = models.CharField(max_length=32, blank=True, default="", db_index=True)
    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_automation_decisions",
    )
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_automation_decisions",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_automation_decisions",
    )
    invoice = models.ForeignKey(
        "projects.Invoice",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_automation_decisions",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sms_automation_decisions",
    )
    should_send = models.BooleanField(default=False)
    channel_decision = models.CharField(
        max_length=24,
        choices=ChannelDecision.choices,
        default=ChannelDecision.NONE,
        db_index=True,
    )
    reason_code = models.CharField(max_length=64, db_index=True)
    priority = models.CharField(
        max_length=16,
        choices=Priority.choices,
        default=Priority.LOW,
        db_index=True,
    )
    template_key = models.CharField(max_length=64, blank=True, default="", db_index=True)
    intent_key = models.CharField(max_length=64, blank=True, default="")
    intent_summary = models.CharField(max_length=255, blank=True, default="")
    message_preview = models.CharField(max_length=255, blank=True, default="")
    cooldown_applied = models.BooleanField(default=False)
    duplicate_suppressed = models.BooleanField(default=False)
    sent = models.BooleanField(default=False)
    deferred = models.BooleanField(default=False)
    sms_consent_snapshot_json = models.JSONField(default=dict, blank=True)
    decision_context_json = models.JSONField(default=dict, blank=True)
    twilio_message_sid = models.CharField(max_length=64, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["phone_number_e164", "template_key", "created_at"]),
            models.Index(fields=["event_type", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"SMSAutomationDecision(event={self.event_type}, reason={self.reason_code}, sent={self.sent})"


class DeferredSMSAutomation(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        CANCELLED = "cancelled", "Cancelled"
        SUPERSEDED = "superseded", "Superseded"

    phone_number_e164 = models.CharField(max_length=32, db_index=True)
    template_key = models.CharField(max_length=64, db_index=True)
    intent_key = models.CharField(max_length=64, blank=True, default="")
    message_body = models.TextField()
    scheduled_for = models.DateTimeField(db_index=True)
    event_type = models.CharField(max_length=100, db_index=True)
    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_sms_automations",
    )
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_sms_automations",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_sms_automations",
    )
    invoice = models.ForeignKey(
        "projects.Invoice",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_sms_automations",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_sms_automations",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    decision = models.ForeignKey(
        "projects.SMSAutomationDecision",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_for", "-id"]
        indexes = [
            models.Index(fields=["status", "scheduled_for"]),
        ]

    def __str__(self) -> str:
        return f"DeferredSMSAutomation(event={self.event_type}, status={self.status}, scheduled_for={self.scheduled_for})"


class SMSConsentStatus(models.Model):
    KEYWORD_OPT_OUT = "opt_out"
    KEYWORD_HELP = "help"
    KEYWORD_OPT_IN = "opt_in"
    KEYWORD_DEFAULT = "default"
    KEYWORD_ERROR = "error"

    KEYWORD_TYPE_CHOICES = (
        (KEYWORD_OPT_OUT, "Opt Out"),
        (KEYWORD_HELP, "Help"),
        (KEYWORD_OPT_IN, "Opt In"),
        (KEYWORD_DEFAULT, "Default"),
        (KEYWORD_ERROR, "Error"),
    )

    phone_number = models.CharField(max_length=32, unique=True, db_index=True)
    is_subscribed = models.BooleanField(default=True)
    last_inbound_message_sid = models.CharField(max_length=64, blank=True, default="")
    last_inbound_body = models.TextField(blank=True, default="")
    last_keyword_type = models.CharField(
        max_length=16,
        choices=KEYWORD_TYPE_CHOICES,
        default=KEYWORD_DEFAULT,
        db_index=True,
    )
    opted_out_at = models.DateTimeField(null=True, blank=True)
    opted_in_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self) -> str:
        return f"SMSConsentStatus(phone={self.phone_number}, subscribed={self.is_subscribed})"
