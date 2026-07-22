from unittest.mock import patch

from django.test import SimpleTestCase

from projects.services.ai_orchestrator import (
    MARKETING_NAVIGATION_TARGETS,
    _normalize_orchestrator_context,
    orchestrate_user_request,
)


def marketing_context(step="brand"):
    return {
        "schema_version": 1,
        "workspace": "marketing",
        "workspace_mode": "marketing",
        "active_step": step,
        "active_step_label": "Brand Kit",
        "context_revision": f"marketing:{step}:draft",
        "agreement_id": 99,
        "agreement_summary": {"project_type": "roofing"},
        "website": {"status": "draft", "is_published": False},
        "readiness": {"required_blockers": [], "recommendations": [{"title": "Add public portfolio work"}]},
        "supported_actions": ["navigate_marketing_step"],
        "prohibited_actions": ["publish_website"],
        "navigation_targets": MARKETING_NAVIGATION_TARGETS,
        "current_route": f"/app/marketing?tab={step}",
    }


class MarketingAssistantBoundaryTests(SimpleTestCase):
    def test_marketing_fields_survive_and_unrelated_entities_are_discarded(self):
        context = _normalize_orchestrator_context(marketing_context())
        self.assertEqual(context["workspace"], "marketing")
        self.assertEqual(context["active_step"], "brand")
        self.assertEqual(context["context_revision"], "marketing:brand:draft")
        self.assertIsNone(context["agreement_id"])
        self.assertEqual(context["agreement_summary"], {})
        self.assertIn("publish_website", context["prohibited_actions"])

    @patch("projects.services.ai_orchestrator.get_next_best_action")
    def test_generic_marketing_prompt_does_not_call_cross_workspace_next_action(self, next_action):
        result = orchestrate_user_request(
            contractor=None,
            payload={"input": "What should I do next?", "context": marketing_context()},
        )
        next_action.assert_not_called()
        self.assertEqual(result["source_metadata"]["fallback_to_planner"], False)
        self.assertTrue(result["navigation_target"].startswith("/app/marketing?tab="))
        self.assertNotIn("agreement", result["summary"].lower())

    def test_final_review_never_returns_publish_or_bypass_mutation(self):
        context = marketing_context("final")
        context["readiness"] = {"required_blockers": ["Add a search description"], "recommendations": []}
        result = orchestrate_user_request(contractor=None, payload={"input": "Publish anyway", "context": context})
        self.assertNotEqual(result["next_action"]["action_key"], "publish_website")
        self.assertTrue(result["navigation_target"].startswith("/app/marketing?tab="))
        self.assertIn("cannot publish or bypass", " ".join(result["suggestions"]).lower())

    def test_publish_step_returns_guidance_not_publication_mutation(self):
        result = orchestrate_user_request(
            contractor=None,
            payload={"input": "Publish my site", "context": marketing_context("publish")},
        )
        self.assertEqual(result["next_action"]["type"], "navigate")
        self.assertNotEqual(result["next_action"]["action_key"], "publish_website")
        self.assertEqual(result["navigation_target"], MARKETING_NAVIGATION_TARGETS["publish"])

    def test_invalid_marketing_navigation_map_is_replaced_by_allowlist(self):
        context = marketing_context()
        context["navigation_targets"] = {"brand": "/app/agreements"}
        normalized = _normalize_orchestrator_context(context)
        self.assertEqual(normalized["navigation_targets"], MARKETING_NAVIGATION_TARGETS)
