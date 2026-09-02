from django.test import SimpleTestCase

from projects.services.pdf.agreement_pdf import _desc_to_html


class AgreementPdfScopeFormattingTests(SimpleTestCase):
    def test_scope_sections_and_bullets_remain_in_source_order(self):
        scope = (
            "Included Work:\n"
            "- Remove existing fixtures\n"
            "- Install new tile\n"
            "Exclusions:\n"
            "- Structural modifications\n"
            "Customer Responsibilities:\n"
            "- Remove personal items"
        )

        html = _desc_to_html(scope)

        self.assertEqual(
            html,
            "<b>Included Work:</b><br/>"
            "- Remove existing fixtures<br/>"
            "- Install new tile<br/>"
            "<b>Exclusions:</b><br/>"
            "- Structural modifications<br/>"
            "<b>Customer Responsibilities:</b><br/>"
            "- Remove personal items",
        )

    def test_scope_paragraph_breaks_are_preserved(self):
        html = _desc_to_html("First paragraph.\n\nSecond paragraph.")
        self.assertEqual(html, "First paragraph.<br/><br/>Second paragraph.")
