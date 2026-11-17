import io
import json

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from projects.management.commands.prepare_homeowner_guides import CATALOG
from projects.models_templates import ProjectTemplate
from projects.views.public_improvements import PublicImprovementDetailView, PublicImprovementLibraryView, serialize_improvement


class HomeownerGuideDraftTests(TestCase):
    def prepare(self):
        call_command("prepare_homeowner_guides", apply=True, stdout=io.StringIO())

    def test_dry_run_validates_without_creating_records(self):
        output = io.StringIO()
        call_command("prepare_homeowner_guides", stdout=output)
        self.assertEqual(ProjectTemplate.objects.count(), 0)
        self.assertEqual(output.getvalue().count("DRY RUN valid draft:"), 4)

    def test_four_reviewable_drafts_have_safe_diy_plans_and_sources(self):
        self.prepare()
        rows = list(ProjectTemplate.objects.order_by("pk"))
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0].public_category_slug, "bathroom")
        for row in rows:
            with self.subTest(slug=row.public_slug):
                self.assertEqual(row.public_publication_status, "ready_for_review")
                self.assertIsNone(row.public_reviewed_at)
                self.assertIsNone(row.public_reviewed_by_id)
                self.assertIsNone(row.public_published_at)
                self.assertFalse(row.is_published)
                self.assertFalse(row.allow_discovery)
                self.assertEqual(row.milestones.count(), 5)
                source = next(s for s in row.public_sections if s["id"] == "guide-sources")
                self.assertIn("https://www.sa.gov/", source["body"])
                self.assertTrue(any(s["id"] == "diy-readiness" for s in row.public_sections))
                self.assertTrue(any(s["id"] == "hire-scope" for s in row.public_sections))
                self.assertEqual(serialize_improvement(row, detail=True)["milestones"][0]["title"], row.milestones.first().title)
        bath = rows[0]
        self.assertIn("cosmetic", bath.diy_guidance)
        self.assertIn("ground-access", rows[1].diy_guidance.lower())
        self.assertIn("surface", rows[2].safety_guidance)

    def test_repeated_preparation_preserves_human_edits_and_existing_milestones(self):
        self.prepare()
        row = ProjectTemplate.objects.first()
        row.public_intro = "Owner revision that must be preserved."
        row.save()
        first_ids = list(row.milestones.values_list("pk", flat=True))
        self.prepare()
        row.refresh_from_db()
        self.assertEqual(ProjectTemplate.objects.count(), 4)
        self.assertEqual(row.public_intro, "Owner revision that must be preserved.")
        self.assertEqual(list(row.milestones.values_list("pk", flat=True)), first_ids)

    def test_drafts_are_not_exposed_in_public_api(self):
        self.prepare()
        factory = APIRequestFactory()
        response = PublicImprovementLibraryView.as_view()(factory.get("/"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["improvements"], [])
        row = ProjectTemplate.objects.first()
        response = PublicImprovementDetailView.as_view()(
            factory.get("/"), category_slug=row.public_category_slug, improvement_slug=row.public_slug,
        )
        self.assertEqual(response.status_code, 404)

    def test_publication_still_requires_a_recorded_human_review(self):
        self.prepare()
        row = ProjectTemplate.objects.first()
        row.public_publication_status = "published"
        with self.assertRaises(ValidationError) as error:
            row.full_clean()
        self.assertIn("public_reviewed_at", error.exception.message_dict)

    def test_catalog_has_ordered_topics_unique_sections_and_secure_sources(self):
        guides = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.assertEqual([g["category"] for g in guides], ["bathroom", "outdoor", "outdoor", "outdoor"])
        for guide in guides:
            self.assertLessEqual(len(guide["sections"]) + 1, 20)
            self.assertTrue(all(url.startswith("https://") for label, url in guide["sources"]))
            self.assertEqual(len({s[0] for s in guide["sections"]}), len(guide["sections"]))
