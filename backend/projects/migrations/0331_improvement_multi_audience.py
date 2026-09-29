from django.db import migrations, models


def preserve_existing_audiences(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")
    for article in ProjectTemplate.objects.exclude(public_slug__isnull=True).iterator():
        audience = article.public_audience or "homeowner"
        article.public_audiences = [audience]
        article.public_audience_actions = {
            audience: article.public_next_action or "create_project",
        }
        article.save(update_fields=["public_audiences", "public_audience_actions"])


def seed_payment_risk_acceptance_draft(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")
    ProjectTemplate.objects.get_or_create(
        public_slug="payment-risk-for-both-sides",
        defaults={
            "name": "Payment risk for both sides of a home project",
            "is_system": True,
            "public_title": "Payment risk for both sides of a home project",
            "public_category_slug": "project-planning",
            "public_publication_status": "draft",
            "public_audience": "contractor",
            "public_audiences": ["contractor", "homeowner"],
            "public_audience_actions": {
                "contractor": "sign_up",
                "homeowner": "create_project",
            },
            "public_editorial_brief": {
                "idea": "Address payment and performance risk from both sides of a home project.",
                "problem": "A homeowner may pay for work that is not completed, while a contractor may complete agreed work and struggle to get paid.",
                "readers": "Homeowners and contractors",
                "viewpoint": "Use balanced expectations, shared records, and explicit review steps without promising an outcome.",
                "desired_action": "Choose the role-appropriate project planning path.",
                "sources": "",
            },
            "public_summary": "A balanced guide to documenting scope, progress, review, and payment expectations.",
            "public_problem": "Homeowners and contractors can each carry serious risk when agreed work, proof, review, and payment steps are unclear.",
            "public_viewpoint": "Neither payment nor completion should depend on assumptions. Document the agreed scope, review points, concerns, and next decision. A deposit is not automatic protection, and no workflow can promise payment or completion.",
            "public_practical_steps": "- Homeowners: confirm the written scope and review agreed evidence before the next payment decision.\n- Contractors: document completed agreed work and request review through the recorded process.\n- Both roles: record concerns and scope changes before treating them as resolved or approved.",
            "public_next_action": "sign_up",
        },
    )


class Migration(migrations.Migration):
    dependencies = [("projects", "0330_refine_contractor_deposit_viewpoint")]

    operations = [
        migrations.AddField(
            model_name="projecttemplate",
            name="public_audiences",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="projecttemplate",
            name="public_audience_actions",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="projecttemplate",
            name="public_editorial_brief",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(preserve_existing_audiences, migrations.RunPython.noop),
        migrations.RunPython(seed_payment_risk_acceptance_draft, migrations.RunPython.noop),
    ]
