"""
ASGI config for core project with WebSocket support.

This setup allows for HTTP and WebSocket connections, providing real-time functionality
for notifications, chat, and other live features.
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

from core.websocket_routing import websocket_urlpatterns  # Custom WebSocket URLs
from core.jwt_middleware import JwtAuthMiddleware  # ✅ Custom JWT WebSocket Authentication

application = ProtocolTypeRouter({
    "http": get_asgi_application(),  # Default HTTP support
    "websocket": AllowedHostsOriginValidator(
        JwtAuthMiddleware(  # ✅ Secure JWT WebSocket Authentication
            URLRouter(websocket_urlpatterns)
        )
    ),
})



