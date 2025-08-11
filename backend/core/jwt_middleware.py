# core/jwt_middleware.py
import logging
from channels.middleware.base import BaseMiddleware
from jwt import decode, ExpiredSignatureError, InvalidTokenError
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from channels.db import database_sync_to_async

User = get_user_model()
logger = logging.getLogger(__name__)

@database_sync_to_async
def get_user(user_id):
    """Async helper to get a user from the database."""
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return AnonymousUser()

class JwtAuthMiddleware(BaseMiddleware):
    """
    Custom middleware for Django Channels to authenticate users via a JWT
    passed in the query string.
    """
    async def __call__(self, scope, receive, send):
        # Extract token from query string more robustly
        query_string = scope.get("query_string", b"").decode("utf-8")
        token = dict(qp.split('=', 1) for qp in query_string.split('&') if '=' in qp).get('token')

        if token:
            try:
                # Use the algorithm specified in settings for consistency
                payload = decode(token, settings.SECRET_KEY, algorithms=[settings.SIMPLE_JWT['ALGORITHM']])
                user_id = payload.get("user_id")
                scope["user"] = await get_user(user_id)
                logger.info(f"WebSocket user authenticated: {scope['user']}")
            except ExpiredSignatureError:
                logger.warning("WebSocket connection attempt with an expired token.")
                scope["user"] = AnonymousUser()
            except InvalidTokenError as e:
                logger.error(f"WebSocket connection attempt with an invalid token: {e}")
                scope["user"] = AnonymousUser()
        else:
            scope["user"] = AnonymousUser()

        return await super().__call__(scope, receive, send)