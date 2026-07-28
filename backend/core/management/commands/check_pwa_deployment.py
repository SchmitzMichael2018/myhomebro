from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test import Client
from django.urls import resolve

from core.views_frontend import PWA_PUBLIC_ASSETS


class Command(BaseCommand):
    help = "Validate the local PWA build and its public Django serving contract."

    def handle(self, *args, **options):
        failures = []
        build_dir = Path(settings.PWA_BUILD_DIR)
        self.stdout.write(f"PWA_ENABLED={settings.PWA_ENABLED}")
        self.stdout.write(f"BASE_DIR={settings.BASE_DIR}")
        self.stdout.write(f"PWA_BUILD_DIR={build_dir}")
        if not settings.PWA_ENABLED:
            raise CommandError("PWA is disabled; deployment validation cannot pass.")
        try:
            build_dir.resolve().relative_to(Path(settings.REPO_DIR).resolve())
        except (OSError, ValueError):
            failures.append("PWA_BUILD_DIR is outside REPO_DIR")
        if not build_dir.is_dir():
            failures.append("PWA build directory is missing or unreadable")

        required = list(PWA_PUBLIC_ASSETS)
        for filename in required:
            if not (build_dir / filename).is_file():
                failures.append(f"missing {filename}")

        sw_path = build_dir / "sw.js"
        workbox_name = None
        if sw_path.is_file():
            match = re.search(
                r"workbox-[A-Za-z0-9_-]+(?:\.js)?",
                sw_path.read_text(encoding="utf-8"),
            )
            if match:
                workbox_name = match.group(0)
                if not workbox_name.endswith(".js"):
                    workbox_name += ".js"
                if not (build_dir / workbox_name).is_file():
                    failures.append(f"referenced Workbox file is missing: {workbox_name}")
            else:
                failures.append("sw.js does not reference a generated Workbox file")

        manifest_path = build_dir / "manifest.webmanifest"
        manifest = {}
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                failures.append("manifest.webmanifest is not valid JSON")
            if manifest.get("scope") != "/":
                failures.append("manifest scope must be /")
            if not str(manifest.get("start_url", "")).startswith("/"):
                failures.append("manifest start_url must be root-relative")

        urls = ["/sw.js", "/manifest.webmanifest", "/offline.html"]
        urls.extend(
            urlsplit(icon.get("src", "")).path
            for icon in manifest.get("icons", [])
            if icon.get("src")
        )
        if workbox_name:
            urls.append(f"/{workbox_name}")

        client = Client()
        expected_types = {
            "/sw.js": "application/javascript",
            "/manifest.webmanifest": "application/manifest+json",
            "/offline.html": "text/html",
        }
        for url in dict.fromkeys(urls):
            try:
                match = resolve(url)
            except Exception as exc:
                failures.append(f"{url} does not resolve: {exc}")
                continue
            response = client.get(url, secure=True, HTTP_HOST="localhost")
            self.stdout.write(
                f"{url}: view={match.view_name or match.func.__name__} "
                f"status={response.status_code} type={response.get('Content-Type', '')}"
            )
            if response.status_code != 200:
                failures.append(f"{url} returned {response.status_code}")
            expected_type = expected_types.get(url)
            if expected_type and not response.get("Content-Type", "").startswith(expected_type):
                failures.append(f"{url} has incorrect Content-Type")
            if url == "/sw.js" and response.get("Service-Worker-Allowed") != "/":
                failures.append("/sw.js is missing Service-Worker-Allowed: /")
            if hasattr(response, "close"):
                response.close()

        if failures:
            raise CommandError("PWA deployment check failed:\n- " + "\n- ".join(failures))
        self.stdout.write(self.style.SUCCESS("PWA deployment check passed."))
