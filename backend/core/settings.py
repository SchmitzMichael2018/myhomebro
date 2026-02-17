# ~/backend/backend/core/settings.py
import os
from pathlib import Path
from datetime import timedelta
from urllib.parse import urlparse

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
    return raw.lower() in ("1", "true", "t", "yes", "y", "on")

def _derive_redis_db(url: str, db_index: int) -> str:
    """
    If url ends with /0, produce /<db_index>. If url has no explicit db path,
    append /<db_index>. Preserves querystring if present.
    """
    if not url:
        return url

    # Split querystring
    if "?" in url:
        base, qs = url.split("?", 1)
        qs = "?" + qs
    else:
        base, qs = url, ""

    # If base already ends with /<num>, swap it.
    parsed = urlparse(base)
    path = parsed.path or ""

    # If path is '/', treat as empty db.
    if path in ("", "/"):
        new_base = base.rstrip("/") + f"/{db_index}"
        return new_base + qs

    # If path is '/0' or '/1' etc, replace last segment if numeric
    parts = path.split("/")
    last = parts[-1] if parts else ""
    if last.isdigit():
        parts[-1] = str(db_index)
        new_path = "/".join(parts)
        new_base = base[: len(base) - len(path)] + new_path
        return new_base + qs

    # Otherwise append /<db_index>
    new_base = base.rstrip("/") + f"/{db_index}"
    return new_base + qs

# ──────────────────────────────────────────────────────────────────────────────
# Paths & .env
# ──────────────────────────────────────────────────────────────────────────────
# This file lives at: ~/backend/backend/core/settings.py
# So:
#   BASE_DIR = ~/backend/backend
#   REPO_DIR = ~/backend
BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent
FRONTEND_DIR = REPO_DIR / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"

# Robust .env loading
explicit_env = REPO_DIR / ".env"
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

ALLOWED_HOSTS = [
    h.strip()
    for h in get_env_var(
        "ALLOWED_HOSTS",
        "localhost,127.0.0.1,myhomebro.com,www.myhomebro.com"
    ).split(",")
    if h.strip()
]

# Public URLs (used for CSRF/CORS defaults)
FRONTEND_URL = get_env_var("FRONTEND_URL", "http://localhost:3000").rstrip("/")
SITE_URL     = get_env_var("SITE_URL",     "http://127.0.0.1:8000").rstrip("/")

# CSRF requires scheme+host
CSRF_TRUSTED_ORIGINS = [
    u.strip()
    for u in (
        [SITE_URL, FRONTEND_URL] +
        [
            u.strip()
            for u in get_env_var(
                "CSRF_TRUSTED_ORIGINS",
                "https://myhomebro.com,https://www.myhomebro.com"
            ).split(",")
        ]
    )
    if u.strip().startswith("http")
]

# Production safety net: ALWAYS trust your canonical HTTPS domains
if not DEBUG:
    for u in ("https://myhomebro.com", "https://www.myhomebro.com"):
        if u not in CSRF_TRUSTED_ORIGINS:
            CSRF_TRUSTED_ORIGINS.append(u)

# Allow our in-app PDF viewer to render in an iframe
X_FRAME_OPTIONS = "SAMEORIGIN"

# Tighten referrer policy; safe for PDF/HTML previews
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# ──────────────────────────────────────────────────────────────────────────────
# Installed Apps & Middleware (Channels & chat removed)
# ──────────────────────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    # Django core
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",

    # WhiteNoise "no static" app must be listed BEFORE staticfiles
    "whitenoise.runserver_nostatic",

    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third-party
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_extensions",
    "django_filters",
    "django_celery_beat",
    "django_celery_results",

    # Local apps
    "core",
    "accounts",
    "payments",
    "receipts.apps.ReceiptsConfig",
    "adminpanel",
    "projects.apps.ProjectsConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # must be right after SecurityMiddleware
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

# WSGI/ASGI (plain ASGI; no Channels)
WSGI_APPLICATION = "core.wsgi.application"
ASGI_APPLICATION = "core.asgi.application"

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ──────────────────────────────────────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────────────────────────────────────
_sqlite_candidates = [
    REPO_DIR / "db.sqlite3",
    BASE_DIR / "db.sqlite3",
]
_sqlite_file = next((p for p in _sqlite_candidates if p.exists()), _sqlite_candidates[0])
SQLITE_ABS_PATH = str(_sqlite_file.resolve())

