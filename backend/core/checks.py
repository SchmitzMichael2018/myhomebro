from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, Tags, Warning, register

from core.async_readiness import (
    configuration_diagnostics,
    pdf_storage_status,
)


@register(Tags.security, deploy=True)
def async_services_deploy_checks(app_configs, **kwargs):
    diagnostics = configuration_diagnostics()
    messages = [
        Error(message, id=f"core.E{index:03d}")
        for index, message in enumerate(diagnostics["errors"], start=101)
    ]
    messages.extend(
        Warning(message, id=f"core.W{index:03d}")
        for index, message in enumerate(diagnostics["warnings"], start=101)
    )
    storage = pdf_storage_status(write_test=False)
    if not storage["writable"]:
        messages.append(
            Error(
                "Agreement PDF output directory is not writable.",
                hint="Verify MEDIA_ROOT permissions for the web and Celery worker users.",
                id="core.E120",
            )
        )
    return messages
