# backend/projects/apps.py
from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "projects"

    def ready(self):
        # Load existing signals (agreements, invoices, AI entitlements, etc.)
        try:
            import projects.signals  # noqa
        except Exception:
            pass

        # Ensure attachments model file is loaded
        try:
            import projects.models_attachments  # noqa
        except Exception:
            pass

        # ✅ Load billing signals (auto-create ContractorBillingProfile)
        try:
            import projects.signals_billing  # noqa
        except Exception:
            pass