from django.db import migrations, models
import django.db.models.deletion


def backfill_lifecycle_links(apps, schema_editor):
    CustomerRequest = apps.get_model("projects", "CustomerRequest")
    MaintenanceWorkOrder = apps.get_model("projects", "MaintenanceWorkOrder")
    PropertyHomeSystem = apps.get_model("projects", "PropertyHomeSystem")

    for system in PropertyHomeSystem.objects.exclude(linked_customer_request_id=None).iterator():
        CustomerRequest.objects.filter(pk=system.linked_customer_request_id, linked_home_system_id__isnull=True).update(
            linked_home_system_id=system.id
        )

    for system in PropertyHomeSystem.objects.exclude(linked_agreement_id=None).iterator():
        MaintenanceWorkOrder.objects.filter(
            maintenance_agreement_id=system.linked_agreement_id,
            property_profile_id=system.property_profile_id,
            home_system_id__isnull=True,
        ).update(home_system_id=system.id)


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0208_property_profile_bedrooms_bathrooms"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerrequest",
            name="linked_home_system",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="customer_requests",
                to="projects.propertyhomesystem",
            ),
        ),
        migrations.AddField(
            model_name="maintenanceworkorder",
            name="home_system",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="maintenance_work_orders",
                to="projects.propertyhomesystem",
            ),
        ),
        migrations.RunPython(backfill_lifecycle_links, migrations.RunPython.noop),
    ]
