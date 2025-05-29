"""
core/websocket_routing.py

This file defines the WebSocket routes for MyHomeBro.
- Secure WebSocket Connection: JWT authentication is enforced.
- Chat Rooms: Contractors and Homeowners can chat securely.
"""

# core/websocket_routing.py
from django.urls import re_path
from projects.consumers import ChatConsumer  # Make sure the path is correct

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<room_name>\w+)/$', ChatConsumer.as_asgi()),
]

