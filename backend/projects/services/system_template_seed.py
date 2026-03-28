from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction

from projects.models_templates import (
    ProjectTemplate,
    ProjectTemplateMilestone,
    SeedBenchmarkProfile,
)
from projects.services.regions import build_normalized_region_key


@dataclass(frozen=True)
class SeedProjectSpec:
    key: str
    name: str
    project_type: str
    project_subtype: str
    estimated_days: int
    payment_structure: str
    retainage_percent: Decimal
    price_low: Decimal
    price_high: Decimal
    duration_low: int
    duration_high: int
    description: str
    scope_text: str
    source_note: str
    milestone_pattern: list[dict]
    clarifications: list[dict]
    finish_level_multipliers: dict
    complexity_multipliers: dict
    project_materials_hint: str = ""


@dataclass(frozen=True)
class SeedRegionalOverrideSpec:
    benchmark_key: str
    region_state: str = ""
    region_city: str = ""
    normalized_region_key: str = ""
    price_low: Decimal = Decimal("0.00")
    price_high: Decimal = Decimal("0.00")
    duration_low: int = 0
    duration_high: int = 0
    location_multiplier: Decimal = Decimal("1.0000")
    region_priority_weight: Decimal = Decimal("1.00")
    source_note: str = ""
    rationale: str = ""
    milestone_pattern: list[dict] | None = None
    clarifications: list[dict] | None = None


