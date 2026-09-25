from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class MarketplaceRequestLifecycleMigrationTests(TransactionTestCase):
    migrate_from = ("projects", "0324_contractorinvite_contact_identity")
    migrate_to = ("projects", "0325_marketplace_request_lifecycle")

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        Intake = old_apps.get_model("projects", "ProjectIntake")
        CustomerRequest = old_apps.get_model("projects", "CustomerRequest")
        self.submitted_id = Intake.objects.create(
            customer_name="Migration Test",
            customer_email="submitted@example.test",
            status="submitted",
            post_submit_flow="multi_contractor",
        ).pk
        self.archived_classification_id = Intake.objects.create(
            customer_name="Migration Test",
            customer_email="archived@example.test",
            status="submitted",
            traffic_classification="archived",
        ).pk
        protected = Intake.objects.create(
            customer_name="Migration Test",
            customer_email="protected@example.test",
            status="submitted",
            post_submit_flow="multi_contractor",
        )
        self.protected_id = protected.pk
        CustomerRequest.objects.create(
            customer_email=protected.customer_email,
            request_type="repair",
            title="Existing customer history",
            description="Historical relationship",
            source_intake=protected,
        )
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_to])

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_existing_rows_keep_status_history_and_do_not_acquire_archive_age(self):
        from projects.models_project_intake import ProjectIntake
        from projects.services.marketplace_request_lifecycle import retention_protection_reason

        submitted = ProjectIntake.objects.get(pk=self.submitted_id)
        archived_classification = ProjectIntake.objects.get(pk=self.archived_classification_id)
        protected = ProjectIntake.objects.get(pk=self.protected_id)
        self.assertEqual(submitted.status, "submitted")
        self.assertEqual(archived_classification.traffic_classification, "archived")
        for intake in (submitted, archived_classification, protected):
            self.assertIsNone(intake.marketplace_archived_at)
            self.assertIsNone(intake.first_marketplace_reminder_sent_at)
            self.assertIsNone(intake.final_marketplace_reminder_sent_at)
            self.assertIsNone(intake.marketplace_last_archived_at)
            self.assertEqual(intake.marketplace_archive_reason, "")
        self.assertEqual(retention_protection_reason(protected), "Customer request history")
