from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("projects", "0277_projecttemplate_lifecycle_status")]

    operations = [
        migrations.AddField(
            model_name="proposal",
            name="selected_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="estimate_proposals", to="projects.projecttemplate"),
        ),
        migrations.AddField(model_name="proposal", name="selected_template_name_snapshot", field=models.CharField(blank=True, default="", max_length=255)),
        migrations.AddField(model_name="proposal", name="selected_template_source_snapshot", field=models.CharField(blank=True, default="", max_length=32)),
        migrations.AddField(model_name="proposal", name="pricing_template_name_snapshot", field=models.CharField(blank=True, default="", max_length=255)),
    ]
