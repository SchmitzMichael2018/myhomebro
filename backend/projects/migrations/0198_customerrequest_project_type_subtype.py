from django.db import migrations, models


def copy_project_category_to_type(apps, schema_editor):
    CustomerRequest = apps.get_model("projects", "CustomerRequest")
    for row in CustomerRequest.objects.filter(project_type="", project_category__gt="").only(
        "id", "project_category", "project_type"
    ):
        row.project_type = row.project_category
        row.save(update_fields=["project_type"])


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0197_customerrequest_project_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerrequest",
            name="project_subtype",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="customerrequest",
            name="project_type",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.RunPython(copy_project_category_to_type, migrations.RunPython.noop),
    ]
