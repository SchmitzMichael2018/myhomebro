from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from django.db.models import Q

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
    exclusions_text: str = ""
    assumptions_text: str = ""


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
        name="Standard Kitchen Remodel",
        project_type="Remodel",
        project_subtype="Kitchen Remodel",
        estimated_days=21,
        payment_structure="progress",
        retainage_percent=Decimal("5.00"),
        price_low=Decimal("18000.00"),
        price_high=Decimal("65000.00"),
        duration_low=14,
        duration_high=35,
        description="Reusable kitchen remodel template covering planning, protection, demolition, rough-ins, cabinetry, finish installation, and closeout.",
        scope_text=(
            "Included Work:\n"
            "- Confirm kitchen layout, finish selections, and work-area protection plan before starting work\n"
            "- Protect adjacent rooms, flooring, countertops, and existing finishes not included in the remodel\n"
            "- Remove agreed cabinets, surfaces, fixtures, and finishes included in the approved scope\n"
            "- Coordinate required rough plumbing, electrical, and ventilation work within the agreed layout\n"
            "- Install cabinets, trim, countertops, backsplash, fixtures, and finish materials included in the agreement\n"
            "- Complete punch-list touchups, jobsite cleanup, and final walkthrough\n\n"
            "Exclusions:\n"
            "- Structural wall changes, hazardous-material remediation, and hidden-condition repairs unless specifically included\n"
            "- Appliance purchase, utility upgrades, or permit fees unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Approve finish selections and provide access to the kitchen and staging areas\n"
            "- Remove personal items from cabinets and work areas before the start date"
        ),
        source_note="Seeded residential remodeling starter based on common mid-market kitchen projects.",
        project_materials_hint="Cabinets, countertops, backsplash tile, trim, hardware, and appliance coordination often drive budget range.",
        exclusions_text="Structural wall changes, hazardous-material remediation, hidden-condition repairs, appliance purchase, utility upgrades, and permit fees unless specifically included.",
        assumptions_text="Customer approves selections before work begins, removes personal items from work areas, and provides access to staging and utility shutoffs.",
        finish_level_multipliers={"builder_grade": "0.90", "mid_grade": "1.00", "premium": "1.25"},
        complexity_multipliers={"light_layout_change": "1.00", "wall_move": "1.18", "structural": "1.30"},
        milestone_pattern=[
            {"title": "Planning & Protection", "normalized_milestone_type": "site_preparation", "duration_days": 2},
            {"title": "Demo & Rough-In", "normalized_milestone_type": "demolition", "duration_days": 4},
            {"title": "Cabinets & Counters", "normalized_milestone_type": "cabinet_installation", "duration_days": 6},
            {"title": "Fixtures & Finish Work", "normalized_milestone_type": "installation", "duration_days": 5},
            {"title": "Final Walkthrough", "normalized_milestone_type": "final_walkthrough", "duration_days": 2},
        ],
        clarifications=[
            {"key": "cabinet_scope", "label": "Are cabinets new, reused, or owner-supplied?", "type": "select", "options": ["New", "Reuse existing", "Owner supplied"], "required": True},
            {"key": "appliance_scope", "label": "Are appliances included in contractor scope?", "type": "select", "options": ["Yes", "No"], "required": True},
            {"key": "layout_change", "label": "Will walls, plumbing, or electrical layout move?", "type": "select", "options": ["No layout change", "Minor layout change", "Major layout change"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="remodel:bathroom_remodel",
        name="Bathroom Remodel",
        project_type="Remodel",
        project_subtype="Bathroom Remodel",
        estimated_days=14,
        payment_structure="progress",
        retainage_percent=Decimal("5.00"),
        price_low=Decimal("9000.00"),
        price_high=Decimal("32000.00"),
        duration_low=7,
        duration_high=21,
        description="Reusable bathroom remodel template covering protection, demolition, rough-ins, waterproofing, tile, fixture installation, and closeout.",
        scope_text=(
            "Included Work:\n"
            "- Protect adjacent floors, walls, and access paths before demolition begins\n"
            "- Remove agreed bathroom fixtures, finishes, and surfaces included in the remodel scope\n"
            "- Complete agreed plumbing/electrical rough-in adjustments and substrate preparation\n"
            "- Install waterproofing, tile or wall finishes, vanity, trim, fixtures, and accessories included in the agreement\n"
            "- Test fixture operation, complete punch-list touchups, and clean the work area\n\n"
            "Exclusions:\n"
            "- Mold remediation, structural framing repair, and concealed plumbing/electrical repairs unless listed\n"
            "- Specialty glass, custom cabinetry, permits, and owner-selected fixtures unless specifically included\n\n"
            "Customer Responsibilities:\n"
            "- Approve tile, fixture, and finish selections before ordering\n"
            "- Maintain access to the bathroom, water shutoffs, and work path during scheduled work"
        ),
        source_note="Seeded bathroom remodel baseline for residential contractors.",
        finish_level_multipliers={"standard": "1.00", "spa_finish": "1.20"},
        complexity_multipliers={"powder_room": "0.80", "hall_bath": "1.00", "primary_suite": "1.25"},
        milestone_pattern=[
            {"title": "Protection & Demo", "normalized_milestone_type": "demolition", "duration_days": 2},
            {"title": "Plumbing & Waterproofing", "normalized_milestone_type": "plumbing_rough_in", "duration_days": 3},
            {"title": "Tile & Surfaces", "normalized_milestone_type": "tile_installation", "duration_days": 4},
            {"title": "Fixtures & Vanity", "normalized_milestone_type": "vanity_installation", "duration_days": 3},
            {"title": "Final Walkthrough", "normalized_milestone_type": "final_walkthrough", "duration_days": 2},
        ],
        clarifications=[
            {"key": "wet_area_scope", "label": "Is the shower/tub area being replaced?", "type": "select", "options": ["Yes", "No"], "required": True},
            {"key": "tile_extent", "label": "What tile areas are included?", "type": "text", "required": True},
            {"key": "fixture_supply", "label": "Who is supplying fixtures?", "type": "select", "options": ["Contractor", "Owner"], "required": True},
        ],
        project_materials_hint="Tile selection, shower glass, and specialty plumbing trim are common price drivers.",
        exclusions_text="Mold remediation, structural framing repair, concealed trade repairs, specialty glass, custom cabinetry, permits, and owner-selected fixtures unless specifically included.",
        assumptions_text="Customer approves finish selections before ordering and provides access to bathroom, water shutoffs, and work path.",
    ),
    SeedProjectSpec(
        key="roofing:roof_replacement",
        name="Roof Replacement",
        project_type="Roofing",
        project_subtype="Roof Replacement",
        estimated_days=5,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("8500.00"),
        price_high=Decimal("28000.00"),
        duration_low=2,
        duration_high=7,
        description="Reusable roof replacement template covering tear-off, deck review, weatherproofing, roofing installation, cleanup, and final review.",
        scope_text=(
            "Included Work:\n"
            "- Protect landscaping, driveway, and adjacent exterior areas before roof work begins\n"
            "- Remove agreed existing roofing materials and dispose of roofing debris\n"
            "- Review visible roof decking and notify customer of repair needs outside the agreed scope\n"
            "- Install underlayment, flashing, drip edge, vents, shingles, and accessories included in the agreement\n"
            "- Complete magnetic sweep, cleanup, and final roof walkthrough\n\n"
            "Exclusions:\n"
            "- Deck replacement, structural repairs, gutter work, skylight replacement, and permit fees unless specifically included\n"
            "- Insurance claim negotiation or code-upgrade work unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Provide driveway/work-area access and move vehicles before scheduled work\n"
            "- Identify sensitive landscaping, attic access concerns, or known leak locations"
        ),
        source_note="Seeded roofing baseline for asphalt-shingle residential work.",
        project_materials_hint="Shingle type, underlayment, flashing, vents, drip edge, decking allowance, and roof complexity drive pricing.",
        exclusions_text="Deck replacement, structural repairs, gutter work, skylight replacement, permit fees, insurance negotiation, and code-upgrade work unless included.",
        assumptions_text="Customer provides driveway/work-area access, moves vehicles, and identifies sensitive landscaping or known leak locations.",
        finish_level_multipliers={"standard_shingle": "1.00", "architectural": "1.12", "premium_system": "1.28"},
        complexity_multipliers={"single_story": "0.95", "two_story": "1.05", "complex_roofline": "1.18"},
        milestone_pattern=[
            {"title": "Tear-Off & Deck Review", "normalized_milestone_type": "roof_removal", "duration_days": 1},
            {"title": "Weatherproofing & Flashing", "normalized_milestone_type": "roof_installation", "duration_days": 1},
            {"title": "Roof Installation", "normalized_milestone_type": "roof_installation", "duration_days": 2},
            {"title": "Cleanup & Final Review", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "deck_repair_allowance", "label": "Should deck repairs be handled as an allowance/change order?", "type": "select", "options": ["Allowance", "Change order", "Included"], "required": True},
            {"key": "insurance_claim", "label": "Is this project tied to an insurance claim?", "type": "select", "options": ["Yes", "No"], "required": False},
        ],
    ),
    SeedProjectSpec(
        key="installation:flooring_installation",
        name="Flooring Installation",
        project_type="Flooring",
        project_subtype="Flooring Installation",
        estimated_days=4,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("2500.00"),
        price_high=Decimal("14000.00"),
        duration_low=2,
        duration_high=7,
        description="Reusable flooring installation template for prep, layout, main install, trim, and cleanup.",
        scope_text=(
            "Included Work:\n"
            "- Confirm flooring material, installation areas, direction, and transition locations before work begins\n"
            "- Protect adjacent surfaces and remove agreed existing flooring, trim, or transition pieces as listed\n"
            "- Check and prepare the substrate for installation-ready conditions within the agreed scope\n"
            "- Install underlayment, vapor barrier, flooring, transitions, and basic trim items included in the agreement\n"
            "- Complete final cuts, cleanup, debris removal, and walkthrough of installed flooring\n\n"
            "Exclusions:\n"
            "- Subfloor leveling, moisture remediation, structural subfloor repairs, and asbestos/lead abatement unless included\n"
            "- Furniture moving, appliance moving, painting, and baseboard replacement unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Clear personal belongings from flooring areas before work begins\n"
            "- Provide approved flooring material or confirm contractor-supplied material selections before scheduling"
        ),
        source_note="Seeded flooring baseline for residential flooring replacement.",
        finish_level_multipliers={"lvp": "1.00", "laminate": "0.95", "engineered_hardwood": "1.20", "tile": "1.25"},
        complexity_multipliers={"clear_floor": "0.95", "occupied_home": "1.05", "subfloor_repair": "1.20"},
        project_materials_hint="Flooring material, underlayment, transitions, trim, adhesive, moisture barrier, and subfloor prep drive price and schedule.",
        exclusions_text="Subfloor leveling, moisture remediation, structural subfloor repairs, asbestos/lead abatement, furniture moving, appliance moving, painting, and baseboard replacement unless included.",
        assumptions_text="Customer clears belongings from flooring areas and confirms material selections or owner-supplied material availability before scheduling.",
        milestone_pattern=[
            {
                "title": "Prep & Leveling",
                "description": "Confirm rooms and flooring layout, protect adjacent finishes, remove agreed existing flooring or transitions, and prepare the substrate for installation-ready conditions.",
                "normalized_milestone_type": "site_preparation",
                "duration_days": 1,
                "suggested_amount_percent": "25.00",
                "pricing_advisory": True,
                "materials_hint": "Substrate prep, moisture barrier, underlayment, and transition planning.",
            },
            {
                "title": "Install Flooring",
                "description": "Install the selected flooring in the agreed areas, including layout alignment, field cuts, underlayment or vapor barrier where included, and transitions between rooms.",
                "normalized_milestone_type": "flooring_installation",
                "duration_days": 2,
                "suggested_amount_percent": "55.00",
                "pricing_advisory": True,
                "materials_hint": "Flooring material, adhesive or locking system, underlayment, transitions, and waste allowance.",
            },
            {
                "title": "Trim & Cleanup",
                "description": "Complete final cuts, install included trim or transition pieces, remove installation debris, clean the work areas, and walk through the completed flooring.",
                "normalized_milestone_type": "cleanup",
                "duration_days": 1,
                "suggested_amount_percent": "20.00",
                "pricing_advisory": True,
                "materials_hint": "Transition strips, quarter round or agreed trim pieces, fasteners, and cleanup supplies.",
            },
        ],
        clarifications=[
            {"key": "flooring_material", "label": "What flooring material is being installed?", "type": "select", "options": ["LVP", "Laminate", "Engineered Hardwood", "Tile"], "required": True},
            {"key": "furniture_moving", "label": "Is furniture moving included?", "type": "select", "options": ["Yes", "No"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="painting:interior_painting",
        name="Interior Painting",
        project_type="Painting",
        project_subtype="Interior Painting",
        estimated_days=3,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("1800.00"),
        price_high=Decimal("9500.00"),
        duration_low=1,
        duration_high=5,
        description="Reusable interior painting template for protection, prep, coating application, and closeout.",
        scope_text=(
            "Included Work:\n"
            "- Confirm rooms, surfaces, paint colors, sheen, and coating quantities before work begins\n"
            "- Protect floors, furniture, fixtures, and adjacent finishes in the work areas\n"
            "- Patch minor nail holes and surface blemishes included in the agreed preparation level\n"
            "- Caulk minor gaps where included and sand/prep surfaces for paint application\n"
            "- Apply primer and finish coats to the agreed walls, ceilings, trim, doors, or other listed surfaces\n"
            "- Complete touchups, remove protection, clean work areas, and conduct final walkthrough\n\n"
            "Exclusions:\n"
            "- Major drywall repair, texture matching, wallpaper removal, lead paint handling, and water-damage repair unless included\n"
            "- Moving heavy furniture, window treatments, or fragile items unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Confirm paint colors and finish selections before work begins\n"
            "- Remove fragile personal items and provide access to each room being painted"
        ),
        source_note="Seeded interior painting baseline for residential work.",
        finish_level_multipliers={"walls_only": "0.90", "walls_trim": "1.00", "full_interior": "1.20"},
        complexity_multipliers={"vacant": "0.95", "occupied": "1.10"},
        project_materials_hint="Paint brand, sheen, primer needs, patching level, trim/door count, and occupied-home protection drive labor.",
        exclusions_text="Major drywall repair, texture matching, wallpaper removal, lead paint handling, water-damage repair, heavy furniture moving, and window treatment removal unless included.",
        assumptions_text="Customer confirms colors and sheen before work begins, removes fragile items, and provides room access.",
        milestone_pattern=[
            {"title": "Protection & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Repair & Patching", "normalized_milestone_type": "site_preparation", "duration_days": 1},
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
        name="Exterior Painting",
        project_type="Painting",
        project_subtype="Exterior Painting",
        estimated_days=5,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("3000.00"),
        price_high=Decimal("18000.00"),
        duration_low=2,
        duration_high=8,
        description="Reusable exterior painting template covering wash, prep, minor surface repair, coating application, cleanup, and walkthrough.",
        scope_text=(
            "Included Work:\n"
            "- Confirm exterior surfaces, colors, sheen, and weather-dependent schedule before work begins\n"
            "- Wash or clean agreed surfaces and protect landscaping, windows, fixtures, and adjacent finishes\n"
            "- Scrape, sand, caulk, and spot-prime surfaces included in the agreed preparation level\n"
            "- Apply primer and finish coats to listed siding, trim, doors, railings, or other exterior surfaces\n"
            "- Complete touchups, remove protection, clean the work area, and conduct final walkthrough\n\n"
            "Exclusions:\n"
            "- Wood rot repair, siding replacement, lead paint handling, major carpentry, and structural repairs unless included\n"
            "- Color changes after approval and specialty coatings unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Confirm color selections before work begins and provide exterior water/power access\n"
            "- Trim vegetation or move outdoor items that block the work surfaces"
        ),
        source_note="Seeded exterior painting baseline for residential projects.",
        finish_level_multipliers={"single_color": "1.00", "trim_and_body": "1.15"},
        complexity_multipliers={"single_story": "0.95", "two_story": "1.15", "extensive_prep": "1.25"},
        project_materials_hint="Paint system, primer, caulk, patching level, trim count, height, weather windows, and access constraints drive labor.",
        exclusions_text="Wood rot repair, siding replacement, lead paint handling, major carpentry, structural repairs, color changes after approval, and specialty coatings unless included.",
        assumptions_text="Customer confirms colors, provides water/power access, trims vegetation, and moves outdoor items blocking surfaces.",
        milestone_pattern=[
            {"title": "Wash & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 2},
            {"title": "Surface Repair & Spot Prime", "normalized_milestone_type": "surface_preparation", "duration_days": 1},
            {"title": "Prime & Paint", "normalized_milestone_type": "painting", "duration_days": 2},
            {"title": "Touch-Up & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "surface_type", "label": "What exterior surfaces are included?", "type": "text", "required": True},
            {"key": "repair_scope", "label": "Are wood/siding repairs included?", "type": "select", "options": ["Yes", "No", "Allowance"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="cabinetry:cabinet_installation",
        name="Cabinet Installation",
        project_type="Cabinetry",
        project_subtype="Cabinet Installation",
        estimated_days=4,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("2200.00"),
        price_high=Decimal("12500.00"),
        duration_low=2,
        duration_high=6,
        description="Reusable cabinet installation template for measurements, prep, installation, alignment, and closeout.",
        scope_text=(
            "Included Work:\n"
            "- Confirm cabinet layout, cabinet inventory, hardware, fillers, panels, and trim pieces before installation\n"
            "- Protect adjacent finishes and prepare walls/floors for cabinet installation within agreed conditions\n"
            "- Set, level, fasten, and align cabinets included in the approved layout\n"
            "- Install included fillers, toe kicks, panels, trim, and hardware where listed\n"
            "- Complete adjustment, cleanup, and final walkthrough of installed cabinetry\n\n"
            "Exclusions:\n"
            "- Cabinet fabrication, countertop work, plumbing/electrical relocation, wall repair, and painting unless included\n"
            "- Hidden blocking/framing repairs or correction of out-of-level walls/floors unless listed\n\n"
            "Customer Responsibilities:\n"
            "- Confirm cabinet delivery, layout, and hardware before installation\n"
            "- Clear work areas and provide access to the installation space"
        ),
        source_note="Seeded cabinet installation baseline for focused kitchen, bath, and storage cabinet projects.",
        finish_level_multipliers={"stock": "0.95", "semi_custom": "1.00", "custom": "1.18"},
        complexity_multipliers={"single_wall": "0.92", "multi_wall": "1.00", "island_or_built_in": "1.12"},
        milestone_pattern=[
            {"title": "Measurements & Staging", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Layout & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Cabinet Installation", "normalized_milestone_type": "cabinet_installation", "duration_days": 1},
            {"title": "Alignment & Closeout", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "cabinet_scope", "label": "How many cabinet runs or zones are included?", "type": "text", "required": True},
            {"key": "hardware_install", "label": "Is hardware installation included?", "type": "select", "options": ["Yes", "No"], "required": True},
        ],
        project_materials_hint="Cabinet box quality, filler needs, trim, and hardware installation often shift labor and schedule.",
        exclusions_text="Cabinet fabrication, countertop work, plumbing/electrical relocation, wall repair, painting, hidden blocking/framing repairs, and correction of out-of-level walls/floors unless included.",
        assumptions_text="Customer confirms cabinet delivery, layout, and hardware before installation and clears work areas.",
    ),
    SeedProjectSpec(
        key="installation:countertop_installation",
        name="Countertop Installation",
        project_type="Countertops",
        project_subtype="Countertop Installation",
        estimated_days=4,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("1800.00"),
        price_high=Decimal("9500.00"),
        duration_low=1,
        duration_high=5,
        description="Reusable countertop installation template for template prep, fabrication coordination, install, and sink closeout.",
        scope_text=(
            "Included Work:\n"
            "- Confirm countertop material, edge profile, cutouts, seams, and installation areas before work begins\n"
            "- Prepare cabinet bases and installation surfaces for agreed countertop installation\n"
            "- Coordinate field measurements, fabrication readiness, delivery, and staging\n"
            "- Install countertops, seams, backsplash pieces, and cutout items listed in the agreement\n"
            "- Complete sink/fixture closeout items included in scope and final cleanup\n\n"
            "Exclusions:\n"
            "- Cabinet repair, plumbing reconnect, electrical work, wall repair, and disposal unless specifically included\n"
            "- Material upgrades, added cutouts, or layout changes after approval unless handled by change order\n\n"
            "Customer Responsibilities:\n"
            "- Confirm material, edge, sink, and fixture selections before fabrication\n"
            "- Provide clear access to cabinets and remove items from work areas"
        ),
        source_note="Seeded countertop installation baseline for stone, solid-surface, and laminate replacement jobs.",
        finish_level_multipliers={"laminate": "0.90", "quartz": "1.00", "natural_stone": "1.18"},
        complexity_multipliers={"straight_runs": "0.94", "island_cutouts": "1.08", "waterfall_or_complex_edges": "1.18"},
        project_materials_hint="Countertop material, edge detail, seams, sink/cooktop cutouts, backsplash, and plumbing reconnect responsibility drive price.",
        exclusions_text="Cabinet repair, plumbing reconnect, electrical work, wall repair, disposal, material upgrades, added cutouts, and post-approval layout changes unless included.",
        assumptions_text="Customer confirms material/edge/sink selections before fabrication and clears cabinet/work areas.",
        milestone_pattern=[
            {"title": "Template & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Fabrication Coordination", "normalized_milestone_type": "general_milestone", "duration_days": 1},
            {"title": "Countertop Install", "normalized_milestone_type": "installation", "duration_days": 1},
            {"title": "Sink & Closeout", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "countertop_material", "label": "What countertop material is being installed?", "type": "select", "options": ["Laminate", "Quartz", "Granite", "Solid surface"], "required": True},
            {"key": "sink_scope", "label": "Does scope include sink disconnect/reconnect?", "type": "select", "options": ["Yes", "No"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="installation:appliance_installation",
        name="Appliance Installation",
        project_type="Appliance Installation",
        project_subtype="Appliance Installation",
        estimated_days=2,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("350.00"),
        price_high=Decimal("3200.00"),
        duration_low=1,
        duration_high=3,
        description="Reusable appliance installation template for delivery coordination, prep, install, testing, and handoff.",
        scope_text=(
            "Included Work:\n"
            "- Confirm appliance model, location, utility requirements, clearances, and delivery readiness\n"
            "- Protect adjacent finishes and stage appliance or equipment for installation\n"
            "- Remove or disconnect existing appliance only where listed in the agreement\n"
            "- Install, level, connect, and secure the appliance using approved connections included in scope\n"
            "- Test basic operation, review care/handoff notes, and clean the immediate work area\n\n"
            "Exclusions:\n"
            "- New utility lines, cabinet modification, vent relocation, permit work, and manufacturer warranty registration unless included\n"
            "- Haul-away or disposal of existing appliance unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Confirm appliance delivery, model compatibility, and access path before installation\n"
            "- Provide utility access and remove stored items from the installation area"
        ),
        source_note="Seeded appliance installation baseline for common residential kitchen and laundry appliance swaps.",
        finish_level_multipliers={"single_appliance": "1.00", "built_in": "1.10", "premium_package": "1.18"},
        complexity_multipliers={"like_for_like": "0.95", "minor_modifications": "1.08", "utility_adjustments": "1.18"},
        project_materials_hint="Appliance type, utility readiness, connection kits, anti-tip hardware, venting, haul-away, and cabinet fit drive scope.",
        exclusions_text="New utility lines, cabinet modification, vent relocation, permit work, manufacturer warranty registration, haul-away, and disposal unless included.",
        assumptions_text="Customer confirms appliance delivery/model compatibility, provides utility access, and clears installation area.",
        milestone_pattern=[
            {"title": "Delivery & Staging", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Removal & Prep", "normalized_milestone_type": "demolition", "duration_days": 1},
            {"title": "Appliance Install", "normalized_milestone_type": "installation", "duration_days": 1},
            {"title": "Testing & Handoff", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "appliance_type", "label": "Which appliance or appliances are included?", "type": "text", "required": True},
            {"key": "haul_away", "label": "Is haul-away of existing equipment included?", "type": "select", "options": ["Yes", "No"], "required": False},
        ],
    ),
    SeedProjectSpec(
        key="electrical:electrical_upgrade",
        name="Electrical Work",
        project_type="Electrical",
        project_subtype="Electrical Work",
        estimated_days=3,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("2500.00"),
        price_high=Decimal("12000.00"),
        duration_low=1,
        duration_high=5,
        description="Reusable electrical work template for scoped repairs, device work, circuit upgrades, testing, and closeout.",
        scope_text=(
            "Included Work:\n"
            "- Confirm electrical items, locations, access needs, and permit/inspection responsibility before work begins\n"
            "- Protect work areas and safely de-energize circuits as needed for the agreed scope\n"
            "- Complete approved wiring, device, fixture, circuit, or panel-related work listed in the agreement\n"
            "- Label, test, and verify operation of completed electrical work\n"
            "- Complete trim-out, cleanup, and final walkthrough\n\n"
            "Exclusions:\n"
            "- Utility company work, service upgrades, drywall repair, painting, permit fees, and hidden-code corrections unless included\n"
            "- Work outside listed devices, circuits, or fixtures unless approved by change order\n\n"
            "Customer Responsibilities:\n"
            "- Provide access to panels, rooms, attic/crawl areas, and affected devices\n"
            "- Identify known electrical issues, access limitations, and preferred fixture/device locations"
        ),
        source_note="Seeded electrical work baseline for common residential service, repair, and upgrade jobs.",
        finish_level_multipliers={"device_work": "0.95", "circuit_work": "1.00", "panel_or_service_work": "1.20"},
        complexity_multipliers={"same_location": "1.00", "access_constraints": "1.10", "inspection_required": "1.18"},
        project_materials_hint="Device count, fixture type, circuit needs, panel access, permit/inspection requirements, and wall/attic access drive labor.",
        exclusions_text="Utility company work, service upgrades, drywall repair, painting, permit fees, hidden-code corrections, and work outside listed devices/circuits unless included.",
        assumptions_text="Customer provides access to panels/work areas and identifies known issues, limitations, and preferred locations.",
        milestone_pattern=[
            {"title": "Scope Review & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Rough Wiring or Device Work", "normalized_milestone_type": "electrical_rough_in", "duration_days": 1},
            {"title": "Testing & Trim-Out", "normalized_milestone_type": "installation", "duration_days": 1},
            {"title": "Final Walkthrough", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "electrical_scope", "label": "What electrical items are included?", "type": "text", "required": True},
            {"key": "permit_responsibility", "label": "Who is handling permits or inspections?", "type": "select", "options": ["Contractor", "Owner", "Not required"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="plumbing:plumbing_repair_replacement",
        name="Plumbing Repair",
        project_type="Plumbing",
        project_subtype="Plumbing Repair",
        estimated_days=2,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("600.00"),
        price_high=Decimal("8500.00"),
        duration_low=1,
        duration_high=4,
        description="Reusable plumbing repair template for diagnosis, repair or replacement, testing, and handoff.",
        scope_text=(
            "Included Work:\n"
            "- Confirm plumbing issue, fixture/line locations, access conditions, and water shutoff requirements\n"
            "- Protect the work area and access exposed plumbing within the agreed repair scope\n"
            "- Complete approved plumbing repair, fixture replacement, or line work listed in the agreement\n"
            "- Test for leaks, drainage, pressure, and basic operation after repair\n"
            "- Clean the immediate work area and review completed work with the customer\n\n"
            "Exclusions:\n"
            "- Wall/floor restoration, mold remediation, sewer camera work, permits, and hidden-condition repairs unless included\n"
            "- Additional fixtures, supply lines, drain lines, or unrelated plumbing issues unless approved by change order\n\n"
            "Customer Responsibilities:\n"
            "- Provide access to fixtures, shutoffs, panels, and affected rooms\n"
            "- Remove stored items from under sinks or near plumbing access points"
        ),
        source_note="Seeded plumbing repair baseline for residential service work.",
        finish_level_multipliers={"repair": "1.00", "fixture_replace": "1.08", "line_replace": "1.20"},
        complexity_multipliers={"accessible": "0.95", "wall_opening_required": "1.20"},
        project_materials_hint="Fixture type, valve/line condition, access needs, shutoff condition, and restoration responsibility drive price.",
        exclusions_text="Wall/floor restoration, mold remediation, sewer camera work, permits, hidden-condition repairs, and unrelated plumbing issues unless included.",
        assumptions_text="Customer provides plumbing access, shutoff access, and removes stored items from affected areas.",
        milestone_pattern=[
            {"title": "Diagnosis & Access", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Repair or Replacement", "normalized_milestone_type": "plumbing_rough_in", "duration_days": 1},
            {"title": "Testing & Adjustments", "normalized_milestone_type": "installation", "duration_days": 1},
            {"title": "Cleanup & Handoff", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "access_conditions", "label": "Will wall/floor access be required?", "type": "select", "options": ["Yes", "No", "Unknown"], "required": True},
            {"key": "fixture_owner_supplied", "label": "Are any fixtures owner supplied?", "type": "select", "options": ["Yes", "No"], "required": False},
        ],
    ),
    SeedProjectSpec(
        key="hvac:hvac_replacement",
        name="HVAC Replacement",
        project_type="HVAC",
        project_subtype="HVAC Replacement",
        estimated_days=3,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("6500.00"),
        price_high=Decimal("18000.00"),
        duration_low=1,
        duration_high=4,
        description="Reusable HVAC replacement template covering equipment staging, removal, installation, startup, testing, and closeout.",
        scope_text=(
            "Included Work:\n"
            "- Confirm equipment model, location, access, thermostat, duct, electrical, and permit requirements before work begins\n"
            "- Protect work areas and remove existing HVAC equipment listed in the agreement\n"
            "- Install replacement equipment, required connections, drain/line-set items, and accessories included in scope\n"
            "- Start up, test, charge, and verify basic heating/cooling operation\n"
            "- Review operation notes, warranty paperwork, cleanup, and final walkthrough\n\n"
            "Exclusions:\n"
            "- Duct replacement, electrical panel upgrades, structural work, drywall repair, and permit fees unless included\n"
            "- Indoor air quality accessories, zoning, or thermostat upgrades unless listed in the agreement\n\n"
            "Customer Responsibilities:\n"
            "- Provide access to indoor/outdoor equipment, attic/crawl areas, thermostat, and electrical panel\n"
            "- Clear stored items around equipment and confirm preferred thermostat/location details"
        ),
        source_note="Seeded HVAC replacement baseline for common residential equipment swaps.",
        finish_level_multipliers={"basic_split": "1.00", "high_efficiency": "1.18", "heat_pump": "1.22"},
        complexity_multipliers={"same_location": "1.00", "ductwork_changes": "1.18"},
        project_materials_hint="Equipment size/efficiency, line set, pad, thermostat, duct modifications, access conditions, and permits drive price.",
        exclusions_text="Duct replacement, electrical panel upgrades, structural work, drywall repair, permit fees, IAQ accessories, zoning, and thermostat upgrades unless included.",
        assumptions_text="Customer provides access to equipment, attic/crawl areas, thermostat, panel, and clears stored items around equipment.",
        milestone_pattern=[
            {"title": "Equipment Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Removal & Staging", "normalized_milestone_type": "demolition", "duration_days": 1},
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
        name="Deck Construction",
        project_type="Decking",
        project_subtype="Deck Construction",
        estimated_days=6,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("3000.00"),
        price_high=Decimal("22000.00"),
        duration_low=2,
        duration_high=10,
        description="Reusable deck construction template covering layout, footings, framing, decking, rails, stairs where included, and final review.",
        scope_text=(
            "Included Work:\n"
            "- Confirm deck layout, dimensions, materials, access, and permit/inspection responsibilities before work begins\n"
            "- Lay out the deck footprint and prepare the work area for footing and framing work\n"
            "- Install footings, posts, beams, joists, blocking, and connectors included in the approved design\n"
            "- Install decking boards, railing, stairs, fascia, and hardware included in the agreement\n"
            "- Complete cleanup, fastener review, safety walkthrough, and final punch-list items\n\n"
            "Exclusions:\n"
            "- Engineering, permits, utility relocation, landscaping repair, lighting, staining, and concealed structural repairs unless included\n"
            "- Demolition of existing structures unless listed in the approved scope\n\n"
            "Customer Responsibilities:\n"
            "- Confirm material selections and provide access to the exterior work area\n"
            "- Mark or disclose irrigation, utilities, pet systems, and access restrictions before layout"
        ),
        source_note="Seeded deck construction baseline for residential deck projects.",
        project_materials_hint="Decking material, footing conditions, rail type, stairs, fascia, hardware, and inspection requirements drive cost and duration.",
        exclusions_text="Engineering, permits, utility relocation, landscaping repair, lighting, staining, concealed structural repairs, and demolition unless included.",
        assumptions_text="Customer confirms material selections, provides exterior access, and discloses irrigation, utilities, pet systems, and access restrictions.",
        finish_level_multipliers={"pressure_treated": "1.00", "cedar": "1.15", "composite": "1.25"},
        complexity_multipliers={"basic_layout": "1.00", "gate_or_stairs": "1.10", "elevated_or_multi_section": "1.22"},
        milestone_pattern=[
            {"title": "Layout & Footings", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Framing", "normalized_milestone_type": "framing", "duration_days": 2},
            {"title": "Decking & Rails", "normalized_milestone_type": "installation", "duration_days": 2},
            {"title": "Final Walkthrough", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "permit_needed", "label": "Is permitting required?", "type": "select", "options": ["Yes", "No", "Unknown"], "required": True},
            {"key": "material_family", "label": "What material family is planned?", "type": "select", "options": ["Pressure treated", "Cedar", "Composite", "Metal"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="outdoor:fence_installation",
        name="Fence Installation",
        project_type="Fencing",
        project_subtype="Fence Installation",
        estimated_days=4,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("1800.00"),
        price_high=Decimal("12000.00"),
        duration_low=1,
        duration_high=6,
        description="Reusable fence installation template covering layout, posts, panels, gates, and final review.",
        scope_text=(
            "Included Work:\n"
            "- Confirm fence line, materials, height, gate locations, utility marking, and access before work begins\n"
            "- Lay out the fence alignment and prepare post locations within the agreed scope\n"
            "- Set posts, install rails/panels/pickets, and complete fence sections listed in the agreement\n"
            "- Install included gates, latch hardware, adjustments, and bracing\n"
            "- Clean the work area and conduct final walkthrough of fence alignment and gate operation\n\n"
            "Exclusions:\n"
            "- Surveying, permits, HOA approvals, utility relocation, staining/painting, and landscaping repair unless included\n"
            "- Rock excavation, retaining walls, or hidden underground obstructions unless handled by change order\n\n"
            "Customer Responsibilities:\n"
            "- Confirm property lines, HOA requirements, and gate locations before layout\n"
            "- Provide access to fence line and disclose irrigation, pets, utilities, or underground systems"
        ),
        source_note="Seeded outdoor construction baseline for residential fence installation projects.",
        finish_level_multipliers={"pressure_treated": "1.00", "cedar": "1.12", "ornamental_metal": "1.20"},
        complexity_multipliers={"straight_run": "0.95", "multiple_gates": "1.08", "grade_changes": "1.15"},
        project_materials_hint="Linear footage, material type, gate count, post depth, grade changes, hardware, staining, and access drive price.",
        exclusions_text="Surveying, permits, HOA approvals, utility relocation, staining/painting, landscaping repair, rock excavation, retaining walls, and hidden underground obstructions unless included.",
        assumptions_text="Customer confirms property lines/HOA requirements/gate locations and provides access while disclosing irrigation, pets, utilities, or underground systems.",
        milestone_pattern=[
            {"title": "Layout & Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Posts & Framing", "normalized_milestone_type": "framing", "duration_days": 1},
            {"title": "Panel Installation", "normalized_milestone_type": "installation", "duration_days": 1},
            {"title": "Gates & Walkthrough", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "linear_footage", "label": "Approximately how many linear feet are included?", "type": "text", "required": True},
            {"key": "gate_count", "label": "How many gates are included?", "type": "select", "options": ["0", "1", "2+"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="repair:handyman_general_repair",
        name="General Repair Job",
        project_type="Repair",
        project_subtype="General Repair",
        estimated_days=2,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("300.00"),
        price_high=Decimal("3500.00"),
        duration_low=1,
        duration_high=3,
        description="Reusable general repair template for small residential repair scopes with diagnosis, approved repair work, cleanup, and verification.",
        scope_text=(
            "Included Work:\n"
            "- Review the customer-provided repair list and confirm the repair items included in this agreement\n"
            "- Check accessible conditions related to the approved repair scope\n"
            "- Complete labor and basic installation/repair tasks listed in the approved scope\n"
            "- Use contractor-supplied or owner-supplied materials as identified in the agreement\n"
            "- Clean the immediate work area and review completed items with the customer\n\n"
            "Exclusions:\n"
            "- Electrical, plumbing, HVAC, roofing, structural, hazardous-material, or permit-required work unless specifically included\n"
            "- Hidden-condition repairs, specialty materials, and additional repair items discovered after work begins unless approved by change order\n\n"
            "Customer Responsibilities:\n"
            "- Provide a clear repair list and access to each work area\n"
            "- Remove personal belongings or fragile items from the immediate repair area"
        ),
        source_note="Seeded general repair baseline for small-scope residential work.",
        finish_level_multipliers={"basic_fix": "1.00", "finish_carpentry": "1.15"},
        complexity_multipliers={"single_item": "0.90", "multi_trade": "1.20"},
        project_materials_hint="Fasteners, patch materials, trim, minor hardware, sealant, and owner-supplied items should be confirmed before scheduling.",
        exclusions_text="Electrical, plumbing, HVAC, roofing, structural, hazardous-material, permit-required, hidden-condition, specialty-material, and added repair work unless approved.",
        assumptions_text="Customer provides a clear repair list, work-area access, and removal of fragile or personal items from repair areas.",
        milestone_pattern=[
            {"title": "Review & Diagnosis", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Materials & Access Prep", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Repair Work", "normalized_milestone_type": "general_milestone", "duration_days": 1},
            {"title": "Verification & Cleanup", "normalized_milestone_type": "cleanup", "duration_days": 1},
        ],
        clarifications=[
            {"key": "repair_list", "label": "What repair items are included?", "type": "text", "required": True},
            {"key": "materials_allowance", "label": "Are materials billed separately?", "type": "select", "options": ["Included", "Allowance", "Owner supplied"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="diy:contractor_assist",
        name="DIY Contractor Assist",
        project_type="DIY Help",
        project_subtype="Contractor Assist",
        estimated_days=2,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("250.00"),
        price_high=Decimal("2500.00"),
        duration_low=1,
        duration_high=3,
        description="Reusable assisted-DIY template for contractor guidance, limited hands-on support, safety review, and homeowner-led work.",
        scope_text=(
            "Included Work:\n"
            "- Review the homeowner's planned DIY scope and identify practical sequence, safety, and material considerations\n"
            "- Provide limited contractor guidance, coaching, or task support for the agreed work session\n"
            "- Review owner-supplied tools, materials, and site readiness before beginning assisted work\n"
            "- Complete only the hands-on tasks specifically listed in the agreement\n"
            "- Provide cleanup guidance, next-step notes, and final review of the assisted work area\n\n"
            "Exclusions:\n"
            "- Full-service completion of the project unless separately agreed\n"
            "- Licensed trade work, permit-required work, structural work, hazardous-material work, and warranty of homeowner-performed work unless specifically included\n\n"
            "Customer Responsibilities:\n"
            "- Supply approved materials, tools, and protective equipment unless contractor supply is listed\n"
            "- Remain responsible for homeowner-performed work and follow contractor safety guidance"
        ),
        source_note="Seeded assisted-DIY baseline for advisory contractor support and limited task assistance.",
        finish_level_multipliers={"coaching_only": "0.75", "assisted_task": "1.00", "multi_session": "1.25"},
        complexity_multipliers={"simple_task": "0.90", "multi_step": "1.10", "requires_specialty_review": "1.20"},
        project_materials_hint="Owner-supplied materials, tool readiness, safety equipment, and whether hands-on labor is included determine scope and price.",
        exclusions_text="Full-service project completion, licensed trade work, permit-required work, structural work, hazardous-material work, and warranty of homeowner-performed work unless included.",
        assumptions_text="Customer supplies listed materials/tools, remains responsible for homeowner-performed work, and follows contractor safety guidance.",
        milestone_pattern=[
            {"title": "DIY Scope Review", "normalized_milestone_type": "scope_review", "duration_days": 1},
            {"title": "Materials & Safety Check", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Assisted Work Session", "normalized_milestone_type": "assisted_diy", "duration_days": 1},
            {"title": "Next Steps & Cleanup Review", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "assistance_type", "label": "What type of contractor assistance is needed?", "type": "select", "options": ["Advice only", "Hands-on help", "Multi-session support"], "required": True},
            {"key": "owner_supplied_materials", "label": "Are materials and tools owner supplied?", "type": "select", "options": ["Yes", "No", "Mixed"], "required": True},
        ],
    ),
    SeedProjectSpec(
        key="inspection:home_inspection",
        name="Home Inspection Service",
        project_type="Inspection",
        project_subtype="Home Inspection",
        estimated_days=1,
        payment_structure="simple",
        retainage_percent=Decimal("0.00"),
        price_low=Decimal("300.00"),
        price_high=Decimal("1200.00"),
        duration_low=1,
        duration_high=2,
        description="Reusable home inspection template for accessible visual inspection, findings documentation, and report delivery.",
        scope_text=(
            "Included Work:\n"
            "- Perform a visual inspection of accessible areas and systems listed in the agreement\n"
            "- Review visible exterior, interior, attic/crawlspace access, mechanical, electrical, plumbing, and safety items as applicable\n"
            "- Document observed defects, limitations, and recommended follow-up items\n"
            "- Provide a written findings summary or inspection report after the site visit\n"
            "- Review report findings with the customer when included in the agreement\n\n"
            "Exclusions:\n"
            "- Destructive testing, code certification, engineering opinions, environmental testing, and repair work unless specifically included\n"
            "- Inspection of concealed, inaccessible, unsafe, or owner-restricted areas\n\n"
            "Customer Responsibilities:\n"
            "- Provide safe access to the property, utilities, panels, attic/crawlspace entries, and locked areas\n"
            "- Disclose known access limitations and provide seller/occupant coordination when applicable"
        ),
        source_note="Seeded home inspection baseline for visual inspection and written findings workflows.",
        finish_level_multipliers={"walkthrough": "0.80", "standard_report": "1.00", "detailed_report": "1.20"},
        complexity_multipliers={"small_home": "0.90", "standard_home": "1.00", "large_or_complex": "1.20"},
        project_materials_hint="Reporting format, property size, specialty systems, crawl/attic access, and follow-up review time drive pricing.",
        exclusions_text="Destructive testing, code certification, engineering opinions, environmental testing, repair work, and inaccessible/unsafe areas unless included.",
        assumptions_text="Customer provides safe access to property, utilities, panels, attic/crawlspace entries, locked areas, and known access limitations.",
        milestone_pattern=[
            {"title": "Inspection Scheduling & Access", "normalized_milestone_type": "site_preparation", "duration_days": 1},
            {"title": "Accessible Systems Review", "normalized_milestone_type": "inspection", "duration_days": 1},
            {"title": "Findings Documentation", "normalized_milestone_type": "reporting", "duration_days": 1},
            {"title": "Report Delivery", "normalized_milestone_type": "final_walkthrough", "duration_days": 1},
        ],
        clarifications=[
            {"key": "inspection_scope", "label": "What inspection areas or systems are included?", "type": "text", "required": True},
            {"key": "report_format", "label": "What report format is expected?", "type": "select", "options": ["Written summary", "Detailed report", "Walkthrough only"], "required": True},
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
                "duration_days": milestone.get("duration_days", 1),
                "suggested_amount_percent": milestone.get("suggested_amount_percent"),
                "suggested_amount_fixed": milestone.get("suggested_amount_fixed"),
                "pricing_advisory": bool(milestone.get("pricing_advisory", False)),
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

        template = ProjectTemplate.objects.filter(
            Q(is_system_template=True, is_published=True, benchmark_match_key=spec.key)
            | Q(is_system=True, benchmark_match_key=spec.key)
        ).first()
        template_defaults = {
            "name": spec.name,
            "project_type": spec.project_type,
            "project_subtype": spec.project_subtype,
            "description": spec.description,
            "estimated_days": spec.estimated_days,
            "payment_structure": spec.payment_structure,
            "retainage_percent": spec.retainage_percent,
            "default_scope": spec.scope_text,
            "exclusions_text": spec.exclusions_text,
            "assumptions_text": spec.assumptions_text,
            "default_clarifications": spec.clarifications,
            "benchmark_match_key": spec.key,
            "region_tags": _regional_template_tags(spec.key),
            "project_materials_hint": spec.project_materials_hint,
            "is_system": True,
            "is_system_template": True,
            "is_published": True,
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
