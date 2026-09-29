"""Clarify the unpublished deposit guide without replacing staff edits."""

from django.db import migrations


PREVIOUS_VIEWPOINT = (
    "Reasonable startup costs should be explained, and any upfront payment "
    "should sit inside a complete plan tied to scope and later work, not stand "
    "in for one. A deposit, a platform-held balance, and a completed payment "
    "are different things. Available funding and release controls depend on "
    "the actual agreement and payment setup."
)

REFINED_VIEWPOINT = (
    "Explain why an upfront payment is needed and include it in the full payment "
    "schedule. A deposit paid to the contractor is not money held through "
    "MyHomeBro. Platform-held funds are a separate payment setup, with release "
    "governed by the agreement and applicable holds or disputes. An upfront "
    "payment is not automatically held or protected by the platform."
)


def refine_unedited_draft(apps, schema_editor):
    Template = apps.get_model("projects", "ProjectTemplate")
    Template.objects.filter(
        public_slug="contractor-deposit-vs-milestones",
        public_publication_status="draft",
        public_viewpoint=PREVIOUS_VIEWPOINT,
    ).update(public_viewpoint=REFINED_VIEWPOINT)


class Migration(migrations.Migration):
    dependencies = [("projects", "0329_improvement_walkthrough_video")]
    operations = [migrations.RunPython(refine_unedited_draft, migrations.RunPython.noop)]
