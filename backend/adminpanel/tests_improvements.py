from django.contrib.admin.models import LogEntry
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models_templates import ProjectTemplate


@override_settings(SECURE_SSL_REDIRECT=False)
class ImprovementEditorialTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.admin = User.objects.create_user(email="editor@example.com", password="password", is_staff=True)
        self.other = User.objects.create_user(email="reader@example.com", password="password")
        self.payload = {
            "name": "QA Bathroom Planning",
            "public_title": "Plan a Bathroom Update",
            "public_slug": "qa-bathroom-planning",
            "public_category_slug": "bathroom",
            "public_summary": "Scope the project before starting.",
            "public_intro": "Measure the space and write down the fixtures you want to replace.",
            "seo_description": "Plan a bathroom update and decide when to ask a professional for help.",
        }

    def test_authentication_and_role_guard_read_and_write(self):
        for url in ("/api/projects/admin/improvements/", "/api/projects/admin/improvements/1/transition/"):
            self.assertIn(self.client.get(url).status_code, (401, 403, 404))
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get("/api/projects/admin/improvements/").status_code, 403)
        self.assertEqual(self.client.post("/api/projects/admin/improvements/", self.payload, content_type="application/json").status_code, 403)

    def test_review_publish_archive_and_public_visibility(self):
        self.client.force_authenticate(user=self.admin)
        created = self.client.post("/api/projects/admin/improvements/", self.payload, content_type="application/json")
        self.assertEqual(created.status_code, 201, created.content)
        template_id = created.json()["id"]
        template = ProjectTemplate.objects.get(pk=template_id)
        self.assertTrue(template.is_system)
        self.assertFalse(template.is_published)  # Contractor template availability remains separate.
        public_url = "/api/projects/public/improvements/bathroom/qa-bathroom-planning/"
        self.assertEqual(self.client.get(public_url).status_code, 404)
        attempted = self.client.patch(
            f"/api/projects/admin/improvements/{template_id}/",
            {"public_publication_status": "published", "public_reviewed_at": "2026-09-28T00:00:00Z"},
            content_type="application/json",
        )
        self.assertEqual(attempted.status_code, 400)
        self.assertEqual(ProjectTemplate.objects.get(pk=template_id).public_publication_status, "draft")
        transition = f"/api/projects/admin/improvements/{template_id}/transition/"
        self.assertEqual(self.client.post(transition, {"action": "publish", "confirmed": True}, content_type="application/json").status_code, 409)
        self.assertEqual(self.client.post(transition, {"action": "request_review"}, content_type="application/json").status_code, 200)
        self.assertEqual(self.client.get(public_url).status_code, 404)
        self.assertEqual(self.client.post(transition, {"action": "publish"}, content_type="application/json").status_code, 400)
        published = self.client.post(transition, {"action": "publish", "confirmed": True}, content_type="application/json")
        self.assertEqual(published.status_code, 200, published.content)
        self.assertEqual(self.client.get(public_url).status_code, 200)
        template.refresh_from_db()
        self.assertEqual(template.public_reviewed_by, self.admin)
        self.assertIsNotNone(template.public_published_at)
        self.assertEqual(self.client.patch(f"/api/projects/admin/improvements/{template_id}/", {"public_intro": "Changed"}, content_type="application/json").status_code, 409)
        self.assertEqual(self.client.post(transition, {"action": "archive"}, content_type="application/json").status_code, 200)
        self.assertEqual(self.client.get(public_url).status_code, 404)
        self.assertGreaterEqual(LogEntry.objects.filter(object_id=str(template_id)).count(), 4)

    def test_edit_requires_new_review_and_validation_prevents_incomplete_publication(self):
        self.client.force_authenticate(user=self.admin)
        created = self.client.post("/api/projects/admin/improvements/", self.payload, content_type="application/json").json()
        url = f"/api/projects/admin/improvements/{created['id']}/"
        transition = f"{url}transition/"
        self.client.post(transition, {"action": "request_review"}, content_type="application/json")
        edited = self.client.patch(url, {"public_intro": "Revised scope", "seo_description": ""}, content_type="application/json")
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(edited.json()["status"], "draft")
        self.client.post(transition, {"action": "request_review"}, content_type="application/json")
        failed = self.client.post(transition, {"action": "publish", "confirmed": True}, content_type="application/json")
        self.assertEqual(failed.status_code, 400)
        self.assertIn("seo_description", failed.json())
        self.assertEqual(ProjectTemplate.objects.get(pk=created["id"]).public_publication_status, "ready_for_review")
        self.assertEqual(self.client.get("/api/projects/public/improvements/").json()["improvements"], [])

    def test_private_template_cannot_be_edited_and_invalid_slug_is_rejected(self):
        self.client.force_authenticate(user=self.admin)
        private = ProjectTemplate.objects.create(name="Private contractor agreement", is_system=False)
        self.assertEqual(self.client.patch(f"/api/projects/admin/improvements/{private.id}/", self.payload, content_type="application/json").status_code, 404)
        invalid = self.client.post("/api/projects/admin/improvements/", {**self.payload, "public_slug": "Not a slug"}, content_type="application/json")
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(ProjectTemplate.objects.filter(name="QA Bathroom Planning").exists())

    def test_contractors_visible_template_keeps_shared_fields(self):
        self.client.force_authenticate(user=self.admin)
        existing = ProjectTemplate.objects.create(
            name="Existing contractor template", default_scope="Existing agreement scope",
            is_system=True, is_published=True, public_slug="existing-qa-guide",
            public_category_slug="bathroom", public_intro="Planning guidance",
        )
        url = f"/api/projects/admin/improvements/{existing.id}/"
        denied = self.client.patch(url, {"name": "Changed agreement title"}, content_type="application/json")
        self.assertEqual(denied.status_code, 400)
        existing.refresh_from_db()
        self.assertEqual(existing.name, "Existing contractor template")
        edited = self.client.patch(url, {"public_intro": "Revised public planning guidance"}, content_type="application/json")
        self.assertEqual(edited.status_code, 200, edited.content)
        existing.refresh_from_db()
        self.assertEqual(existing.default_scope, "Existing agreement scope")
