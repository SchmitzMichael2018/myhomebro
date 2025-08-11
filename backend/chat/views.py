# backend/chat/views.py

from rest_framework import viewsets, permissions
from rest_framework.exceptions import NotFound, PermissionDenied
from django.db.models import Prefetch

from .models import Conversation, Message
from .serializers import ConversationSerializer, MessageSerializer


class ConversationViewSet(viewsets.ModelViewSet):
    """
    List/Create your chat threads. On create, the creator is auto-added.
    The list view is highly optimized to prevent N+1 database queries.
    """
    serializer_class = ConversationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """
        This queryset is now highly optimized. It fetches all necessary related
        data (participants, project info, and the last message for each
        conversation) in a minimal number of database queries.
        """
        user = self.request.user
        
        # This Prefetch object is the key to solving the N+1 problem for the last message.
        # It gets the latest message for each conversation in a single extra query.
        last_message_prefetch = Prefetch(
            'messages',
            queryset=Message.objects.order_by('conversation_id', '-timestamp').distinct('conversation_id'),
            to_attr='last_message_obj'
        )

        # The final, optimized queryset for conversations the user participates in.
        queryset = user.chat_conversations.select_related(
            "project", 
            "project__homeowner"
        ).prefetch_related(
            "participants",
            last_message_prefetch
        )
        return queryset

    def perform_create(self, serializer):
        """When creating a conversation, add the creator to the participants."""
        conv = serializer.save()
        conv.participants.add(self.request.user)


class MessageViewSet(viewsets.ModelViewSet):
    """
    List/Create messages under /conversations/{conversation_pk}/messages/
    """
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_conversation(self):
        """
        Helper method to get the conversation, ensuring the user is a participant.
        This is more efficient as it checks for participation in the same database query.
        """
        try:
            # Only find the conversation if the current user is a participant
            conversation = Conversation.objects.prefetch_related('participants').get(
                pk=self.kwargs["conversation_pk"],
                participants=self.request.user
            )
            return conversation
        except Conversation.DoesNotExist:
            # If get() fails, it's either because the conversation doesn't exist
            # or the user is not a participant. For security, we treat both
            # cases as if the conversation was not found.
            raise NotFound("Conversation not found or you do not have permission to access it.")

    def get_queryset(self):
        """
        Returns messages for a conversation. The permission check is now implicitly
        handled by the get_conversation() method.
        """
        conv = self.get_conversation()
        # Use the 'messages' related_name from our updated Message model
        return conv.messages.order_by("timestamp").all()

    def perform_create(self, serializer):
        """When creating a message, set the sender and conversation."""
        conv = self.get_conversation()
        # We don't need to check participation again, get_conversation already did.
        serializer.save(sender=self.request.user, conversation=conv)