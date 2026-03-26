from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0096_contractorpublicprofile_contractorgalleryitem_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="publiccontractorlead",
            name="converted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="publiccontractorlead",
            name="converted_homeowner",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name="converted_public_leads",
                to="projects.homeowner",
            ),
        ),
        migrations.AlterField(
            model_name="publiccontractorlead",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("contacted", "Contacted"),
                    ("qualified", "Qualified"),
                    ("closed", "Closed"),
                    ("archived", "Archived"),
                ],
                default="new",
                max_length=20,
            ),
        ),
    ]
