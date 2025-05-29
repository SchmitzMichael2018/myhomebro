import json
from django.utils.html import escape
from channels.generic.websocket import AsyncWebsocketConsumer

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.scope["user"].id}_{self.room_name}'

        # ✅ Require Authentication
        if not self.scope['user'].is_authenticated:
            await self.close(code=4001)
            return

        # ✅ Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        try:
            # ✅ Leave room group
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
        except Exception as e:
            print(f"❌ Error in Disconnect: {str(e)}")

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message = escape(text_data_json.get('message', ''))
            username = self.scope['user'].get_full_name() or self.scope['user'].email

            # ✅ Broadcast message to room group
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message': message,
                    'username': username
                }
            )
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({"error": "Invalid message format."}))

    async def chat_message(self, event):
        message = event['message']
        username = event['username']

        # ✅ Send message to WebSocket client
        await self.send(text_data=json.dumps({
            'username': username,
            'message': message
        }))

