# chat/signals.py
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from .models import Message

@receiver(post_save, sender=Message)
def update_conversation_timestamp(sender, instance, created, **kwargs):
    """
    Update the parent conversation's updated_at timestamp when a new
    message is created.
    """
    if created:
        conversation = instance.conversation
        conversation.updated_at = timezone.now()
        conversation.save(update_fields=['updated_at'])