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
        fixtures = [
            ("Canonical Duplicate", "DUPLICATE@example.com", ""),
            ("Legacy Duplicate", "DUPLICATE@example.com", ""),
            ("Valid Domestic Phone", "", "(512) 555-0188"),
            ("Equivalent Domestic Phone", "", "+1 512.555.0188"),
            ("Valid International Phone", "", "+44 20 7946 0958"),
            ("Equivalent International Phone", "", "+44-20-7946-0958"),
            ("Invalid Email One", "invalid", ""),
            ("Invalid Email Two", "invalid", ""),
            ("Invalid Phone One", "", "abc"),
            ("Invalid Phone Two", "", "abc"),
            ("Valid Email Invalid Phone", "valid@example.com", "abc"),
            ("Alphabetic Prefix", "", "abc5125550188"),
            ("Alphabetic Suffix", "", "5125550188abc"),
            ("Zero Country Code", "", "+00000000"),
            ("Unsupported All Zero", "", "00000000"),
            ("Domestic All Zero", "", "0000000000"),
            ("Multiple Plus", "", "++15125550188"),
            ("Embedded Letters", "", "+1abc5125550188"),
            ("Vanity Phone", "", "1-800-FLOWERS"),
            ("Too Short", "", "5551212"),
            ("Too Long", "", "+1234567890123456"),
            ("Unsupported Extension", "", "+1 512 555 0188 ext 2"),
            ("Unicode Digits", "", "１２３４５６７８９０"),
            ("Blank Contact", "", ""),
        ]
        self.original_tokens = {}
        self.original_resend_tokens = {}
        for name, email, phone in fixtures:
            invite = ContractorInvite.objects.create(
                homeowner_name=name,
                homeowner_email="legacy-customer@example.com",
                contractor_email=email,
                contractor_phone=phone,
                message="https://[malformed" if name == "Blank Contact" else "",
                source_intake=intake,
            )
            self.original_tokens[name] = str(invite.token)
            self.original_resend_tokens[name] = str(invite.resend_token)

        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_to])

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_backfill_preserves_legacy_duplicates_and_enforces_new_invariant(self):
        # The disposable database is at 0324 here, so use the matching
        # historical model rather than today's model with later intake fields.
        apps = self.executor.loader.project_state([self.migrate_to]).apps
        ContractorInvite = apps.get_model("projects", "ContractorInvite")

        invites = list(ContractorInvite.objects.order_by("created_at", "id"))
        by_name = {invite.homeowner_name: invite for invite in invites}
        self.assertEqual(len(invites), 24)
        self.assertEqual(
            by_name["Canonical Duplicate"].contact_identity,
            "email:duplicate@example.com",
        )
        self.assertTrue(
            by_name["Legacy Duplicate"].contact_identity.startswith(
                f"legacy:{by_name['Legacy Duplicate'].id}:"
            )
        )
        self.assertEqual(
            by_name["Valid Domestic Phone"].contact_identity,
            "phone:+15125550188",
        )
        self.assertTrue(
            by_name["Equivalent Domestic Phone"].contact_identity.startswith(
                f"legacy:{by_name['Equivalent Domestic Phone'].id}:phone:+15125550188"
            )
        )
        self.assertEqual(
            by_name["Valid International Phone"].contact_identity,
            "phone:+442079460958",
        )
        self.assertTrue(
            by_name["Equivalent International Phone"].contact_identity.startswith(
                f"legacy:{by_name['Equivalent International Phone'].id}:phone:+442079460958"
            )
        )
        canonical_names = {
            "Canonical Duplicate",
            "Valid Domestic Phone",
            "Valid International Phone",
        }
        for invite in invites:
            if invite.homeowner_name not in canonical_names and invite.homeowner_name not in {
                "Legacy Duplicate",
                "Equivalent Domestic Phone",
                "Equivalent International Phone",
            }:
                self.assertEqual(invite.contact_identity, f"legacy:{invite.id}:")
            self.assertEqual(str(invite.token), self.original_tokens[invite.homeowner_name])
            self.assertEqual(
                str(invite.resend_token),
                self.original_resend_tokens[invite.homeowner_name],
            )
        self.assertEqual(len({invite.contact_identity for invite in invites}), 24)
        self.assertEqual(len({invite.token for invite in invites}), 24)
        self.assertEqual(len({invite.resend_token for invite in invites}), 24)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ContractorInvite.objects.create(
                    homeowner_name="Legacy Customer",
                    homeowner_email="legacy-customer@example.com",
                    contractor_email="duplicate@example.com",
                    source_intake=invites[0].source_intake,
                    contact_identity="email:duplicate@example.com",
                )
