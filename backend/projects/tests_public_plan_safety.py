"""Reviewed public guide precautions survive provider omissions and signed save."""

import json
from importlib import import_module
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models_diy_planner import DIYProject
from projects.models_templates import ProjectTemplate
from projects.services.public_improvement_planner import (
    GuideSafetyReferenceError,
    build_public_plan_preview,
    read_public_plan_preview,
)
from projects.views.customer_portal import _portal_token


REMODEL_SAFETY = (
    "Determine applicable permits and licensing before affected work. Before demolition, drilling, or cutting, "
    "assess older painted surfaces, suspected asbestos, moisture damage, unstable floors, and uncertain utilities; "
    "stop disturbance pending appropriate assessment. For scoped rough work, substrates, or waterproofing, "
    "complete applicable inspections and tests and obtain clearance before concealment. Final inspections "
    "do not replace these earlier hold points."
)
FAUCET_SAFETY = (
    "Turn off water and verify isolation before disconnecting supply lines. Do not force corroded connections "
    "or continue if shutoffs do not isolate water. Test every disturbed connection repeatedly for leaks."
)


def guide_template(**overrides):
    return ProjectTemplate(**{
        "pk": 123,
        "name": "Bathroom Remodel Planning",
        "public_title": "Bathroom Remodel Planning",
        "public_category_slug": "bathroom",
        "public_publication_status": "published",
        "is_active": True,
        "public_reviewed_by_id": 1,
        "public_reviewed_at": timezone.now(),
        "safety_guidance": REMODEL_SAFETY,
        "preparation": "Confirm the retained items, scope, dimensions, and affected utilities before work.",
        "pro_guidance": "Seek qualified assessment for work outside your competence or uncertain conditions.",
        **overrides,
    })


def provider_plan(title="Plan bathroom work", **overrides):
    return {
        "summary": "A provider plan that omits the guide's safety precautions.",
        "phases": [{"title": title, "tasks": [{"title": title, "description": "Complete the selected scope."}]}],
        **overrides,
    }


def task_text(plan):
    return "\n".join(task["description"] for phase in plan["phases"] for task in phase["tasks"])


