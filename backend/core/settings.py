import os
from pathlib import Path
from datetime import timedelta

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv, find_dotenv
import dj_database_url

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def get_env_var(name: str, default: str | None = None, required: bool = False) -> str:
    val = os.getenv(name, default)
    if required and not val:
        raise ImproperlyConfigured(f"Missing required environment variable: {name}")
    return val  # type: ignore

def get_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.lower() in ("1", "true", "t", "yes", "y")

# ──────────────────────────────────────────────────────────────────────────────
# Paths & .env
# ──────────────────────────────────────────────────────────────────────────────
# This file lives at backend/core/settings.py → BASE_DIR == backend/
BASE_DIR = Path(__file__).resolve().parent.parent

# Robust .env loading (works even if CWD changes)
explicit_env = BASE_DIR / ".env"
if explicit_env.exists():
    load_dotenv(dotenv_path=explicit_env, override=True)
else:
    discovered = find_dotenv(filename=".env", usecwd=True)
    if discovered:
        load_dotenv(discovered, override=True)

# ──────────────────────────────────────────────────────────────────────────────
# Security & Debug
# ──────────────────────────────────────────────────────────────────────────────
SECRET_KEY = get_env_var("SECRET_KEY", required=True)
DEBUG = get_bool("DEBUG", default=False)
ALLOWED_HOSTS = [h.strip() for h in get_env_var("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]

# Public URLs (used for CSRF/CORS defaults)
FRONTEND_URL = get_env_var("FRONTEND_URL", "http://localhost:3000").rstrip("/")
SITE_URL     = get_env_var("SITE_URL",     "http://127.0.0.1:8000").rstrip("/")

# CSRF requires scheme+host
CSRF_TRUSTED_ORIGINS = [
    SITE_URL,
    FRONTEND_URL,
] + [
    u.strip() for u in get_env_var(
        "CSRF_TRUSTED_ORIGINS",
        "https://myhomebro.com,https://www.myhomebro.com"
    ).split(",") if u.strip().startswith("http")
]

# ──────────────────────────────────────────────────────────────────────────────
# Installed Apps & Middleware
# ──────────────────────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    # Django core
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third-party
    "whitenoise.runserver_nostatic",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_extensions",
    "django_filters",
    "channels",
    "django_celery_beat",
    "django_celery_results",

    # Local apps
    "core",
    "accounts",
    "projects",
    "chat",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"
WSGI_APPLICATION = "core.wsgi.application"
ASGI_APPLICATION = "core.asgi.application"

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ──────────────────────────────────────────────────────────────────────────────
# Database (single source: DATABASE_URL; defaults to SQLite)
# ──────────────────────────────────────────────────────────────────────────────
# Examples:
#   sqlite (default): sqlite:///db.sqlite3
#   postgres:         postgres://USER:PASS@HOST:PORT/DBNAME
DEFAULT_DB_URL = "sqlite:///" + str(BASE_DIR / "db.sqlite3")
DATABASE_URL = get_env_var("DATABASE_URL", DEFAULT_DB_URL)

DATABASES = {
    "default": dj_database_url.parse(
        DATABASE_URL,
        conn_max_age=600,
        ssl_require=DATABASE_URL.startswith("postgres")
    )
}

# ──────────────────────────────────────────────────────────────────────────────
# Templates (we serve frontend build via templates/index.html if desired)
# ──────────────────────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS":    [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "accounts.backends.EmailBackend",
]

# ──────────────────────────────────────────────────────────────────────────────
# Static & Media
# ──────────────────────────────────────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Keep only app-level static here; build artifacts get collected to STATIC_ROOT
STATICFILES_DIRS = [
    BASE_DIR / "static",
]
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ──────────────────────────────────────────────────────────────────────────────
# Stripe (optional; guarded by flag)
# ──────────────────────────────────────────────────────────────────────────────
STRIPE_ENABLED = get_bool("STRIPE_ENABLED", default=False)
STRIPE_SECRET_KEY     = get_env_var("STRIPE_SECRET_KEY",     required=False)
STRIPE_PUBLIC_KEY     = get_env_var("STRIPE_PUBLIC_KEY",     required=False)
STRIPE_WEBHOOK_SECRET = get_env_var("STRIPE_WEBHOOK_SECRET", required=False)

if STRIPE_ENABLED and STRIPE_SECRET_KEY:
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY

# ──────────────────────────────────────────────────────────────────────────────
# Channels (Redis optional; fallback to in-memory)
# ──────────────────────────────────────────────────────────────────────────────
REDIS_URL = get_env_var("REDIS_URL", "")
if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [REDIS_URL]},
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
    }

# ──────────────────────────────────────────────────────────────────────────────
# DRF / JWT
# ──────────────────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":  timedelta(minutes=int(get_env_var("ACCESS_TOKEN_LIFETIME", "60"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(get_env_var("REFRESH_TOKEN_LIFETIME", "7"))),
    "ROTATE_REFRESH_TOKENS":  True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM":              "HS256",
    "SIGNING_KEY":            SECRET_KEY,
    "USER_ID_FIELD":          "id",
    "USER_ID_CLAIM":          "user_id",
}

# ──────────────────────────────────────────────────────────────────────────────
# CORS
# ──────────────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = [
    *[o.strip() for o in get_env_var(
        "CORS_ALLOWED_ORIGINS",
        f"{FRONTEND_URL},http://127.0.0.1:3000"
    ).split(",") if o.strip()]
]
CORS_ALLOW_CREDENTIALS = True

# ──────────────────────────────────────────────────────────────────────────────
# Celery
# ──────────────────────────────────────────────────────────────────────────────
from celery.schedules import crontab
CELERY_BROKER_URL     = REDIS_URL or "redis://localhost:6379/0"
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_BEAT_SCHEDULE  = {
    "auto-release-undisputed-invoices-daily": {
        "task":    "projects.tasks.auto_release_undisputed_invoices",
        "schedule": crontab(hour=0, minute=0),
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# Twilio (optional)
# ──────────────────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID  = get_env_var("TWILIO_ACCOUNT_SID",  required=False)
TWILIO_AUTH_TOKEN   = get_env_var("TWILIO_AUTH_TOKEN",   required=False)
TWILIO_PHONE_NUMBER = get_env_var("TWILIO_PHONE_NUMBER", required=False)

# ──────────────────────────────────────────────────────────────────────────────
# Email (safe defaults for MVP)
# ──────────────────────────────────────────────────────────────────────────────
if DEBUG:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    # If you haven't set SMTP yet, fall back to console so deploy won't crash
    if os.getenv("EMAIL_HOST") and os.getenv("EMAIL_HOST_USER"):
        EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    else:
        EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

EMAIL_HOST          = get_env_var("EMAIL_HOST", required=False)
EMAIL_PORT          = int(get_env_var("EMAIL_PORT", "587"))
EMAIL_USE_TLS       = get_bool("EMAIL_USE_TLS", True)
EMAIL_HOST_USER     = get_env_var("EMAIL_HOST_USER", required=False)
EMAIL_HOST_PASSWORD = get_env_var("EMAIL_HOST_PASSWORD", required=False)
DEFAULT_FROM_EMAIL  = get_env_var("DEFAULT_FROM_EMAIL", "MyHomeBro <no-reply@myhomebro.com>")

# ──────────────────────────────────────────────────────────────────────────────
# Production Security (enable when DEBUG=False)
# ──────────────────────────────────────────────────────────────────────────────
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # Consider enabling HSTS after confirming HTTPS:
    # SECURE_HSTS_SECONDS = 31536000
    # SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # SECURE_HSTS_PRELOAD = True