DEFAULT_DB_URL = f"sqlite:///{SQLITE_ABS_PATH}"
DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_DB_URL)

DATABASES = {
    "default": dj_database_url.parse(
        DATABASE_URL,
        conn_max_age=600,
        ssl_require=DATABASE_URL.startswith(("postgres://", "postgresql://")),
    )
}

# ──────────────────────────────────────────────────────────────────────────────
# Templates
# ──────────────────────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [
            REPO_DIR / "templates",  # ~/backend/templates
            BASE_DIR / "templates",  # ~/backend/backend/templates (safety net)
        ],
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
STATIC_ROOT = REPO_DIR / "staticfiles"  # ~/backend/staticfiles

STATICFILES_DIRS = []

# Only include frontend/dist if it exists (prevents collectstatic crash)
if FRONTEND_DIST_DIR.exists():
    STATICFILES_DIRS.append(FRONTEND_DIST_DIR)

# Optional app-level static
_app_static = BASE_DIR / "static"
if _app_static.exists():
    STATICFILES_DIRS.append(_app_static)

STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
}

WHITENOISE_MANIFEST_STRICT = False
WHITENOISE_AUTOREFRESH = DEBUG

MEDIA_URL = "/media/"
MEDIA_ROOT = REPO_DIR / "media"

# ──────────────────────────────────────────────────────────────────────────────
# Stripe (optional; guarded)
# ──────────────────────────────────────────────────────────────────────────────
STRIPE_ENABLED = get_bool("STRIPE_ENABLED", default=False)
STRIPE_SECRET_KEY     = get_env_var("STRIPE_SECRET_KEY",     required=False)
STRIPE_PUBLIC_KEY     = get_env_var("STRIPE_PUBLIC_KEY",     required=False)
STRIPE_WEBHOOK_SECRET = get_env_var("STRIPE_WEBHOOK_SECRET", required=False)

if STRIPE_ENABLED and STRIPE_SECRET_KEY:
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY

