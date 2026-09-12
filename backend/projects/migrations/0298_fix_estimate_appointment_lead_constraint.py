from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0297_projectintake_share_token_default"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="opportunityestimateappointment",
            name="estimate_appointment_exact_source",
        ),
        migrations.AddConstraint(
            model_name="opportunityestimateappointment",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(
                        source_type="lead",
                        public_lead__isnull=False,
                        project_intake__isnull=True,
                        contractor_opportunity__isnull=True,
                        direct_proposal__isnull=True,
                    )
                    | models.Q(
                        source_type="intake",
                        public_lead__isnull=True,
                        project_intake__isnull=False,
                        contractor_opportunity__isnull=True,
                        direct_proposal__isnull=True,
                    )
                    | models.Q(
                        source_type="opportunity",
                        public_lead__isnull=True,
                        project_intake__isnull=True,
                        contractor_opportunity__isnull=False,
                        direct_proposal__isnull=True,
                    )
                    | models.Q(
                        source_type="proposal",
                        public_lead__isnull=True,
                        project_intake__isnull=True,
                        contractor_opportunity__isnull=True,
                        direct_proposal__isnull=False,
                    )
                ),
                name="estimate_appointment_exact_source",
            ),
        ),
    ]
