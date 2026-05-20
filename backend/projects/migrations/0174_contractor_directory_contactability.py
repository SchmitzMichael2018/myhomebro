from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0173_contractordirectoryentry_archive"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="claim_readiness_notes",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="claim_readiness_status",
            field=models.CharField(blank=True, choices=[("ready", "Ready"), ("needs_contact_method", "Needs Contact Method"), ("needs_service_category", "Needs Service Category"), ("needs_location", "Needs Location"), ("needs_manual_review", "Needs Manual Review")], db_index=True, max_length=40, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="contact_confidence",
            field=models.CharField(blank=True, choices=[("high", "High"), ("medium", "Medium"), ("low", "Low")], db_index=True, max_length=16, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="contact_form_url",
            field=models.URLField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="contact_status",
            field=models.CharField(blank=True, choices=[("contact_ready", "Contact Ready"), ("email_ready", "Email Ready"), ("phone_ready", "Phone Ready"), ("website_form_ready", "Website Form Ready"), ("website_only", "Website Only"), ("manual_review_needed", "Manual Review Needed"), ("unreachable", "Unreachable"), ("claimed", "Claimed")], db_index=True, max_length=40, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="has_contact_form",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="has_phone",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="has_public_email",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="has_website",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="outreach_notes",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="preferred_outreach_method",
            field=models.CharField(blank=True, choices=[("email", "Email"), ("phone", "Phone"), ("sms", "SMS"), ("website_form", "Website Form"), ("claim_link_manual", "Claim Link Manual"), ("unknown", "Unknown")], db_index=True, max_length=32, null=True),
        ),
        migrations.CreateModel(
            name="ContractorDirectoryOutreachLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("outreach_type", models.CharField(choices=[("email", "Email"), ("sms", "SMS"), ("phone", "Phone"), ("website_form", "Website Form"), ("claim_link_copied", "Claim Link Copied"), ("manual_note", "Manual Note")], db_index=True, max_length=32)),
                ("destination", models.CharField(blank=True, max_length=500, null=True)),
                ("status", models.CharField(blank=True, max_length=80, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("notes", models.TextField(blank=True, null=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="contractor_directory_outreach_logs", to=settings.AUTH_USER_MODEL)),
                ("directory_entry", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="outreach_logs", to="projects.contractordirectoryentry")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="contractordirectoryentry",
            index=models.Index(fields=["contact_status"], name="projects_co_contact_7fcd35_idx"),
        ),
        migrations.AddIndex(
            model_name="contractordirectoryentry",
            index=models.Index(fields=["claim_readiness_status"], name="projects_co_claim_r_3df57d_idx"),
        ),
        migrations.AddIndex(
            model_name="contractordirectoryoutreachlog",
            index=models.Index(fields=["directory_entry", "created_at"], name="projects_co_outreac_6a8f21_idx"),
        ),
        migrations.AddIndex(
            model_name="contractordirectoryoutreachlog",
            index=models.Index(fields=["outreach_type", "created_at"], name="projects_co_outreac_894e28_idx"),
        ),
    ]
