import io
import tempfile
from PIL import Image
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models_website_service import WebsiteServiceMaterial, WebsiteServiceProject


@override_settings(SECURE_SSL_REDIRECT=False)
class WebsiteServiceTests(TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.storage_settings = override_settings(WEBSITE_MATERIAL_ROOT=self.root.name)
        self.storage_settings.enable()
        self.addCleanup(self.storage_settings.disable)
        # FileField storage is initialized with the model; swap its location for this test only.
        self.field = WebsiteServiceMaterial._meta.get_field("file")
        self.old_storage = self.field.storage
        from projects.models_website_service import website_material_storage
        self.field.storage = website_material_storage()
        self.addCleanup(setattr, self.field, "storage", self.old_storage)
        self.owner = get_user_model().objects.create_user(email="website-owner@example.test", password="test-only-password")
        self.other = get_user_model().objects.create_user(email="website-other@example.test", password="test-only-password")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.base = "/api/projects/website-service-projects/"

    def create(self, **extra):
        payload = {"business_name": "Example Kitchen", "business_type": "restaurant", "template_id": "restaurant-food"}
        payload.update(extra)
        response = self.client.post(self.base, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.base).status_code, [401, 403])
        self.assertIn(self.client.post(self.base, {"business_name": "No"}, format="json").status_code, [401, 403])

    def test_project_persists_for_current_user_and_ignores_staff_fields(self):
        project = self.create(owner=self.other.pk, status="launched", preview_url="https://example.test/")
        row = WebsiteServiceProject.objects.get(pk=project["id"])
        self.assertEqual(row.owner, self.owner)
        self.assertEqual(row.status, "brief")
        self.assertEqual(row.preview_url, "")
        response = self.client.patch(f'{self.base}{row.pk}/', {"description": "Menu and catering", "status": "launched"}, format="json")
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.description, "Menu and catering")
        self.assertEqual(row.status, "brief")

    def test_other_account_cannot_list_edit_submit_upload_or_request(self):
        project = self.create()
        self.client.force_authenticate(self.other)
        response = self.client.get(self.base)
        rows = response.data if isinstance(response.data, list) else response.data["results"]
        self.assertEqual(rows, [])
        url = f'{self.base}{project["id"]}/'
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"business_name": "Stolen"}, format="json").status_code, 404)
        for action in ["submit", "materials", "requests"]:
            self.assertEqual(self.client.post(url + action + "/", {}, format="json").status_code, 404)

    def test_submit_requires_complete_brief_and_is_repeatable(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/'
        self.assertEqual(self.client.post(url + "submit/").status_code, 400)
        self.client.patch(url, {"description": "Show our menu", "contact_details": "Example phone and hours"}, format="json")
        self.assertEqual(self.client.post(url + "submit/").data["status"], "review")
        self.assertEqual(self.client.post(url + "submit/").data["status"], "review")
        self.assertEqual(WebsiteServiceProject.objects.count(), 1)

    def test_private_material_download_and_file_validation(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/'
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "green").save(buffer, format="PNG")
        content = buffer.getvalue()
        upload = SimpleUploadedFile("logo.png", content, content_type="image/png")
        response = self.client.post(url + "materials/", {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("file", response.data)
        file_url = url + f'materials/{response.data["id"]}/download/'
        response = self.client.get(file_url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(b"".join(response.streaming_content), content)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(file_url).status_code, 404)
        self.client.force_authenticate(self.owner)
        for name, data in [("bad.png", b"not an image"), ("bad.html", b"<script>"), ("bad.pdf", b"not a pdf"), ("big.pdf", b"%PDF-" + b"x" * (5 * 1024 * 1024))]:
            response = self.client.post(url + "materials/", {"file": SimpleUploadedFile(name, data)}, format="multipart")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(WebsiteServiceMaterial.objects.count(), 1)

    def test_request_and_staff_response_are_visible_to_owner(self):
        project = self.create()
        url = f'{self.base}{project["id"]}/'
        response = self.client.post(url + "requests/", {"message": "Please add a catering page", "status": "done", "response": "forged"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "open")
        self.assertEqual(response.data["response"], "")
        row = WebsiteServiceProject.objects.get(pk=project["id"]).requests.get()
        row.response = "Added to the next preview"
        row.status = "done"
        row.save()
        self.assertEqual(self.client.get(url).data["requests"][0]["response"], row.response)

    def test_invalid_template_rejected(self):
        response = self.client.post(self.base, {"business_name": "Example", "template_id": "../../etc/passwd"}, format="json")
        self.assertEqual(response.status_code, 400)