# ──────────────────────────────────────────────────────────────────────────────
# DRF / JWT
# ──────────────────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    # JWT-only API auth (avoids CSRF enforcement on unsafe methods like DELETE)
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(get_env_var("ACCESS_TOKEN_LIFETIME", "60"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(get_env_var("REFRESH_TOKEN_LIFETIME", "7"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "AUTH_HEADER_TYPES": ("Bearer",),
    "UPDATE_LAST_LOGIN": False,
}

# ──────────────────────────────────────────────────────────────────────────────
# CORS
# ──────────────────────────────────────────────────────────────────────────────
_default_cors = (
    f"{FRONTEND_URL},"
    "http://127.0.0.1:3000,http://localhost:3000,"
    "http://127.0.0.1:5173,http://localhost:5173"
)

CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in get_env_var("CORS_ALLOWED_ORIGINS", _default_cors).split(",")
    if o.strip()
]

# Production safety net: allow canonical HTTPS origins for the app
if not DEBUG:
    for u in ("https://myhomebro.com", "https://www.myhomebro.com"):
        if u not in CORS_ALLOWED_ORIGINS:
            CORS_ALLOWED_ORIGINS.append(u)

CORS_ALLOW_CREDENTIALS = True

from corsheaders.defaults import default_headers as _cors_default_headers  # type: ignore
CORS_ALLOW_HEADERS = list(_cors_default_headers) + ["authorization", "content-disposition"]
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

# ──────────────────────────────────────────────────────────────────────────────
# Upload limits (useful for attachments / PDFs)
# ──────────────────────────────────────────────────────────────────────────────
DATA_UPLOAD_MAX_MEMORY_SIZE = int(get_env_var("DATA_UPLOAD_MAX_MEMORY_SIZE", str(50 * 1024 * 1024)))  # 50MB
FILE_UPLOAD_MAX_MEMORY_SIZE = int(get_env_var("FILE_UPLOAD_MAX_MEMORY_SIZE", str(10 * 1024 * 1024)))  # 10MB

# ──────────────────────────────────────────────────────────────────────────────
# Celery
# ──────────────────────────────────────────────────────────────────────────────
# Preferred (your pattern): set REDIS_URL to enable Celery (broker+backend).
# Back-compat: allow CELERY_BROKER_URL / CELERY_RESULT_BACKEND too.
#
# For Aiven Valkey, REDIS_URL should look like:
#   rediss://default:<PASSWORD>@host:port/0
#
# If you only provide /0, we auto-derive results backend to /1.
REDIS_URL = get_env_var("REDIS_URL", "").strip()

CELERY_BROKER_URL = (
    get_env_var("CELERY_BROKER_URL", "").strip()
    or REDIS_URL
).strip()

# If result backend explicitly set, use it; else if broker is redis-like, derive /1.
_explicit_result = get_env_var("CELERY_RESULT_BACKEND", "").strip()
if _explicit_result:
    CELERY_RESULT_BACKEND = _explicit_result
elif CELERY_BROKER_URL.startswith(("redis://", "rediss://")):
    CELERY_RESULT_BACKEND = _derive_redis_db(CELERY_BROKER_URL, 1)
else:
    CELERY_RESULT_BACKEND = None

# Good defaults (safe)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = get_env_var("CELERY_TIMEZONE", "America/Chicago")

# Beat schedule only if broker exists
CELERY_BEAT_SCHEDULE = {}
if CELERY_BROKER_URL:
    from celery.schedules import crontab
    CELERY_BEAT_SCHEDULE = {
        "auto-release-undisputed-invoices-daily": {
            "task": "projects.tasks.auto_release_undisputed_invoices",
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
# Email (Postmark SMTP in production, console in DEBUG)
# ──────────────────────────────────────────────────────────────────────────────
if DEBUG:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = "smtp.postmarkapp.com"
    EMAIL_PORT = 587
    EMAIL_USE_TLS = True

    POSTMARK_SERVER_TOKEN = get_env_var("POSTMARK_SERVER_TOKEN", required=True)
    EMAIL_HOST_USER = POSTMARK_SERVER_TOKEN
    EMAIL_HOST_PASSWORD = POSTMARK_SERVER_TOKEN

DEFAULT_FROM_EMAIL = get_env_var("DEFAULT_FROM_EMAIL", "MyHomeBro <info@myhomebro.com>")
PUBLIC_LOGO_URL = get_env_var("PUBLIC_LOGO_URL", "") or None

# ──────────────────────────────────────────────────────────────────────────────
# Production Security (enable when DEBUG=False)
# ──────────────────────────────────────────────────────────────────────────────
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_COOKIE_SAMESITE = "Lax"
    # Consider enabling HSTS after confirming HTTPS works end-to-end:
    # SECURE_HSTS_SECONDS = 31536000
    # SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # SECURE_HSTS_PRELOAD = True

# Require email verification before login?
ACCOUNTS_REQUIRE_EMAIL_VERIFICATION = get_bool("ACCOUNTS_REQUIRE_EMAIL_VERIFICATION", default=False)

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": True},
        "accounts": {"handlers": ["console"], "level": "INFO", "propagate": True},
        "projects": {"handlers": ["console"], "level": "INFO", "propagate": True},
        "payments": {"handlers": ["console"], "level": "INFO", "propagate": True},
    },
}

# ============================================================================
# AI FEATURE FLAGS (MyHomeBro)
# ----------------------------------------------------------------------------
# These flags control ALL AI behavior across the platform.
# AI must remain read-only, advisory, and non-financial.
# ----------------------------------------------------------------------------
# IMPORTANT:
# - Do NOT enable these in production until fully tested
# - AI must never trigger refunds, releases, or DB mutations
# ============================================================================

AI_ENABLED = get_bool("AI_ENABLED", default=False)
AI_DISPUTE_RECOMMENDATIONS_ENABLED = get_bool("AI_DISPUTE_RECOMMENDATIONS_ENABLED", default=False)
AI_DISPUTES_ENABLED = get_bool("AI_DISPUTES_ENABLED", default=False)
AI_INSIGHTS_ENABLED = get_bool("AI_INSIGHTS_ENABLED", default=False)
AI_SCOPE_ASSIST_ENABLED = get_bool("AI_SCOPE_ASSIST_ENABLED", default=False)

OPENAI_DISPUTE_SUMMARY_MODEL = get_env_var("OPENAI_DISPUTE_SUMMARY_MODEL", "gpt-4o-mini")

# ✅ Add OpenAI key into settings so AI modules can read it consistently.
# This does NOT force AI on; it simply makes the value available if present.
OPENAI_API_KEY = get_env_var("OPENAI_API_KEY", required=False)

# Backward-compatible alias (some modules may check this name)
AI_OPENAI_API_KEY = get_env_var("AI_OPENAI_API_KEY", default=OPENAI_API_KEY, required=False)
