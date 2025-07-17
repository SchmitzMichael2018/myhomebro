import os
from pathlib import Path
from dotenv import load_dotenv
from datetime import timedelta # Ensure timedelta is imported if not already (it was used lower down)

# ✅ Load Environment Variables
BASE_DIR = Path(__file__).resolve().parent.parent
dotenv_path = BASE_DIR / '.env'
load_dotenv(dotenv_path)

# ✅ Secret Key and Debug
SECRET_KEY = os.getenv("SECRET_KEY", "your-very-strong-secret-key-here")
DEBUG = os.getenv("DEBUG", "True").lower() == "true"

# ✅ Allowed Hosts
ALLOWED_HOSTS = [
    '127.0.0.1',
    'localhost',
    'schmitzmichael1985.pythonanywhere.com',
    'www.myhomebro.com',
]

# ✅ Application Definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'channels',
    'projects',
    'accounts', # Your accounts app
]

# ✅ Custom User Model Configuration
# This line tells Django to use your custom User model from the 'accounts' app
AUTH_USER_MODEL = 'accounts.User' # <<<< ⭐️ ADDED THIS LINE ⭐️ >>>>

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'corsheaders.middleware.CorsMiddleware',
]

ROOT_URLCONF = 'core.urls'
WSGI_APPLICATION = 'core.wsgi.application'
ASGI_APPLICATION = 'core.asgi.application'

# ✅ Database Configuration (PostgreSQL)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('DB_NAME', 'defaultdb'),
        'USER': os.getenv('DB_USER', 'avnadmin'),
        'PASSWORD': os.getenv('DB_PASSWORD', ''),
        'HOST': os.getenv('DB_HOST', 'localhost'),
        'PORT': os.getenv('DB_PORT', '5432'),
        'CONN_MAX_AGE': 600,
        'OPTIONS': {'sslmode': 'require'}, # Ensure your DB setup supports/requires SSL
    }
}

# ✅ Stripe Configuration
STRIPE_SECRET_KEY = os.getenv('STRIPE_SECRET_KEY', '')
STRIPE_PUBLIC_KEY = os.getenv('STRIPE_PUBLIC_KEY', '')
STRIPE_LIVE_MODE = os.getenv('STRIPE_LIVE_MODE', 'False').lower() == 'true'

# ✅ JWT Authentication Settings
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

# ✅ JWT Settings
# from datetime import timedelta # This import was here, moved it to the top for convention
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=int(os.getenv("ACCESS_TOKEN_LIFETIME", 60))),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=int(os.getenv("REFRESH_TOKEN_LIFETIME", 7))),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    # Optional: If your AUTH_USER_MODEL's USERNAME_FIELD is 'email',
    # and you want the `TokenObtainPairSerializer` to explicitly show 'email'
    # as a required field instead of 'username' in API docs / browsable API,
    # you might consider customizing the serializer or ensuring User model is primary.
    # However, `AUTH_USER_MODEL` is the main driver for which field is used for auth.
    # 'USER_ID_FIELD': 'id', # Default is 'user_id' referring to the user's primary key
    # 'USER_ID_CLAIM': 'user_id', # Default
}

# ✅ Static and Media Files
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# ✅ Templates
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / "templates"],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

# ✅ CORS Settings
CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") # Added 127.0.0.1:3000 as common alternative for localhost
CORS_ALLOW_CREDENTIALS = True

# ✅ Redis and Channels (WebSocket Support)
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            "hosts": [os.getenv('REDIS_URL', 'redis://localhost:6379/0')],
        },
    },
}

# ✅ Security Settings (Development - Adjust for Production)
# In production, you would typically set these to True and configure HSTS
SECURE_SSL_REDIRECT = os.getenv('SECURE_SSL_REDIRECT', 'False').lower() == 'true'
SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
CSRF_COOKIE_SECURE = os.getenv('CSRF_COOKIE_SECURE', 'False').lower() == 'true'
SECURE_HSTS_SECONDS = int(os.getenv('SECURE_HSTS_SECONDS', 0)) # e.g., 31536000 for 1 year in production
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.getenv('SECURE_HSTS_INCLUDE_SUBDOMAINS', 'False').lower() == 'true'
SECURE_HSTS_PRELOAD = os.getenv('SECURE_HSTS_PRELOAD', 'False').lower() == 'true'
SECURE_CONTENT_TYPE_NOSNIFF = True # Good practice to keep True
X_FRAME_OPTIONS = 'SAMEORIGIN' # Good default

# ✅ Logging Configuration
LOGS_DIR = BASE_DIR / 'logs'
LOGS_DIR.mkdir(exist_ok=True, parents=True)
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'DEBUG',
            'class': 'logging.FileHandler',
            'filename': LOGS_DIR / 'myhomebro.log',
        },
        'console': {
            'level': 'DEBUG',
            'class': 'logging.StreamHandler',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file', 'console'],
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': True,
        },
    },
}

# ✅ Email Configuration (Console for Development)
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', 'MyHomeBro <no-reply@myhomebro.com>')
SERVER_EMAIL = os.getenv('SERVER_EMAIL', 'MyHomeBro Error Notifier <errors@myhomebro.com>')
EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', 587))
EMAIL_USE_TLS = os.getenv('EMAIL_USE_TLS', 'True').lower() == 'true'
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')

# ✅ Error Tracking for Missing .env Variables
REQUIRED_ENV_VARS = [
    "SECRET_KEY", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST",
    "STRIPE_SECRET_KEY", "STRIPE_PUBLIC_KEY"
]
# It's good practice to check for required env vars, but ensure this runs without error if they are truly optional in some contexts.
# This loop will only print warnings, which is fine.
for var in REQUIRED_ENV_VARS:
    if not os.getenv(var) and DEBUG: # Maybe only warn in DEBUG, or handle differently in prod
        print(f"⚠️ WARNING: Missing environment variable: {var}")

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

















