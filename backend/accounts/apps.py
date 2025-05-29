# accounts/apps.py
from django.apps import AppConfig
import logging
from importlib import import_module

logger = logging.getLogger(__name__)

class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'

    def ready(self):
        try:
            # ✅ Import signals using safer import method
            import_module("accounts.signals")
            logger.info("✅ Accounts Signals Loaded Successfully.")
        except ImportError as e:
            logger.warning(f"⚠️ Accounts Signals Not Loaded: {str(e)}")
        except Exception as e:
            logger.error(f"❌ Unexpected Error Loading Accounts Signals: {str(e)}")

