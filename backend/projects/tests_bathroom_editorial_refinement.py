"""Regression coverage for the non-publishing bathroom draft refinement."""

from copy import deepcopy
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone


refinement = import_module("projects.migrations.0334_refine_bathroom_planning_draft")


class BathroomEditorialRefinementTests(TestCase):
    def setUp(self):
        # Keep these focused tests independent of historical data migrations.
        # A migration-backed run can also contain the actual canonical seed.
        ProjectTemplate.objects.filter(public_slug=refinement.ORIGINAL["slug"]).delete()
        self.template = ProjectTemplate.objects.create(
            name="Bathroom Remodel",
            is_system=True,
            is_published=True,
            benchmark_match_key=refinement.ORIGINAL["key"],
            public_slug=refinement.ORIGINAL["slug"],
            public_category_slug="bathroom",
            public_publication_status="ready_for_review",
            **deepcopy(refinement.BASELINE_FIELDS),
        )
        for title, description, normalized_type, order in refinement.ORIGINAL["milestones"]:
            ProjectTemplateMilestone.objects.create(
                template=self.template,
                title=title,
                description=description,
                normalized_milestone_type=normalized_type,
                sort_order=order,
            )

    def run_refinement(self):
        refinement.refine_unedited_draft(apps, SimpleNamespace(connection=connection))
        self.template.refresh_from_db()

    def snapshot(self):
        return (
            ProjectTemplate.objects.filter(pk=self.template.pk).values().get(),
            list(self.template.milestones.order_by("pk").values()),
        )

    def test_refines_untouched_draft_without_review_publication_or_identity_changes(self):
        milestone_ids = list(self.template.milestones.values_list("pk", flat=True))
        milestone = self.template.milestones.first()
        milestone.suggested_amount_fixed = 275
        milestone.save(update_fields=["suggested_amount_fixed"])
        before_state = (
            self.template.public_publication_status,
            self.template.public_reviewed_at,
            self.template.public_reviewed_by_id,
            self.template.public_published_at,
            self.template.is_published,
            self.template.estimated_days,
        )

        self.run_refinement()

        self.assertEqual(self.template.public_intro, refinement.REFINED_FIELDS["public_intro"])
        self.assertIsNone(self.template.estimated_duration_min_days)
        self.assertIsNone(self.template.estimated_duration_max_days)
        self.assertEqual(before_state, (
            self.template.public_publication_status,
            self.template.public_reviewed_at,
            self.template.public_reviewed_by_id,
            self.template.public_published_at,
            self.template.is_published,
            self.template.estimated_days,
        ))
        self.assertEqual(milestone_ids, list(self.template.milestones.values_list("pk", flat=True)))
        milestone.refresh_from_db()
        self.assertEqual(milestone.suggested_amount_fixed, 275)
        rough = self.template.milestones.get(sort_order=5)
        self.assertIn("before covering", rough.description)
        self.assertIn("Where wet-area work is included", rough.description)
        self.assertIn("before 1978", self.template.safety_guidance)
        self.template.full_clean()

    def test_preserves_draft_status_and_repeated_runs_are_noops(self):
        self.template.public_publication_status = "draft"
        self.template.save(update_fields=["public_publication_status"])
        self.run_refinement()
        self.assertEqual(self.template.public_publication_status, "draft")
        first = self.snapshot()
        self.run_refinement()
        self.assertEqual(first, self.snapshot())

    def test_never_changes_reviewed_published_or_archived_records(self):
        reviewer = get_user_model().objects.create_user(email="editorial-reviewer@example.com")
        for changes in (
            {"public_reviewed_at": timezone.now()},
            {"public_reviewed_by_id": reviewer.pk},
            {"public_published_at": timezone.now()},
            {"public_publication_status": "published"},
            {"public_publication_status": "archived"},
        ):
            with self.subTest(changes=list(changes)):
                ProjectTemplate.objects.filter(pk=self.template.pk).update(**changes)
                before = self.snapshot()
                self.run_refinement()
                self.assertEqual(before, self.snapshot())
                ProjectTemplate.objects.filter(pk=self.template.pk).update(
                    public_reviewed_at=None, public_reviewed_by_id=None,
                    public_published_at=None, public_publication_status="ready_for_review",
                )

    def test_staff_edits_to_any_protected_content_skip_the_entire_refinement(self):
        for changes in (
            {"safety_guidance": "A staff-reviewed safety draft in progress."},
            {"public_sections": [{"id": "staff-note", "title": "Existing note", "body": "Keep this."}]},
            {"public_faqs": [{"question": "Staff question?", "answer": "Keep this answer."}]},
            {"public_editorial_brief": {"idea": "A different editorial direction."}},
            {"estimated_duration_min_days": None},
            {"public_title": "A staff-selected title"},
            {"public_audiences": ["homeowner", "property_manager"]},
            {"social_image": "/static/social/staff-selected.png"},
        ):
            with self.subTest(changes=list(changes)):
                ProjectTemplate.objects.filter(pk=self.template.pk).update(**changes)
                before = self.snapshot()
                self.run_refinement()
                self.assertEqual(before, self.snapshot())
                ProjectTemplate.objects.filter(pk=self.template.pk).update(
                    **{field: deepcopy(refinement.BASELINE_FIELDS[field]) for field in changes}
                )

    def test_changed_or_additional_milestones_skip_the_entire_refinement(self):
        row = self.template.milestones.first()
        original = row.description
        row.description = "Staff changed this step."
        row.save(update_fields=["description"])
        before = self.snapshot()
        self.run_refinement()
        self.assertEqual(before, self.snapshot())
        row.description = original
        row.save(update_fields=["description"])
        self.template.milestones.create(title="Staff-added task", sort_order=8)
        before = self.snapshot()
        self.run_refinement()
        self.assertEqual(before, self.snapshot())

    def test_noncanonical_or_non_system_record_is_untouched(self):
        for changes in (
            {"benchmark_match_key": "staff:bathroom_remodel"},
            {"public_category_slug": "other"},
            {"public_slug": "custom-bathroom-plan"},
            {"is_system": False},
        ):
            with self.subTest(changes=list(changes)):
                original = ProjectTemplate.objects.filter(pk=self.template.pk).values(*changes).get()
                ProjectTemplate.objects.filter(pk=self.template.pk).update(**changes)
                before = self.snapshot()
                self.run_refinement()
                self.assertEqual(before, self.snapshot())
                ProjectTemplate.objects.filter(pk=self.template.pk).update(**original)
