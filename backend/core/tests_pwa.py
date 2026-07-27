from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase, override_settings


@override_settings(SECURE_SSL_REDIRECT=False)
class PwaAssetTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.repo_dir = Path(self.temp_dir.name)
        dist = self.repo_dir / "frontend" / "dist"
        dist.mkdir(parents=True)
        (dist / "sw.js").write_text("/* test worker */", encoding="utf-8")
        (dist / "manifest.webmanifest").write_text('{"name":"MyHomeBro"}', encoding="utf-8")
        (dist / "offline.html").write_text("<h1>Offline</h1>", encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    @override_settings(PWA_ENABLED=False)
    def test_assets_fail_closed_when_pwa_is_disabled(self):
        self.assertEqual(self.client.get("/sw.js").status_code, 404)
        self.assertEqual(self.client.get("/manifest.webmanifest").status_code, 404)

    def test_enabled_worker_is_root_scoped_and_not_cached(self):
        with override_settings(PWA_ENABLED=True, REPO_DIR=self.repo_dir):
            response = self.client.get("/sw.js")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Service-Worker-Allowed"], "/")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertIn("no-cache", response["Cache-Control"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        response.close()

    def test_enabled_manifest_and_offline_shell_are_served(self):
        with override_settings(PWA_ENABLED=True, REPO_DIR=self.repo_dir):
            manifest = self.client.get("/manifest.webmanifest")
            offline = self.client.get("/offline.html")

        self.assertEqual(manifest.status_code, 200)
        self.assertEqual(manifest["Content-Type"], "application/manifest+json")
        self.assertEqual(offline.status_code, 200)
        self.assertContains(offline, "Offline")
        manifest.close()
        offline.close()
