from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Contractor,
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    ContractorWebsite,
    ContractorWebsitePage,
    Notification,
    PublicContractorLead,
    Skill,
)
from projects.models_project_intake import ProjectIntake
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

    def test_trial_first_access_enables_customization_and_keeps_growth_disabled_by_default(self):
        response = self.client.get("/api/projects/contractor/website/", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["entitlements"]["access_state"], "website_trial_active")
        self.assertTrue(response.data["entitlements"]["can_customize"])
        self.assertTrue(response.data["entitlements"]["can_use_ai_limited"])
        features = response.data["entitlements"]["features"]
        self.assertTrue(features["public_profile"]["enabled"])
        self.assertTrue(features["website_builder"]["enabled"])
        self.assertFalse(features["website_publish"]["enabled"])
        self.assertFalse(features["website_custom_domain"]["enabled"])
        self.assertTrue(features["website_ai_copy"]["enabled"])
        self.assertFalse(features["website_analytics"]["enabled"])
        self.assertFalse(features["website_advanced_seo"]["enabled"])
        self.assertEqual(response.data["draft"]["status"], ContractorWebsite.STATUS_DRAFT)
        self.assertTrue(response.data["draft"]["has_draft"])
        self.assertEqual(len(response.data["pages"]), 5)

    def test_expired_trial_blocks_customization_without_deleting_content(self):
        self.client.get("/api/projects/contractor/website/", secure=True)
        website = ContractorWebsite.objects.get(contractor=self.contractor)
        home = website.pages.get(page_type=ContractorWebsitePage.PAGE_HOME)
        home.content_blocks = {"hero": {"headline": "Saved draft headline"}}
        home.save(update_fields=["content_blocks", "updated_at"])
        Contractor.objects.filter(pk=self.contractor.pk).update(created_at=timezone.now() - timedelta(days=45))

        response = self.client.get("/api/projects/contractor/website/", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["entitlements"]["access_state"], "website_trial_expired")
        self.assertFalse(response.data["entitlements"]["can_customize"])
        self.assertEqual(
            response.data["pages"][0]["content_blocks"]["hero"]["headline"],
            "Saved draft headline",
        )

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

    def test_draft_auto_created_and_pages_auto_generated(self):
        response = self.client.get("/api/projects/contractor/website/", secure=True)

        self.assertEqual(response.status_code, 200)
        website = ContractorWebsite.objects.get(contractor=self.contractor)
        self.assertEqual(website.status, ContractorWebsite.STATUS_DRAFT)
        self.assertEqual(website.pages.count(), 5)
        self.assertTrue(website.pages.filter(page_type=ContractorWebsitePage.PAGE_HOME).exists())

    @override_settings(
        CONTRACTOR_WEBSITE_FEATURE_DEFAULTS={
            "website_builder": True,
            "website_publish": True,
        }
    )
    def test_design_edits_and_page_edits_save(self):
        response = self.client.patch(
            "/api/projects/contractor/website/",
            {
                "template_key": "premium_home",
                "homepage_layout": {
                    "branding": {"primary_color": "#123456", "accent_color": "#abcdef"},
                    "sections": {"reviews": False},
                    "section_order": ["hero", "portfolio", "services", "trust", "contact"],
                },
            },
            format="json",
            secure=True,
        )
        self.assertEqual(response.status_code, 200)
        website = ContractorWebsite.objects.get(contractor=self.contractor)
        self.assertEqual(website.template_key, ContractorWebsite.TEMPLATE_PREMIUM_HOME)
        self.assertEqual(website.homepage_layout["branding"]["primary_color"], "#123456")
        self.assertFalse(website.homepage_layout["sections"]["reviews"])

        home = website.pages.get(page_type=ContractorWebsitePage.PAGE_HOME)
        page_response = self.client.patch(
            f"/api/projects/contractor/website/pages/{home.id}/",
            {
                "title": "Austin Kitchen Remodeling",
                "seo_title": "Kitchen Remodeling Austin",
                "content_blocks": {
                    "hero_headline": "Beautiful kitchens without project chaos.",
                    "cta_text": "Start My Remodel",
                },
            },
            format="json",
            secure=True,
        )

        self.assertEqual(page_response.status_code, 200)
        home.refresh_from_db()
        self.assertEqual(home.title, "Austin Kitchen Remodeling")
        self.assertEqual(home.content_blocks["hero_headline"], "Beautiful kitchens without project chaos.")
        self.assertEqual(home.content_blocks["cta_text"], "Start My Remodel")

    @override_settings(CONTRACTOR_WEBSITE_ACCESS_STATE="website_trial_expired")
    def test_entitlement_gates_enforced_for_edits(self):
        self.client.get("/api/projects/contractor/website/", secure=True)
        website = ContractorWebsite.objects.get(contractor=self.contractor)
        home = website.pages.get(page_type=ContractorWebsitePage.PAGE_HOME)

        response = self.client.patch(
            f"/api/projects/contractor/website/pages/{home.id}/",
            {"title": "Blocked"},
            format="json",
            secure=True,
        )

        self.assertEqual(response.status_code, 403)
        home.refresh_from_db()
        self.assertNotEqual(home.title, "Blocked")

    def test_ai_assist_endpoint_validates_action_type(self):
        response = self.client.post(
            "/api/projects/contractor/website/ai-assist/",
            {"action": "dump_private_project_data", "current_value": "Test"},
            format="json",
            secure=True,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Unsupported", response.data["detail"])

    def test_ai_assist_endpoint_does_not_return_private_data_when_provider_missing(self):
        response = self.client.post(
            "/api/projects/contractor/website/ai-assist/",
            {
                "action": "generate_tagline",
                "current_value": "",
                "website_payload": {"private_customer_email": "secret@example.com"},
            },
            format="json",
            secure=True,
        )

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret@example.com", str(response.data))

    @override_settings(
        CONTRACTOR_WEBSITE_FEATURE_DEFAULTS={
            "website_builder": True,
            "website_publish": True,
        }
    )
    def test_publish_creates_snapshot_and_public_renderer_uses_snapshot(self):
        self.client.get("/api/projects/contractor/website/", secure=True)
        website = ContractorWebsite.objects.get(contractor=self.contractor)
        home = website.pages.get(page_type=ContractorWebsitePage.PAGE_HOME)
        self.client.patch(
            f"/api/projects/contractor/website/pages/{home.id}/",
            {"content_blocks": {"hero_headline": "Published snapshot headline"}},
            format="json",
            secure=True,
        )

        publish = self.client.post("/api/projects/contractor/website/publish/", secure=True)
        self.assertEqual(publish.status_code, 200)
        website.refresh_from_db()
        self.assertEqual(website.status, ContractorWebsite.STATUS_PUBLISHED)
        self.assertEqual(website.published_snapshot["pages"][0]["content_blocks"]["hero_headline"], "Published snapshot headline")

        home.content_blocks["hero_headline"] = "Draft changed after publish"
        home.save(update_fields=["content_blocks", "updated_at"])
        public = self.client.get(f"/api/projects/public/websites/{self.profile.slug}/", secure=True)

        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data["current_page"]["content_blocks"]["hero_headline"], "Published snapshot headline")

    @override_settings(
        CONTRACTOR_WEBSITE_FEATURE_DEFAULTS={
            "website_builder": True,
            "website_publish": True,
        }
    )
    def test_paused_website_not_public(self):
        self.client.get("/api/projects/contractor/website/", secure=True)
        self.client.post("/api/projects/contractor/website/publish/", secure=True)

        pause = self.client.post("/api/projects/contractor/website/pause/", secure=True)
        self.assertEqual(pause.status_code, 200)
        public = self.client.get(f"/api/projects/public/websites/{self.profile.slug}/", secure=True)
        self.assertEqual(public.status_code, 404)

    @override_settings(
        CONTRACTOR_WEBSITE_FEATURE_DEFAULTS={
            "website_builder": True,
            "website_publish": True,
        }
    )
    def test_public_website_intake_creates_contractor_scoped_lead_and_notification(self):
        self.client.get("/api/projects/contractor/website/", secure=True)
        publish = self.client.post("/api/projects/contractor/website/publish/", secure=True)
        self.assertEqual(publish.status_code, 200)

        self.client.force_authenticate(None)
        response = self.client.post(
            f"/api/projects/public/websites/{self.profile.slug}/intake/",
            {
                "full_name": "Jordan Website",
                "email": "jordan@example.com",
                "phone": "555-333-4444",
                "project_type": "Kitchen remodel",
                "raw_description": "We need new cabinets, counters, and lighting.",
                "desired_timing_text": "Next month",
                "budget_range_text": "$15k-$25k",
                "payment_preference": "discuss",
                "project_address_line1": "123 Main St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "contact_consent": "true",
            },
            format="multipart",
            secure=True,
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["source"], PublicContractorLead.SOURCE_WEBSITE)
        self.assertEqual(response.data["source_label"], "Website")
        self.assertIn("Bright Build Co", response.data["message"])

        intake = ProjectIntake.objects.get(customer_email="jordan@example.com")
        self.assertEqual(intake.contractor, self.contractor)
        self.assertEqual(intake.public_profile, self.profile)
        self.assertEqual(intake.lead_source, PublicContractorLead.SOURCE_WEBSITE)

        lead = PublicContractorLead.objects.get(email="jordan@example.com")
        self.assertEqual(lead.contractor, self.contractor)
        self.assertEqual(lead.public_profile, self.profile)
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_WEBSITE)
        self.assertEqual(lead.ai_analysis["source_label"], "Website")

        notification = Notification.objects.get(public_lead=lead)
        self.assertEqual(notification.link, "/app/opportunities?source=website")
        self.assertIn("Hey, you got a new lead from your website.", notification.message)
