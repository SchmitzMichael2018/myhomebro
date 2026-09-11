from types import SimpleNamespace

from django.test import SimpleTestCase

from projects.services.pdf.agreement_pdf import agreement_reference_heading


class AgreementPdfHeadingTests(SimpleTestCase):
    def test_original_agreement_heading_does_not_claim_amendment(self):
        agreement = SimpleNamespace(pk=37, amendment_number=0)

        self.assertEqual(agreement_reference_heading(agreement), "Agreement #37")

    def test_amendment_heading_is_prominent_and_numbered(self):
        agreement = SimpleNamespace(pk=37, amendment_number=1)

        self.assertEqual(
            agreement_reference_heading(agreement),
            "Agreement #37 Amendment 1",
        )
