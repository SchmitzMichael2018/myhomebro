from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from projects.models_attribution import AttributionEvent
from projects.models_templates import ProjectTemplate
from projects.views.customer_portal import _portal_token


TARGETS = {
    "remodel:bathroom_remodel": {
        "title": "Bathroom Remodel Planning",
        "slug": "bathroom-remodel-planning",
        "difficulty": "advanced",
    },
    "bathroom:replace_vanity": {
        "title": "Replace Bathroom Vanity",
        "slug": "replace-bathroom-vanity",
        "difficulty": "intermediate",
    },
    "bathroom:replace_faucet": {
        "title": "Replace Bathroom Faucet",
        "slug": "replace-bathroom-faucet",
        "difficulty": "intermediate",
    },
    "bathroom:replace_toilet": {
        "title": "Replace Toilet",
        "slug": "replace-toilet",
        "difficulty": "intermediate",
    },
    "bathroom:install_shower_door": {
        "title": "Install Shower Door",
        "slug": "install-shower-door",
        "difficulty": "advanced",
    },
}


@override_settings(
    SECURE_SSL_REDIRECT=False,
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    },
)
class BathroomImprovementLaunchTests(TestCase):
    def templates(self):
        return ProjectTemplate.objects.filter(benchmark_match_key__in=TARGETS)

    def test_five_canonical_templates_are_complete_and_ready_for_review(self):
        templates = {row.benchmark_match_key: row for row in self.templates()}
        self.assertEqual(set(templates), set(TARGETS))
        self.assertEqual(len({row.public_slug for row in templates.values()}), 5)

        for key, expected in TARGETS.items():
            template = templates[key]
            self.assertTrue(template.is_system)
            self.assertEqual(template.public_title, expected["title"])
            self.assertEqual(template.public_category_slug, "bathroom")
            self.assertEqual(template.public_slug, expected["slug"])
            self.assertEqual(template.difficulty, expected["difficulty"])
            self.assertEqual(template.public_publication_status, "ready_for_review")
            self.assertIsNone(template.public_reviewed_at)
            self.assertIsNone(template.public_reviewed_by_id)
            self.assertIsNone(template.public_published_at)
            self.assertTrue(template.public_summary)
            self.assertTrue(template.public_intro)
            self.assertTrue(template.default_scope)
            self.assertTrue(template.project_materials_hint)
            self.assertTrue(template.tools_guidance)
            self.assertTrue(template.preparation)
            self.assertTrue(template.safety_guidance)
            self.assertTrue(template.cost_guidance)
            self.assertTrue(template.common_mistakes)
            self.assertTrue(template.diy_guidance)
            self.assertTrue(template.pro_guidance)
            self.assertGreaterEqual(len(template.public_faqs), 4)
            self.assertGreaterEqual(template.milestones.count(), 4)
            template.full_clean()

    def test_relationships_make_remodel_the_hub_and_connect_vanity_faucet(self):
        templates = {row.benchmark_match_key: row for row in self.templates()}
        hub_related = set(
            templates["remodel:bathroom_remodel"].related_public_templates.values_list(
                "benchmark_match_key", flat=True
            )
        )
        self.assertEqual(hub_related, set(TARGETS) - {"remodel:bathroom_remodel"})
        vanity_related = set(
            templates["bathroom:replace_vanity"].related_public_templates.values_list(
                "benchmark_match_key", flat=True
            )
        )
        self.assertIn("bathroom:replace_faucet", vanity_related)
        self.assertIn("remodel:bathroom_remodel", vanity_related)

    def test_review_queue_content_is_not_public_or_indexable(self):
        library = self.client.get("/api/projects/public/improvements/")
        sitemap = self.client.get("/sitemap.xml").content.decode()

        self.assertEqual(library.status_code, 200)
        ids = {row["id"] for row in library.json()["improvements"]}
        for template in self.templates():
            self.assertNotIn(template.id, ids)
            self.assertNotIn(template.public_slug, sitemap)
            self.assertEqual(
                self.client.get(
                    f"/api/projects/public/improvements/bathroom/{template.public_slug}/"
                ).status_code,
                404,
            )
            self.assertEqual(
                self.client.get(
                    f"/improvements/bathroom/{template.public_slug}/"
                ).status_code,
                404,
            )

    def test_templates_pass_conversion_and_attribution_contract_after_review(self):
        reviewer = get_user_model().objects.create_user(
            email="bathroom-reviewer@example.com", password="not-used"
        )
        token = _portal_token("bathroom-owner@example.com")

        for template in self.templates().order_by("id"):
            template.public_reviewed_by = reviewer
            template.public_reviewed_at = timezone.now()
            template.public_publication_status = "published"
            template.full_clean()
            template.save()

            detail = self.client.get(
                f"/api/projects/public/improvements/bathroom/{template.public_slug}/"
            )
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["id"], template.id)
            self.assertEqual(detail.json()["title"], template.public_title)
            self.assertEqual(detail.json()["tools_guidance"], template.tools_guidance)

            diy = self.client.post(
                f"/api/projects/customer-portal/{token}/diy-projects/",
                {
                    "title": template.public_title,
                    "desired_outcome": template.public_summary,
                    "source_template_id": template.id,
                },
            )
            self.assertEqual(diy.status_code, 201)
            self.assertEqual(diy.json()["source_template_id"], template.id)
            self.assertEqual(len(diy.json()["phases"]), template.milestones.count())

            intake = self.client.post(
                "/api/projects/public-intake/start/",
                {
                    "customer_name": "Bathroom Owner",
                    "customer_email": "bathroom-owner@example.com",
                    "customer_phone": "2105550100",
                    "source": "improvement_library",
                    "template_id": template.id,
                },
            )
            self.assertEqual(intake.status_code, 201)
            self.assertTrue(template.public_intakes.filter(pk=intake.json()["intake_id"]).exists())

            event = self.client.post(
                "/api/projects/attribution/track/",
                {
                    "event_type": "improvement_template_view",
                    "landing_page": f"/improvements/bathroom/{template.public_slug}/",
                    "object_type": "improvement",
                    "object_id": str(template.id),
                    "metadata": {"category": "bathroom"},
                },
                content_type="application/json",
            )
            self.assertEqual(event.status_code, 201)

        self.assertEqual(
            set(
                AttributionEvent.objects.filter(
                    event_type="improvement_template_view",
                    object_type="improvement",
                ).values_list("object_id", flat=True)
            ),
            {str(template.id) for template in self.templates()},
        )
