"""
Projects App Configuration

- Automatically loads signal handlers on app startup.
- Uses secure import to avoid circular import errors.
- Provides clear logging for signal loading status.
"""

from django.apps import AppConfig
import logging

logger = logging.getLogger(__name__)

class ProjectsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'projects'

    def ready(self):
        try:
            import projects.signals  # ✅ Direct import for reliability
            logger.info("✅ Projects Signals Loaded Successfully.")
        except ImportError as e:
            logger.error(f"❌ Failed to load Projects Signals: {str(e)}")
        except Exception as e:
            logger.error(f"❌ Unexpected error in loading Projects Signals: {str(e)}")





