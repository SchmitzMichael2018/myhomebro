# backend/chat/models.py

from django.db import models
from django.conf import settings

class Conversation(models.Model):
    """
    A chat thread between two or more users, optionally tied to a Project.
    """
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="chat_conversations"
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        null=True, blank=True,
        # Corrected related_name to avoid conflict with 'participants'
        related_name="project_chats"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Order conversations by the most recently updated
        ordering = ['-updated_at']

    def __str__(self):
        # Provide a more descriptive name for the conversation
        if self.project:
            return f"Chat for Project: {self.project.title}"
        
        participant_count = self.participants.count()
        if participant_count == 0:
            return f"Conversation {self.id} (No participants)"
        elif participant_count == 1:
            return f"Conversation with {self.participants.first().email}"
        elif participant_count == 2:
            # A more scalable way than listing all emails for long conversations
            return f"Conversation between {self.participants.first().email} and {self.participants.last().email}"
        else:
            return f"Group chat with {participant_count} participants"


class Message(models.Model):
    """
    An individual message within a Conversation.
    """
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",  # Simplified related_name for clarity
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages" # Simplified related_name
    )
    text = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        # Order messages chronologically
        ordering = ['timestamp']

    def __str__(self):
        return f"Message from {self.sender.email} at {self.timestamp.strftime('%Y-%m-%d %H:%M')}"