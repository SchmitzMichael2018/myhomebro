from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0082_projecttemplate_project_materials_hint"),
    ]

    operations = [
        migrations.AddField(
            model_name="milestone",
            name="labor_estimate_low",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Advisory labor-only low-end estimate snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="labor_estimate_high",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Advisory labor-only high-end estimate snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="materials_estimate_low",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Advisory materials-only low-end estimate snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="materials_estimate_high",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Advisory materials-only high-end estimate snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
    ]
