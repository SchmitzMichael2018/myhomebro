# backend/projects/models_ai_scope.py
from __future__ import annotations

from django.db import models


class AgreementAIScope(models.Model):
    """
    Stores AI scope clarification questions + contractor answers for an Agreement.

    This is persisted so:
    - Step2 can show missing info prompts consistently
    - Final agreement PDF can include these clarifications
    """
    agreement = models.OneToOneField(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="ai_scope",
    )

    # questions returned by AI writer (list of structured dicts)
    questions = models.JSONField(default=list, blank=True)

    # contractor answers keyed by question.key
    answers = models.JSONField(default=dict, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Agreement AI Scope"
        verbose_name_plural = "Agreement AI Scopes"

    def __str__(self) -> str:
        return f"AgreementAIScope(agreement_id={self.agreement_id})"
