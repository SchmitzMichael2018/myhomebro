from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, local
from types import SimpleNamespace
from unittest.mock import patch

from django.db import OperationalError, close_old_connections, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from projects.models_public_planning import PublicImprovementPlanSlot
from projects.services import public_plan_admission as admission
from projects.views.public_improvements import PublicImprovementPlanThrottle, PublicImprovementPlanView


@override_settings(OPENAI_API_KEY="", SECURE_SSL_REDIRECT=False)
class PublicPlanAdmissionTests(TransactionTestCase):
    """Real shared database races, using a separate connection in each worker."""

    peer = "192.0.2.87"

    def setUp(self):
        self.now = timezone.now()
        self.clock = patch("projects.services.public_plan_admission.timezone.now", return_value=self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def throttle(self, peer=None):
        request = SimpleNamespace(META={"REMOTE_ADDR": peer or self.peer})
        throttle = PublicImprovementPlanThrottle()
        accepted = throttle.allow_request(request, None)
        return accepted, throttle.wait()

    def simultaneous_attempts(self, count=12):
        original_snapshot = admission._slot_expirations
        barrier = Barrier(count)
        worker_state = local()

        def synchronized_snapshot(keys):
            result = original_snapshot(keys)
            if not getattr(worker_state, "read_snapshot", False):
                worker_state.read_snapshot = True
                barrier.wait(timeout=10)
            return result

        def attempt(_):
            close_old_connections()
            try:
                return self.throttle()
            finally:
                connections.close_all()

        # Every worker observes the same capacity before attempting its write.
        # This forces both the unique-insert and expired-slot UPDATE races.
        with patch.object(admission, "_slot_expirations", synchronized_snapshot):
            with ThreadPoolExecutor(max_workers=count) as workers:
                return list(workers.map(attempt, range(count)))

    def test_only_one_concurrent_request_claims_the_last_unused_slot(self):
        for _ in range(5):
            self.assertTrue(self.throttle()[0])
        outcomes = self.simultaneous_attempts()
        self.assertEqual(sum(accepted for accepted, _ in outcomes), 1)
        self.assertTrue(all(wait == 3600 for accepted, wait in outcomes if not accepted))
        self.assertEqual(PublicImprovementPlanSlot.objects.count(), 6)
        self.assertFalse(self.throttle()[0])

    def test_only_one_concurrent_request_reuses_the_last_expired_slot(self):
        for _ in range(6):
            self.assertTrue(self.throttle()[0])
        last = PublicImprovementPlanSlot.objects.first()
        PublicImprovementPlanSlot.objects.filter(pk=last.pk).update(available_at=self.now - timedelta(seconds=1))
        outcomes = self.simultaneous_attempts()
        self.assertEqual(sum(accepted for accepted, _ in outcomes), 1)
        self.assertEqual(PublicImprovementPlanSlot.objects.count(), 6)
        self.assertFalse(self.throttle()[0])

    def test_first_concurrent_burst_cannot_create_more_than_six_slots(self):
        outcomes = self.simultaneous_attempts()
        self.assertEqual(sum(accepted for accepted, _ in outcomes), 6)
        self.assertEqual(PublicImprovementPlanSlot.objects.count(), 6)

    def test_expiry_is_a_rolling_hour_and_each_peer_has_independent_capacity(self):
        for _ in range(3):
            self.assertTrue(self.throttle()[0])
        with patch("projects.services.public_plan_admission.timezone.now", return_value=self.now + timedelta(minutes=30)):
            for _ in range(3):
                self.assertTrue(self.throttle()[0])
            self.assertEqual(self.throttle(), (False, 1800))
        with patch("projects.services.public_plan_admission.timezone.now", return_value=self.now + timedelta(hours=1)):
            for _ in range(3):
                self.assertTrue(self.throttle()[0])
            self.assertEqual(self.throttle(), (False, 1800))
            self.assertTrue(self.throttle("192.0.2.88")[0])
        self.assertEqual(PublicImprovementPlanSlot.objects.count(), 7)

    def test_accounting_contains_only_hashed_keys_and_bounded_expiry_cleanup(self):
        PublicImprovementPlanSlot.objects.bulk_create([
            PublicImprovementPlanSlot(key=f"{index:064x}", available_at=self.now - timedelta(hours=2))
            for index in range(admission.EXPIRED_SLOT_CLEANUP_BATCH + 3)
        ])
        self.assertTrue(self.throttle()[0])
        self.assertEqual(PublicImprovementPlanSlot.objects.count(), 4)
        active = PublicImprovementPlanSlot.objects.get(available_at__gt=self.now)
        self.assertEqual(len(active.key), 64)
        self.assertNotIn(self.peer, active.key)
        self.assertEqual(active.available_at, self.now + timedelta(hours=1))

    def test_unavailable_database_fails_closed_before_provider_invocation(self):
        request = APIRequestFactory().post("/plan/", {"desired_outcome": "Paint the vanity"}, format="json")
        with patch.object(admission, "_slot_expirations", side_effect=OperationalError("private database detail")), \
                patch("projects.views.public_improvements.build_public_plan_preview") as provider:
            response = PublicImprovementPlanView.as_view()(request, category_slug="bathroom", improvement_slug="vanity")
        self.assertEqual(response.status_code, 503)
        self.assertIn("temporarily unavailable", str(response.data))
        self.assertNotIn("private database detail", str(response.data))
        provider.assert_not_called()

    def test_exhausted_database_slots_return_retry_after_without_provider_invocation(self):
        for _ in range(6):
            self.assertTrue(self.throttle()[0])
        request = APIRequestFactory().post("/plan/", {"desired_outcome": "Paint the vanity"},
                                          format="json", REMOTE_ADDR=self.peer)
        with patch("projects.views.public_improvements.build_public_plan_preview") as provider:
            response = PublicImprovementPlanView.as_view()(request, category_slug="bathroom", improvement_slug="vanity")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response["Retry-After"], "3600")
        provider.assert_not_called()
