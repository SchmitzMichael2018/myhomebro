from django.db import migrations, models


def revise_payment_risk_draft(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")
    article = ProjectTemplate.objects.filter(
        public_slug="payment-risk-for-both-sides",
        public_publication_status="draft",
    ).first()
    if article is None:
        return

    prior_values = {
        "public_summary": "A balanced guide to documenting scope, progress, review, and payment expectations.",
        "public_problem": "Homeowners and contractors can each carry serious risk when agreed work, proof, review, and payment steps are unclear.",
        "public_viewpoint": "Neither payment nor completion should depend on assumptions. Document the agreed scope, review points, concerns, and next decision. A deposit is not automatic protection, and no workflow can promise payment or completion.",
        "public_practical_steps": "- Homeowners: confirm the written scope and review agreed evidence before the next payment decision.\n- Contractors: document completed agreed work and request review through the recorded process.\n- Both roles: record concerns and scope changes before treating them as resolved or approved.",
    }
    revised_values = {
        "public_summary": (
            "How shared scope, payment milestones, documented work and changes, homeowner review, "
            "and recorded concerns can help both parties make clearer project decisions."
        ),
        "public_problem": (
            "Homeowners risk paying when agreed work or changes are unclear, while contractors risk "
            "doing work without a shared record of what was expected, reviewed, or still disputed."
        ),
        "public_viewpoint": (
            "MyHomeBro helps both parties keep the scope and payment milestones in one shared project "
            "record. Contractors can document work and proposed changes, homeowners can review what "
            "was submitted, and both parties can record specific concerns and responses. That record "
            "supports a clearer conversation; it does not guarantee payment, prove that work is "
            "complete, provide escrow protection, or make MyHomeBro the binding decision-maker."
        ),
        "public_practical_steps": (
            "- Both parties: confirm the shared scope, payment milestones, and expected review evidence.\n"
            "- Contractors: document work performed and proposed scope or price changes before relying on them.\n"
            "- Homeowners: review the submitted work and changes against the shared record before making a payment decision.\n"
            "- Both parties: record each specific concern and response, including what remains unresolved."
        ),
    }
    updated_fields = []
    for field, prior_value in prior_values.items():
        if getattr(article, field) == prior_value:
            setattr(article, field, revised_values[field])
            updated_fields.append(field)
    outside_help = {
        "id": "when-to-seek-outside-help",
        "title": "When to seek outside help.",
        "body": (
            "An unresolved disagreement may call for mediation. Arbitration applies when the parties "
            "have an applicable agreement requiring or allowing it. Court, including small claims "
            "court where eligible, may also be appropriate depending on the agreement and local law.\n\n"
            "Seek prompt advice from a qualified local legal professional when deadlines, liens, "
            "substantial losses, or alleged fraud are involved. MyHomeBro administrative review can "
            "organize the project record and the parties' stated concerns and responses, but it is "
            "not binding arbitration and does not replace a court decision."
        ),
    }
    article.public_sections = [
        section
        for section in article.public_sections
        if isinstance(section, dict) and section.get("id") != outside_help["id"]
    ]
    article.public_sections.append(outside_help)
    article.save(update_fields=[*updated_fields, "public_sections"])


class Migration(migrations.Migration):
    dependencies = [("projects", "0331_improvement_multi_audience")]

    operations = [
        migrations.AddField(
            model_name="projecttemplate",
            name="public_sections",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(revise_payment_risk_draft, migrations.RunPython.noop),
    ]
