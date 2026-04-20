from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from projects.services.project_intelligence import (
    build_project_setup_recommendation,
    infer_project_intelligence,
    infer_project_scope_mode,
)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_decimal(value: Any, default: Decimal | None = None) -> Decimal | None:
    if value in (None, "", []):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, "", []):
            return default
        return max(int(value), 0)
    except (TypeError, ValueError):
        return default


def _combined_text(*parts: Any, clarification_answers: dict[str, Any] | None = None) -> str:
    segments = []
    for part in parts:
        text = _safe_text(part)
        if text:
            segments.append(text)
    for key, value in sorted((clarification_answers or {}).items()):
        text = _safe_text(value)
        if text:
            segments.append(f"{_safe_text(key)} {text}")
    return " ".join(segments).strip()


def _contains_any(text: str, needles: list[str]) -> bool:
    haystack = _safe_text(text).lower()
    return any(_safe_text(needle).lower() in haystack for needle in needles)


PLAN_BLUEPRINTS: dict[str, dict[str, Any]] = {}

PLAN_BLUEPRINTS.update(
    {
        "roofing": {
            "repair": {
                "budget": (Decimal("2500"), Decimal("8000")),
                "duration": (1, 4),
                "milestones": [
                    {"title": "Inspection and protection", "share": 0.20, "days": 1, "note": "Confirm the leak location and protect the work area."},
                    {"title": "Repair work", "share": 0.45, "days": 1, "note": "Complete the main roof repair scope."},
                    {"title": "Weatherproofing and cleanup", "share": 0.20, "days": 1, "note": "Seal the work and clean the area."},
                    {"title": "Final walkthrough", "share": 0.15, "days": 1, "note": "Review the completed repair with the customer."},
                ],
            },
            "replacement": {
                "budget": (Decimal("9000"), Decimal("22000")),
                "duration": (3, 7),
                "milestones": [
                    {"title": "Inspection and protection", "share": 0.15, "days": 1, "note": "Confirm the roof condition and protect the home."},
                    {"title": "Removal and prep", "share": 0.25, "days": 1, "note": "Remove the existing roof and prep the deck."},
                    {"title": "Install new roofing", "share": 0.40, "days": 2, "note": "Install the new roofing system."},
                    {"title": "Weatherproofing and final review", "share": 0.20, "days": 1, "note": "Seal the work and complete final cleanup."},
                ],
            },
            "default": {
                "budget": (Decimal("4000"), Decimal("15000")),
                "duration": (1, 5),
                "milestones": [
                    {"title": "Inspection and protection", "share": 0.20, "days": 1, "note": "Confirm the roof condition and affected areas."},
                    {"title": "Roof work", "share": 0.45, "days": 1, "note": "Complete the main roofing scope."},
                    {"title": "Weatherproofing and cleanup", "share": 0.20, "days": 1, "note": "Seal and clean the work area."},
                    {"title": "Final walkthrough", "share": 0.15, "days": 1, "note": "Review the completed work."},
                ],
            },
        },
        "bathroom_remodel": {
            "repair": {
                "budget": (Decimal("3500"), Decimal("9000")),
                "duration": (1, 4),
                "milestones": [
                    {"title": "Assess and protect", "share": 0.15, "days": 1, "note": "Confirm the bathroom condition and protect finishes."},
                    {"title": "Fixture / finish repair", "share": 0.45, "days": 1, "note": "Complete the repair or refresh scope."},
                    {"title": "Touch-up and cleanup", "share": 0.25, "days": 1, "note": "Finish caulk, trim, and cleanup."},
                    {"title": "Final walkthrough", "share": 0.15, "days": 1, "note": "Review the completed bathroom work."},
                ],
            },
            "remodel": {
                "budget": (Decimal("12000"), Decimal("28000")),
                "duration": (7, 21),
                "milestones": [
                    {"title": "Plan and demo", "share": 0.20, "days": 1, "note": "Confirm layout and remove existing finishes."},
                    {"title": "Rough-in changes", "share": 0.25, "days": 2, "note": "Handle plumbing or electrical changes as needed."},
                    {"title": "Tile and fixtures", "share": 0.35, "days": 2, "note": "Install tile, fixtures, and finishes."},
                    {"title": "Punch list and cleanup", "share": 0.20, "days": 1, "note": "Complete final touches and cleanup."},
                ],
            },
            "default": {
                "budget": (Decimal("6000"), Decimal("22000")),
                "duration": (2, 14),
                "milestones": [
                    {"title": "Plan and prep", "share": 0.20, "days": 1, "note": "Confirm layout, fixtures, and prep needs."},
                    {"title": "Core work", "share": 0.45, "days": 2, "note": "Complete the main bathroom scope."},
                    {"title": "Finish work", "share": 0.20, "days": 1, "note": "Handle caulk, trim, and final details."},
                    {"title": "Final walkthrough", "share": 0.15, "days": 1, "note": "Review the completed bathroom."},
                ],
            },
        },
        "kitchen_remodel": {
            "install_removal": {
                "budget": (Decimal("4000"), Decimal("7500")),
                "duration": (3, 6),
                "milestones": [
                    {"title": "Demo and prep", "share": 0.15, "days": 1, "note": "Protect the work area and remove existing cabinets if needed."},
                    {"title": "Cabinet installation", "share": 0.45, "days": 2, "note": "Install the new cabinets and set the main layout."},
                    {"title": "Finish coordination", "share": 0.25, "days": 1, "note": "Coordinate countertops, backsplash, or related finishes."},
                    {"title": "Punch list and cleanup", "share": 0.15, "days": 1, "note": "Complete final adjustments and cleanup."},
                ],
            },
            "remodel": {
                "budget": (Decimal("18000"), Decimal("45000")),
                "duration": (7, 30),
                "milestones": [
                    {"title": "Plan and demo", "share": 0.20, "days": 1, "note": "Confirm the layout and remove existing finishes."},
                    {"title": "Cabinets and core install", "share": 0.35, "days": 2, "note": "Complete cabinet and core installation work."},
                    {"title": "Countertops and finish work", "share": 0.30, "days": 2, "note": "Install countertops and related finishes."},
                    {"title": "Punch list and cleanup", "share": 0.15, "days": 1, "note": "Complete final adjustments and cleanup."},
                ],
            },
            "install": {
                "budget": (Decimal("3500"), Decimal("9000")),
                "duration": (2, 5),
                "milestones": [
                    {"title": "Site prep", "share": 0.15, "days": 1, "note": "Protect the work area and confirm measurements."},
                    {"title": "Cabinet installation", "share": 0.50, "days": 2, "note": "Install cabinets and align the layout."},
                    {"title": "Finish coordination", "share": 0.20, "days": 1, "note": "Coordinate related trim or finish work."},
                    {"title": "Punch list and cleanup", "share": 0.15, "days": 1, "note": "Complete final adjustments and cleanup."},
                ],
            },
            "default": {
                "budget": (Decimal("5000"), Decimal("25000")),
                "duration": (3, 21),
                "milestones": [
                    {"title": "Plan and prep", "share": 0.20, "days": 1, "note": "Confirm scope, layout, and prep needs."},
                    {"title": "Cabinet work", "share": 0.40, "days": 2, "note": "Complete the main cabinet work."},
                    {"title": "Finish work", "share": 0.25, "days": 1, "note": "Handle related finish coordination."},
                    {"title": "Punch list and cleanup", "share": 0.15, "days": 1, "note": "Finish the project and clean up."},
                ],
            },
        },
        "flooring": {
            "install": {
                "budget": (Decimal("3000"), Decimal("12000")),
                "duration": (2, 7),
                "milestones": [
                    {"title": "Measure and prep", "share": 0.15, "days": 1, "note": "Confirm rooms, subfloor, and prep needs."},
                    {"title": "Remove or prep existing flooring", "share": 0.25, "days": 1, "note": "Handle demo or floor prep as needed."},
                    {"title": "Install flooring", "share": 0.45, "days": 2, "note": "Install the new flooring material."},
                    {"title": "Trim and cleanup", "share": 0.15, "days": 1, "note": "Complete transitions, trim, and cleanup."},
                ],
            },
            "default": {
                "budget": (Decimal("3000"), Decimal("12000")),
                "duration": (2, 7),
                "milestones": [
                    {"title": "Measure and prep", "share": 0.15, "days": 1, "note": "Confirm the rooms and prep needs."},
                    {"title": "Flooring install", "share": 0.50, "days": 2, "note": "Complete the main flooring install."},
                    {"title": "Trim and transitions", "share": 0.20, "days": 1, "note": "Handle trim and transition details."},
                    {"title": "Cleanup and review", "share": 0.15, "days": 1, "note": "Finish cleanup and final review."},
                ],
            },
        },
        "painting": {
            "interior": {
                "budget": (Decimal("1200"), Decimal("6000")),
                "duration": (1, 5),
                "milestones": [
                    {"title": "Prep surfaces", "share": 0.30, "days": 1, "note": "Patch, cover, and prep the surfaces."},
                    {"title": "Paint application", "share": 0.45, "days": 1, "note": "Complete the main paint work."},
                    {"title": "Touch-up and cleanup", "share": 0.25, "days": 1, "note": "Finish touch-ups and cleanup."},
                ],
            },
            "exterior": {
                "budget": (Decimal("2500"), Decimal("9000")),
                "duration": (2, 6),
                "milestones": [
                    {"title": "Prep and protection", "share": 0.30, "days": 1, "note": "Protect the area and prep exterior surfaces."},
                    {"title": "Paint application", "share": 0.45, "days": 1, "note": "Complete the exterior paint work."},
                    {"title": "Cleanup and review", "share": 0.25, "days": 1, "note": "Finish cleanup and final review."},
                ],
            },
            "default": {
                "budget": (Decimal("1200"), Decimal("6000")),
                "duration": (1, 5),
                "milestones": [
                    {"title": "Prep surfaces", "share": 0.30, "days": 1, "note": "Prepare the area for painting."},
                    {"title": "Paint application", "share": 0.45, "days": 1, "note": "Complete the main paint work."},
                    {"title": "Touch-up and cleanup", "share": 0.25, "days": 1, "note": "Finish touch-ups and cleanup."},
                ],
            },
        },
        "electrical": {
            "repair": {
                "budget": (Decimal("350"), Decimal("3500")),
                "duration": (1, 3),
                "milestones": [
                    {"title": "Troubleshoot and isolate", "share": 0.20, "days": 1, "note": "Confirm the affected circuit or fixture."},
                    {"title": "Repair or install", "share": 0.45, "days": 1, "note": "Complete the electrical repair or install."},
                    {"title": "Testing and cleanup", "share": 0.20, "days": 1, "note": "Test the system and clean up."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the work and answer questions."},
                ],
            },
            "install": {
                "budget": (Decimal("500"), Decimal("5000")),
                "duration": (1, 3),
                "milestones": [
                    {"title": "Plan and access check", "share": 0.20, "days": 1, "note": "Confirm the circuit, fixture, and access needs."},
                    {"title": "Install work", "share": 0.45, "days": 1, "note": "Complete the electrical installation."},
                    {"title": "Testing and cleanup", "share": 0.20, "days": 1, "note": "Test and clean up the area."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the work before closing out."},
                ],
            },
            "default": {
                "budget": (Decimal("350"), Decimal("3500")),
                "duration": (1, 3),
                "milestones": [
                    {"title": "Troubleshoot and plan", "share": 0.20, "days": 1, "note": "Confirm the affected system and scope."},
                    {"title": "Electrical work", "share": 0.45, "days": 1, "note": "Complete the main electrical scope."},
                    {"title": "Testing and cleanup", "share": 0.20, "days": 1, "note": "Test the system and clean up."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the work before closing out."},
                ],
            },
        },
        "plumbing": {
            "repair": {
                "budget": (Decimal("300"), Decimal("4000")),
                "duration": (1, 3),
                "milestones": [
                    {"title": "Diagnose and isolate", "share": 0.20, "days": 1, "note": "Confirm the affected fixture, line, or leak area."},
                    {"title": "Repair or replace", "share": 0.45, "days": 1, "note": "Complete the plumbing repair or replacement."},
                    {"title": "Testing and cleanup", "share": 0.20, "days": 1, "note": "Test for leaks and clean up."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the work before closing out."},
                ],
            },
            "install": {
                "budget": (Decimal("500"), Decimal("5000")),
                "duration": (1, 3),
                "milestones": [
                    {"title": "Plan and access check", "share": 0.20, "days": 1, "note": "Confirm the fixture, line, and access needs."},
                    {"title": "Install work", "share": 0.45, "days": 1, "note": "Complete the plumbing installation."},
                    {"title": "Testing and cleanup", "share": 0.20, "days": 1, "note": "Test for leaks and clean up."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the work before closing out."},
                ],
            },
            "default": {
                "budget": (Decimal("300"), Decimal("4000")),
                "duration": (1, 3),
                "milestones": [
                    {"title": "Diagnose and plan", "share": 0.20, "days": 1, "note": "Confirm the affected fixture or line."},
                    {"title": "Plumbing work", "share": 0.45, "days": 1, "note": "Complete the main plumbing scope."},
                    {"title": "Testing and cleanup", "share": 0.20, "days": 1, "note": "Test for leaks and clean up."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the work before closing out."},
                ],
            },
        },
        "handyman": {
            "general": {
                "budget": (Decimal("250"), Decimal("4000")),
                "duration": (1, 4),
                "milestones": [
                    {"title": "Walk the scope", "share": 0.25, "days": 1, "note": "Confirm the task list and priorities."},
                    {"title": "Repair or install tasks", "share": 0.40, "days": 1, "note": "Complete the main repair or install items."},
                    {"title": "Finish and cleanup", "share": 0.20, "days": 1, "note": "Handle the wrap-up details and cleanup."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the completed work."},
                ],
            },
            "default": {
                "budget": (Decimal("250"), Decimal("4000")),
                "duration": (1, 4),
                "milestones": [
                    {"title": "Review the scope", "share": 0.25, "days": 1, "note": "Confirm the task list and priorities."},
                    {"title": "Complete the work", "share": 0.40, "days": 1, "note": "Handle the main project tasks."},
                    {"title": "Finish and cleanup", "share": 0.20, "days": 1, "note": "Complete wrap-up and cleanup."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the completed work."},
                ],
            },
        },
        "general": {
            "general": {
                "budget": (Decimal("250"), Decimal("4000")),
                "duration": (1, 4),
                "milestones": [
                    {"title": "Review the scope", "share": 0.25, "days": 1, "note": "Confirm the task list and priorities."},
                    {"title": "Complete the work", "share": 0.40, "days": 1, "note": "Handle the main project tasks."},
                    {"title": "Finish and cleanup", "share": 0.20, "days": 1, "note": "Complete wrap-up and cleanup."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the completed work."},
                ],
            },
            "default": {
                "budget": (Decimal("250"), Decimal("4000")),
                "duration": (1, 4),
                "milestones": [
                    {"title": "Review the scope", "share": 0.25, "days": 1, "note": "Confirm the task list and priorities."},
                    {"title": "Complete the work", "share": 0.40, "days": 1, "note": "Handle the main project tasks."},
                    {"title": "Finish and cleanup", "share": 0.20, "days": 1, "note": "Complete wrap-up and cleanup."},
                    {"title": "Final review", "share": 0.15, "days": 1, "note": "Review the completed work."},
                ],
            },
        },
    }
)


def _base_plan(*, family_key: str, scope_mode: str) -> dict[str, Any]:
    family = PLAN_BLUEPRINTS.get(family_key) or PLAN_BLUEPRINTS["general"]
    scope = family.get(scope_mode) or family.get("default") or family.get("general")
    return dict(scope)


def _feature_flags(text: str, clarification_answers: dict[str, Any] | None = None) -> dict[str, bool]:
    combined = _combined_text(text, clarification_answers=clarification_answers).lower()
    return {
        "materials_ready": _contains_any(
            combined,
            [
                "on site",
                "already on site",
                "already selected",
                "already picked",
                "picked out",
                "materials selected",
                "materials ready",
                "purchased",
                "have the materials",
            ],
        ),
        "inspection_requested": _contains_any(
            combined,
            ["inspect", "site visit", "inspection", "quote after viewing", "before final pricing"],
        ),
        "urgent_or_damage": _contains_any(
            combined,
            ["urgent", "emergency", "rush", "leak", "water damage", "mold", "storm", "active leak", "damaged"],
        ),
        "multi_area": _contains_any(
            combined,
            [
                "multiple",
                "several rooms",
                "multiple rooms",
                "whole house",
                "entire house",
                "many areas",
                "several areas",
            ],
        ),
        "one_area": _contains_any(
            combined,
            ["one room", "one bathroom", "single room", "single area", "one area", "one section"],
        ),
    }


def _milestone_rows_for_plan(*, family_key: str, scope_mode: str) -> list[dict[str, Any]]:
    base = _base_plan(family_key=family_key, scope_mode=scope_mode)
    return [dict(row) for row in base.get("milestones", []) if isinstance(row, dict)]


def _scaled_milestones(rows: list[dict[str, Any]], *, flags: dict[str, bool]) -> list[dict[str, Any]]:
    rows = [dict(row) for row in rows]
    extra_rows: list[dict[str, Any]] = []
    if flags.get("inspection_requested") or flags.get("urgent_or_damage"):
        extra_rows.append(
            {
                "title": "Inspection and stabilization",
                "share": Decimal("0.15"),
                "days": 1,
                "note": "Confirm the scope, protect the area, and stabilize any urgent issues before the main work begins.",
            }
        )
    if flags.get("multi_area"):
        extra_rows.append(
            {
                "title": "Area-by-area coordination",
                "share": Decimal("0.10"),
                "days": 1,
                "note": "Sequence the work by area so the contractor can keep the project organized.",
            }
        )
    if not extra_rows:
        return rows

    extra_total = sum(_safe_decimal(row.get("share"), Decimal("0.00")) or Decimal("0.00") for row in extra_rows)
    base_total = sum(_safe_decimal(row.get("share"), Decimal("0.00")) or Decimal("0.00") for row in rows)
    if base_total <= 0:
        return extra_rows + rows

    remaining = Decimal("1.00") - extra_total
    scale = remaining / base_total if base_total > 0 else Decimal("1.00")
    scaled_rows = []
    for row in rows:
        scaled = dict(row)
        scaled["share"] = (_safe_decimal(row.get("share"), Decimal("0.00")) or Decimal("0.00")) * scale
        scaled_rows.append(scaled)

    combined = extra_rows + scaled_rows
    total = sum(_safe_decimal(row.get("share"), Decimal("0.00")) or Decimal("0.00") for row in combined)
    if combined and total > 0:
        combined[-1]["share"] = (_safe_decimal(combined[-1].get("share"), Decimal("0.00")) or Decimal("0.00")) + (
            Decimal("1.00") - total
        )
    return combined


def _estimate_confidence(
    *,
    project_family_key: str,
    scope_mode: str,
    clarification_count: int,
    photo_count: int,
    has_budget: bool,
    has_timeline: bool,
    flags: dict[str, bool],
    learned_benchmark_used: bool,
    seeded_benchmark_used: bool,
    source_confidence: str,
) -> tuple[str, str]:
    score = 0
    reasons: list[str] = []

    if project_family_key and project_family_key != "general":
        score += 15
        reasons.append("A clear project family was inferred.")
    else:
        score += 5
        reasons.append("Only a general project family could be inferred.")

    if scope_mode and scope_mode != "general":
        score += 10
        reasons.append("The scope looks specific enough to suggest a workflow.")
    else:
        reasons.append("The scope still looks broad.")

    if clarification_count >= 2:
        score += 10
        reasons.append("Clarification answers added useful detail.")
    elif clarification_count == 1:
        score += 5
        reasons.append("One clarification answer was available.")
    if photo_count > 0:
        score += 5
        reasons.append("Photos are available to confirm the scope.")

    if has_budget:
        score += 5
        reasons.append("Budget guidance was shared.")
    if has_timeline:
        score += 5
        reasons.append("Timing guidance was shared.")
    if flags.get("materials_ready"):
        score += 5
        reasons.append("Materials are already selected or on site.")
    if flags.get("inspection_requested"):
        score -= 5
        reasons.append("An inspection is still expected before final pricing.")
    if flags.get("urgent_or_damage"):
        score += 5
        reasons.append("Visible damage or urgency was mentioned.")
    if flags.get("multi_area"):
        score += 5
        reasons.append("Multiple areas appear to be included.")
    if learned_benchmark_used:
        score += 10
        reasons.append("Similar completed work is available.")
    if seeded_benchmark_used:
        score += 5
        reasons.append("Seeded benchmark guidance is available.")

    source = _safe_text(source_confidence).lower()
    if source == "high":
        score += 10
        reasons.append("Underlying estimate confidence is high.")
    elif source == "medium":
        score += 5
        reasons.append("Underlying estimate confidence is moderate.")
    elif source == "low":
        score -= 10
        reasons.append("Underlying estimate confidence is limited.")

    score = max(0, min(100, score))
    if score >= 70:
        return "high", " ".join(reasons)
    if score >= 45:
        return "medium", " ".join(reasons)
    return "low", " ".join(reasons)


def _build_explanation_points(
    *,
    family_key: str,
    scope_mode: str,
    flags: dict[str, bool],
    project_scope_summary: str,
    recommended_project_type: str,
    suggested_workflow: str,
) -> list[str]:
    points: list[str] = []
    family_label = _safe_text(recommended_project_type)
    summary_text = _safe_text(project_scope_summary).lower()
    workflow_text = _safe_text(suggested_workflow).lower()

    if family_key == "kitchen_remodel":
        if scope_mode == "install_removal" or _contains_any(summary_text, ["cabinet", "cabinets"]):
            points.append("Cabinet installation was detected with removal or replacement work.")
        if flags.get("materials_ready"):
            points.append("Materials or cabinets appear to be on site already.")
        if _contains_any(summary_text, ["backsplash", "countertop", "trim", "finish"]):
            points.append("Related finish work was included in the scope.")
        if "removal" in workflow_text or "install" in workflow_text:
            points.append("The workflow starts with removal and install coordination.")
    elif family_key == "roofing":
        if flags.get("urgent_or_damage") or _contains_any(summary_text, ["leak", "water damage", "storm", "damage"]):
            points.append("A leak, damage, or localized roof issue was detected.")
        if scope_mode == "replacement" or _contains_any(summary_text, ["replace", "replacement", "new roof"]):
            points.append("The scope points toward replacement rather than a small repair.")
        else:
            points.append("No full replacement signals were found, so repair remains the likely starting point.")
        if flags.get("inspection_requested"):
            points.append("Inspection is requested before final pricing.")
    elif family_key == "bathroom_remodel":
        if _contains_any(summary_text, ["layout", "move", "fixture", "fixtures"]):
            points.append("Layout or fixture changes were mentioned in the request.")
        if _contains_any(summary_text, ["repair", "refresh"]) and scope_mode != "remodel":
            points.append("The request reads more like a repair or refresh than a full remodel.")
        if _contains_any(summary_text, ["tile", "shower", "vanity", "toilet", "sink"]):
            points.append("Core bathroom fixtures or finishes are part of the scope.")
    elif family_key == "flooring":
        if _contains_any(summary_text, ["square foot", "sq ft", "room", "rooms", "area"]):
            points.append("Room or square-foot coverage was mentioned, which helps size the job.")
        if _contains_any(summary_text, ["subfloor", "underlayment", "prep", "demo", "remove"]):
            points.append("Prep or subfloor work is likely needed before installation.")
        if flags.get("materials_ready"):
            points.append("Flooring materials appear to be selected or already on site.")
    elif family_key in {"electrical", "plumbing"}:
        points.append("The request looks like a system-focused repair or install rather than a general remodel.")
        if flags.get("inspection_requested") or _contains_any(summary_text, ["troubleshoot", "diagnose", "inspect"]):
            points.append("Troubleshooting or inspection is likely needed before final pricing.")
        if _contains_any(summary_text, ["replace", "new", "install"]):
            points.append("The scope includes a clear install or replacement component.")
    else:
        if flags.get("inspection_requested"):
            points.append("An inspection or site visit is still expected before final pricing.")
        if flags.get("materials_ready"):
            points.append("Materials appear to be selected or already on site.")
        if flags.get("urgent_or_damage"):
            points.append("Visible damage or urgency was mentioned in the intake.")
        if scope_mode != "general":
            points.append("The project details were specific enough to suggest a focused workflow.")

    if not points:
        if family_label:
            points.append(f"The request was clear enough to recommend a {family_label.lower()} starting point.")
        else:
            points.append("The request was clear enough to recommend a practical starting plan.")

    if len(points) == 1:
        if flags.get("inspection_requested") and "inspection" not in points[0].lower():
            points.append("An inspection before final pricing is still part of the plan.")
        elif flags.get("materials_ready") and "materials" not in points[0].lower():
            points.append("Materials already on site may reduce setup work.")
    return points[:4]


def build_project_plan_suggestion(
    *,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    description: str = "",
    project_scope_summary: str = "",
    clarification_answers: dict[str, Any] | None = None,
    photo_count: int = 0,
    suggested_total_price: Any = None,
    suggested_price_low: Any = None,
    suggested_price_high: Any = None,
    suggested_duration_days: Any = None,
    suggested_duration_low: Any = None,
    suggested_duration_high: Any = None,
    confidence_level: str = "",
    confidence_reasoning: str = "",
    learned_benchmark_used: bool = False,
    seeded_benchmark_used: bool = False,
    benchmark_source: str = "",
    benchmark_match_scope: str = "",
    template_name: str = "",
    recommended_project_type: str = "",
    recommended_project_subtype: str = "",
    suggested_workflow: str = "",
    suggested_template_label: str = "",
    recommended_template_name: str = "",
    selected_template_id: Any = None,
) -> dict[str, Any]:
    family = infer_project_intelligence(
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description or project_scope_summary,
    )
    family_key = _safe_text(family.get("key")) or "general"
    family_label = _safe_text(family.get("label")) or "General project review"
    scope_text = _combined_text(
        project_title,
        project_type,
        project_subtype,
        description,
        project_scope_summary,
        clarification_answers=clarification_answers,
    )
    scope_mode = infer_project_scope_mode(text=scope_text, family_key=family_key)

    setup = build_project_setup_recommendation(
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description or project_scope_summary,
        template_id=selected_template_id,
        template_name=template_name or recommended_template_name,
    )
    setup_project_type = _safe_text(setup.get("recommended_project_type")) or _safe_text(recommended_project_type) or family_label
    setup_project_subtype = _safe_text(setup.get("recommended_project_subtype")) or _safe_text(recommended_project_subtype) or family_label
    setup_workflow = _safe_text(setup.get("suggested_workflow")) or _safe_text(suggested_workflow) or "General project review"
    setup_template_label = _safe_text(setup.get("suggested_template_label")) or _safe_text(suggested_template_label)
    setup_template_name = _safe_text(setup.get("recommended_template_name")) or _safe_text(recommended_template_name)
    setup_note = _safe_text(setup.get("recommendation_note"))

    flags = _feature_flags(scope_text, clarification_answers)
    clarification_count = len([value for value in (clarification_answers or {}).values() if value not in (None, "", [], {})])

    budget_low = _safe_decimal(suggested_price_low, default=None)
    budget_high = _safe_decimal(suggested_price_high, default=None)
    total_price = _safe_decimal(suggested_total_price, default=None)
    if (budget_low is None or budget_high is None) and total_price is not None and total_price > 0:
        spread = Decimal("0.30") if _safe_text(confidence_level).lower() == "low" else Decimal("0.20")
        if flags.get("inspection_requested") or flags.get("multi_area"):
            spread += Decimal("0.05")
        if flags.get("materials_ready"):
            spread -= Decimal("0.03")
        budget_low = (total_price * (Decimal("1.00") - spread)).quantize(Decimal("0.01"))
        budget_high = (total_price * (Decimal("1.00") + spread)).quantize(Decimal("0.01"))
    if budget_low is None or budget_high is None:
        base = _base_plan(family_key=family_key, scope_mode=scope_mode)
        low_high = base.get("budget", (Decimal("0.00"), Decimal("0.00")))
        budget_low = budget_low or _safe_decimal(low_high[0], Decimal("0.00"))
        budget_high = budget_high or _safe_decimal(low_high[1], Decimal("0.00"))

    duration_low = _safe_int(suggested_duration_low, default=0)
    duration_high = _safe_int(suggested_duration_high, default=0)
    total_duration_days = _safe_int(suggested_duration_days, default=0)
    if (duration_low <= 0 or duration_high <= 0) and total_duration_days > 0:
        spread = 0.30 if _safe_text(confidence_level).lower() == "low" else 0.20
        if flags.get("inspection_requested") or flags.get("multi_area"):
            spread += 0.05
        if flags.get("materials_ready"):
            spread -= 0.03
        duration_low = max(int(round(total_duration_days * (1 - spread))), 1)
        duration_high = max(int(round(total_duration_days * (1 + spread))), duration_low)
    if duration_low <= 0 or duration_high <= 0:
        base = _base_plan(family_key=family_key, scope_mode=scope_mode)
        low_high = base.get("duration", (1, 4))
        duration_low = duration_low or _safe_int(low_high[0], 1)
        duration_high = duration_high or _safe_int(low_high[1], max(duration_low, 1))

    if not confidence_level:
        confidence_level = "medium" if family_key != "general" else "low"
    confidence_level, confidence_reasoning = _estimate_confidence(
        project_family_key=family_key,
        scope_mode=scope_mode,
        clarification_count=clarification_count,
        photo_count=photo_count,
        has_budget=budget_low is not None and budget_high is not None,
        has_timeline=duration_low > 0 and duration_high > 0,
        flags=flags,
        learned_benchmark_used=learned_benchmark_used,
        seeded_benchmark_used=seeded_benchmark_used,
        source_confidence=confidence_level,
    )

    reason_bits = [bit for bit in [setup_note, confidence_reasoning] if bit]
    if not reason_bits:
        if confidence_level == "high":
            reason_bits.append("The project type, scope, and clarifications are specific enough for a confident starting plan.")
        elif confidence_level == "medium":
            reason_bits.append("The project type and scope are specific enough for a practical starting plan.")
        else:
            reason_bits.append("The plan stays broad because the project details are still somewhat general.")
    if flags.get("materials_ready"):
        reason_bits.append("Materials are already selected or on site.")
    if flags.get("inspection_requested"):
        reason_bits.append("A site visit or inspection is still expected before final pricing.")
    if flags.get("urgent_or_damage"):
        reason_bits.append("Visible damage or urgency was mentioned.")
    if flags.get("multi_area"):
        reason_bits.append("The work appears to span multiple areas.")
    if photo_count > 0:
        reason_bits.append("Photos are available to confirm the scope.")

    base_rows = _scaled_milestones(
        _milestone_rows_for_plan(family_key=family_key, scope_mode=scope_mode),
        flags=flags,
    )
    if not base_rows:
        base_rows = _scaled_milestones(_milestone_rows_for_plan(family_key="general", scope_mode="general"), flags=flags)

    milestone_rows: list[dict[str, Any]] = []
    running = Decimal("0.00")
    for idx, row in enumerate(base_rows):
        share = _safe_decimal(row.get("share"), Decimal("0.00")) or Decimal("0.00")
        if idx == len(base_rows) - 1:
            share = Decimal("1.00") - running if running < Decimal("1.00") else share
        running += share
        low_amount = ""
        high_amount = ""
        if budget_low is not None and budget_high is not None and budget_low > 0 and budget_high > 0:
            low_amount = str((budget_low * share).quantize(Decimal("0.01")))
            high_amount = str((budget_high * share).quantize(Decimal("0.01")))
        milestone_rows.append(
            {
                "order": idx + 1,
                "title": _safe_text(row.get("title")) or f"Milestone {idx + 1}",
                "allocation_percent": float(share),
                "suggested_duration_days": max(int(round(duration_high * float(share))) if duration_high > 0 else _safe_int(row.get("days"), 1), 1),
                "suggested_amount_low": low_amount,
                "suggested_amount_high": high_amount,
                "note": _safe_text(row.get("note")),
            }
        )

    learning_key = ":".join(
        [
            family_key,
            scope_mode,
            _safe_text(project_type) or "project",
            _safe_text(project_subtype) or "subtype",
            str(clarification_count),
            "photos" if photo_count else "no_photos",
            "learned" if learned_benchmark_used else "seeded" if seeded_benchmark_used else "deterministic",
        ]
    )

    explanation_points = _build_explanation_points(
        family_key=family_key,
        scope_mode=scope_mode,
        flags=flags,
        project_scope_summary=_safe_text(project_scope_summary) or _safe_text(description),
        recommended_project_type=setup_project_type,
        suggested_workflow=setup_workflow,
    )

    return {
        "plan_version": 1,
        "project_family_key": family_key,
        "project_family_label": family_label,
        "project_scope_summary": _safe_text(project_scope_summary) or _safe_text(description),
        "recommended_project_type": setup_project_type,
        "recommended_project_subtype": setup_project_subtype,
        "suggested_workflow": setup_workflow,
        "suggested_template_label": setup_template_label,
        "recommended_template_name": setup_template_name,
        "suggested_budget_low": str(budget_low or Decimal("0.00")),
        "suggested_budget_high": str(budget_high or Decimal("0.00")),
        "suggested_duration_low_days": int(duration_low or 0),
        "suggested_duration_high_days": int(duration_high or 0),
        "suggested_budget_center": str(total_price.quantize(Decimal("0.01"))) if total_price is not None and total_price > 0 else "",
        "suggested_duration_days": int(total_duration_days or max(duration_high or 0, duration_low or 0, 0)),
        "confidence_level": confidence_level,
        "confidence_reasoning": " ".join(reason_bits).strip(),
        "explanation_points": explanation_points,
        "milestones": milestone_rows,
        "flags": {
            "materials_ready": flags.get("materials_ready", False),
            "inspection_requested": flags.get("inspection_requested", False),
            "urgent_or_damage": flags.get("urgent_or_damage", False),
            "multi_area": flags.get("multi_area", False),
            "one_area": flags.get("one_area", False),
        },
        "learning_ready": {
            "learning_key": learning_key,
            "benchmark_source": _safe_text(benchmark_source),
            "benchmark_match_scope": _safe_text(benchmark_match_scope),
            "seeded_benchmark_used": bool(seeded_benchmark_used),
            "learned_benchmark_used": bool(learned_benchmark_used),
            "clarification_count": clarification_count,
            "photo_count": int(photo_count or 0),
        },
        "source_metadata": {
            "family_key": family_key,
            "scope_mode": scope_mode,
            "project_type": _safe_text(project_type),
            "project_subtype": _safe_text(project_subtype),
            "clarification_count": clarification_count,
            "photo_count": int(photo_count or 0),
            "benchmark_source": _safe_text(benchmark_source),
            "benchmark_match_scope": _safe_text(benchmark_match_scope),
            "seeded_benchmark_used": bool(seeded_benchmark_used),
            "learned_benchmark_used": bool(learned_benchmark_used),
            "recommendation_basis": "deterministic_first",
            "selected_template_id": selected_template_id,
        },
    }
