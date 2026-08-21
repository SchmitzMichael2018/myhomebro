from __future__ import annotations

from django.conf import settings
from pathlib import Path

from django.core.checks import Error, Tags, Warning, register
from django.core.exceptions import ImproperlyConfigured

from core.public_app_urls import normalize_public_app_origin

from core.async_readiness import (
    configuration_diagnostics,
    pdf_storage_status,
)


@register(Tags.security)
def public_site_url_deploy_check(app_configs, **kwargs):
    if str(getattr(settings, "DEPLOYMENT_ENVIRONMENT", "")).lower() not in {"production", "staging"}:
        return []
    messages = []
    value = str(getattr(settings, "SITE_URL", "") or "").strip()
    try:
        normalize_public_app_origin(value, production=True)
    except (ImproperlyConfigured, ValueError):
        valid = False
    else:
        valid = bool(getattr(settings, "SITE_URL_CONFIGURED", False))
    if not valid:
        messages.append(Error(
            "Production SITE_URL must be an explicitly configured public HTTPS origin.",
            hint="Set SITE_URL=https://www.myhomebro.com in the shared production environment.",
            id="core.E130",
        ))
    if not str(getattr(settings, "CACHE_URL", "") or "").strip():
        messages.append(Warning(
            "CACHE_URL is not configured; public-link throttles are process-local.",
            hint="Set CACHE_URL to the deployment's shared Redis endpoint before relying on global throttle enforcement.",
            id="core.W130",
        ))
    return messages


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


@register(Tags.staticfiles, deploy=True)
def pwa_deployment_checks(app_configs, **kwargs):
    if not getattr(settings, "PWA_ENABLED", False):
        return []
    build_dir = Path(settings.PWA_BUILD_DIR)
    repo_dir = Path(settings.REPO_DIR).resolve()
    try:
        resolved = build_dir.resolve()
        resolved.relative_to(repo_dir)
    except (OSError, ValueError):
        return [
            Error(
                "PWA_BUILD_DIR must resolve inside REPO_DIR.",
                id="core.E201",
            )
        ]
    if not resolved.is_dir():
        return [Error("PWA build directory is missing or unreadable.", id="core.E202")]
    messages = []
    for filename, error_id in (
        ("sw.js", "core.E203"),
        ("manifest.webmanifest", "core.E204"),
    ):
        if not (resolved / filename).is_file():
            messages.append(Error(f"Required PWA asset is missing: {filename}", id=error_id))
    if not any(resolved.glob("workbox-*.js")):
        messages.append(Error("No generated Workbox JavaScript file exists.", id="core.E205"))
    return messages