SEED_PROJECT_SPECS: list[SeedProjectSpec] = [
    SeedProjectSpec(
        key="remodel:kitchen_remodel",
        name="System Kitchen Remodel",
        project_type="Remodel",
        project_subtype="Kitchen Remodel",
        estimated_days=21,
        payment_structure="progress",
        retainage_percent=Decimal("5.00"),
        price_low=Decimal("18000.00"),
        price_high=Decimal("65000.00"),
        duration_low=14,
        duration_high=35,
        description="Full-service kitchen remodel baseline for cabinets, counters, finishes, and punch work.",
        scope_text="Demo existing kitchen, update rough-ins as needed, install cabinetry, counters, finishes, and complete closeout.",
        source_note="Seeded residential remodeling starter based on common mid-market kitchen projects.",
        project_materials_hint="Cabinets, countertops, backsplash tile, trim, hardware, and appliance coordination often drive budget range.",
        finish_level_multipliers={"builder_grade": "0.90", "mid_grade": "1.00", "premium": "1.25"},
        complexity_multipliers={"light_layout_change": "1.00", "wall_move": "1.18", "structural": "1.30"},
        milestone_pattern=[
            {"title": "Demo & Site Protection", "normalized_milestone_type": "demolition", "duration_days": 3},
            {"title": "Rough-In Updates", "normalized_milestone_type": "electrical_rough_in", "duration_days": 4},
            {"title": "Cabinets & Counters", "normalized_milestone_type": "cabinet_installation", "duration_days": 6},
            {"title": "Finish Work", "normalized_milestone_type": "painting", "duration_days": 5},
            {"title": "Final Punch & Walkthrough", "normalized_milestone_type": "final_walkthrough", "duration_days": 2},
        ],
        clarifications=[
            {"key": "cabinet_scope", "label": "Are cabinets new, reused, or owner-supplied?", "type": "select", "options": ["New", "Reuse existing", "Owner supplied"], "required": True},
            {"key": "appliance_scope", "label": "Are appliances included in contractor scope?", "type": "select", "options": ["Yes", "No"], "required": True},
            {"key": "layout_change", "label": "Will walls, plumbing, or electrical layout move?", "type": "select", "options": ["No layout change", "Minor layout change", "Major layout change"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="remodel:bathroom_remodel",
        name="System Bathroom Remodel",
        project_type="Remodel",
        project_subtype="Bathroom Remodel",
        estimated_days=14,
        payment_structure="progress",
        retainage_percent=Decimal("5.00"),
        price_low=Decimal("9000.00"),
        price_high=Decimal("32000.00"),
        duration_low=7,
        duration_high=21,
        description="Bathroom remodel starter covering demo, waterproofing, tile, fixtures, and finish work.",
        scope_text="Remove existing bath finishes, update wet-area prep, install new fixtures and finishes, and complete punch work.",
        source_note="Seeded bathroom remodel baseline for residential contractors.",
        finish_level_multipliers={"standard": "1.00", "spa_finish": "1.20"},
        complexity_multipliers={"powder_room": "0.80", "hall_bath": "1.00", "primary_suite": "1.25"},
        milestone_pattern=[
            {"title": "Demo & Prep", "normalized_milestone_type": "demolition", "duration_days": 2},
            {"title": "Plumbing & Waterproofing", "normalized_milestone_type": "plumbing_rough_in", "duration_days": 3},
            {"title": "Tile & Shower Install", "normalized_milestone_type": "tile_installation", "duration_days": 4},
            {"title": "Fixtures & Vanity", "normalized_milestone_type": "vanity_installation", "duration_days": 3},
            {"title": "Punch & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 2},
        ],
        clarifications=[
            {"key": "wet_area_scope", "label": "Is the shower/tub area being replaced?", "type": "select", "options": ["Yes", "No"], "required": True},
            {"key": "tile_extent", "label": "What tile areas are included?", "type": "text", "required": True},
            {"key": "fixture_supply", "label": "Who is supplying fixtures?", "type": "select", "options": ["Contractor", "Owner"], "required": True},
        ],
        project_materials_hint="Tile selection, shower glass, and specialty plumbing trim are common price drivers.",
    ),
    SeedProjectSpec(
        key="roofing:roof_replacement",
        name="System Roof Replacement",
        project_type="Roofing",
        project_subtype="Roof Replacement",
        estimated_days=5,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("8500.00"),
        price_high=Decimal("28000.00"),
        duration_low=2,
        duration_high=7,
        description="Residential roof replacement starter with tear-off, deck review, install, and cleanup.",
        scope_text="Tear off existing roofing, address deck issues as approved, install new roofing system, and complete cleanup.",
        source_note="Seeded roofing baseline for asphalt-shingle residential work.",
        finish_level_multipliers={"standard_shingle": "1.00", "architectural": "1.12", "premium_system": "1.28"},
        complexity_multipliers={"single_story": "0.95", "two_story": "1.05", "complex_roofline": "1.18"},
        milestone_pattern=[
            {"title": "Tear-Off & Deck Inspection", "normalized_milestone_type": "roof_removal", "duration_days": 1},
            {"title": "Underlayment & Flashing", "normalized_milestone_type": "roof_installation", "duration_days": 1},
            {"title": "Roof Install", "normalized_milestone_type": "roof_installation", "duration_days": 2},
            {"title": "Cleanup & Final Review", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "deck_repair_allowance", "label": "Should deck repairs be handled as an allowance/change order?", "type": "select", "options": ["Allowance", "Change order", "Included"], "required": True},
            {"key": "insurance_claim", "label": "Is this project tied to an insurance claim?", "type": "select", "options": ["Yes", "No"], "required": False},
        ],
    ),
    SeedProjectSpec(
        key="installation:flooring_installation",
        name="System Flooring Installation",
        project_type="Installation",
        project_subtype="Flooring Installation",
        estimated_days=4,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("2500.00"),
        price_high=Decimal("14000.00"),
        duration_low=2,
        duration_high=7,
        description="Flooring installation starter for prep, underlayment, install, and trim.",
        scope_text="Prepare substrate, install selected flooring system, complete trim transitions, and final cleanup.",
        source_note="Seeded flooring baseline for residential flooring replacement.",
        finish_level_multipliers={"lvp": "1.00", "laminate": "0.95", "engineered_hardwood": "1.20", "tile": "1.25"},
        complexity_multipliers={"clear_floor": "0.95", "occupied_home": "1.05", "subfloor_repair": "1.20"},
        milestone_pattern=[
            {"title": "Prep & Leveling", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Main Install", "normalized_milestone_type": "flooring_installation", "duration_days": 2},
            {"title": "Transitions & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "flooring_material", "label": "What flooring material is being installed?", "type": "select", "options": ["LVP", "Laminate", "Engineered Hardwood", "Tile"], "required": True},
            {"key": "furniture_moving", "label": "Is furniture moving included?", "type": "select", "options": ["Yes", "No"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="painting:interior_painting",
        name="System Interior Painting",
        project_type="Painting",
        project_subtype="Interior Painting",
        estimated_days=3,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("1800.00"),
        price_high=Decimal("9500.00"),
        duration_low=1,
        duration_high=5,
        description="Interior painting starter with prep, coating application, and cleanup.",
        scope_text="Protect work areas, complete prep and patching, apply specified coats, and finish cleanup.",
        source_note="Seeded interior painting baseline for residential work.",
        finish_level_multipliers={"walls_only": "0.90", "walls_trim": "1.00", "full_interior": "1.20"},
        complexity_multipliers={"vacant": "0.95", "occupied": "1.10"},
        milestone_pattern=[
            {"title": "Prep & Masking", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Paint Application", "normalized_milestone_type": "painting", "duration_days": 1},
            {"title": "Touch-Up & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "paint_scope", "label": "What surfaces are included?", "type": "text", "required": True},
            {"key": "owner_furnish_paint", "label": "Is paint supplied by owner?", "type": "select", "options": ["Yes", "No"], "required": False},
        ],
    ),
    SeedProjectSpec(
        key="painting:exterior_painting",
        name="System Exterior Painting",
        project_type="Painting",
        project_subtype="Exterior Painting",
        estimated_days=5,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("3000.00"),
        price_high=Decimal("18000.00"),
        duration_low=2,
        duration_high=8,
        description="Exterior painting starter with wash/prep, coating, and cleanup.",
        scope_text="Prepare exterior surfaces, perform repairs noted in scope, apply coatings, and complete cleanup.",
        source_note="Seeded exterior painting baseline for residential projects.",
        finish_level_multipliers={"single_color": "1.00", "trim_and_body": "1.15"},
        complexity_multipliers={"single_story": "0.95", "two_story": "1.15", "extensive_prep": "1.25"},
        milestone_pattern=[
            {"title": "Wash & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 2},
            {"title": "Prime & Paint", "normalized_milestone_type": "painting", "duration_days": 2},
            {"title": "Touch-Up & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "surface_type", "label": "What exterior surfaces are included?", "type": "text", "required": True},
            {"key": "repair_scope", "label": "Are wood/siding repairs included?", "type": "select", "options": ["Yes", "No", "Allowance"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="electrical:electrical_upgrade",
        name="System Electrical Upgrade",
        project_type="Electrical",
        project_subtype="Electrical Upgrade",
        estimated_days=3,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("2500.00"),
        price_high=Decimal("12000.00"),
        duration_low=1,
        duration_high=5,
        description="Electrical upgrade starter for panel/service/circuit work.",
        scope_text="Perform approved electrical upgrades, coordinate inspections, and complete final verification.",
        source_note="Seeded electrical upgrade baseline for common residential panel and service work.",
        finish_level_multipliers={"panel_swap": "1.00", "service_upgrade": "1.20"},
        complexity_multipliers={"same_location": "1.00", "relocation": "1.18"},
        milestone_pattern=[
            {"title": "Permitting & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Upgrade Install", "normalized_milestone_type": "electrical_rough_in", "duration_days": 1},
            {"title": "Inspection & Closeout", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "service_size", "label": "What service/panel size is targeted?", "type": "text", "required": True},
            {"key": "permit_responsibility", "label": "Who is handling permits?", "type": "select", "options": ["Contractor", "Owner"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="plumbing:plumbing_repair_replacement",
        name="System Plumbing Repair / Replacement",
        project_type="Plumbing",
        project_subtype="Plumbing Repair / Replacement",
        estimated_days=2,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("600.00"),
        price_high=Decimal("8500.00"),
        duration_low=1,
        duration_high=4,
        description="Plumbing repair baseline for fixture replacement, leak repair, and focused replacements.",
        scope_text="Diagnose and complete the specified plumbing repair or replacement, then test and close out the work.",
        source_note="Seeded plumbing repair baseline for residential service work.",
        finish_level_multipliers={"repair": "1.00", "fixture_replace": "1.08", "line_replace": "1.20"},
        complexity_multipliers={"accessible": "0.95", "wall_opening_required": "1.20"},
        milestone_pattern=[
            {"title": "Diagnosis & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Repair / Replacement", "normalized_milestone_type": "plumbing_rough_in", "duration_days": 1},
            {"title": "Testing & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "access_conditions", "label": "Will wall/floor access be required?", "type": "select", "options": ["Yes", "No", "Unknown"], "required": True},
            {"key": "fixture_owner_supplied", "label": "Are any fixtures owner supplied?", "type": "select", "options": ["Yes", "No"], "required": False},
        ],
    ),
    SeedProjectSpec(
        key="hvac:hvac_replacement",
        name="System HVAC Replacement",
        project_type="HVAC",
        project_subtype="HVAC Replacement",
        estimated_days=3,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("6500.00"),
        price_high=Decimal("18000.00"),
        duration_low=1,
        duration_high=4,
        description="HVAC replacement baseline for unit swap, startup, and closeout.",
        scope_text="Replace the specified HVAC equipment, connect/charge/test system, and complete startup documentation.",
        source_note="Seeded HVAC replacement baseline for common residential equipment swaps.",
        finish_level_multipliers={"basic_split": "1.00", "high_efficiency": "1.18", "heat_pump": "1.22"},
        complexity_multipliers={"same_location": "1.00", "ductwork_changes": "1.18"},
        milestone_pattern=[
            {"title": "Equipment Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Install & Startup", "normalized_milestone_type": "installation", "duration_days": 1},
            {"title": "Testing & Closeout", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "equipment_type", "label": "What equipment is being replaced?", "type": "text", "required": True},
            {"key": "ductwork_scope", "label": "Are duct modifications included?", "type": "select", "options": ["Yes", "No", "Allowance"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="outdoor:deck_fence",
        name="System Deck / Fence",
        project_type="Outdoor",
        project_subtype="Deck / Fence",
        estimated_days=6,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("3000.00"),
        price_high=Decimal("22000.00"),
        duration_low=2,
        duration_high=10,
        description="Outdoor starter for deck or fence construction and repair work.",
        scope_text="Prepare site, perform structural framing/posts as needed, install finished surfaces, and complete final walkthrough.",
        source_note="Seeded outdoor construction baseline for deck and fence work.",
        finish_level_multipliers={"pressure_treated": "1.00", "cedar": "1.15", "composite": "1.25"},
        complexity_multipliers={"basic_layout": "1.00", "gate_or_stairs": "1.10", "elevated_or_multi_section": "1.22"},
        milestone_pattern=[
            {"title": "Site Prep & Layout", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Posts / Framing", "normalized_milestone_type": "framing", "duration_days": 2},
            {"title": "Surface / Panels Install", "normalized_milestone_type": "installation", "duration_days": 2},
            {"title": "Final Review", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "permit_needed", "label": "Is permitting required?", "type": "select", "options": ["Yes", "No", "Unknown"], "required": True},
            {"key": "material_family", "label": "What material family is planned?", "type": "select", "options": ["Pressure treated", "Cedar", "Composite", "Metal"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="repair:handyman_general_repair",
        name="System Handyman / General Repair",
        project_type="Repair",
        project_subtype="Handyman / General Repair",
        estimated_days=2,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("300.00"),
        price_high=Decimal("3500.00"),
        duration_low=1,
        duration_high=3,
        description="Flexible general repair starter for small-scope residential jobs.",
        scope_text="Review the requested repair list, complete agreed repair items, and verify the work with the homeowner.",
        source_note="Seeded general repair baseline for small-scope residential work.",
        finish_level_multipliers={"basic_fix": "1.00", "finish_carpentry": "1.15"},
        complexity_multipliers={"single_item": "0.90", "multi_trade": "1.20"},
        milestone_pattern=[
            {"title": "Review & Diagnosis", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Repair Work", "normalized_milestone_type": "general_milestone", "duration_days": 1},
            {"title": "Verification & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "repair_list", "label": "What repair items are included?", "type": "text", "required": True},
            {"key": "materials_allowance", "label": "Are materials billed separately?", "type": "select", "options": ["Included", "Allowance", "Owner supplied"], "required": True},
        ],
    ),
]


SEED_REGIONAL_OVERRIDES: list[SeedRegionalOverrideSpec] = [
    SeedRegionalOverrideSpec(
        benchmark_key="remodel:kitchen_remodel",
        region_state="TX",
        price_low=Decimal("19500.00"),
        price_high=Decimal("69000.00"),
        duration_low=15,
        duration_high=37,
        location_multiplier=Decimal("1.0600"),
        region_priority_weight=Decimal("1.10"),
        source_note="Texas kitchen remodel baseline with permit and labor uplift.",
        rationale="State-level kitchen remodel adjustment for Texas labor and inspection conditions.",
        clarifications=[
            {"key": "permit_municipality", "label": "Which Texas municipality will issue permits?", "type": "text", "required": False},
            {"key": "hoa_limits", "label": "Are there HOA work-hour or dumpster restrictions?", "type": "select", "options": ["Yes", "No", "Unknown"], "required": False},
        ],
    ),
    SeedRegionalOverrideSpec(
        benchmark_key="remodel:kitchen_remodel",
        region_state="TX",
        region_city="San Antonio",
        price_low=Decimal("20500.00"),
        price_high=Decimal("72000.00"),
        duration_low=16,
        duration_high=40,
        location_multiplier=Decimal("1.0900"),
        region_priority_weight=Decimal("1.20"),
        source_note="San Antonio kitchen remodel metro override.",
        rationale="San Antonio metro kitchen projects trend slightly above statewide baseline due to labor and logistics mix.",
    ),
    SeedRegionalOverrideSpec(
        benchmark_key="roofing:roof_replacement",
        region_state="TX",
        price_low=Decimal("9000.00"),
        price_high=Decimal("30500.00"),
        duration_low=2,
        duration_high=8,
        location_multiplier=Decimal("1.0700"),
        region_priority_weight=Decimal("1.10"),
        source_note="Texas roofing baseline adjusted for heat, disposal, and inspection conditions.",
        rationale="Texas roof replacements commonly include higher disposal and heat-related labor pressure.",
    ),
    SeedRegionalOverrideSpec(
        benchmark_key="roofing:roof_replacement",
        region_state="CO",
        price_low=Decimal("9800.00"),
        price_high=Decimal("33500.00"),
        duration_low=2,
        duration_high=9,
        location_multiplier=Decimal("1.1200"),
        region_priority_weight=Decimal("1.10"),
        source_note="Colorado roofing baseline adjusted for slope, weather, and insurance complexity.",
        rationale="Colorado roofing work often carries higher insurance-process and weather-driven costs.",
    ),
    SeedRegionalOverrideSpec(
        benchmark_key="painting:interior_painting",
        region_state="CA",
        price_low=Decimal("2300.00"),
        price_high=Decimal("11800.00"),
        duration_low=1,
        duration_high=6,
        location_multiplier=Decimal("1.1500"),
        region_priority_weight=Decimal("1.10"),
        source_note="California interior painting baseline adjusted for labor rates.",
        rationale="California residential painting commonly prices above national seeded baseline.",
    ),
]


def _milestones_for_template(spec: SeedProjectSpec) -> list[dict]:
    row_count = max(len(spec.milestone_pattern), 1)
    span = max(spec.estimated_days, row_count)
    price_span = spec.price_high - spec.price_low
    per_row = (price_span / Decimal(row_count)).quantize(Decimal("0.01")) if row_count else Decimal("0.00")
    rows: list[dict] = []
    for index, milestone in enumerate(spec.milestone_pattern, start=1):
        low_amount = (spec.price_low / Decimal(row_count)).quantize(Decimal("0.01"))
        high_amount = (spec.price_high / Decimal(row_count)).quantize(Decimal("0.01"))
        rows.append(
            {
                "title": milestone["title"],
                "description": milestone.get("description", ""),
                "sort_order": index,
                "normalized_milestone_type": milestone.get("normalized_milestone_type", ""),
                "recommended_days_from_start": milestone.get("day_offset", min(index, span)),
                "recommended_duration_days": milestone.get("duration_days", 1),
                "suggested_amount_low": low_amount,
                "suggested_amount_high": high_amount,
                "pricing_confidence": "low",
                "pricing_source_note": "Seeded MyHomeBro system benchmark",
                "materials_hint": milestone.get("materials_hint", ""),
            }
        )
    return rows


def _regional_template_tags(benchmark_key: str) -> list[str]:
    tags = set()
    for override in SEED_REGIONAL_OVERRIDES:
        if override.benchmark_key != benchmark_key:
            continue
        if override.region_city and override.region_state:
            tags.add(f"{override.region_state}:{override.region_city}")
        elif override.region_state:
            tags.add(override.region_state)
    return sorted(tags)


@transaction.atomic
def seed_system_benchmark_foundation() -> dict[str, int]:
    created_profiles = 0
    created_templates = 0
    updated_profiles = 0
    updated_templates = 0

    for spec in SEED_PROJECT_SPECS:
        profile_defaults = {
            "benchmark_match_key": spec.key,
            "project_type": spec.project_type,
            "project_subtype": spec.project_subtype,
            "normalized_region_key": build_normalized_region_key(country="US"),
            "is_system": True,
            "is_active": True,
            "base_price_low": spec.price_low,
            "base_price_high": spec.price_high,
            "base_duration_days_low": spec.duration_low,
            "base_duration_days_high": spec.duration_high,
            "default_milestone_count": len(spec.milestone_pattern),
            "default_milestone_pattern": spec.milestone_pattern,
            "default_clarification_questions": spec.clarifications,
            "finish_level_multipliers": spec.finish_level_multipliers,
            "complexity_multipliers": spec.complexity_multipliers,
            "location_multiplier": Decimal("1.0000"),
            "region_priority_weight": Decimal("1.00"),
            "source_note": spec.source_note,
            "rationale": spec.description,
        }
        profile, created = SeedBenchmarkProfile.objects.update_or_create(
            benchmark_key=spec.key,
            defaults=profile_defaults,
        )
        if created:
            created_profiles += 1
        else:
            updated_profiles += 1

        template = ProjectTemplate.objects.filter(is_system=True, benchmark_match_key=spec.key).first()
        template_defaults = {
            "name": spec.name,
            "project_type": spec.project_type,
            "project_subtype": spec.project_subtype,
            "description": spec.description,
            "estimated_days": spec.estimated_days,
            "payment_structure": spec.payment_structure,
            "retainage_percent": spec.retainage_percent,
            "default_scope": spec.scope_text,
            "default_clarifications": spec.clarifications,
            "benchmark_match_key": spec.key,
            "region_tags": _regional_template_tags(spec.key),
            "project_materials_hint": spec.project_materials_hint,
            "is_system": True,
            "is_active": True,
            "visibility": ProjectTemplate.Visibility.SYSTEM,
            "allow_discovery": True,
            "normalized_region_key": build_normalized_region_key(country="US"),
            "benchmark_profile": profile,
            "source_system_template": None,
        }
        if template is None:
            template = ProjectTemplate.objects.create(**template_defaults)
            created_templates += 1
        else:
            changed = False
            for field, value in template_defaults.items():
                if getattr(template, field) != value:
                    setattr(template, field, value)
                    changed = True
            if changed:
                template.save()
                updated_templates += 1

        profile.template = template
        profile.normalized_region_key = (
            build_normalized_region_key(country="US", state=profile.region_state, city=profile.region_city)
            if profile.region_state or profile.region_city
            else build_normalized_region_key(country="US")
        )
        profile.save(update_fields=["template", "normalized_region_key"])

        template_rows = _milestones_for_template(spec)
        existing_rows = list(template.milestones.all().order_by("sort_order", "id"))
        if len(existing_rows) != len(template_rows):
            template.milestones.all().delete()
            existing_rows = []

        if not existing_rows:
            for row in template_rows:
                ProjectTemplateMilestone.objects.create(template=template, **row)
        else:
            for milestone, row in zip(existing_rows, template_rows):
                changed = False
                for field, value in row.items():
                    if getattr(milestone, field) != value:
                        setattr(milestone, field, value)
                        changed = True
                if changed:
                    milestone.save()

    spec_by_key = {spec.key: spec for spec in SEED_PROJECT_SPECS}
    for override in SEED_REGIONAL_OVERRIDES:
        spec = spec_by_key[override.benchmark_key]
        base_profile = SeedBenchmarkProfile.objects.get(benchmark_key=override.benchmark_key)
        benchmark_key = ":".join(
            part
            for part in [
                override.benchmark_key,
                override.region_state.lower().replace(" ", "_") if override.region_state else "",
                override.region_city.lower().replace(" ", "_") if override.region_city else "",
                override.normalized_region_key.lower().replace(":", "_") if override.normalized_region_key and not (override.region_state or override.region_city) else "",
            ]
            if part
        )
        profile_defaults = {
            "benchmark_match_key": base_profile.benchmark_match_key,
            "project_type": base_profile.project_type,
            "project_subtype": base_profile.project_subtype,
            "region_state": override.region_state,
            "region_city": override.region_city,
            "normalized_region_key": (
                override.normalized_region_key
                or build_normalized_region_key(country="US", state=override.region_state, city=override.region_city)
            ),
            "template": base_profile.template,
            "is_system": True,
            "is_active": True,
            "base_price_low": override.price_low,
            "base_price_high": override.price_high,
            "base_duration_days_low": override.duration_low,
            "base_duration_days_high": override.duration_high,
            "default_milestone_count": len(override.milestone_pattern or base_profile.default_milestone_pattern),
            "default_milestone_pattern": override.milestone_pattern or base_profile.default_milestone_pattern,
            "default_clarification_questions": (base_profile.default_clarification_questions or []) + list(override.clarifications or []),
            "finish_level_multipliers": base_profile.finish_level_multipliers,
            "complexity_multipliers": base_profile.complexity_multipliers,
            "location_multiplier": override.location_multiplier,
            "region_priority_weight": override.region_priority_weight,
            "source_note": override.source_note,
            "rationale": override.rationale or spec.description,
        }
        _profile, created = SeedBenchmarkProfile.objects.update_or_create(
            benchmark_key=benchmark_key,
            defaults=profile_defaults,
        )
        if created:
            created_profiles += 1
        else:
            updated_profiles += 1

    specs_by_type: dict[str, list[SeedProjectSpec]] = {}
    for spec in SEED_PROJECT_SPECS:
        specs_by_type.setdefault(spec.project_type, []).append(spec)

    for project_type, typed_specs in specs_by_type.items():
        exemplar = typed_specs[0]
        benchmark_key = f"type:{project_type.lower().replace(' ', '_')}"
        profile_defaults = {
            "benchmark_match_key": project_type.lower(),
            "project_type": project_type,
            "project_subtype": "",
            "normalized_region_key": build_normalized_region_key(country="US"),
            "template": None,
            "is_system": True,
            "is_active": True,
            "base_price_low": min(spec.price_low for spec in typed_specs),
            "base_price_high": max(spec.price_high for spec in typed_specs),
            "base_duration_days_low": min(spec.duration_low for spec in typed_specs),
            "base_duration_days_high": max(spec.duration_high for spec in typed_specs),
            "default_milestone_count": len(exemplar.milestone_pattern),
            "default_milestone_pattern": exemplar.milestone_pattern,
            "default_clarification_questions": exemplar.clarifications,
            "finish_level_multipliers": exemplar.finish_level_multipliers,
            "complexity_multipliers": exemplar.complexity_multipliers,
            "location_multiplier": Decimal("1.0000"),
            "region_priority_weight": Decimal("0.95"),
            "source_note": f"Type-level seeded fallback for {project_type}",
            "rationale": f"Fallback seeded benchmark aggregated from {len(typed_specs)} system starters.",
        }
        _profile, created = SeedBenchmarkProfile.objects.update_or_create(
            benchmark_key=benchmark_key,
            defaults=profile_defaults,
        )
        if created:
            created_profiles += 1
        else:
            updated_profiles += 1

    type_region_groups: dict[tuple[str, str, str, str], list[SeedBenchmarkProfile]] = {}
    for profile in SeedBenchmarkProfile.objects.filter(is_system=True, is_active=True).exclude(project_type="").exclude(project_subtype=""):
        if not (profile.region_state or profile.region_city or profile.normalized_region_key):
            continue
        type_region_groups.setdefault(
            (
                profile.project_type,
                profile.region_state,
                profile.region_city,
                profile.normalized_region_key,
            ),
            [],
        ).append(profile)

    for (project_type, region_state, region_city, normalized_region_key), grouped_profiles in type_region_groups.items():
        exemplar = grouped_profiles[0]
        key_parts = ["type", project_type.lower().replace(" ", "_")]
        if region_state:
            key_parts.append(region_state.lower().replace(" ", "_"))
        if region_city:
            key_parts.append(region_city.lower().replace(" ", "_"))
        elif normalized_region_key and not region_state:
            key_parts.append(normalized_region_key.lower().replace(":", "_"))
        benchmark_key = ":".join(key_parts)
        profile_defaults = {
            "benchmark_match_key": project_type.lower().replace(" ", "_"),
            "project_type": project_type,
            "project_subtype": "",
            "region_state": region_state,
            "region_city": region_city,
            "normalized_region_key": normalized_region_key,
            "template": None,
            "is_system": True,
            "is_active": True,
            "base_price_low": min(profile.base_price_low for profile in grouped_profiles),
            "base_price_high": max(profile.base_price_high for profile in grouped_profiles),
            "base_duration_days_low": min(profile.base_duration_days_low for profile in grouped_profiles),
            "base_duration_days_high": max(profile.base_duration_days_high for profile in grouped_profiles),
            "default_milestone_count": exemplar.default_milestone_count,
            "default_milestone_pattern": exemplar.default_milestone_pattern,
            "default_clarification_questions": exemplar.default_clarification_questions,
            "finish_level_multipliers": exemplar.finish_level_multipliers,
            "complexity_multipliers": exemplar.complexity_multipliers,
            "location_multiplier": max(profile.location_multiplier for profile in grouped_profiles),
            "region_priority_weight": max(profile.region_priority_weight for profile in grouped_profiles),
            "source_note": f"Type-level regional seeded fallback for {project_type}",
            "rationale": f"Fallback seeded benchmark aggregated from {len(grouped_profiles)} regional system profiles.",
        }
        _profile, created = SeedBenchmarkProfile.objects.update_or_create(
            benchmark_key=benchmark_key,
            defaults=profile_defaults,
        )
        if created:
            created_profiles += 1
        else:
            updated_profiles += 1

    generic_defaults = {
        "benchmark_match_key": "generic",
        "project_type": "",
        "project_subtype": "",
        "normalized_region_key": build_normalized_region_key(country="US"),
        "template": None,
        "is_system": True,
        "is_active": True,
        "base_price_low": min(spec.price_low for spec in SEED_PROJECT_SPECS),
        "base_price_high": max(spec.price_high for spec in SEED_PROJECT_SPECS),
        "base_duration_days_low": min(spec.duration_low for spec in SEED_PROJECT_SPECS),
        "base_duration_days_high": max(spec.duration_high for spec in SEED_PROJECT_SPECS),
        "default_milestone_count": 3,
        "default_milestone_pattern": [
            {"title": "Project Setup", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Main Scope", "normalized_milestone_type": "general_milestone", "duration_days": 2},
            {"title": "Closeout", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        "default_clarification_questions": [
            {"key": "site_conditions", "label": "Are there any site access or occupancy constraints?", "type": "text", "required": False},
            {"key": "material_responsibility", "label": "Who is supplying primary materials?", "type": "select", "options": ["Contractor", "Owner", "Mixed"], "required": False},
        ],
        "finish_level_multipliers": {},
        "complexity_multipliers": {},
        "location_multiplier": Decimal("1.0000"),
        "region_priority_weight": Decimal("0.75"),
        "source_note": "Generic seeded national fallback used when no project family baseline exists.",
        "rationale": "Final generic fallback to keep the estimator foundation predictable before richer data exists.",
    }
    _generic, created = SeedBenchmarkProfile.objects.update_or_create(
        benchmark_key="generic:national",
        defaults=generic_defaults,
    )
    if created:
        created_profiles += 1
    else:
        updated_profiles += 1

    return {
        "created_profiles": created_profiles,
        "updated_profiles": updated_profiles,
        "created_templates": created_templates,
        "updated_templates": updated_templates,
    }
