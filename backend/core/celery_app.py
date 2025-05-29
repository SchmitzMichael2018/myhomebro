# core/celery_app.py

from celery import Celery
import os
from django.conf import settings

# Set the default Django settings module for Celery
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

app = Celery('core')

# Load task modules from all registered Django app configs
app.config_from_object('django.conf:settings', namespace='CELERY')

# Redis Broker URL (Make sure Redis is running)
app.conf.broker_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

# Optional: Set a result backend (also using Redis)
app.conf.result_backend = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

# Auto-discover tasks from your Django apps
app.autodiscover_tasks(lambda: settings.INSTALLED_APPS)

# Optional: Custom task settings (tune as needed)
app.conf.task_serializer = 'json'
app.conf.result_serializer = 'json'
app.conf.accept_content = ['json']
app.conf.task_always_eager = False  # Set to True for debugging (synchronous execution)



