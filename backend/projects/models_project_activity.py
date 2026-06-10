from django.conf import settings
from django.db import models
from django.utils import timezone


class ProjectActivityEvent(models.Model):
    """
    Auditable two-sided activity/acknowledgement record for contractual,
    payment, dispute, and evidence workflows. This complements notifications;
    it is the project history of what was created, delivered, viewed,
    responded to, and resolved.
    """

    class EventType(models.TextChoices):
        AMENDMENT_CREATED = "amendment_created", "Amendment Created"
        AMENDMENT_DELIVERED = "amendment_delivered", "Amendment Delivered"
        AMENDMENT_VIEWED = "amendment_viewed", "Amendment Viewed"
        AMENDMENT_RESPONDED = "amendment_responded", "Amendment Responded"
        AMENDMENT_RESOLVED = "amendment_resolved", "Amendment Resolved"
        DISPUTE_CREATED = "dispute_created", "Dispute Created"
        DISPUTE_DELIVERED = "dispute_delivered", "Dispute Delivered"
        DISPUTE_VIEWED = "dispute_viewed", "Dispute Viewed"
        DISPUTE_RESPONDED = "dispute_responded", "Dispute Responded"
        DISPUTE_RESOLVED = "dispute_resolved", "Dispute Resolved"
        REFUND_ELIGIBLE = "refund_eligible", "Refund Eligible"
        MILESTONE_BLOCKED = "milestone_blocked", "Milestone Blocked"

    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="project_activity_events",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="project_activity_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="project_activity_events_created",
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="project_activity_events_received",
    )
    actor_role = models.CharField(max_length=32, blank=True, default="")
    recipient_role = models.CharField(max_length=32, blank=True, default="")
    object_type = models.CharField(max_length=64, db_index=True)
    object_id = models.CharField(max_length=64, db_index=True)
    event_type = models.CharField(max_length=64, choices=EventType.choices, db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField(blank=True, default="")
    delivered_at = models.DateTimeField(null=True, blank=True)
    viewed_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["object_type", "object_id", "event_type"]),
            models.Index(fields=["agreement", "created_at"]),
        ]
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.event_type} {self.object_type}:{self.object_id}"
