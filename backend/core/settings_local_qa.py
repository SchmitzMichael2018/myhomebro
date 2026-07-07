from .settings import *  # noqa: F403,F401

DEBUG = True
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
CORS_ALLOWED_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]
CSRF_TRUSTED_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
STRIPE_ENABLED = False
STRIPE_SECRET_KEY = ""
STRIPE_PUBLIC_KEY = ""
STRIPE_WEBHOOK_SECRET = ""
TWILIO_INVITES_ENABLED = False
MARKETPLACE_JOIN_INVITE_SMS_ENABLED = False
TWILIO_ACCOUNT_SID = ""
TWILIO_AUTH_TOKEN = ""
TWILIO_MESSAGING_SERVICE_SID = ""
TWILIO_PHONE_NUMBER = ""
TWILIO_FROM_NUMBER = ""
POSTMARK_SERVER_TOKEN = ""
CORS_ALLOW_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "cache-control",
    "pragma",
]
