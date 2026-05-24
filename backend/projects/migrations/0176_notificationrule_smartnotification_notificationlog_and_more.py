from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0175_customer_portal_workspace"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=160)),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("customer_request_submitted", "Customer Request Submitted"),
                            ("property_profile_updated", "Property Profile Updated"),
                            ("agreement_needs_signature", "Agreement Needs Signature"),
                            ("escrow_needs_funding", "Escrow Needs Funding"),
                            ("milestone_needs_approval", "Milestone Needs Approval"),
                            ("payment_received", "Payment Received"),
                            ("request_marketplace_ready", "Request Marketplace Ready"),
                        ],
                        db_index=True,
                        max_length=64,
                    ),
                ),
                (
                    "channel",
                    models.CharField(
                        choices=[("in_app", "In App"), ("email_stub", "Email Stub"), ("sms_stub", "SMS Stub")],
                        db_index=True,
                        default="in_app",
                        max_length=24,
                    ),
                ),
                (
                    "audience",
                    models.CharField(
                        choices=[("customer", "Customer"), ("contractor", "Contractor"), ("internal", "Internal")],
                        db_index=True,
                        default="customer",
                        max_length=24,
                    ),
                ),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("title_template", models.CharField(max_length=255)),
                ("message_template", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["event_type", "channel", "name"],
                "unique_together": {("event_type", "channel", "audience")},
            },
        ),
        migrations.CreateModel(
            name="SmartNotification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("customer_request_submitted", "Customer Request Submitted"),
                            ("property_profile_updated", "Property Profile Updated"),
                            ("agreement_needs_signature", "Agreement Needs Signature"),
                            ("escrow_needs_funding", "Escrow Needs Funding"),
                            ("milestone_needs_approval", "Milestone Needs Approval"),
                            ("payment_received", "Payment Received"),
                            ("request_marketplace_ready", "Request Marketplace Ready"),
                        ],
                        db_index=True,
                        max_length=64,
                    ),
                ),
                (
                    "channel",
                    models.CharField(
                        choices=[("in_app", "In App"), ("email_stub", "Email Stub"), ("sms_stub", "SMS Stub")],
                        db_index=True,
                        default="in_app",
                        max_length=24,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("unread", "Unread"), ("read", "Read"), ("dismissed", "Dismissed")],
                        db_index=True,
                        default="unread",
                        max_length=24,
                    ),
                ),
                ("recipient_email", models.EmailField(db_index=True, max_length=254)),
                ("title", models.CharField(max_length=255)),
                ("message", models.TextField(blank=True, default="")),
                ("action_url", models.CharField(blank=True, default="", max_length=500)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                (
                    "agreement",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.contractor",
                    ),
                ),
                (
                    "customer_request",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.customerrequest",
                    ),
                ),
                (
                    "draw_request",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.drawrequest",
                    ),
                ),
                (
                    "homeowner",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.homeowner",
                    ),
                ),
                (
                    "invoice",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.invoice",
                    ),
                ),
                (
                    "milestone",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.milestone",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.project",
                    ),
                ),
                (
                    "property_profile",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="smart_notifications",
                        to="projects.propertyprofile",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="NotificationLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("customer_request_submitted", "Customer Request Submitted"),
                            ("property_profile_updated", "Property Profile Updated"),
                            ("agreement_needs_signature", "Agreement Needs Signature"),
                            ("escrow_needs_funding", "Escrow Needs Funding"),
                            ("milestone_needs_approval", "Milestone Needs Approval"),
                            ("payment_received", "Payment Received"),
                            ("request_marketplace_ready", "Request Marketplace Ready"),
                        ],
                        db_index=True,
                        max_length=64,
                    ),
                ),
                (
                    "channel",
                    models.CharField(
                        choices=[("in_app", "In App"), ("email_stub", "Email Stub"), ("sms_stub", "SMS Stub")],
                        db_index=True,
                        default="in_app",
                        max_length=24,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("created", "Created"), ("skipped", "Skipped"), ("stubbed", "Stubbed"), ("failed", "Failed")],
                        db_index=True,
                        default="created",
                        max_length=24,
                    ),
                ),
                ("recipient_email", models.EmailField(blank=True, db_index=True, default="", max_length=254)),
                ("message", models.TextField(blank=True, default="")),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "notification_rule",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="logs",
                        to="projects.notificationrule",
                    ),
                ),
                (
                    "smart_notification",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="logs",
                        to="projects.smartnotification",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="smartnotification",
            index=models.Index(fields=["recipient_email", "status"], name="projects_sm_recipie_bd88ae_idx"),
        ),
        migrations.AddIndex(
            model_name="smartnotification",
            index=models.Index(fields=["event_type", "created_at"], name="projects_sm_event_t_562d01_idx"),
        ),
        migrations.AddIndex(
            model_name="notificationlog",
            index=models.Index(fields=["event_type", "status"], name="projects_no_event_t_c1ffe7_idx"),
        ),
        migrations.AddIndex(
            model_name="notificationlog",
            index=models.Index(fields=["recipient_email", "created_at"], name="projects_no_recipie_e50373_idx"),
        ),
    ]
