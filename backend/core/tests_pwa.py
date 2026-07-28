from pathlib import Path
from tempfile import TemporaryDirectory
from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, override_settings
from django.urls import resolve


@override_settings(SECURE_SSL_REDIRECT=False)
class PwaAssetTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.repo_dir = Path(self.temp_dir.name)
        dist = self.repo_dir / "frontend" / "dist"
        dist.mkdir(parents=True)
        (dist / "sw.js").write_text("/* test worker */", encoding="utf-8")
        (dist / "sw.js").write_text(
            'importScripts("./workbox-test.js")', encoding="utf-8"
        )
        (dist / "workbox-test.js").write_text("/* workbox */", encoding="utf-8")
        (dist / "manifest.webmanifest").write_text(
            '{"name":"MyHomeBro","scope":"/","start_url":"/app/dashboard",'
            '"icons":[{"src":"/favicon-192x192.png"}]}',
            encoding="utf-8",
        )
        (dist / "offline.html").write_text("<h1>Offline</h1>", encoding="utf-8")
        for filename in (
            "favicon.ico",
            "favicon-192x192.png",
            "favicon-512x512.png",
            "apple-touch-icon.png",
            "pwa-maskable-512x512.png",
        ):
            (dist / filename).write_bytes(b"test image")

    def tearDown(self):
        self.temp_dir.cleanup()

    @override_settings(PWA_ENABLED=False)
    def test_assets_fail_closed_when_pwa_is_disabled(self):
        self.assertEqual(self.client.get("/sw.js").status_code, 404)
        self.assertEqual(self.client.get("/manifest.webmanifest").status_code, 404)

    def test_enabled_worker_is_root_scoped_and_not_cached(self):
        with override_settings(PWA_ENABLED=True, PWA_BUILD_DIR=self.repo_dir / "frontend" / "dist"):
            response = self.client.get("/sw.js")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Service-Worker-Allowed"], "/")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertIn("no-cache", response["Cache-Control"])
        self.assertEqual(response["Pragma"], "no-cache")
        self.assertEqual(response["Expires"], "0")
        self.assertTrue(response["Content-Type"].startswith("application/javascript"))
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        response.close()

    def test_enabled_manifest_and_offline_shell_are_served(self):
        with override_settings(PWA_ENABLED=True, PWA_BUILD_DIR=self.repo_dir / "frontend" / "dist"):
            manifest = self.client.get("/manifest.webmanifest")
            offline = self.client.get("/offline.html")

        self.assertEqual(manifest.status_code, 200)
        self.assertEqual(manifest["Content-Type"], "application/manifest+json")
        self.assertEqual(offline.status_code, 200)
        self.assertContains(offline, "Offline")
        manifest.close()
        offline.close()

    def test_head_returns_worker_headers_without_body(self):
        with override_settings(PWA_ENABLED=True, PWA_BUILD_DIR=self.repo_dir / "frontend" / "dist"):
            response = self.client.head("/sw.js")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Service-Worker-Allowed"], "/")
        self.assertEqual(b"".join(response.streaming_content), b"")
        response.close()

    def test_workbox_and_root_icons_are_public_and_safely_routed(self):
        build_dir = self.repo_dir / "frontend" / "dist"
        with override_settings(PWA_ENABLED=True, PWA_BUILD_DIR=build_dir):
            anonymous = self.client.get("/workbox-test.js")
            icon = self.client.get("/favicon-192x192.png")
            authenticated_equivalent = self.client.get("/workbox-test.js")
        self.assertEqual(anonymous.status_code, 200)
        self.assertTrue(anonymous["Content-Type"].startswith("application/javascript"))
        self.assertIn("immutable", anonymous["Cache-Control"])
        self.assertEqual(icon.status_code, 200)
        self.assertEqual(authenticated_equivalent.status_code, 200)
        anonymous.close()
        icon.close()
        authenticated_equivalent.close()

    def test_workbox_path_traversal_and_unapproved_files_are_rejected(self):
        build_dir = self.repo_dir / "frontend" / "dist"
        with override_settings(PWA_ENABLED=True, PWA_BUILD_DIR=build_dir):
            self.assertEqual(self.client.get("/workbox-../settings.py").status_code, 404)
        self.assertEqual(resolve("/workbox-test.js").view_name, "pwa-workbox")
        self.assertNotEqual(resolve("/secret.txt").view_name, "pwa-workbox")

    def test_missing_worker_returns_404(self):
        build_dir = self.repo_dir / "frontend" / "dist"
        (build_dir / "sw.js").unlink()
        with override_settings(PWA_ENABLED=True, PWA_BUILD_DIR=build_dir):
            response = self.client.get("/sw.js")
        self.assertEqual(response.status_code, 404)

    def test_diagnostic_command_passes_and_detects_missing_asset(self):
        build_dir = self.repo_dir / "frontend" / "dist"
        settings_override = override_settings(
            PWA_ENABLED=True,
            PWA_BUILD_DIR=build_dir,
            REPO_DIR=self.repo_dir,
        )
        with settings_override:
            call_command("check_pwa_deployment", verbosity=0)
            (build_dir / "sw.js").unlink()
            with self.assertRaises(CommandError):
                call_command("check_pwa_deployment", verbosity=0)

    def test_pwa_routes_precede_spa_fallback(self):
        self.assertEqual(resolve("/sw.js").view_name, "pwa-service-worker")
        self.assertEqual(resolve("/manifest.webmanifest").view_name, "pwa-manifest")
        self.assertEqual(resolve("/offline.html").view_name, "pwa-offline")
