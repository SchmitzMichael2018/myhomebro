import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from projects.ai.improvement_editorial import UnsafeEditorialProposal, propose_article_sections


class ImprovementEditorialAITests(SimpleTestCase):
    context = {
        "public_title": "A payment plan",
        "public_audience": "contractor",
        "public_audiences": ["contractor", "homeowner"],
        "public_problem": "Payment expectations are unclear.",
        "public_evidence": "A qualified survey result stays here.",
        "public_evidence_source": "https://example.com/verified-source",
        "public_viewpoint": "Agree on review steps up front.",
    }

    def propose(self, mode, result, section=None):
        provider = Mock()
        provider.responses.create.return_value = SimpleNamespace(output_text=json.dumps(result))
        with patch("projects.ai.improvement_editorial._require_openai_client", return_value=provider), patch(
            "projects.ai.improvement_editorial._model_name", return_value="test-model"
        ):
            proposal = propose_article_sections(mode=mode, section=section, context=self.context)
        sent = json.loads(provider.responses.create.call_args.kwargs["input"][1]["content"])
        self.assertEqual(sent["article_context"]["public_evidence_source"], self.context["public_evidence_source"])
        return proposal

    def test_outline_draft_and_rewrite_only_propose_narrative_sections(self):
        titles = {"article_titles": ["Plan payment together", "Safer project payment"], "seo_titles": ["Home project payment planning", "Payment planning for both sides"]}
        self.assertEqual(self.propose("titles", titles), titles)
        self.assertEqual(self.propose("outline", {"editorial_outline": "- Homeowner risk\n- Contractor risk"}), {"editorial_outline": "- Homeowner risk\n- Contractor risk"})
        draft = {
            "public_summary": "A clear summary.",
            "public_problem": "A clear project problem.",
            "public_viewpoint": "Both roles need documented expectations.",
            "public_practical_steps": "- Agree on steps.",
        }
        self.assertEqual(self.propose("draft", draft), draft)
        self.assertEqual(self.propose("rewrite", {"public_viewpoint": "Agree on a fair review process."}, "public_viewpoint"), {"public_viewpoint": "Agree on a fair review process."})
        with self.assertRaises(ValueError):
            propose_article_sections(mode="rewrite", section="public_evidence", context=self.context)

    def test_can_create_an_empty_viewpoint_for_multiple_audiences(self):
        context = {**self.context, "public_viewpoint": ""}
        provider = Mock()
        provider.responses.create.return_value = SimpleNamespace(
            output_text=json.dumps({"public_viewpoint": "Use a balanced review process for both roles."})
        )
        with patch("projects.ai.improvement_editorial._require_openai_client", return_value=provider):
            result = propose_article_sections(mode="rewrite", section="public_viewpoint", context=context)
        self.assertEqual(result["public_viewpoint"], "Use a balanced review process for both roles.")

    def test_rejects_invented_citations_numbers_and_payment_promises(self):
        for unsafe in (
            "Payment is guaranteed for 56% of contractors.",
            "See https://example.com/invented for proof.",
            "According to a study, every project is safe.",
            "MyHomeBro ensures contractors get paid.",
        ):
            with self.subTest(unsafe=unsafe), self.assertRaises(UnsafeEditorialProposal):
                self.propose("rewrite", {"public_problem": unsafe}, "public_problem")

    def test_allows_process_guidance_about_signing_a_payment_plan(self):
        text = "- Ensure both parties sign the payment plan to formalize the agreement."
        self.assertEqual(self.propose("outline", {"editorial_outline": text}), {"editorial_outline": text})

    def test_rejects_provider_attempt_to_edit_source_or_evidence(self):
        with self.assertRaises(UnsafeEditorialProposal):
            self.propose("rewrite", {"public_evidence_source": "https://example.com/new"}, "public_problem")
