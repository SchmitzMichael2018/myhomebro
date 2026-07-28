from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit, urlunsplit

from django.conf import settings


REDIS_SCHEMES = {"redis", "rediss"}
PRODUCTION_ENVIRONMENTS = {"production", "staging"}


def sanitized_url_status(value: str | None) -> dict[str, Any]:
    value = (value or "").strip()
    if not value:
        return {"configured": False, "scheme": "", "host": ""}
    try:
        parsed = urlparse(value)
    except ValueError:
        return {"configured": True, "scheme": "", "host": "", "valid": False}
    return {
        "configured": True,
        "scheme": parsed.scheme,
        "host": parsed.hostname or "",
        "valid": bool(parsed.scheme and parsed.hostname),
    }


def is_local_broker(value: str | None) -> bool:
    host = sanitized_url_status(value).get("host", "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def redis_dependency_status() -> dict[str, Any]:
    available = importlib.util.find_spec("redis") is not None
    result: dict[str, Any] = {"available": available}
    if available:
        try:
            from importlib.metadata import version

            result["version"] = version("redis")
        except Exception:
            result["version"] = "unknown"
    return result


def configuration_diagnostics() -> dict[str, Any]:
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "")
    backend = str(getattr(settings, "CELERY_RESULT_BACKEND", "") or "")
    environment = str(getattr(settings, "DEPLOYMENT_ENVIRONMENT", "") or "").lower()
    async_enabled = bool(getattr(settings, "PDF_ASYNC_ENABLED", False))
    scheduled_jobs_enabled = bool(getattr(settings, "CELERY_SCHEDULED_JOBS_ENABLED", False))
    notifications_enabled = bool(getattr(settings, "CELERY_NOTIFICATIONS_ENABLED", False))
    broker_required = async_enabled or scheduled_jobs_enabled or notifications_enabled
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    redis_status = redis_dependency_status()
    errors: list[str] = []
    warnings: list[str] = []

    broker_status = sanitized_url_status(broker)
    backend_status = sanitized_url_status(backend)
    if broker_required and not broker:
        errors.append("A Celery capability is enabled but CELERY_BROKER_URL/REDIS_URL is missing.")
    if broker_required and broker and not broker_status.get("valid"):
        errors.append("The configured Celery broker URL is malformed.")
    if (
        broker_required
        and broker_status.get("scheme") in REDIS_SCHEMES
        and not redis_status["available"]
    ):
        errors.append("The Python redis package required by the Celery Redis transport is unavailable.")
    if (
        broker_required
        and environment in PRODUCTION_ENVIRONMENTS
        and broker
        and is_local_broker(broker)
    ):
        errors.append("A localhost Celery broker is not allowed in staging or production.")
    if environment in PRODUCTION_ENVIRONMENTS and eager:
        warnings.append("Celery eager mode is enabled outside development.")
    if environment in PRODUCTION_ENVIRONMENTS and getattr(settings, "PDF_SYNC_FALLBACK_ENABLED", False):
        warnings.append("Synchronous PDF fallback is configured but unsupported in web requests.")
    if async_enabled and not backend:
        warnings.append("Celery result backend is disabled; worker round-trip verification is limited.")

    return {
        "ready": not errors,
        "environment": environment,
        "async_pdf_enabled": async_enabled,
        "celery_required": broker_required,
        "scheduled_jobs_enabled": scheduled_jobs_enabled,
        "celery_notifications_enabled": notifications_enabled,
        "sync_fallback_enabled": bool(getattr(settings, "PDF_SYNC_FALLBACK_ENABLED", False)),
        "eager_mode": eager,
        "queue": str(getattr(settings, "PDF_QUEUE_NAME", "pdf")),
        "redis_package": redis_status,
        "broker": broker_status,
        "result_backend": backend_status,
        "errors": errors,
        "warnings": warnings,
    }


