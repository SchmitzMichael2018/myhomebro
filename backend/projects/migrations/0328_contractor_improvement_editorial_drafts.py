"""Unpublished editorial starting points; publication requires a separate review."""

from django.db import migrations


ARTICLES = [
    {
        "public_slug": "contractor-payment-plan",
        "public_title": "The job is done. Where’s the payment?",
        "public_summary": "Agree on scope, proof of completion, review, and payment milestones before a home project starts.",
        "public_problem": "You finish the agreed work. The homeowner says it looks good, then asks to sort out a few things before payment. The concern may be legitimate, or 'a few things' may mean an expectation nobody wrote down. The worst time to define what earns a payment is after the work is done.",
        "public_evidence": "In Intuit QuickBooks' 2025 U.S. survey of 2,487 small businesses across industries, 56% reported money owed on unpaid invoices. This is not a residential-contractor statistic, and it does not establish that a milestone plan prevents late payment.",
        "public_evidence_source": "https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2025/",
        "public_viewpoint": "Contractors should know what they need to show to request each payment before work starts. A shared milestone plan gives the customer a fair review point and the contractor a clear path to requesting payment. It does not guarantee approval or release; those depend on the agreement, payment setup, and any applicable dispute or hold.",
        "public_practical_steps": "1. Define the work, materials, exclusions, and what completion means.\n2. Set sensible payment stages, including genuine material or mobilization needs.\n3. Agree on proof for each stage, such as photos, notes, inspection, or walkthrough.\n4. Record who reviews the work, when, and how a concern is handled.\n5. Document scope, price, and timing changes before extra work proceeds.\n\nExample: For a bathroom job, 'rough plumbing complete' is clearer when fixture locations and any required inspection are identified. 'Half the bathroom done' leaves too much open to interpretation.",
        "seo_title": "Contractor Payment Milestones Before Work Starts | MyHomeBro",
        "seo_description": "A practical way to agree on scope, proof of completion, and payment milestones before a home project starts.",
        "public_next_action": "sign_up",
    },
    {
        "public_slug": "contractor-deposit-vs-milestones",
        "public_title": "A deposit is not a payment plan",
        "public_summary": "Explain startup needs within a complete agreement and payment schedule tied to real progress.",
        "public_problem": "The homeowner asks why money is needed before work starts. You ask how to order materials without it. Both are fair questions. An upfront amount alone does not explain when the next payment is due, what the customer will review, or how a scope change will be handled.",
        "public_evidence": "The U.S. Federal Trade Commission's consumer guidance for repairs after weather emergencies advises a written contract with a payment schedule, scope, and project timing. It is disaster-repair guidance, not a universal deposit rule or a prescribed percentage for all residential work; local requirements may differ.",
        "public_evidence_source": "https://consumer.ftc.gov/articles/how-avoid-scams-after-weather-emergencies-and-natural-disasters",
        "public_viewpoint": "Reasonable startup costs should be explained, and any upfront payment should sit inside a complete plan tied to scope and later work, not stand in for one. A deposit, a platform-held balance, and a completed payment are different things. Available funding and release controls depend on the actual agreement and payment setup.",
        "public_practical_steps": "1. Before work: record scope, materials, timing, any upfront amount, and every later payment stage.\n2. During work: capture progress and explain any hidden issue before treating additional work as agreed.\n3. At each milestone: submit the agreed deliverable and evidence for customer review.\n4. At closeout: identify remaining agreed items and the final payment step.\n\nExample: A custom-order shower door may have a real early material cost. Explain what that amount covers and when installation and final review payments would be due. There is no one deposit percentage that fits every project.",
        "seo_title": "Contractor Deposits vs. Payment Milestones | MyHomeBro",
        "seo_description": "Contractors need startup cash, and homeowners want to see progress. Plan deposits and milestones around a clear agreement.",
        "public_next_action": "sign_up",
    },
    {
        "public_slug": "contractor-change-orders",
        "public_title": "The wall has a surprise. Your agreement needs a next step.",
        "public_summary": "When hidden conditions change a job, document the discovery and agree on revised scope, cost, and timing.",
        "public_problem": "You open a shower wall and discover damage that was not visible during the estimate. The original quote covered tile and fixtures; repairing hidden damage changes the work. Explain the finding before the change becomes an argument.",
        "public_evidence": "In Houzz's 2026 U.S. Houzz & Home study, 37% of surveyed homeowners who set an initial renovation budget exceeded it in 2025. The survey covered renovating U.S. homeowners who use Houzz; reported reasons included unexpectedly costly products or services, higher-end materials, and expanded scope. It does not show that contractors caused the overruns.",
        "public_evidence_source": "https://www.houzz.com/magazine/2026-u-s-houzz-and-home-study-renovation-trends-stsetivw-vs~185090855",
        "public_viewpoint": "A surprise behind the wall should lead to a documented decision about scope, cost, and time before extra work proceeds. Keep the original promise and any approved amendment connected. MyHomeBro can record the decision; it cannot prevent every dispute or guarantee payment for changed work.",
        "public_practical_steps": "1. Pause affected work; continue unrelated agreed tasks only if appropriate.\n2. Photograph the condition and distinguish known facts from what still needs inspection.\n3. Explain options, added scope, price, schedule impact, and any safety concern.\n4. Record customer approval through an amendment before extra work begins.\n5. Keep the original agreement, finding, proposal, and decision together.\n\nExample: 'We found damaged backing after demolition. The original scope assumed sound backing. Here are photos, the proposed replacement, the added price, and the two-day schedule impact.' This gives the customer a specific decision.",
        "seo_title": "Contractor Change Orders When Scope Changes | MyHomeBro",
        "seo_description": "Found hidden damage? Document the issue, agree on cost and timing, and keep the original agreement and approved change connected.",
        "public_next_action": "sign_up",
    },
]


def create_drafts(apps, schema_editor):
    Template = apps.get_model("projects", "ProjectTemplate")
    created = []
    for index, content in enumerate(ARTICLES):
        slug = content["public_slug"]
        article, _ = Template.objects.get_or_create(
            public_slug=slug,
            defaults={
                **content,
                "name": content["public_title"],
                "public_category_slug": "contractor-practice",
                "public_audience": "contractor",
                "public_publication_status": "draft",
                "is_system": True,
                "is_system_template": True,
                "is_published": False,
                "is_featured_public": index == 0,
            },
        )
        created.append(article)
    for article in created:
        article.related_public_templates.add(*(other for other in created if other.pk != article.pk))


class Migration(migrations.Migration):
    dependencies = [("projects", "0327_projecttemplate_public_audience_and_more")]
    operations = [migrations.RunPython(create_drafts, migrations.RunPython.noop)]
