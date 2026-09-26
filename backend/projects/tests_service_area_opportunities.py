from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor, ContractorInvite, ContractorPublicProfile, Skill
from projects.models_contractor_discovery import (
    ContractorOpportunity,
    MarketplaceAutomaticMatchingApproval,
    MarketplaceLocation,
)
from projects.models_customer_portal import CustomerRequest
from projects.models_project_intake import ProjectIntake


class ContractorServiceAreaOpportunitiesTests(TestCase):
    endpoint = "/api/projects/contractor/service-area-opportunities/"

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="demand-contractor@example.com",
            password="test-password",
            is_active=True,
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Demand Roofing",
            city="Austin",
            state="TX",
        )
        roofing, _ = Skill.objects.get_or_create(
            slug="roofing",
            defaults={"name": "Roofing"},
        )
        self.contractor.skills.add(roofing)
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            city="Austin",
            state="TX",
            primary_trade="Roofing",
            service_cities=["Round Rock, TX"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _request(
        self,
        *,
        city="Austin",
        state="TX",
        postal_code="78701",
        trade="Roofing",
        status="submitted",
        traffic="real",
        archived=False,
        suffix="",
    ):
        return ProjectIntake.objects.create(
            initiated_by="homeowner",
            post_submit_flow="multi_contractor",
            status=status,
            traffic_classification=traffic,
            project_city=city,
            project_state=state,
            project_postal_code=postal_code,
            ai_project_type=trade,
            customer_name=f"Private Customer {suffix}",
            customer_email=f"private{suffix}@example.com",
            customer_phone="555-0100",
            project_address_line1="100 Private Lane",
            accomplishment_text="Private request details",
            marketplace_archived_at=timezone.now() if archived else None,
            submitted_at=timezone.now(),
        )

    def test_requires_authentication_and_contractor_role(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.endpoint).status_code, 401)

        homeowner = get_user_model().objects.create_user(
            email="homeowner-only@example.com",
            password="test-password",
        )
        self.client.force_authenticate(homeowner)
        response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "This workspace is unavailable.")

        staff = get_user_model().objects.create_user(
            email="staff-only@example.com", password="test-password", is_staff=True
        )
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get(self.endpoint).status_code, 403)

    def test_legitimate_onboarding_contractor_can_view_without_payment_or_verification(self):
        for index in range(3):
            self._request(suffix=str(index))

        response = self.client.get(self.endpoint)

        self.assertEqual(response.status_code, 200)
        row = response.json()["results"][0]
        self.assertEqual(row["relationship"], "readiness_needed")
        self.assertFalse(row["contractor_readiness"]["approved_verification"])
        self.assertFalse(row["contractor_readiness"]["payment_ready"])
        self.assertEqual(row["recommended_action"]["label"], "Complete verification")

    def test_blocked_account_states_fail_closed_with_generic_response(self):
        cases = [
            ("inactive", {"user__is_active": False}),
            (
                "disabled",
                {
                    "user__verification_state": get_user_model().VerificationState.DISABLED
                },
            ),
            (
                "suspicious_verification",
                {
                    "user__verification_state": get_user_model().VerificationState.SUSPICIOUS
                },
            ),
            (
                "suspicious_trust",
                {
                    "user__trust_classification": get_user_model().TrustClassification.SUSPICIOUS
                },
            ),
            (
                "fraud",
                {
                    "user__trust_classification": get_user_model().TrustClassification.SPAM_FRAUD
                },
            ),
            ("contractor_inactive", {"contractor__is_active": False}),
            (
                "suspended",
                {
                    "contractor__marketplace_verification_status": Contractor.MARKETPLACE_SUSPENDED
                },
            ),
            (
                "rejected",
                {
                    "contractor__marketplace_verification_status": Contractor.MARKETPLACE_REJECTED
                },
            ),
        ]
        for label, changes in cases:
            with self.subTest(label=label):
                self.user.is_active = True
                self.user.verification_state = get_user_model().VerificationState.VERIFIED
                self.user.trust_classification = get_user_model().TrustClassification.NORMAL
                self.user.save(
                    update_fields=[
                        "is_active",
                        "verification_state",
                        "trust_classification",
                    ]
                )
                self.contractor.is_active = True
                self.contractor.marketplace_verification_status = (
                    Contractor.MARKETPLACE_UNVERIFIED
                )
                self.contractor.save(
                    update_fields=["is_active", "marketplace_verification_status"]
                )
                for field, value in changes.items():
                    target, attribute = field.split("__")
                    instance = self.user if target == "user" else self.contractor
                    setattr(instance, attribute, value)
                    instance.save(update_fields=[attribute])
                response = self.client.get(self.endpoint)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(
                    response.json(), {"detail": "This workspace is unavailable."}
                )

    def test_operational_lifecycle_and_single_trade_classification_are_authoritative(self):
        included = self._request(suffix="included")
        self._request(status="draft", suffix="draft")
        self._request(status="converted", suffix="converted")
        self._request(archived=True, suffix="archived")
        self._request(traffic="spam_fraud", suffix="spam")
        cancelled = self._request(suffix="cancelled")
        CustomerRequest.objects.create(
            source_intake=cancelled,
            status=CustomerRequest.STATUS_CANCELLED,
        )
        multi_trade = self._request(trade="Roofing and plumbing", suffix="multi")

        response = self.client.get(self.endpoint)

        self.assertEqual(response.status_code, 200)
        rows = response.json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["trade"], "roofing")
        self.assertEqual(rows[0]["demand_signal"], "Emerging demand")
        self.assertNotEqual(included.id, multi_trade.id)

    def test_privacy_suppression_does_not_serialize_pii_or_exact_small_counts(self):
        for index in range(2):
            self._request(suffix=str(index))

        response = self.client.get(self.endpoint)
        body = response.content.decode()
        row = response.json()["results"][0]

        self.assertIsNone(row["demand_count"])
        self.assertEqual(row["demand_signal"], "Emerging demand")
        self.assertNotIn("newest_demand_at", row)
        for private_value in (
            "Private Customer",
            "@example.com",
            "555-0100",
            "100 Private Lane",
            "Private request details",
            "request_id",
            "intake_id",
        ):
            self.assertNotIn(private_value, body)

        self._request(suffix="third")
        exact = self.client.get(self.endpoint).json()["results"][0]
        self.assertEqual(exact["demand_count"], 3)
        self.assertEqual(exact["demand_signal"], "3")
        self.assertNotIn("newest_demand_at", exact)

    def test_relationship_and_market_readiness_are_location_trade_specific(self):
        self.contractor.marketplace_verification_status = Contractor.MARKETPLACE_VERIFIED
        self.contractor.charges_enabled = True
        self.contractor.payouts_enabled = True
        self.contractor.save(
            update_fields=[
                "marketplace_verification_status",
                "charges_enabled",
                "payouts_enabled",
            ]
        )
        MarketplaceLocation.objects.create(city="Austin", state="TX")
        MarketplaceAutomaticMatchingApproval.objects.create(
            city_key="austin",
            state_key="TX",
            trade="roofing",
            is_approved=True,
        )
        for city, state in (("Austin", "TX"), ("Dallas", "TX"), ("Albany", "NY")):
            for index in range(3):
                self._request(city=city, state=state, suffix=f"{city}-{index}")

        rows = self.client.get(self.endpoint).json()["results"]
        by_area = {row["area"]: row for row in rows}

        self.assertEqual(by_area["Austin, TX 78701"]["relationship"], "in_service_area")
        self.assertEqual(
            by_area["Dallas, TX 78701"]["relationship"], "expansion_opportunity"
        )
        self.assertEqual(
            by_area["Albany, NY 78701"]["relationship"], "outside_current_coverage"
        )
        self.assertTrue(
            by_area["Austin, TX 78701"]["automatic_matching_approval"]
        )
        self.assertFalse(by_area["Austin, TX 78701"]["automatic_matching_available"])
        self.assertFalse(
            by_area["Dallas, TX 78701"]["automatic_matching_approval"]
        )

    def test_filters_sorting_and_pagination_are_server_side_and_stable(self):
        for city_index in range(27):
            for request_index in range(3):
                intake = self._request(
                    city=f"City {city_index:02d}",
                    suffix=f"{city_index}-{request_index}",
                )
                ProjectIntake.objects.filter(pk=intake.pk).update(
                    created_at=timezone.now() - timedelta(days=city_index)
                )

        first = self.client.get(
            self.endpoint,
            {"sort": "area_name", "page_size": 25, "page": 1},
        ).json()
        second = self.client.get(
            self.endpoint,
            {"sort": "area_name", "page_size": 25, "page": 2},
        ).json()
        identities = [
            (row["area"], row["trade"])
            for row in first["results"] + second["results"]
        ]

        self.assertEqual(first["pagination"]["total"], 27)
        self.assertEqual(first["pagination"]["page_count"], 2)
        self.assertEqual(len(first["results"]), 25)
        self.assertEqual(len(second["results"]), 2)
        self.assertEqual(len(identities), len(set(identities)))
        self.assertEqual(identities, sorted(identities))

        filtered = self.client.get(
            self.endpoint,
            {"city": "City 04", "trade": "roofer", "page_size": 100},
        ).json()
        self.assertEqual(filtered["pagination"]["total"], 1)
        self.assertEqual(filtered["results"][0]["area"], "City 04, TX 78701")

        invalid = self.client.get(
            self.endpoint,
            {"page": 999, "page_size": 999},
        ).json()["pagination"]
        self.assertEqual(invalid["page_size"], 25)
        self.assertEqual(invalid["page"], invalid["page_count"])

    def test_zip_drill_down_preserves_privacy_threshold_for_one_and_two(self):
        self._request(postal_code="78701", suffix="one")
        for index in range(2):
            self._request(postal_code="78702", suffix=f"two-{index}")
        for index in range(3):
            self._request(postal_code="78703", suffix=f"three-{index}")

        all_rows = self.client.get(self.endpoint, {"city": "Austin"}).json()
        self.assertEqual(all_rows["pagination"]["total"], 3)
        by_zip = {row["zip"]: row for row in all_rows["results"]}
        self.assertEqual(
            by_zip["78701"]["demand_signal"],
            by_zip["78702"]["demand_signal"],
        )
        self.assertEqual(by_zip["78701"]["demand_signal"], "Emerging demand")
        self.assertIsNone(by_zip["78701"]["demand_count"])
        self.assertIsNone(by_zip["78702"]["demand_count"])
        self.assertEqual(by_zip["78703"]["demand_count"], 3)
        for postal_code in ("78701", "78702", "78703"):
            result = self.client.get(self.endpoint, {"city": postal_code}).json()
            self.assertEqual(result["pagination"]["total"], 1)
            self.assertEqual(result["results"][0]["zip"], postal_code)
        self.assertEqual(
            self.client.get(self.endpoint, {"city": "Austin", "zip": "78702"})
            .json()["pagination"]["total"],
            1,
        )

    def test_responded_request_is_not_open_demand_but_unanswered_request_is(self):
        unanswered = self._request(postal_code="78701", suffix="unanswered")
        responded = self._request(postal_code="78702", suffix="responded")
        ContractorInvite.objects.create(
            homeowner_name="Private Customer",
            homeowner_email=responded.customer_email,
            contractor_email="contractor@example.test",
            source_intake=responded,
            accepted_at=timezone.now(),
        )
        rows = self.client.get(self.endpoint).json()["results"]
        self.assertEqual([row["zip"] for row in rows], ["78701"])
        self.assertTrue(ProjectIntake.objects.filter(pk=unanswered.pk).exists())

    def test_restored_request_uses_lifecycle_start_for_time_window(self):
        intake = self._request(suffix="restored")
        old = timezone.now() - timedelta(days=100)
        ProjectIntake.objects.filter(pk=intake.pk).update(
            created_at=old,
            submitted_at=old,
            marketplace_restored_at=timezone.now(),
        )
        rows = self.client.get(self.endpoint, {"time_window": "30d"}).json()["results"]
        self.assertEqual(len(rows), 1)

    def test_overlapping_time_windows_cannot_reveal_small_count_differences(self):
        recent = [self._request(suffix=f"recent-{index}") for index in range(3)]
        older = self._request(suffix="older")
        old_date = timezone.now() - timedelta(days=50)
        ProjectIntake.objects.filter(pk=older.pk).update(submitted_at=old_date)

        for window in ("all", "30d", "90d", "12m"):
            with self.subTest(window=window):
                row = self.client.get(
                    self.endpoint, {"time_window": window, "sort": "newest_demand"}
                ).json()["results"][0]
                self.assertIsNone(row["demand_count"])
                self.assertEqual(row["demand_signal"], "Established demand")
                self.assertNotIn("newest_demand_at", row)

        # Removing the older request makes every nonempty window identical.
        # Exact counts of three are then safe and useful.
        ProjectIntake.objects.filter(pk=older.pk).update(
            marketplace_archived_at=timezone.now()
        )
        for window in ("all", "30d", "90d", "12m"):
            row = self.client.get(
                self.endpoint, {"time_window": window}
            ).json()["results"][0]
            self.assertEqual(row["demand_count"], 3)
        self.assertEqual(len(recent), 3)

    def test_caller_cannot_select_another_contractor_or_reuse_cached_context(self):
        self._request(suffix="shared")
        other_user = get_user_model().objects.create_user(
            email="other-contractor@example.com", password="test-password"
        )
        other = Contractor.objects.create(
            user=other_user, business_name="Other Roofing", city="Dallas", state="TX"
        )
        roofing = Skill.objects.get(slug="roofing")
        other.skills.add(roofing)
        own = self.client.get(self.endpoint, {"contractor_id": other.pk})
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.json()["results"][0]["relationship"], "readiness_needed")
        self.client.force_authenticate(other_user)
        theirs = self.client.get(self.endpoint, {"contractor_id": self.contractor.pk})
        self.assertEqual(theirs.status_code, 200)
        self.assertEqual(
            theirs.json()["results"][0]["relationship"], "expansion_opportunity"
        )
        self.assertIn("no-cache", own["Cache-Control"])
        self.assertIn("no-cache", theirs["Cache-Control"])

    def test_query_growth_is_bounded_and_request_is_read_only(self):
        for index in range(3):
            self._request(suffix=f"small-{index}")
        with CaptureQueriesContext(connection) as small:
            self.client.get(self.endpoint)

        for city_index in range(10):
            for request_index in range(3):
                self._request(
                    city=f"Bounded {city_index}",
                    suffix=f"large-{city_index}-{request_index}",
                )
        before = {
            "intakes": ProjectIntake.objects.count(),
            "opportunities": ContractorOpportunity.objects.count(),
        }
        with CaptureQueriesContext(connection) as large:
            response = self.client.get(self.endpoint)
        after = {
            "intakes": ProjectIntake.objects.count(),
            "opportunities": ContractorOpportunity.objects.count(),
        }

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(large), len(small) + 2)
        self.assertEqual(after, before)
        self.assertFalse(response.has_header("Cache-Control") is False)
        self.assertIn("no-cache", response["Cache-Control"])
