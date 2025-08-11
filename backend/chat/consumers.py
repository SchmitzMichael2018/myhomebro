# backend/chat/consumers.py

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model

from .models import Conversation, Message
from .serializers import MessageSerializer
from projects.tasks import notify_recipient_new_message

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for a single Conversation.
    Handles real-time chat functionality.
    URL: ws://<host>/ws/chat/<conversation_id>/
    """

    async def connect(self):
        """
        Handles a new WebSocket connection.
        Authenticates the user, verifies their participation in the conversation,
        and joins them to the conversation's channel group.
        """
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.group_name = f'chat_{self.conversation_id}'
        self.user = self.scope['user']

        if not self.user.is_authenticated:
            await self.close()
            return

        # Verify that the conversation exists and the user is a participant.
        # This is a more efficient query that fetches the conversation and
        # its participants in a single database hit.
        self.conversation = await self.get_conversation()
        if self.conversation is None:
            await self.close()
            return

        # Join the chat group
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        """
        Handles a WebSocket disconnection.
        Removes the user from the conversation's channel group.
        """
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        """
        Called when a message is received from the WebSocket.
        It expects a JSON payload with a "text" field.
        The message is persisted to the database, and then broadcast
        to the channel group.
        """
        try:
            payload = json.loads(text_data)
            text = payload.get('text', '').strip()
        except json.JSONDecodeError:
            # Handle malformed JSON
            return

        if not text:
            return

        # Persist the message to the database
        message = await self.create_message(text)

        # Enqueue email/SMS notifications for offline participants
        notify_recipient_new_message.delay(message.id)

        # Get the serialized message data
        message_data = await self.serialize_message(message)

        # Broadcast the message to the group
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'chat.message',
                'message': message_data
            }
        )

    async def chat_message(self, event):
        """
        Handler for 'chat.message' events.
        Sends the message JSON to the client's WebSocket.
        """
        await self.send(text_data=json.dumps(event['message']))

    @database_sync_to_async
    def get_conversation(self):
        """
        Fetches the conversation from the database and verifies that the
        current user is a participant.
        """
        try:
            # Using select_related to also fetch the participants in the same query
            conv = Conversation.objects.get(pk=self.conversation_id)
            if self.user in conv.participants.all():
                return conv
        except Conversation.DoesNotExist:
            return None
        return None

    @database_sync_to_async
    def create_message(self, text):
        """
        Creates and saves a new Message object in the database,
        and updates the parent conversation's `updated_at` timestamp.
        """
        message = Message.objects.create(
            conversation=self.conversation,
            sender=self.user,
            text=text
        )
        
        # This "touches" the conversation, updating its `updated_at` field.
        self.conversation.save(update_fields=['updated_at'])
        
        return message

    @database_sync_to_async
    def serialize_message(self, message):
        """
        Serializes a Message object using the MessageSerializer.
        This ensures the data format is consistent with the REST API.
        """
        return MessageSerializer(message).data