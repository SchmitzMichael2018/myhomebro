from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit, urlunsplit

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def _is_local_hostname(hostname: str) -> bool:
    hostname = hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def normalize_public_app_origin(value: str, *, production: bool = False) -> str:
    """Validate and normalize the trusted, configuration-owned public app base URL."""
    parsed = urlsplit(str(value or "").strip())
    hostname = (parsed.hostname or "").lower()
    invalid = (
        parsed.scheme not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or bool(parsed.query)
        or bool(parsed.fragment)
    )
    if invalid:
        raise ImproperlyConfigured(
            "SITE_URL must be a valid absolute application URL without credentials, a query, or a fragment."
        )
    if parsed.scheme != "https" and not _is_local_hostname(hostname):
        raise ImproperlyConfigured("SITE_URL must use HTTPS outside local development.")
    if production and (
        parsed.scheme != "https"
        or _is_local_hostname(hostname)
        or hostname.endswith((".local", ".test", ".invalid", ".example"))
        or parsed.port in {3000, 5173, 8000}
        or parsed.path not in {"", "/"}
    ):
        raise ImproperlyConfigured("Production SITE_URL must be a public HTTPS origin.")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def public_app_origin() -> str:
    return normalize_public_app_origin(str(getattr(settings, "SITE_URL", "") or ""))


def build_public_app_url(relative_path: str) -> str:
    parsed = urlsplit(str(relative_path or ""))
    if (
        not relative_path
        or not str(relative_path).startswith("/")
        or str(relative_path).startswith("//")
        or parsed.scheme
        or parsed.netloc
    ):
        raise ValueError("Public application URLs must be built from a root-relative path.")
    return f"{public_app_origin()}{relative_path}"
