# backend/chat/urls.py

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter # type: ignore
from .views import ConversationViewSet, MessageViewSet

# Root router for Conversation
router = DefaultRouter()
router.register(r"conversations", ConversationViewSet, basename="conversation")

# Nested router for Message under Conversation
conv_router = NestedDefaultRouter(router, r"conversations", lookup="conversation")
conv_router.register(r"messages", MessageViewSet, basename="conversation-messages")

urlpatterns = [
    # /api/chat/conversations/...
    path("", include(router.urls)),
    # /api/chat/conversations/{conversation_pk}/messages/...
    path("", include(conv_router.urls)),
]
