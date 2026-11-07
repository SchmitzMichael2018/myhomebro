"""Refine only the untouched bathroom planning draft; never publish or approve it.

This migration intentionally leaves reviewed, published, archived, or edited
records alone. Existing template/milestone identities and pricing stay intact.
The reverse is a no-op so rolling back code cannot overwrite later staff edits.
"""

from importlib import import_module

from django.db import migrations
from django.utils import timezone


ORIGINAL = import_module(
    "projects.migrations.0321_prepare_bathroom_launch_content"
).TEMPLATES[0]

BASELINE_FIELDS = {
    "description": ORIGINAL["summary"],
    "public_title": ORIGINAL["public_title"],
    "public_summary": ORIGINAL["summary"],
    "public_intro": ORIGINAL["intro"],
    "default_scope": ORIGINAL["scope"],
    "project_materials_hint": ORIGINAL["materials"],
    "difficulty": ORIGINAL["difficulty"],
    "estimated_duration_min_days": ORIGINAL["days"][0],
    "estimated_duration_max_days": ORIGINAL["days"][1],
    "cost_guidance": ORIGINAL["cost"],
    "tools_guidance": ORIGINAL["tools"],
    "preparation": ORIGINAL["preparation"],
    "safety_guidance": ORIGINAL["safety"],
    "common_mistakes": ORIGINAL["mistakes"],
    "diy_guidance": ORIGINAL["diy"],
    "pro_guidance": ORIGINAL["pro"],
    "public_faqs": ORIGINAL["faqs"],
    "seo_title": ORIGINAL["seo_title"],
    "seo_description": ORIGINAL["seo_description"],
    "social_image": "",
    "is_featured_public": True,
    "public_audience": "homeowner",
    "public_audiences": ["homeowner"],
    "public_audience_actions": {"homeowner": "create_project"},
    "public_next_action": "",
    "public_sections": [],
    "public_editorial_brief": {},
    "public_problem": "",
    "public_evidence": "",
    "public_evidence_source": "",
    "public_viewpoint": "",
    "public_practical_steps": "",
    "public_video_url": "",
    "public_video_title": "",
    "public_video_description": "",
    "public_video_poster_url": "",
    "public_video_text_summary": "",
    "public_video_transcript_url": "",
}

