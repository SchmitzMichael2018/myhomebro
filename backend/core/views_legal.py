# backend/core/views_legal.py

from django.views.generic import TemplateView


class TermsOfServiceView(TemplateView):
    """
    Simple HTML Terms of Service page.
    Renders templates/legal/terms_of_service.html
    """
    template_name = "legal/terms_of_service.html"


class PrivacyPolicyView(TemplateView):
    """
    Simple HTML Privacy Policy page.
    Renders templates/legal/privacy_policy.html
    """
    template_name = "legal/privacy_policy.html"
