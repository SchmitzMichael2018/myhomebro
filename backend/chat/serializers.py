# backend/chat/serializers.py

from rest_framework import serializers
from django.contrib.auth import get_user_model

from .models import Conversation, Message
from projects.models import Contractor

User = get_user_model()

class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.get_full_name', read_only=True)

    class Meta:
        model = Message
        fields = ["id", "conversation", "sender", "sender_name", "text", "timestamp"]
        read_only_fields = ["id", "sender", "sender_name", "timestamp"]
        extra_kwargs = {'conversation': {'write_only': True}}

class ConversationSerializer(serializers.ModelSerializer):
    participants = serializers.StringRelatedField(many=True, read_only=True)
    project_title = serializers.CharField(source="project.title", read_only=True)
    homeowner_name = serializers.CharField(source="project.homeowner.name", read_only=True, default=None)
    last_message = MessageSerializer(read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "project", "project_title", "homeowner_name", "participants", "created_at", "updated_at", "last_message"]
        read_only_fields = ["updated_at", "last_message"]