REFINED_FIELDS = {
    "public_intro": (
        "Start with a measured record of the room and a written scope. Decide what stays, what changes, who supplies each item, and whether plumbing, electrical, ventilation, or the layout will change. You can do much of this planning yourself. The Advanced difficulty rating describes remodel execution, which may involve several qualified trades.\n\n"
        "Before affected work begins, confirm the local permit, licensing, and inspection requirements and who is responsible for them. Assess suspected hazardous materials and unsafe conditions before disturbance. Then plan protection and selective removal, concealed-condition review, authorized rough work, applicable inspections and tests before covering the work, finishes and fixtures, and final testing and inspections. Include waterproofing verification where wet-area assemblies are part of the scope."
    ),
    "estimated_duration_min_days": None,
    "estimated_duration_max_days": None,
    "preparation": (
        "Photograph and measure the room without opening walls or disturbing suspect materials. Record fixture locations, clearances, visible moisture damage, ventilation, and accessible water and electrical controls. Note the home's age and any unknown materials for assessment before demolition. Confirm product specifications and lead times, an alternative bathroom arrangement, protection for occupants and adjacent rooms, and who selects, purchases, receives, and checks each item."
    ),
    "safety_guidance": (
        "Before demolition, drilling, or cutting, pause for assessment if paint in an older home, suspected asbestos-containing material, active moisture damage, unstable flooring, or exposed or uncertain utilities may be disturbed. In homes built before 1978, painted surfaces need lead-safe assessment and work practices; EPA recommends a lead-safe certified contractor. Do not disturb suspected asbestos. Keep occupants away from the work area and plan appropriate dust containment and cleanup.\n\n"
        "Identify water and power controls before work begins; qualified people should isolate and verify affected services before disconnection. Stop if water cannot be isolated or a utility's condition is uncertain. Use qualified help for plumbing, electrical, structural, ventilation, waterproofing, or other work that exceeds your competence or requires a licensed professional locally.\n\n"
        "Confirm applicable permits, inspections, and tests before affected work. Obtain required rough-work and substrate or waterproofing approvals and test results before covering those assemblies. Follow the selected system's installation and cure requirements. Final checks do not replace required pre-cover inspections, and a suggested plan is not a code or safety approval."
    ),
    "common_mistakes": (
        "Common planning failures include ordering before measuring, leaving product compatibility unverified, treating a full remodel as one DIY task, starting disturbance before hazard assessment, leaving permit and inspection responsibility unclear, covering work before required approvals or tests, omitting ventilation or waterproofing details, assuming walls and floors are sound, and starting extra work before agreeing on scope, cost, and schedule changes."
    ),
    "diy_guidance": (
        "DIY planning can include non-invasive measurements, photos, selections, and a written list of responsibilities and questions. Limited finish work may be appropriate after site conditions, product instructions, and local requirements are understood. Choose participation task by task; do not treat the Advanced remodel rating or a suggested plan as permission to perform higher-risk work."
    ),
    "pro_guidance": (
        "Arrange qualified review before layout changes, plumbing or electrical relocation, structural or extensive substrate repair, ventilation changes, wet-area waterproofing, or custom glass work. Seek appropriate assessment before disturbing suspected lead paint, asbestos, moisture-damaged materials, unstable floors, or uncertain utilities. Confirm local licensing, permit, and inspection requirements and document who will handle each applicable responsibility."
    ),
    "public_faqs": [
        {
            "question": "What should I decide before starting a bathroom remodel?",
            "answer": "Document the measured layout, retained and replaced items, product specifications, responsibilities, exclusions and allowances, budget and contingency, bathroom access, applicable approvals, and the order of dependent work. Resolve unsafe or uncertain conditions before disturbance.",
        },
        {
            "question": "What is the typical order of a bathroom remodel?",
            "answer": "Plan the scope and applicable approvals, assess hazards before disturbance, protect the work area, complete agreed removal and condition review, then authorized rough work. Obtain required inspections and tests before covering rough work or wet-area assemblies. Follow with finishes, fixtures, final testing and inspections, corrections, and closeout records. The exact sequence depends on the scope and chosen products.",
        },
        {
            "question": "How long will the remodel take?",
            "answer": "A single day range cannot reliably describe both planning and construction. Agree on an active-work schedule after scope, site conditions, products, trade availability, required inspections, and cure times are known. Product lead times, permit review, or hidden-condition repairs can extend the overall elapsed time.",
        },
        {
            "question": "How much contingency should I plan?",
            "answer": "There is no universal percentage. Base the contingency on concealed conditions, the room's age, scope certainty, and the risk of product or repair changes. Record who can approve additional work and how changes to scope, cost, and timing will be agreed before that work starts.",
        },
        {
            "question": "When should I involve a professional?",
            "answer": "Get qualified review before higher-risk or regulated work and before disturbing uncertain or hazardous conditions. A licensed trade may be required even when a task looks straightforward. Planning yourself does not mean carrying out every task yourself.",
        },
    ],
    "public_sections": [
        {
            "id": "ready-to-start",
            "title": "Before work starts",
            "body": (
                "Use this checklist to agree on the next safe step:\n"
                "1. Record a measured layout and list what stays, changes, and is excluded.\n"
                "2. Verify product specifications, compatibility, purchasing responsibilities, and lead times.\n"
                "3. Resolve hazard and hidden-condition questions before disturbing affected materials.\n"
                "4. Confirm applicable permits, qualified trades, inspection or test hold points, and the person responsible for each.\n"
                "5. Agree on the budget, allowances, contingency, and written approval of changes before extra work.\n"
                "6. Plan bathroom access, occupant protection, trade sequence, and product cure time.\n"
                "7. Define completion evidence: applicable approvals, test results, corrections, photos, receipts, product instructions, and warranties."
            ),
        },
        {
            "id": "schedule-assumptions",
            "title": "Build a schedule for your scope",
            "body": (
                "Separate planning and purchasing time from active construction and total time without a usable bathroom. Set dates only after the scope, site conditions, products, trade availability, required approvals, and cure times are understood. Allow for permit review, delivery delays, inspections, and concealed-condition repairs. A suggested plan is not a completion-time promise."
            ),
        },
        {
            "id": "san-antonio-checks",
            "title": "Planning in the San Antonio area",
            "body": (
                "First confirm which authority handles permits for the property's address. A San Antonio-area mailing address does not by itself establish the permitting jurisdiction. Ask that authority about the building and trade requirements for your actual scope, who may do the work, and which inspections must be approved before work is covered. Record the permit applicant, responsible trades, and inspection scheduling responsibilities.\n\n"
                "For property within City of San Antonio jurisdiction, start with [Residential inspections](https://www.sa.gov/Directory/Departments/DSD/Constructing/Residential/Inspections) and [IB 130: residential inspection stages](https://docsonline.sanantonio.gov/FileUploads/DSD/IB130.pdf). The bulletin describes staged inspections; not every listed stage applies to every bathroom project. Confirm requirements with Development Services before work begins."
            ),
        },
        {
            "id": "safety-sources",
            "title": "Safety references for planning",
            "body": (
                "Read [EPA lead-safe renovation guidance](https://www.epa.gov/lead/lead-safe-renovations-diyers) before work that may disturb older painted surfaces. See [EPA remodeling and indoor-air guidance](https://www.epa.gov/indoor-air-quality-iaq/best-practices-indoor-air-quality-when-remodeling-your-home) for planning around asbestos, moisture, dust, and occupant protection. These references support planning; they do not replace a site assessment or the selected product's instructions. Sources checked November 7, 2026."
            ),
        },
    ],
}

