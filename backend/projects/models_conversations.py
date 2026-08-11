from django.conf import settings
from django.db import models
from django.db.models import Q


class CustomerConversation(models.Model):
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="customer_conversations")
    customer = models.ForeignKey("projects.Homeowner", on_delete=models.SET_NULL, null=True, blank=True, related_name="conversations")
    customer_name = models.CharField(max_length=255, blank=True, default="")
    customer_email = models.EmailField(blank=True, default="")
    proposal = models.OneToOneField("projects.Proposal", on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_conversation")
    agreement = models.OneToOneField("projects.Agreement", on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_conversation")
    project = models.OneToOneField("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_conversation")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at", "-id"]


class ConversationMessage(models.Model):
    SENDER_CUSTOMER = "customer"
    SENDER_CONTRACTOR = "contractor"
    SENDER_TEAM_MEMBER = "team_member"
    SENDER_CHOICES = [(SENDER_CUSTOMER, "Customer"), (SENDER_CONTRACTOR, "Contractor"), (SENDER_TEAM_MEMBER, "Team member")]
    CONTEXT_ESTIMATE = "estimate"
    CONTEXT_AGREEMENT = "agreement"
    CONTEXT_PROJECT = "project"
    CONTEXT_CHOICES = [(CONTEXT_ESTIMATE, "Estimate"), (CONTEXT_AGREEMENT, "Agreement"), (CONTEXT_PROJECT, "Project")]

    conversation = models.ForeignKey(CustomerConversation, on_delete=models.CASCADE, related_name="messages")
    sender_type = models.CharField(max_length=20, choices=SENDER_CHOICES)
    sender_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_conversation_messages")
    sender_display_name = models.CharField(max_length=255, blank=True, default="")
    message_text = models.TextField()
    lifecycle_context = models.CharField(max_length=20, choices=CONTEXT_CHOICES)
    proposal_review_version = models.ForeignKey("projects.ProposalReviewVersion", on_delete=models.SET_NULL, null=True, blank=True, related_name="conversation_messages")
    contractor_read_at = models.DateTimeField(null=True, blank=True)
    customer_read_at = models.DateTimeField(null=True, blank=True)
    dedupe_key = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [models.UniqueConstraint(fields=["conversation", "dedupe_key"], condition=~Q(dedupe_key=""), name="uniq_conversation_message_dedupe")]
        indexes = [models.Index(fields=["conversation", "created_at"], name="conversation_created_idx")]
