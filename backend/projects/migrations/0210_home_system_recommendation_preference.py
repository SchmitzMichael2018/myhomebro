from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0209_customer_lifecycle_traceability"),
    ]

    operations = [
        migrations.CreateModel(
            name="PropertyHomeSystemRecommendationPreference",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("recommendation_key", models.CharField(max_length=160)),
                ("status", models.CharField(choices=[("active", "Active"), ("ignored", "Ignored")], default="active", max_length=16)),
                ("ignored_at", models.DateTimeField(blank=True, null=True)),
                ("restored_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "home_system",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="recommendation_preferences",
                        to="projects.propertyhomesystem",
                    ),
                ),
                (
                    "property_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="home_system_recommendation_preferences",
                        to="projects.propertyprofile",
                    ),
                ),
            ],
            options={
                "ordering": ["property_profile_id", "home_system_id", "recommendation_key"],
            },
        ),
        migrations.AddIndex(
            model_name="propertyhomesystemrecommendationpreference",
            index=models.Index(fields=["property_profile", "status"], name="projects_pr_propert_d16102_idx"),
        ),
        migrations.AddIndex(
            model_name="propertyhomesystemrecommendationpreference",
            index=models.Index(fields=["home_system", "status"], name="projects_pr_home_sy_6c0978_idx"),
        ),
        migrations.AddConstraint(
            model_name="propertyhomesystemrecommendationpreference",
            constraint=models.UniqueConstraint(
                fields=("property_profile", "home_system", "recommendation_key"),
                name="uniq_home_system_recommendation_preference",
            ),
        ),
    ]