REFINED_MILESTONE_DESCRIPTIONS = {
    1: "Record goals, dimensions, fixture locations, ventilation, visible damage, access constraints, and the room's age. Identify hazards and unknown conditions for assessment before disturbance.",
    3: "Document cost drivers, allowances, contingency, lead times, trade sequence, bathroom access, and change approvals. Confirm applicable permits and licensing before affected work; assign responsibility for required inspection and test hold points and milestone evidence.",
    4: "Resolve hazard questions before disturbance, protect occupants and adjacent areas, and have affected utilities safely isolated and verified. Complete only agreed selective removal; stop for appropriate review when damage or unexpected systems appear.",
    5: "Complete authorized trade and repair work within the agreed scope. Obtain required rough-work inspections and approvals before covering it. Where wet-area work is included, verify substrate and waterproofing requirements, required tests or inspections, and cure time before concealing the assembly or adding finishes.",
    7: "Test operation and leaks, complete applicable final inspections, and document corrections. Final checks do not replace required pre-cover approvals. Clean the area, close the punch list, and retain photos, approvals, receipts, product instructions, and warranties.",
}


def refine_unedited_draft(apps, schema_editor):
    Template = apps.get_model("projects", "ProjectTemplate")
    Milestone = apps.get_model("projects", "ProjectTemplateMilestone")
    alias = schema_editor.connection.alias
    candidates = Template.objects.using(alias).select_for_update().filter(
        is_system=True,
        benchmark_match_key=ORIGINAL["key"],
        public_slug=ORIGINAL["slug"],
        public_category_slug="bathroom",
        public_publication_status__in=("draft", "ready_for_review"),
        public_reviewed_at__isnull=True,
        public_reviewed_by_id__isnull=True,
        public_published_at__isnull=True,
    )
    for template in candidates:
        if any(getattr(template, field) != value for field, value in BASELINE_FIELDS.items()):
            continue
        milestones = list(
            Milestone.objects.using(alias).select_for_update()
            .filter(template_id=template.pk).order_by("sort_order", "pk")
        )
        actual = [
            (row.title, row.description, row.normalized_milestone_type, row.sort_order)
            for row in milestones
        ]
        if actual != ORIGINAL["milestones"]:
            continue
        Template.objects.using(alias).filter(pk=template.pk).update(
            **REFINED_FIELDS, updated_at=timezone.now()
        )
        for row in milestones:
            description = REFINED_MILESTONE_DESCRIPTIONS.get(row.sort_order)
            if description:
                Milestone.objects.using(alias).filter(pk=row.pk).update(description=description)


class Migration(migrations.Migration):
    dependencies = [("projects", "0333_public_improvement_plan_slot")]
    operations = [migrations.RunPython(refine_unedited_draft, migrations.RunPython.noop)]
