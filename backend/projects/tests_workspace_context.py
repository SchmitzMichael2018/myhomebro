from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import resolve
from rest_framework.test import APIClient

from projects.models import Contractor, ContractorWorkspaceContext
from projects.services.workspace_context import normalize_project_family
from projects.views.workspace_context import WorkspaceContextView


class WorkspaceContextApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Test Contractor",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.path = "/api/projects/workspace-context/"

    def test_route_maps_to_workspace_context_view(self):
        match = resolve(self.path)
        self.assertIs(getattr(match.func, "cls", None), WorkspaceContextView)

    def test_get_returns_blank_context_when_unset(self):
        response = self.client.get(self.path)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data,
            {
                "project_family": {"key": "", "label": ""},
                "source": "server",
                "updated_at": None,
            },
        )

    def test_patch_persists_valid_project_family(self):
        response = self.client.patch(
            self.path,
            {
                "project_family": {
                    "key": "roofing",
                    "label": "Roofing",
                }
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["project_family"],
            normalize_project_family({"key": "roofing", "label": "Roofing"}),
        )
        self.assertEqual(response.data["source"], "server")
        self.assertTrue(response.data["updated_at"])

        context = ContractorWorkspaceContext.objects.get(contractor=self.contractor)
        self.assertEqual(context.default_project_family_key, "roofing")
        self.assertEqual(context.default_project_family_label, "Roofing")
        self.assertTrue(context.context_updated_at)

    def test_patch_clears_invalid_or_stale_project_family(self):
        ContractorWorkspaceContext.objects.create(
            contractor=self.contractor,
            default_project_family_key="roofing",
            default_project_family_label="Roofing",
        )

        response = self.client.patch(
            self.path,
            {
                "project_family": {
                    "key": "stale-family",
                    "label": "Stale Family",
                }
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["project_family"], {"key": "", "label": ""})

        context = ContractorWorkspaceContext.objects.get(contractor=self.contractor)
        self.assertEqual(context.default_project_family_key, "")
        self.assertEqual(context.default_project_family_label, "")
        self.assertTrue(context.context_updated_at)
