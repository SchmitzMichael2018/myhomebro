import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import PropertyProfile
from projects.models_diy_planner import DIYProject, DIYProjectAIProposal, DIYProjectPhase, DIYProjectTask
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.services.public_improvement_planner import PREVIEW_MAX_AGE, PREVIEW_TOKEN_MAX_LENGTH
from projects.views.customer_portal import _portal_token


@override_settings(OPENAI_API_KEY="", SECURE_SSL_REDIRECT=False)
class PublicImprovementPlannerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        reviewer = get_user_model().objects.create_user(email="plan-reviewer@example.com", password="not-used")
        cls.template = ProjectTemplate.objects.create(
            name="QA Vanity Refresh", public_slug="qa-vanity-refresh", public_category_slug="bathroom",
            public_summary="Plan a bathroom vanity refresh.", public_intro="Review the existing vanity first.",
            seo_description="Review the scope, materials, and steps for your bathroom vanity refresh.",
            public_reviewed_by=reviewer, public_reviewed_at="2026-10-01T12:00:00Z", is_system=True,
        )
        ProjectTemplateMilestone.objects.create(
            template=cls.template, title="Original guide milestone", description="Do not duplicate this in an AI plan."
        )
        cls.template.public_publication_status = "published"
        cls.template.full_clean()
        cls.template.save()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.email = "preview-owner@example.com"
        self.save_url = f"/api/projects/customer-portal/{_portal_token(self.email)}/diy-projects/"
        self.preview_url = "/api/projects/public/improvements/bathroom/qa-vanity-refresh/plan/"
        self.answers = {
            "title": "Paint the bathroom vanity",
            "desired_outcome": "Paint the existing vanity white and replace the hardware.",
            "existing_conditions": "The retained vanity has a worn finish.",
            "additional_context": "Keep the existing sink and countertop.",
            "confidence_notes": "I can paint but need help choosing a primer.",
        }

    def preview(self):
        response = self.client.post(self.preview_url, self.answers, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def save_preview(self, preview, **extra):
        return self.client.post(self.save_url, {
            "preview_token": preview["preview_token"], "confirm": True, **extra,
        }, format="json")

    def assert_no_plan_saved(self):
        for model in (DIYProject, DIYProjectAIProposal, DIYProjectPhase, DIYProjectTask):
            self.assertEqual(model.objects.count(), 0)

    def test_public_preview_is_advisory_and_does_not_save_any_plan_records(self):
        response = self.client.post(self.preview_url, self.answers, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response.data["inputs"], self.answers)
        self.assertEqual(response.data["source_template_id"], self.template.pk)
        self.assertTrue(response.data["expires_at"])
        self.assertTrue(response.data["preview_token"])
        self.assertTrue(response.data["proposal"]["phases"])
        self.assertTrue(response.data["proposal"]["limitations"])
        self.assert_no_plan_saved()

    def test_missing_title_defaults_to_guide_and_inputs_are_plain_text(self):
        response = self.client.post(self.preview_url, {
            "desired_outcome": "<b>Paint the vanity</b>",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["inputs"]["title"], self.template.name)
        self.assertEqual(response.data["inputs"]["desired_outcome"], "Paint the vanity")

    def test_draft_archived_inactive_and_unknown_guides_cannot_generate(self):
        with patch("projects.views.public_improvements.build_public_plan_preview") as build:
            for publication in ("draft", "archived"):
                ProjectTemplate.objects.filter(pk=self.template.pk).update(public_publication_status=publication)
                self.assertEqual(self.client.post(self.preview_url, self.answers, format="json").status_code, 404)
            ProjectTemplate.objects.filter(pk=self.template.pk).update(public_publication_status="published", is_active=False)
            self.assertEqual(self.client.post(self.preview_url, self.answers, format="json").status_code, 404)
            self.assertEqual(self.client.post(self.preview_url.replace("bathroom", "unknown"), self.answers, format="json").status_code, 404)
            build.assert_not_called()
        self.assert_no_plan_saved()

    def test_input_limits_and_unknown_fields_reject_before_generation(self):
        with patch("projects.views.public_improvements.build_public_plan_preview") as build:
            for field, limit in (("title", 200), ("desired_outcome", 2000), ("existing_conditions", 2000),
                                 ("additional_context", 2000), ("confidence_notes", 1000)):
                with self.subTest(field=field):
                    response = self.client.post(self.preview_url, {**self.answers, field: "x" * (limit + 1)}, format="json")
                    self.assertEqual(response.status_code, 400, response.data)
                    self.assertIn(field, response.data)
            response = self.client.post(self.preview_url, {**self.answers, "owner_email": self.email}, format="json")
            self.assertEqual(response.status_code, 400)
            build.assert_not_called()

    def test_public_preview_is_rate_limited_by_ip(self):
        for _ in range(6):
            self.preview()
        response = self.client.post(self.preview_url, self.answers, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        self.assert_no_plan_saved()

    def test_forwarded_header_changes_cannot_bypass_public_throttle(self):
        for index in range(6):
            response = self.client.post(self.preview_url, self.answers, format="json",
                                        REMOTE_ADDR="192.0.2.10", HTTP_X_FORWARDED_FOR=f"198.51.100.{index}, 192.0.2.10")
            self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(self.preview_url, self.answers, format="json",
                                    REMOTE_ADDR="192.0.2.10", HTTP_X_FORWARDED_FOR="203.0.113.99")
        self.assertEqual(response.status_code, 429)
        response = self.client.post(self.preview_url, self.answers, format="json", REMOTE_ADDR="192.0.2.11")
        self.assertEqual(response.status_code, 200)

    def test_maximum_unicode_answers_emit_a_token_accepted_by_save(self):
        self.answers = {field: "\U0001f600" * limit for field, limit in (
            ("title", 200), ("desired_outcome", 2000), ("existing_conditions", 2000),
            ("additional_context", 2000), ("confidence_notes", 1000),
        )}
        preview = self.preview()
        self.assertLessEqual(len(preview["preview_token"]), PREVIEW_TOKEN_MAX_LENGTH)
        self.assertEqual(self.save_preview(preview).status_code, 201)

    def test_preview_that_still_cannot_fit_returns_recoverable_validation_error(self):
        with patch("projects.services.public_improvement_planner.PREVIEW_TOKEN_MAX_LENGTH", 100):
            response = self.client.post(self.preview_url, self.answers, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Shorten your answers", str(response.data))
        self.assert_no_plan_saved()

    @override_settings(OPENAI_API_KEY="test-only-not-a-real-key")
    def test_provider_failure_and_malformed_output_use_the_existing_fallback(self):
        with patch("openai.OpenAI", side_effect=TimeoutError("private provider failure")):
            preview = self.preview()
        self.assertIn("vanity", str(preview["proposal"]).lower())
        self.assertNotIn("private provider failure", str(preview))
        with patch("openai.OpenAI") as provider:
            provider.return_value.responses.create.return_value.output_text = '{"phases": "invalid"}'
            self.assertTrue(self.preview()["proposal"]["phases"])
        self.assert_no_plan_saved()

    def test_save_requires_valid_portal_before_reading_preview(self):
        preview = self.preview()
        with patch("projects.views.diy_planner.read_public_plan_preview") as read:
            response = self.client.post("/api/projects/customer-portal/invalid/diy-projects/", {
                "preview_token": preview["preview_token"], "confirm": True,
            }, format="json")
        self.assertEqual(response.status_code, 403)
        read.assert_not_called()
        self.assert_no_plan_saved()

    def test_save_requires_confirmation_and_rejects_unreviewed_changes(self):
        preview = self.preview()
        for body in (
            {"preview_token": preview["preview_token"]},
            {"preview_token": preview["preview_token"], "confirm": False},
            {"preview_token": preview["preview_token"], "confirm": True, "title": "Changed without review"},
            {"preview_token": preview["preview_token"], "confirm": True, "phases": []},
        ):
            self.assertEqual(self.client.post(self.save_url, body, format="json").status_code, 400)
        self.assert_no_plan_saved()

    def test_tampered_and_oversized_tokens_are_rejected(self):
        preview = self.preview()
        token = preview["preview_token"]
        prefix, signature = token.rsplit(":", 1)
        preview["preview_token"] = prefix + ":" + ("a" if signature[0] != "a" else "b") + signature[1:]
        response = self.save_preview(preview)
        self.assertEqual(response.status_code, 400)
        self.assertIn("invalid", response.data["detail"])
        preview["preview_token"] = "x" * (PREVIEW_TOKEN_MAX_LENGTH + 1)
        self.assertEqual(self.save_preview(preview).status_code, 400)
        self.assert_no_plan_saved()

    def test_expired_preview_explains_how_to_recover(self):
        preview = self.preview()
        with patch("django.core.signing.time.time", return_value=time.time() + PREVIEW_MAX_AGE + 1):
            response = self.save_preview(preview)
        self.assertEqual(response.status_code, 400)
        self.assertIn("expired", response.data["detail"])
        self.assertIn("Generate a new preview", response.data["detail"])
        self.assert_no_plan_saved()

    def test_guide_unpublished_after_preview_cannot_be_saved(self):
        preview = self.preview()
        ProjectTemplate.objects.filter(pk=self.template.pk).update(public_publication_status="draft")
        self.assertEqual(self.save_preview(preview).status_code, 404)
        self.assert_no_plan_saved()

    def test_confirmed_save_uses_reviewed_tasks_and_preserves_owner_and_provenance(self):
        preview = self.preview()
        response = self.save_preview(preview)
        self.assertEqual(response.status_code, 201, response.data)
        project = DIYProject.objects.get(pk=response.data["id"])
        self.assertEqual(project.owner_email, self.email)
        self.assertEqual(project.source_template_id, self.template.pk)
        for field, value in self.answers.items():
            self.assertEqual(getattr(project, field), value)
        self.assertEqual(project.ai_summary, preview["proposal"]["summary"])
        self.assertEqual(len(response.data["phases"]), len(preview["proposal"]["phases"]))
        self.assertEqual(
            [task["title"] for phase in response.data["phases"] for task in phase["tasks"]],
            [task["title"] for phase in preview["proposal"]["phases"] for task in phase["tasks"]],
        )
        self.assertFalse(project.phases.filter(title="Original guide milestone").exists())
        proposal = project.ai_proposals.get()
        self.assertEqual(proposal.status, "applied")
        self.assertIsNotNone(proposal.applied_at)
        self.assertEqual(proposal.payload, preview["proposal"])
        self.assertTrue(all(task.source == "ai" for task in DIYProjectTask.objects.all()))
        self.assertTrue(all(task.ai_metadata["proposal_id"] == str(proposal.pk) for task in DIYProjectTask.objects.all()))

    def test_repeat_save_returns_same_project_without_reapplying_or_overwriting_edits(self):
        preview = self.preview()
        first = self.save_preview(preview)
        self.assertEqual(first.status_code, 201)
        tasks_before = DIYProjectTask.objects.count()
        DIYProject.objects.filter(pk=first.data["id"]).update(title="Owner edited the saved title")
        second = self.save_preview(preview)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["id"], first.data["id"])
        self.assertEqual(second.data["title"], "Owner edited the saved title")
        self.assertEqual(DIYProject.objects.count(), 1)
        self.assertEqual(DIYProjectAIProposal.objects.count(), 1)
        self.assertEqual(DIYProjectTask.objects.count(), tasks_before)

    def test_other_owner_cannot_read_saved_plan_and_saving_shared_preview_is_isolated(self):
        preview = self.preview()
        first = self.save_preview(preview)
        other_url = f"/api/projects/customer-portal/{_portal_token('another-owner@example.com')}/diy-projects/"
        self.assertEqual(self.client.get(f"{other_url}{first.data['id']}/").status_code, 404)
        second = self.client.post(other_url, {"preview_token": preview["preview_token"], "confirm": True}, format="json")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(second.data["id"], first.data["id"])
        self.assertEqual(DIYProject.objects.get(pk=second.data["id"]).owner_email, "another-owner@example.com")

    def test_property_must_belong_to_saving_owner(self):
        preview = self.preview()
        profile = PropertyProfile.objects.create(customer_email="other-property-owner@example.com", address_line1="123 Test St")
        self.assertEqual(self.save_preview(preview, property_id=profile.pk).status_code, 404)
        self.assert_no_plan_saved()
        profile.customer_email = self.email
        profile.save()
        response = self.save_preview(preview, property_id=profile.pk)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(DIYProject.objects.get().property_profile_id, profile.pk)

    def test_failed_apply_rolls_back_and_retry_can_succeed(self):
        preview = self.preview()
        with patch("projects.services.public_improvement_planner.apply_plan_proposal", side_effect=RuntimeError("test failure")):
            with self.assertRaises(RuntimeError):
                self.save_preview(preview)
        self.assert_no_plan_saved()
        self.assertEqual(self.save_preview(preview).status_code, 201)
        self.assertEqual(DIYProject.objects.count(), 1)

    def test_repeated_provider_keys_and_unbounded_costs_are_normalized_before_preview(self):
        plan = {
            "phases": [{"client_id": "duplicate", "title": title, "tasks": [
                {"client_id": "duplicate", "title": "Prepare", "estimated_cost": "Infinity"},
                {"client_id": "duplicate", "title": "Review", "estimated_cost": "99999999999999"},
            ]} for title in ("First phase", "Second phase")],
        }
        with patch("projects.services.public_improvement_planner.build_plan_proposal", return_value=plan):
            preview = self.preview()
        response = self.save_preview(preview)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(DIYProjectPhase.objects.count(), 2)
        self.assertEqual(DIYProjectTask.objects.count(), 4)
        self.assertTrue(all(task.estimated_cost is None for task in DIYProjectTask.objects.all()))
