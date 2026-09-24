from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class ContractorInviteIdentityMigrationTests(TransactionTestCase):
    migrate_from = ("projects", "0323_admin_request_management")
    migrate_to = ("projects", "0324_contractorinvite_contact_identity")

    def setUp(self):
        super().setUp()
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps
        ProjectIntake = old_apps.get_model("projects", "ProjectIntake")
        ContractorInvite = old_apps.get_model("projects", "ContractorInvite")
        intake = ProjectIntake.objects.create(
            customer_name="Legacy Customer",
            customer_email="legacy-customer@example.com",
        )
        for _ in range(2):
            ContractorInvite.objects.create(
                homeowner_name="Legacy Customer",
                homeowner_email="legacy-customer@example.com",
                contractor_email="DUPLICATE@example.com",
                source_intake=intake,
            )

        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_to])

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_backfill_preserves_legacy_duplicates_and_enforces_new_invariant(self):
        from projects.models_invite import ContractorInvite

        invites = list(ContractorInvite.objects.order_by("created_at", "id"))
        self.assertEqual(len(invites), 2)
        self.assertEqual(invites[0].contact_identity, "email:duplicate@example.com")
        self.assertTrue(invites[1].contact_identity.startswith(f"legacy:{invites[1].id}:"))
        self.assertNotEqual(invites[0].token, invites[1].token)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ContractorInvite.objects.create(
                    homeowner_name="Legacy Customer",
                    homeowner_email="legacy-customer@example.com",
                    contractor_email="duplicate@example.com",
                    source_intake=invites[0].source_intake,
                    contact_identity="email:duplicate@example.com",
                )