@override_settings(OPENAI_API_KEY="")
class PublicPlanSafetyTests(SimpleTestCase):
    def setUp(self):
        self.template = guide_template()
        self.inputs = {"title": "Bathroom Remodel Planning", "desired_outcome": "Plan bathroom work"}

    def assert_reviewed_safety(self, preview):
        plan = preview["proposal"]
        self.assertEqual(plan["phases"][0]["title"], "Review applicable guide safety checkpoints")
        self.assertIn(REMODEL_SAFETY, task_text(plan))
        self.assertIn("not a code, permit, engineering, or safety determination", plan["limitations"])
        self.assertEqual(read_public_plan_preview(preview["preview_token"])["proposal"], plan)
        self.assertEqual(preview["inputs"], self.inputs)

    @override_settings(OPENAI_API_KEY="test-only-not-a-real-key")
    def test_provider_gets_separate_reviewed_context_and_cannot_omit_saved_safety(self):
        with patch("openai.OpenAI") as provider:
            provider.return_value.responses.create.return_value.output_text = json.dumps(provider_plan())
            preview = build_public_plan_preview(self.template, self.inputs)
        request = provider.return_value.responses.create.call_args.kwargs
        context = json.loads(request["input"][1]["content"])
        self.assertEqual(context["reviewed_guide"]["safety_guidance"], REMODEL_SAFETY)
        self.assertEqual(context["reviewed_guide"]["source_template_id"], self.template.pk)
        self.assertEqual(context["desired_outcome"], self.inputs["desired_outcome"])
        self.assertEqual(context["additional_context"], "")
        self.assertEqual(preview["proposal"]["summary"], provider_plan()["summary"])
        self.assert_reviewed_safety(preview)

    def test_unconfigured_provider_fallback_preserves_reviewed_hold_points(self):
        self.assert_reviewed_safety(build_public_plan_preview(self.template, self.inputs))

    @override_settings(OPENAI_API_KEY="test-only-not-a-real-key")
    def test_failed_provider_fallback_preserves_reviewed_hold_points(self):
        with patch("openai.OpenAI", side_effect=TimeoutError("private failure")):
            preview = build_public_plan_preview(self.template, self.inputs)
        self.assert_reviewed_safety(preview)
        self.assertNotIn("private failure", str(preview))

    def test_validation_fallback_still_preserves_reviewed_hold_points(self):
        with patch("projects.services.public_improvement_planner.build_plan_proposal", return_value={"phases": []}):
            self.assert_reviewed_safety(build_public_plan_preview(self.template, self.inputs))

    def test_overfull_provider_cannot_push_safety_out_of_phase_or_warning_limits(self):
        plan = provider_plan(
            phases=[{"title": f"Provider phase {i}", "tasks": [{"title": "Work"}]} for i in range(20)],
            warnings=[{"message": f"Provider warning {i}"} for i in range(10)],
        )
        with patch("projects.services.public_improvement_planner.build_plan_proposal", return_value=plan):
            preview = build_public_plan_preview(self.template, self.inputs)
        self.assert_reviewed_safety(preview)
        self.assertLessEqual(len(preview["proposal"]["phases"]), 20)
        self.assertLessEqual(len(preview["proposal"]["warnings"]), 10)
        self.assertNotIn("Provider phase", str(preview["proposal"]))

    def test_safety_survives_full_warning_list_and_last_available_phase(self):
        plan = provider_plan(
            phases=[{"title": f"Provider phase {i}", "tasks": [{"title": "Work"}]} for i in range(19)],
            warnings=[{"message": f"Provider warning {i}"} for i in range(10)],
        )
        with patch("projects.services.public_improvement_planner.build_plan_proposal", return_value=plan):
            preview = build_public_plan_preview(self.template, self.inputs)
        self.assert_reviewed_safety(preview)
        self.assertEqual(len(preview["proposal"]["phases"]), 20)
        self.assertEqual(len(preview["proposal"]["warnings"]), 10)
        self.assertEqual([row["message"] for row in preview["proposal"]["warnings"]],
                         [row["message"] for row in plan["warnings"]])
        self.assertEqual(preview["proposal"]["phases"][-1]["title"], "Provider phase 18")

    def test_guide_notice_does_not_displace_tenth_provider_hazard_warning(self):
        warnings = [{"message": f"Provider warning {i}"} for i in range(9)]
        warnings.append({"message": "STOP: TENTH HAZARD HOLD POINT MUST SURVIVE"})
        with patch("projects.services.public_improvement_planner.build_plan_proposal",
                   return_value=provider_plan(warnings=warnings)):
            preview = build_public_plan_preview(self.template, self.inputs)
        self.assert_reviewed_safety(preview)
        self.assertEqual(len(preview["proposal"]["phases"]), 2)
        expected = [row["message"] for row in warnings]
        self.assertEqual([row["message"] for row in preview["proposal"]["warnings"]], expected)
        signed = read_public_plan_preview(preview["preview_token"])["proposal"]
        self.assertEqual([row["message"] for row in signed["warnings"]], expected)

    def test_guide_warning_is_added_when_it_does_not_displace_provider_warnings(self):
        warnings = [{"message": f"Provider warning {i}"} for i in range(9)]
        with patch("projects.services.public_improvement_planner.build_plan_proposal",
                   return_value=provider_plan(warnings=warnings)):
            preview = build_public_plan_preview(self.template, self.inputs)
        preserved = preview["proposal"]["warnings"]
        self.assertEqual(len(preserved), 10)
        self.assertIn("reviewed guide", preserved[0]["message"])
        self.assertEqual([row["message"] for row in preserved[1:]], [row["message"] for row in warnings])

    def test_long_reviewed_safety_is_chunked_without_losing_late_hold_points(self):
        self.template.safety_guidance = ("Confirm conditions relevant to the selected work. " * 70) + REMODEL_SAFETY
        preview = build_public_plan_preview(self.template, self.inputs)
        description = task_text(preview["proposal"])
        self.assertIn("Final inspections do not replace these earlier hold points.", description)
        self.assertGreater(sum("Review guide safety before affected work" in task["title"]
                               for task in preview["proposal"]["phases"][0]["tasks"]), 1)
        self.assertTrue(all(len(task["description"]) <= 2000
                            for task in preview["proposal"]["phases"][0]["tasks"]))
        self.assertEqual(read_public_plan_preview(preview["preview_token"])["proposal"], preview["proposal"])

    def test_oversized_guide_fails_before_provider_instead_of_truncating_safety(self):
        self.template.safety_guidance = "Review this condition before work. " * 1000
        with patch("projects.services.public_improvement_planner.build_plan_proposal") as build:
            with self.assertRaises(GuideSafetyReferenceError):
                build_public_plan_preview(self.template, self.inputs)
        build.assert_not_called()

    def test_sparse_scope_keeps_reviews_without_inventing_guide_trades(self):
        # Guide preparation includes many items, but it must not feed work-item detection.
        self.template.preparation = "Review vanity, countertop, flooring, and plumbing only if selected in scope."
        preview = build_public_plan_preview(self.template, self.inputs)
        self.assert_reviewed_safety(preview)
        generated_titles = [task["title"] for phase in preview["proposal"]["phases"][1:] for task in phase["tasks"]]
        self.assertNotIn("Prepare and finish the cabinetry", generated_titles)
        self.assertNotIn("Prepare the substrate and install the flooring", generated_titles)
        self.assertNotIn("Install fixtures and verify plumbing connections", generated_titles)
        self.assertTrue(preview["proposal"]["questions"])

    def test_faucet_scope_keeps_shutoff_compatibility_and_leak_checks_without_renovation_tasks(self):
        template = guide_template(
            name="Replace Bathroom Faucet", public_title="Replace Bathroom Faucet", safety_guidance=FAUCET_SAFETY,
            preparation="Confirm faucet, sink holes, supply connection compatibility, and serviceable shutoffs.",
            pro_guidance="Stop and seek qualified plumbing help for unreliable valves, damaged piping, or persistent leaks.",
        )
        preview = build_public_plan_preview(template, {
            "title": "Replace Bathroom Faucet", "desired_outcome": "Replace bathroom faucet only.",
        })
        plan = preview["proposal"]
        self.assertIn(FAUCET_SAFETY, task_text(plan))
        self.assertIn("compatibility", task_text(plan))
        self.assertIn("permits, licensing", task_text(plan))
        titles = " ".join(task["title"] for phase in plan["phases"] for task in phase["tasks"]).lower()
        for unrelated in ("demolition", "waterproofing", "ventilation", "cabinetry", "flooring"):
            self.assertNotIn(unrelated, titles)

    def test_refined_bathroom_guidance_retains_all_published_safety_references(self):
        refined = import_module("projects.migrations.0334_refine_bathroom_planning_draft").REFINED_FIELDS
        template = guide_template(**refined)
        preview = build_public_plan_preview(template, self.inputs)
        saved_text = task_text(read_public_plan_preview(preview["preview_token"])["proposal"])
        for field in ("safety_guidance", "preparation", "pro_guidance"):
            self.assertIn(refined[field], saved_text)
        for checkpoint in ("before covering", "before 1978", "Do not disturb suspected asbestos", "licensing"):
            self.assertIn(checkpoint, saved_text)

    def test_unreviewed_or_nonpublic_source_is_not_labeled_as_reviewed_safety(self):
        for change in ({"public_reviewed_at": None}, {"public_reviewed_by_id": None},
                       {"public_publication_status": "draft"}, {"is_active": False}):
            with self.subTest(change=change):
                preview = build_public_plan_preview(guide_template(**change), self.inputs)
                self.assertNotIn(REMODEL_SAFETY, task_text(preview["proposal"]))