def probe_redis_url(value: str | None, timeout: float = 3.0) -> dict[str, Any]:
    status = sanitized_url_status(value)
    if not status.get("configured"):
        return {**status, "reachable": False, "error": "not configured"}
    if status.get("scheme") not in REDIS_SCHEMES:
        return {**status, "reachable": False, "error": "unsupported broker scheme"}
    try:
        import redis

        redis_url = str(value)
        parts = urlsplit(redis_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        cert_reqs = query.get("ssl_cert_reqs", "")
        if cert_reqs.upper().startswith("CERT_"):
            query["ssl_cert_reqs"] = cert_reqs[5:].lower()
            redis_url = urlunsplit(
                (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
            )
        client = redis.Redis.from_url(
            redis_url,
            socket_connect_timeout=timeout,
            socket_timeout=timeout,
        )
        client.ping()
        return {**status, "reachable": True}
    except Exception as exc:
        return {**status, "reachable": False, "error": type(exc).__name__}


def celery_app_status() -> dict[str, Any]:
    try:
        from core.celery_app import app

        task_name = "generate_full_agreement_pdf"
        return {
            "importable": True,
            "pdf_task_registered": task_name in app.tasks,
            "probe_task_registered": "projects.tasks.pdf_readiness_probe" in app.tasks,
        }
    except Exception as exc:
        return {"importable": False, "error": type(exc).__name__}


def pdf_storage_status(write_test: bool = False) -> dict[str, Any]:
    root = Path(settings.MEDIA_ROOT)
    output = root / "agreements" / "tmp"
    try:
        output.mkdir(parents=True, exist_ok=True)
        writable = os.access(output, os.W_OK)
        if write_test and writable:
            handle = tempfile.NamedTemporaryFile(
                prefix="readiness-",
                suffix=".tmp",
                dir=output,
                delete=False,
            )
            path = Path(handle.name)
            try:
                handle.write(b"myhomebro-readiness")
                handle.close()
            finally:
                path.unlink(missing_ok=True)
        return {"writable": writable, "path_kind": "MEDIA_ROOT/agreements/tmp"}
    except Exception as exc:
        return {
            "writable": False,
            "path_kind": "MEDIA_ROOT/agreements/tmp",
            "error": type(exc).__name__,
        }


def worker_status(timeout: float = 3.0) -> dict[str, Any]:
    try:
        from core.celery_app import app

        replies = app.control.ping(timeout=timeout)
        return {"available": bool(replies), "worker_count": len(replies or [])}
    except Exception as exc:
        return {"available": False, "worker_count": 0, "error": type(exc).__name__}


def readiness_report(
    *,
    connect_broker: bool = False,
    check_worker: bool = False,
    write_test: bool = False,
    force_optional: bool = False,
) -> dict[str, Any]:
    config = configuration_diagnostics()
    async_enabled = bool(config["async_pdf_enabled"])
    storage = pdf_storage_status(write_test=write_test)
    report: dict[str, Any] = {
        "ready": config["ready"],
        "configuration": config,
        "celery": celery_app_status(),
        "pdf_storage": storage,
        "capabilities": {
            "core_web": {"status": "available", "required": True},
            "database": {"status": "configured", "required": True},
            "file_pdf_generation": {
                "status": "available" if storage.get("writable") else "unavailable",
                "required": True,
            },
            "async_pdf_queue": {
                "status": "enabled" if async_enabled else "disabled",
                "required": async_enabled,
            },
            "scheduled_jobs": {
                "status": "enabled" if config["scheduled_jobs_enabled"] else "disabled",
                "required": config["scheduled_jobs_enabled"],
            },
            "websockets": {"status": "inactive", "required": False},
            "redis_cache": {"status": "inactive", "required": False},
        },
    }
    report["ready"] = bool(
        report["ready"]
        and report["celery"].get("importable")
        and report["celery"].get("pdf_task_registered")
        and report["pdf_storage"].get("writable")
    )
    should_probe_celery = bool(config["celery_required"]) or force_optional
    if connect_broker and not should_probe_celery:
        report["broker_connection"] = {"status": "disabled", "attempted": False}
    elif connect_broker:
        report["broker_connection"] = probe_redis_url(
            getattr(settings, "CELERY_BROKER_URL", ""),
            timeout=float(getattr(settings, "CELERY_BROKER_CONNECTION_TIMEOUT", 5)),
        )
        report["ready"] = bool(report["ready"] and report["broker_connection"].get("reachable"))
        backend = str(getattr(settings, "CELERY_RESULT_BACKEND", "") or "")
        if backend:
            report["result_backend_connection"] = probe_redis_url(
                backend,
                timeout=float(getattr(settings, "CELERY_BROKER_CONNECTION_TIMEOUT", 5)),
            )
            report["ready"] = bool(
                report["ready"] and report["result_backend_connection"].get("reachable")
            )
    if check_worker and not should_probe_celery:
        report["worker"] = {"status": "disabled", "attempted": False}
    elif check_worker:
        report["worker"] = worker_status()
        report["ready"] = bool(report["ready"] and report["worker"].get("available"))
    return report
