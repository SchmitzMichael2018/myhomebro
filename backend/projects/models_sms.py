from __future__ import annotations

from django.db import models


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