@override_settings(OPENAI_API_KEY="", SECURE_SSL_REDIRECT=False)
class PublicPlanSafetySaveTests(TestCase):
    def test_confirmed_save_retains_the_exact_preview_safety_after_source_changes(self):
        reviewer = get_user_model().objects.create_user(email="safety-reviewer@example.com", password="not-used")
        template = ProjectTemplate.objects.create(
            name="Safety guide", public_slug="safety-guide", public_category_slug="bathroom", is_system=True,
            public_publication_status="published", public_reviewed_by=reviewer, public_reviewed_at=timezone.now(),
            safety_guidance=REMODEL_SAFETY,
        )
        inputs = {"title": "Bathroom plan", "desired_outcome": "Plan bathroom work"}
        with patch("projects.services.public_improvement_planner.build_plan_proposal", return_value=provider_plan()):
            preview = build_public_plan_preview(template, inputs)
        self.assertEqual(DIYProject.objects.count(), 0)
        ProjectTemplate.objects.filter(pk=template.pk).update(safety_guidance="Later editorial revision.")
        url = f"/api/projects/customer-portal/{_portal_token('safety-owner@example.com')}/diy-projects/"
        response = APIClient().post(url, {"preview_token": preview["preview_token"], "confirm": True}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        project = DIYProject.objects.get(pk=response.data["id"])
        self.assertEqual(project.ai_proposals.get().payload, preview["proposal"])
        self.assertIn(REMODEL_SAFETY, "\n".join(task.description for phase in project.phases.all() for task in phase.tasks.all()))
        self.assertEqual(project.desired_outcome, inputs["desired_outcome"])
        self.assertEqual(project.additional_context, "")

    def test_guide_reference_error_does_not_tell_user_to_shorten_their_answers(self):
        ProjectTemplate.objects.create(
            name="Oversized guide", public_slug="oversized-guide", public_category_slug="bathroom",
            public_publication_status="published", is_system=True,
        )
        with patch("projects.views.public_improvements.build_public_plan_preview", side_effect=GuideSafetyReferenceError):
            response = APIClient().post("/api/projects/public/improvements/bathroom/oversized-guide/plan/", {
                "desired_outcome": "Plan bathroom work",
            }, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("guide", str(response.data).lower())
        self.assertNotIn("Shorten your answers", str(response.data))
