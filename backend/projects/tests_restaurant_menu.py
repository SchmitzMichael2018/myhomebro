import io
import tempfile
import uuid

from PIL import Image, PngImagePlugin
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models_website_service import WebsiteMenuEvent, WebsiteMenuPhoto, WebsiteServiceProject, website_material_storage


@override_settings(SECURE_SSL_REDIRECT=False)
class RestaurantMenuTests(TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.settings_override = override_settings(WEBSITE_MATERIAL_ROOT=self.root.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        field = WebsiteMenuPhoto._meta.get_field("file")
        old_storage = field.storage
        field.storage = website_material_storage()
        self.addCleanup(setattr, field, "storage", old_storage)
        User = get_user_model()
        self.owner = User.objects.create_user(email="menu-owner@example.test", password="test-only", is_verified=True)
        self.other = User.objects.create_user(email="menu-other@example.test", password="test-only", is_staff=True)
        self.project = WebsiteServiceProject.objects.create(owner=self.owner, business_name="Example Kitchen", business_type="restaurant", description="Private website brief", contact_details="Private draft contact")
        self.other_project = WebsiteServiceProject.objects.create(owner=self.other, business_name="Other Kitchen", business_type="restaurant")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.public = APIClient()
        self.url = f"/api/projects/website-service-projects/{self.project.pk}/menu/"
        self.feed = f"/api/projects/public/restaurant-menus/{self.project.menu_public_id}/"

    def dish(self, **extra):
        data = {"id": str(uuid.uuid4()), "name": "Garden sandwich", "description": "Vegetables and house dressing", "category": "Sandwiches", "price": "12.50", "available": True, "vegetarian": True, "photo_id": None}
        data.update(extra)
        return data

    def save(self, items, revision=None):
        self.project.refresh_from_db()
        response = self.client.put(self.url, {"items": items, "revision": self.project.menu_revision if revision is None else revision}, format="json")
        return response

    def publish(self):
        self.project.refresh_from_db()
        return self.client.post(self.url + "publish/", {"revision": self.project.menu_revision}, format="json")

    def upload(self):
        content = io.BytesIO()
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("private-camera-note", "strip-this-metadata")
        Image.new("RGB", (30, 20), "green").save(content, format="PNG", pnginfo=metadata)
        response = self.client.post(self.url + "photos/", {"file": SimpleUploadedFile("dish.png", content.getvalue(), content_type="image/png")}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def test_requires_authentication_and_restaurant_project(self):
        self.assertIn(self.public.get(self.url).status_code, [401, 403])
        self.assertIn(self.public.put(self.url, {}, format="json").status_code, [401, 403])
        self.project.business_type = "contractor"
        self.project.save()
        self.assertEqual(self.client.get(self.url).status_code, 400)
        self.assertEqual(self.client.post(self.url + "photos/", {}, format="multipart").status_code, 400)

    def test_add_edit_reorder_remove_dishes_and_persist(self):
        first, second = self.dish(), self.dish(name="Soup", category="Starters", price="6.00")
        response = self.save([first, second])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["revision"], 1)
        second["price"] = "7.25"
        first["name"] = "Updated sandwich"
        self.assertEqual(self.save([second, first]).status_code, 200)
        self.assertEqual(self.client.get(self.url).data["items"][0]["name"], "Soup")
        self.assertEqual(self.client.get(self.url).data["items"][0]["price"], "7.25")
        self.assertEqual(self.save([first]).status_code, 200)
        self.assertEqual(len(self.client.get(self.url).data["items"]), 1)

    def test_other_account_and_staff_cannot_access_owner_menu_or_photo(self):
        photo_id = self.upload()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.put(self.url, {"revision": 0, "items": []}, format="json").status_code, 404)
        for action in ["publish/", "unpublish/", "photos/"]:
            self.assertEqual(self.client.post(self.url + action, {"revision": 0}, format="json").status_code, 404)
        self.assertEqual(self.client.get(self.url + f"photos/{photo_id}/").status_code, 404)

    def test_drafts_stay_private_until_explicit_publish(self):
        dish = self.dish()
        self.assertEqual(self.save([dish]).status_code, 200)
        self.assertEqual(self.public.get(self.feed).status_code, 404)
        response = self.publish()
        self.assertEqual(response.status_code, 200)
        public = self.public.get(self.feed, HTTP_ORIGIN="https://example-restaurant.test")
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public["Access-Control-Allow-Origin"], "*")
        self.assertEqual(public["Cache-Control"], "no-store")
        self.assertEqual(set(public.data), {"business_name", "currency", "revision", "items"})
        self.assertNotIn("Private website brief", str(public.data))
        self.assertNotIn("Private draft contact", str(public.data))
        dish["price"] = "14.00"
        self.save([dish])
        self.assertEqual(self.public.get(self.feed).data["items"][0]["price"], "12.50")
        self.publish()
        self.assertEqual(self.public.get(self.feed).data["items"][0]["price"], "14.00")

    def test_publish_is_repeatable_and_records_actor(self):
        self.save([self.dish()])
        self.publish()
        self.publish()
        self.assertEqual(WebsiteMenuEvent.objects.filter(project=self.project, action="published").count(), 1)
        self.assertEqual(WebsiteMenuEvent.objects.get(project=self.project, action="published").actor, self.owner)

    def test_stale_save_and_publish_cannot_overwrite_newer_work(self):
        self.save([self.dish()])
        self.assertEqual(self.save([], revision=0).status_code, 409)
        self.assertEqual(self.client.post(self.url + "publish/", {"revision": 0}, format="json").status_code, 409)
        self.assertEqual(len(self.client.get(self.url).data["items"]), 1)
        self.assertEqual(self.public.get(self.feed).status_code, 404)

    def test_validation_for_price_names_duplicate_ids_and_menu_limit(self):
        for dish in [self.dish(price="-1"), self.dish(price="1.234"), self.dish(price="1000000.00"), self.dish(name=""), self.dish(photo_id=str(uuid.uuid4()))]:
            self.assertEqual(self.save([dish]).status_code, 400)
        dish = self.dish()
        self.assertEqual(self.save([dish, dish]).status_code, 400)
        self.assertEqual(self.save([self.dish() for _ in range(151)]).status_code, 400)

    def test_photo_reencoded_and_public_only_while_published_and_available(self):
        photo_id = self.upload()
        photo = WebsiteMenuPhoto.objects.get(pk=photo_id)
        with photo.file.open("rb") as handle:
            image = Image.open(handle)
            self.assertEqual(image.format, "JPEG")
            self.assertNotIn("private-camera-note", image.info)
        self.assertEqual(self.client.get(self.url + f"photos/{photo_id}/").status_code, 200)
        public_photo = self.feed + f"photos/{photo_id}/"
        self.assertEqual(self.public.get(public_photo).status_code, 404)
        dish = self.dish(photo_id=photo_id)
        self.save([dish])
        self.publish()
        response = self.public.get(public_photo)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        response.close()
        self.save([])
        self.assertEqual(self.public.get(public_photo).status_code, 200)
        self.publish()
        self.assertEqual(self.public.get(public_photo).status_code, 404)
        self.assertEqual(self.public.get(self.feed).data["items"], [])

    def test_invalid_files_and_cross_owner_photo_references_rejected(self):
        for name, content in [("bad.png", b"not an image"), ("bad.svg", b"<svg/>"), ("bad.pdf", b"%PDF-"), ("large.png", b"x" * (5 * 1024 * 1024 + 1))]:
            self.assertEqual(self.client.post(self.url + "photos/", {"file": SimpleUploadedFile(name, content)}, format="multipart").status_code, 400)
        foreign = WebsiteMenuPhoto.objects.create(project=self.other_project, file="not-a-public-file.jpg")
        self.assertEqual(self.save([self.dish(photo_id=str(foreign.pk))]).status_code, 400)

    def test_unavailable_dishes_hidden_and_unpublish_retains_draft(self):
        self.save([self.dish(), self.dish(name="Seasonal special", available=False)])
        self.publish()
        self.assertEqual(len(self.public.get(self.feed).data["items"]), 1)
        self.project.refresh_from_db()
        response = self.client.post(self.url + "unpublish/", {"revision": self.project.menu_revision}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.public.get(self.feed).status_code, 404)
        self.assertEqual(len(self.client.get(self.url).data["items"]), 2)

    def test_business_type_and_generic_project_api_do_not_bypass_menu_workflow(self):
        self.save([self.dish()])
        base = f"/api/projects/website-service-projects/{self.project.pk}/"
        self.assertEqual(self.client.patch(base, {"business_type": "contractor"}, format="json").status_code, 400)
        self.client.patch(base, {"menu_published": [self.dish()], "menu_draft": []}, format="json")
        self.project.refresh_from_db()
        self.assertIsNone(self.project.menu_published)
        self.assertEqual(len(self.project.menu_draft), 1)
        self.assertNotEqual(self.project.menu_public_id, self.other_project.menu_public_id)
