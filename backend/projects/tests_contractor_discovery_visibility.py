from django.contrib.auth import get_user_model
from django.test import TestCase

from projects.models import Contractor, ContractorPublicProfile
from projects.services.contractor_discovery import _iter_contractors_for_public_profiles


class ContractorDiscoveryVisibilityTests(TestCase):
    def _contractor_with_public_profile(self, *, email, business_name, is_active):
        user = get_user_model().objects.create_user(email=email, password="testpass123")
        contractor = Contractor.objects.create(
            user=user,
            business_name=business_name,
            is_active=is_active,
        )
        ContractorPublicProfile.objects.create(
            contractor=contractor,
            business_name_public=business_name,
            is_public=True,
        )
        return contractor

    def test_deactivated_contractor_is_not_discoverable(self):
        active = self._contractor_with_public_profile(
            email="active-discovery@example.com",
            business_name="Active Discovery Contractor",
            is_active=True,
        )
        inactive = self._contractor_with_public_profile(
            email="inactive-discovery@example.com",
            business_name="Inactive QA Contractor",
            is_active=False,
        )

        contractor_ids = {
            contractor.id for contractor, _profile in _iter_contractors_for_public_profiles()
        }

        self.assertIn(active.id, contractor_ids)
        self.assertNotIn(inactive.id, contractor_ids)
