from types import SimpleNamespace

from django.test import SimpleTestCase

from projects.services.agreement_readiness import agreement_readiness
from projects.services.legal_clauses import build_legal_notices


class _Rows(list):
    def order_by(self, *_args):
        return self


class _MilestoneManager:
    def __init__(self, rows):
        self.rows = _Rows(rows)

    def all(self):
        return self.rows


def _agreement(**overrides):
    values = {
        "description": "Remove existing finishes and install the specified bathroom materials.",
        "warranty_type": "default",
        "warranty_text_snapshot": "One-year workmanship warranty from substantial completion.",
        "milestones": _MilestoneManager([
            SimpleNamespace(pk=1, title="Demolition", description="Listed finishes removed and debris cleared.", amount="500.00")
        ]),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class AgreementReadinessTests(SimpleTestCase):
    def test_complete_agreement_is_ready(self):
        self.assertEqual(agreement_readiness(_agreement()), {"ready": True, "blockers": []})

    def test_scope_outcome_and_warranty_are_required_when_applicable(self):
        result = agreement_readiness(_agreement(
            description="",
            warranty_type="custom",
            warranty_text_snapshot="",
            milestones=_MilestoneManager([
                SimpleNamespace(pk=1, title="Demolition", description="", amount="500.00")
            ]),
        ))
        self.assertFalse(result["ready"])
        self.assertEqual(
            {row["key"] for row in result["blockers"]},
            {"scope", "milestone_outcomes", "warranty"},
        )

    def test_explicit_no_warranty_is_a_valid_decision(self):
        result = agreement_readiness(_agreement(warranty_type="none", warranty_text_snapshot=""))
        self.assertTrue(result["ready"])

    def test_legal_copy_matches_non_binding_resolution_workflow(self):
        clauses = dict(build_legal_notices(project_state="TX", payment_mode="escrow"))
        self.assertIn("non-binding resolution options", clauses["Dispute Resolution"])
        self.assertIn("timely dispute blocks release", clauses["Payment & Escrow"])
        self.assertNotIn("binding arbitration", clauses["Dispute Resolution"])
        self.assertNotIn("Photo Authorization (Optional)", clauses)
