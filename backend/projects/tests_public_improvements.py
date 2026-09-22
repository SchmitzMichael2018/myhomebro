import struct
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings

from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.services.attribution import acquisition_report
from projects.views.customer_portal import _portal_token


@override_settings(
    SECURE_SSL_REDIRECT=False,
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    },
)
class PublicImprovementLibraryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.reviewer = get_user_model().objects.create_user(
            email="reviewer@example.com", password="not-used"
        )
        cls.published = cls._template(
            "QA Replace Bathroom Vanity", "qa-replace-bathroom-vanity", "published"
        )
        cls.related = cls._template(
            "QA Replace Bathroom Faucet", "qa-replace-bathroom-faucet", "published"
        )
        cls.published.related_public_templates.add(cls.related)
        cls.draft = cls._template("QA Replace Toilet", "qa-replace-toilet", "draft")
        cls.archived = cls._template(
            "QA Install Shower Door", "qa-install-shower-door", "archived"
        )

    @classmethod
    def _template(cls, name, slug, status):
        template = ProjectTemplate.objects.create(
            name=name,
            is_system=True,
            public_category_slug="bathroom",
            public_slug=slug,
            public_summary=f"Authoritative summary for {name}.",
            public_intro=f"Reviewed introduction for {name}.",
            seo_description=f"Plan {name.lower()} with reviewed MyHomeBro project information.",
            public_publication_status="draft",
            public_reviewed_by=cls.reviewer,
            public_reviewed_at="2026-09-21T12:00:00Z",
        )
        ProjectTemplateMilestone.objects.create(
            template=template, title="Prepare the work area", description="Protect adjacent surfaces."
        )
        template.public_publication_status = status
        template.full_clean()
        template.save()
        return template

    def test_library_category_and_search_only_return_published_content(self):
        library = self.client.get("/api/projects/public/improvements/")
        category = self.client.get("/api/projects/public/improvements/bathroom/")
        search = self.client.get("/api/projects/public/improvements/?q=toilet")

        self.assertEqual(library.status_code, 200)
        self.assertEqual(category.status_code, 200)
        self.assertEqual({row["id"] for row in library.json()["improvements"]}, {self.published.id, self.related.id})
        self.assertEqual(search.json()["improvements"], [])
        self.assertEqual(self.client.get("/api/projects/public/improvements/kitchen/").status_code, 404)

    def test_published_detail_has_related_content_and_private_states_404(self):
        response = self.client.get(
            "/api/projects/public/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["related"][0]["id"], self.related.id)
        self.assertEqual(
            self.client.get("/api/projects/public/improvements/bathroom/qa-replace-toilet/").status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/projects/public/improvements/bathroom/qa-install-shower-door/").status_code,
            404,
        )

    def test_shell_metadata_canonical_and_slug_redirect(self):
        response = self.client.get(
            "/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertContains(response, "QA Replace Bathroom Vanity: DIY &amp; Project Guide | MyHomeBro")
        self.assertContains(
            response,
            'href="https://www.myhomebro.com/improvements/bathroom/qa-replace-bathroom-vanity/"',
        )
        self.assertContains(
            response,
            "https://www.myhomebro.com/static/social/myhomebro-default-1200x630.png",
        )

        self.published.public_slug = "qa-replace-a-bathroom-vanity"
        self.published.save()
        redirect = self.client.get(
            "/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertRedirects(
            redirect,
            "/improvements/bathroom/qa-replace-a-bathroom-vanity/",
            status_code=301,
            fetch_redirect_response=False,
        )

    def test_sitemap_includes_published_category_and_content_only(self):
        body = self.client.get("/sitemap.xml").content.decode()
        self.assertIn("/improvements/", body)
        self.assertIn("/improvements/bathroom/", body)
        self.assertIn("qa-replace-bathroom-vanity", body)
        self.assertNotIn("qa-replace-toilet", body)
        self.assertNotIn("qa-install-shower-door", body)

    def test_publication_validation_and_social_override(self):
        invalid = ProjectTemplate(
            name="Incomplete",
            public_publication_status="published",
            social_image="/media/unapproved.png",
        )
        with self.assertRaises(ValidationError):
            invalid.full_clean()

        self.published.social_image = "/static/social/vanity-1200x630.png"
        self.published.full_clean()
        self.published.save()
        response = self.client.get(
            "/api/projects/public/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertEqual(response.json()["social_image"], "/static/social/vanity-1200x630.png")

    def test_default_social_asset_is_valid_1200_by_630_png(self):
        path = Path(__file__).resolve().parents[1] / "static" / "social" / "myhomebro-default-1200x630.png"
        raw = path.read_bytes()[:24]
        self.assertEqual(raw[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", raw[16:24]), (1200, 630))

    def test_contractor_intake_and_diy_project_preserve_template_identity(self):
        intake = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "customer_name": "Home Owner",
                "customer_email": "owner@example.com",
                "customer_phone": "2105550100",
                "source": "landing_page",
                "template_id": self.published.id,
            },
        )
        self.assertEqual(intake.status_code, 201)
        self.assertEqual(self.published.public_intakes.get().pk, intake.json()["intake_id"])

        token = _portal_token("owner@example.com")
        diy = self.client.post(
            f"/api/projects/customer-portal/{token}/diy-projects/",
            {
                "title": self.published.name,
                "desired_outcome": self.published.public_summary,
                "source_template_id": self.published.id,
            },
        )
        self.assertEqual(diy.status_code, 201)
        self.assertEqual(diy.json()["source_template_id"], self.published.id)
        self.assertEqual(len(diy.json()["phases"]), 1)

    def test_improvement_cta_events_are_reported_by_template_and_category(self):
        for event_type in (
            "improvement_template_view",
            "diy_project_started",
            "hire_pro_clicked",
        ):
            response = self.client.post(
                "/api/projects/attribution/track/",
                {
                    "event_type": event_type,
                    "landing_page": f"/improvements/bathroom/{self.published.public_slug}/",
                    "object_type": "improvement",
                    "object_id": str(self.published.id),
                    "metadata": {"category": "bathroom"},
                },
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 201)

        report = acquisition_report()
        self.assertEqual(
            {row["event_type"] for row in report["by_improvement"]},
            {"improvement_template_view", "diy_project_started", "hire_pro_clicked"},
        )
        self.assertEqual(
            {row["metadata__category"] for row in report["by_improvement_category"]},
            {"bathroom"},
        )
