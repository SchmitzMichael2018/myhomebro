from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0182_rename_projects_ag_contrac_5de7e1_idx_projects_ag_contrac_d0ce86_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="propertyprofile",
            name="is_primary",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
