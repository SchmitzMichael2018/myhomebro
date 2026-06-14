from __future__ import annotations

from typing import Any


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _seed(*parts: Any) -> str:
    return " ".join(_safe_text(part).lower() for part in parts if _safe_text(part))


PROJECT_MATERIAL_RULES: list[tuple[tuple[str, ...], list[dict[str, Any]]]] = [
    (
        ("roof", "roofing", "shingle"),
        [
            {
                "category": "Roofing Materials",
                "options": ["Roofing underlayment", "Starter shingles", "Flashing", "Roofing nails"],
                "notes": "Materials commonly used for roof installation or repair planning.",
            },
            {
                "category": "Weatherproofing",
                "options": ["Drip edge", "Roof sealant", "Vent flashing", "Ice and water shield"],
                "notes": "Confirm roofing specifications, code requirements, and installation details with the contractor.",
            },
        ],
    ),
    (
        ("bath", "bathroom", "shower", "wet area"),
        [
            {
                "category": "Wet Area Materials",
                "options": ["Backer board", "Waterproofing membrane", "Tile mortar", "Grout"],
                "notes": "Materials commonly used for bathroom remodels and wet-area tile work.",
            },
            {
                "category": "Bathroom Finishes",
                "options": ["Tile", "Fixture sealant", "Plumbing trim", "Moisture-rated fasteners"],
                "notes": "Confirm finish selections and fixture specifications before purchasing.",
            },
        ],
    ),
    (
        ("bedroom addition", "room addition", "addition", "framing", "new room"),
        [
            {
                "category": "Addition Materials",
                "options": ["Framing lumber", "Drywall sheets", "Insulation", "Interior paint"],
                "notes": "Materials commonly used for framed interior additions.",
            },
            {
                "category": "Closeout Materials",
                "options": ["Trim", "Joint compound", "Fasteners", "Primer"],
                "notes": "Confirm framing, insulation, and finish specifications with the contractor.",
            },
        ],
    ),
    (
        ("concrete patio", "patio", "concrete", "driveway", "slab", "hardscape"),
        [
            {
                "category": "Concrete Materials",
                "options": ["Concrete mix or ready-mix planning", "Gravel base", "Form boards", "Concrete sealer"],
                "notes": "Materials commonly used for concrete flatwork planning.",
            },
            {
                "category": "Site Prep",
                "options": ["Rebar or wire mesh", "Expansion joint material", "Curing supplies", "Stakes"],
                "notes": "Confirm slab thickness, reinforcement, drainage, and finish with the contractor.",
            },
        ],
    ),
    (
        ("floor", "flooring", "lvp", "hardwood", "tile floor"),
        [
            {
                "category": "Flooring Materials",
                "options": ["Flooring material", "Underlayment", "Transitions", "Trim"],
                "notes": "Materials commonly used for flooring installation planning.",
            },
            {
                "category": "Installation Supplies",
                "options": ["Adhesive or fasteners", "Moisture barrier", "Leveling compound", "Floor protection"],
                "notes": "Confirm substrate preparation and manufacturer requirements before purchasing.",
            },
        ],
    ),
    (
        ("kitchen", "cabinet", "countertop"),
        [
            {
                "category": "Kitchen Materials",
                "options": ["Cabinetry", "Countertops", "Trim", "Sealant"],
                "notes": "Materials commonly used for kitchen remodel planning.",
            },
            {
                "category": "Finish Supplies",
                "options": ["Backsplash tile", "Tile mortar", "Grout", "Cabinet hardware"],
                "notes": "Confirm finish selections and measurements before purchasing.",
            },
        ],
    ),
    (
        ("deck", "outdoor living", "porch"),
        [
            {
                "category": "Deck Materials",
                "options": ["Decking boards", "Framing lumber", "Rail components", "Fasteners"],
                "notes": "Use exterior-rated materials and weather-resistant fasteners.",
            },
            {
                "category": "Closeout Materials",
                "options": ["Sealant", "Cleanup supplies", "Protection materials", "Post bases"],
                "notes": "Confirm structural and code requirements with the contractor.",
            },
        ],
    ),
    (
        ("drywall", "ceiling repair", "wall repair", "patch"),
        [
            {
                "category": "Drywall Materials",
                "options": ["Drywall sheets or patch panels", "Joint compound", "Drywall tape", "Primer"],
                "notes": "Materials commonly used for drywall and ceiling repair planning.",
            },
            {
                "category": "Finish Supplies",
                "options": ["Texture material", "Interior paint", "Sanding supplies", "Dust barriers"],
                "notes": "Confirm finish match and affected area before purchasing.",
            },
        ],
    ),
    (
        ("gutter", "downspout"),
        [
            {
                "category": "Gutter Materials",
                "options": ["Gutter sections", "Downspouts", "Elbows", "Hangers"],
                "notes": "Materials commonly used for gutter installation planning.",
            },
            {
                "category": "Drainage Supplies",
                "options": ["Splash blocks", "Sealant", "Fasteners", "End caps"],
                "notes": "Confirm roofline measurements and drainage plan with the contractor.",
            },
        ],
    ),
]


GENERIC_PROJECT_MATERIALS = [
    {
        "category": "Project Materials",
        "options": ["Protection materials", "Trade-specific materials", "Fasteners", "Cleanup supplies"],
        "notes": "Use reusable planning categories rather than exact takeoff quantities.",
    }
]


def project_material_categories(project_type: str = "", project_subtype: str = "", description: str = "", title: str = "") -> list[dict[str, Any]]:
    text = _seed(project_type, project_subtype, title, description)
    for keywords, materials in PROJECT_MATERIAL_RULES:
        if any(keyword in text for keyword in keywords):
            return [dict(row) for row in materials]
    return [dict(row) for row in GENERIC_PROJECT_MATERIALS]


def project_material_names(project_type: str = "", project_subtype: str = "", description: str = "", title: str = "") -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for category in project_material_categories(project_type, project_subtype, description, title):
        for option in category.get("options") or []:
            name = _safe_text(option)
            if not name:
                continue
            rows.append(
                {
                    "name": name,
                    "category": _safe_text(category.get("category")) or "Project material",
                    "reason": _safe_text(category.get("notes")) or "Materials commonly used for this type of project.",
                }
            )
    return rows
