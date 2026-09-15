from django.contrib.auth import get_user_model
from django.test import TestCase

from projects.models import Contractor
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorOpportunity,
)
from projects.services.team_attention import build_contractor_attention_counts


class ContractorOpportunityAttentionCountTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            email="opportunity-count@example.com",
            password="test-pass",
        )
        self.contractor = Contractor.objects.create(
            user=user,
            business_name="Opportunity Count Contractor",
        )
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Opportunity Count Contractor",
            normalized_name="opportunity count contractor",
            claimed=True,
            claimed_by_contractor=self.contractor,
            services=["flooring"],
        )

    def _create_opportunity(self, *, status=ContractorOpportunity.STATUS_PENDING):
        return ContractorOpportunity.objects.create(
            directory_entry=self.entry,
            homeowner_name="QA Homeowner",
            project_title="Water-Resistant LVP Flooring",
            project_type="Flooring",
            project_subtype="Luxury Vinyl Plank",
            status=status,
        )

    def test_new_opportunity_count_only_includes_pending_opportunities(self):
        first = self._create_opportunity()
        self._create_opportunity()
        self._create_opportunity(status=ContractorOpportunity.STATUS_ACCEPTED)
        self._create_opportunity(status=ContractorOpportunity.STATUS_DECLINED)

        counts = build_contractor_attention_counts(self.contractor)
        self.assertEqual(counts["new_opportunities_count"], 2)

        first.status = ContractorOpportunity.STATUS_ACCEPTED
        first.save(update_fields=["status"])

        refreshed_counts = build_contractor_attention_counts(self.contractor)
        self.assertEqual(refreshed_counts["new_opportunities_count"], 1)

