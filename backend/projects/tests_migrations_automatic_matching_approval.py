from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class AutomaticMatchingApprovalMigrationTests(TransactionTestCase):
    migrate_from = ("projects", "0325_marketplace_request_lifecycle")
    migrate_to = ("projects", "0326_automatic_matching_trade_approval")

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        Location = old_apps.get_model("projects", "MarketplaceLocation")
        self.location_id = Location.objects.create(city="Austin", state="TX", is_enabled=True).pk
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_to])

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_forward_is_empty_fail_closed_and_backward_preserves_legacy_row(self):
        executor = MigrationExecutor(connection)
        apps = executor.loader.project_state([self.migrate_to]).apps
        Approval = apps.get_model("projects", "MarketplaceAutomaticMatchingApproval")
        Location = apps.get_model("projects", "MarketplaceLocation")
        self.assertEqual(Approval.objects.count(), 0)
        self.assertTrue(Location.objects.get(pk=self.location_id).is_enabled)

        Approval.objects.create(city_key="austin", state_key="TX", trade="roofing", is_approved=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Approval.objects.create(city_key="austin", state_key="TX", trade="roofing", is_approved=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Approval.objects.create(city_key="", state_key="TX", trade="roofing", is_approved=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Approval.objects.create(city_key="austin", state_key="TX", trade="unknown", is_approved=True)

        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        self.assertNotIn("projects_marketplaceautomaticmatchingapproval", connection.introspection.table_names())
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        Location = old_apps.get_model("projects", "MarketplaceLocation")
        self.assertTrue(Location.objects.get(pk=self.location_id).is_enabled)
