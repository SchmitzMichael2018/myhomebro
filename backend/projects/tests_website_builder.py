from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Contractor,
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    Skill,
)
from projects.services.website_builder import build_website_profile_payload


User = get_user_model()


class ContractorWebsiteBuilderFoundationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="builder@example.com",
            password="pass",
            first_name="Builder",
            last_name="Owner",
        )
        self.skill = Skill.objects.create(name="Kitchen Remodeling", slug="kitchen-remodeling")
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Bright Build Co",
            phone="555-111-2222",
            city="Austin",
            state="TX",
            license_number="TX-123",
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
        )
        self.contractor.skills.add(self.skill)
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Bright Build Co",
            tagline="Calm remodels, clean finishes",
            bio="We help homeowners with kitchen and bath projects.",
            brand_primary_color="#1d4ed8",
            brand_accent_color="#0f766e",
            city="Austin",
            state="TX",
            service_area_text="Austin metro",
            phone_public="555-111-2222",
            email_public="hello@bright.example.com",
            show_phone_public=True,
            show_email_public=False,
            specialties=["Kitchen Remodels"],
            work_types=["Bathroom Remodels"],
            seo_title="Bright Build Co | Austin Remodeler",
            seo_description="Austin remodeling contractor for kitchens and baths.",
            is_public=True,
        )
        self.gallery = ContractorGalleryItem.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            title="Kitchen refresh",
            description="New cabinets and tile.",
            category="Kitchen",
            image=SimpleUploadedFile("kitchen.jpg", b"fake-image", content_type="image/jpeg"),
            is_public=True,
            is_featured=True,
        )
        ContractorGalleryItem.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            title="Private project",
            image=SimpleUploadedFile("private.jpg", b"fake-image", content_type="image/jpeg"),
            is_public=False,
        )
        self.review = ContractorReview.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            customer_name="Taylor Homeowner",
            rating=5,
            title="Excellent work",
            review_text="Clear communication from start to finish.",
            moderation_status=ContractorReview.MODERATION_APPROVED,
            is_verified=True,
            is_public=True,
            published_at=timezone.now(),
        )
        ContractorReview.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            customer_name="Hidden Customer",
            rating=2,
            moderation_status=ContractorReview.MODERATION_PENDING,
            is_public=False,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_website_profile_payload_uses_existing_public_profile_data(self):
        payload = build_website_profile_payload(self.contractor)

        self.assertEqual(payload["identity"]["business_name"], "Bright Build Co")
        self.assertEqual(payload["identity"]["tagline"], "Calm remodels, clean finishes")
        self.assertEqual(payload["service_area"]["service_area_text"], "Austin metro")
        self.assertIn("Kitchen Remodels", payload["services"]["specialties"])
        self.assertIn("Kitchen Remodeling", payload["services"]["skills"])
        self.assertEqual(payload["seo"]["title"], "Bright Build Co | Austin Remodeler")
        self.assertEqual(payload["gallery"]["count"], 2)
        self.assertEqual(payload["reviews"]["count"], 1)

    def test_missing_fields_generate_readiness_checklist_items(self):
        self.profile.tagline = ""
        self.profile.bio = ""
        self.profile.service_area_text = ""
        self.profile.city = ""
        self.profile.state = ""
        self.profile.save(update_fields=["tagline", "bio", "service_area_text", "city", "state"])
        self.contractor.city = ""
        self.contractor.state = ""
        self.contractor.save(update_fields=["city", "state"])

        payload = build_website_profile_payload(self.contractor)

        missing = set(payload["readiness"]["missing_required_fields"])
        self.assertIn("tagline", missing)
        self.assertIn("bio", missing)
        self.assertIn("service_area", missing)
        checklist = {item["key"]: item for item in payload["readiness"]["checklist"]}
        self.assertFalse(checklist["tagline"]["complete"])
        self.assertTrue(checklist["tagline"]["required"])

    def test_free_profile_enabled_and_pro_growth_features_disabled_by_default(self):
        response = self.client.get("/api/projects/contractor/website/", secure=True)

        self.assertEqual(response.status_code, 200)
        features = response.data["entitlements"]["features"]
        self.assertTrue(features["public_profile"]["enabled"])
        self.assertFalse(features["website_builder"]["enabled"])
        self.assertFalse(features["website_publish"]["enabled"])
        self.assertFalse(features["website_custom_domain"]["enabled"])
        self.assertFalse(features["website_ai_copy"]["enabled"])
        self.assertFalse(features["website_analytics"]["enabled"])
        self.assertFalse(features["website_advanced_seo"]["enabled"])
        self.assertEqual(response.data["draft"]["status"], "placeholder")

    def test_preview_endpoint_returns_public_safe_data_only(self):
        self.profile.show_email_public = False
        self.profile.email_public = "private@bright.example.com"
        self.profile.save(update_fields=["show_email_public", "email_public"])

        response = self.client.get("/api/projects/contractor/website/preview/", secure=True)

        self.assertEqual(response.status_code, 200)
        profile = response.data["profile"]
        self.assertTrue(response.data["preview"]["public_safe"])
        self.assertFalse(response.data["preview"]["can_publish"])
        self.assertEqual(profile["contact"]["email_public"], "")
        self.assertEqual(profile["gallery"]["count"], 1)
        self.assertEqual(len(profile["gallery"]["items"]), 1)
        self.assertEqual(profile["reviews"]["count"], 1)
        self.assertEqual(profile["reviews"]["selected"][0]["customer_name"], "Taylor Homeowner")
