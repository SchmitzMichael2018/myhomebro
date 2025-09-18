# backend/projects/apps.py
from django.apps import AppConfig

class ProjectsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "projects"

    def ready(self):
        try:
            import projects.signals  # noqa
        except Exception:
            pass
        # ensure our attachments model file is loaded
        try:
            import projects.models_attachments  # noqa
        except Exception:
            pass
