from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0276_contractor_custom_services"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttemplate",
            name="lifecycle_status",
            field=models.CharField(
                choices=[("draft", "Draft"), ("active", "Active")],
                db_index=True,
                default="active",
                help_text="Contractor drafts are saved but unavailable to template application workflows until finalized.",
                max_length=16,
            ),
        ),
    ]
