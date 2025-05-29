# core/jwt_middleware.py
from channels.middleware.base import BaseMiddleware
from jwt import decode, exceptions
from django.conf import settings
from django.contrib.auth import get_user_model
from channels.db import database_sync_to_async

User = get_user_model()

class JwtAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        token = self.get_token_from_scope(scope)
        if token:
            try:
                payload = decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                user_id = payload.get("user_id")
                user = await self.get_user(user_id)
                scope["user"] = user
            except exceptions.InvalidTokenError:
                scope["user"] = None
        return await super().__call__(scope, receive, send)

    def get_token_from_scope(self, scope):
        query_string = scope.get("query_string").decode()
        if "token=" in query_string:
            return query_string.split("token=")[1]
        return None

    @database_sync_to_async
    def get_user(self, user_id):
        try:
            return User.objects.get(id=user_id)
        except User.DoesNotExist:
            return None
