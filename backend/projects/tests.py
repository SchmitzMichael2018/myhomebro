from __future__ import annotations

import inspect
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import resolve
from rest_framework.test import APIClient

from projects.api.ai_agreement_views import ai_suggest_milestones
from projects.models import Agreement, Contractor, Homeowner, Project


class AgreementMilestoneAIRouteTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="contractor_ai_owner",
            email="contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Test Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Homeowner Test",
            email="homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Agreement AI Test Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Test agreement",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_ai_suggest_milestones_route_and_contract(self):
        path = f"/api/projects/agreements/{self.agreement.id}/ai/suggest-milestones/"
        match = resolve(path)
        self.assertIs(inspect.unwrap(match.func), ai_suggest_milestones)

        with override_settings(AI_ENABLED=True):
            with patch(
                "projects.api.ai_agreement_views.consume_agreement_bundle_credit_if_needed",
                return_value={
                    "charged": True,
                    "ai_credits": {
                        "free_total": 5,
                        "free_used": 1,
                        "free_remaining": 4,
                    },
                },
            ) as mock_consume:
                with patch(
                    "projects.api.ai_agreement_views.suggest_scope_and_milestones",
                    return_value={
                        "scope_text": "Scope from AI",
                        "milestones": [{"title": "Milestone 1", "amount": "100.00"}],
                        "questions": [{"key": "permits_responsibility", "label": "Who handles permits?"}],
                        "_model": "test-model",
                    },
                ) as mock_suggest:
                    response = self.client.post(path, {"notes": "Please suggest milestones"}, format="json")

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["scope_text"], "Scope from AI")
        self.assertIsInstance(data["milestones"], list)
        self.assertIsInstance(data["questions"], list)
        self.assertEqual(data["charged_now"], True)
        self.assertEqual(data["remaining_credits"], 4)
        self.assertEqual(
            data["ai_credits"],
            {
                "free_total": 5,
                "free_used": 1,
                "free_remaining": 4,
                "enabled": True,
            },
        )

        mock_consume.assert_called_once_with(
            contractor=self.contractor,
            agreement_id=self.agreement.id,
        )
        mock_suggest.assert_called_once_with(agreement=self.agreement, notes="Please suggest milestones")
