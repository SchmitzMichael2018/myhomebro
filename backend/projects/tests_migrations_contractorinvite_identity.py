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
        for name in ("Canonical Duplicate", "Legacy Duplicate"):
            ContractorInvite.objects.create(
                homeowner_name=name,
                homeowner_email="legacy-customer@example.com",
                contractor_email="DUPLICATE@example.com",
                source_intake=intake,
            )
        malformed_rows = [
            ("Invalid Email One", "invalid", "", ""),
            ("Invalid Email Two", "invalid", "", ""),
            ("Invalid Phone One", "", "abc", ""),
            ("Invalid Phone Two", "", "abc", ""),
            ("Valid Email Invalid Phone", "valid@example.com", "abc", ""),
            ("Blank Contact", "", "", "https://[malformed"),
        ]
        for name, email, phone, message in malformed_rows:
            ContractorInvite.objects.create(
                homeowner_name=name,
                homeowner_email="legacy-customer@example.com",
                contractor_email=email,
                contractor_phone=phone,
                message=message,
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
        self.assertEqual(len(invites), 8)
        self.assertEqual(invites[0].contact_identity, "email:duplicate@example.com")
        self.assertTrue(invites[1].contact_identity.startswith(f"legacy:{invites[1].id}:"))
        self.assertNotEqual(invites[0].token, invites[1].token)
        for invite in invites[2:]:
            self.assertEqual(invite.contact_identity, f"legacy:{invite.id}:")
        self.assertEqual(len({invite.contact_identity for invite in invites}), 8)
        self.assertEqual(len({invite.token for invite in invites}), 8)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ContractorInvite.objects.create(
                    homeowner_name="Legacy Customer",
                    homeowner_email="legacy-customer@example.com",
                    contractor_email="duplicate@example.com",
                    source_intake=invites[0].source_intake,
                    contact_identity="email:duplicate@example.com",
                )
