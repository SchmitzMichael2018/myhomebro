from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("projects", "0291_agreement_warranty_none_choice")]

    operations = [
        migrations.CreateModel(
            name="MilestoneCollaboratorAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "milestone",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="collaborator_assignments", to="projects.milestone"),
                ),
                (
                    "subaccount",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="milestone_collaborations", to="projects.contractorsubaccount"),
                ),
            ],
            options={"unique_together": {("milestone", "subaccount")}},
        )
    ]
