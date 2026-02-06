# backend/projects/services/agreements/address.py
from __future__ import annotations

import sys
from typing import List

from projects.models import Agreement


def _format_address_like_pdf(line1, line2, city, state, postal) -> str:
    parts: List[str] = []
    line1 = (line1 or "").strip()
    line2 = (line2 or "").strip()
    city = (city or "").strip()
    state = (state or "").strip()
    postal = (postal or "").strip()

    if line1:
        if line2:
            parts.append(f"{line1}, {line2}")
        else:
            parts.append(line1)

    loc_bits: List[str] = []
    if city:
        loc_bits.append(city)
    if state:
        loc_bits.append(state)
    if postal:
        if loc_bits:
            loc_bits[-1] = f"{loc_bits[-1]} {postal}"
        else:
            loc_bits.append(postal)

    loc_str = " ".join(loc_bits) if loc_bits else ""
    if loc_str:
        if parts:
            parts.append(f"— {loc_str}")
        else:
            parts.append(loc_str)

    return " ".join(parts).strip()


def sync_project_address_from_agreement(ag: Agreement) -> None:
    """Best-effort sync for project + snapshot address fields from Agreement."""
    project = getattr(ag, "project", None)
    homeowner = getattr(ag, "homeowner", None)

    if not project:
        return

    p_line1 = getattr(ag, "project_address_line1", None)
    p_line2 = getattr(ag, "project_address_line2", None)
    p_city = getattr(ag, "project_address_city", None)
    p_state = getattr(ag, "project_address_state", None)
    p_postal = (
        getattr(ag, "project_postal_code", None)
        or getattr(ag, "project_zip", None)
    )

    changed_project_fields: list[str] = []

    mapping = [
        (p_line1, "address_line1"),
        (p_line2, "address_line2"),
        (p_city, "city"),
        (p_state, "state"),
        (p_postal, "postal_code"),
    ]

    for val, dest_field in mapping:
        if val is None:
            continue
        if not hasattr(project, dest_field):
            continue
        if getattr(project, dest_field, None) != val:
            setattr(project, dest_field, val)
            changed_project_fields.append(dest_field)

    if changed_project_fields:
        try:
            project.save(update_fields=changed_project_fields)
        except Exception as e:
            print(
                "Warning: sync_project_address_from_agreement(project) failed:",
                repr(e),
                file=sys.stderr,
            )

    # homeowner snapshot
    if homeowner is not None and (
        hasattr(ag, "homeowner_address_snapshot")
        or hasattr(ag, "homeowner_address_text")
    ):
        h_line1 = getattr(homeowner, "address_line1", "") or ""
        h_line2 = getattr(homeowner, "address_line2", "") or ""
        h_city = getattr(homeowner, "city", "") or ""
        h_state = getattr(homeowner, "state", "") or ""
        h_postal = (
            getattr(homeowner, "postal_code", "")
            or getattr(homeowner, "zip", "")
            or ""
        )
        h_snap = _format_address_like_pdf(h_line1, h_line2, h_city, h_state, h_postal)
        if hasattr(ag, "homeowner_address_snapshot"):
            ag.homeowner_address_snapshot = h_snap
        if hasattr(ag, "homeowner_address_text"):
            ag.homeowner_address_text = h_snap

    # project snapshot
    if any([p_line1, p_city, p_state, p_postal]):
        snap_line1 = p_line1 or ""
        snap_line2 = p_line2 or ""
        snap_city = p_city or ""
        snap_state = p_state or ""
        snap_postal = p_postal or ""
    else:
        snap_line1 = getattr(project, "address_line1", "") or ""
        snap_line2 = getattr(project, "address_line2", "") or ""
        snap_city = getattr(project, "city", "") or ""
        snap_state = getattr(project, "state", "") or ""
        snap_postal = (
            getattr(project, "postal_code", "")
            or getattr(project, "zip", "")
            or ""
        )

    p_snap = _format_address_like_pdf(
        snap_line1, snap_line2, snap_city, snap_state, snap_postal
    )

    if hasattr(ag, "project_address_snapshot"):
        ag.project_address_snapshot = p_snap
    if hasattr(ag, "project_address_text"):
        ag.project_address_text = p_snap

    fields_to_update: list[str] = []
    for f in [
        "homeowner_address_snapshot",
        "homeowner_address_text",
        "project_address_snapshot",
        "project_address_text",
    ]:
        if hasattr(ag, f):
            fields_to_update.append(f)

    if fields_to_update:
        try:
            ag.save(update_fields=fields_to_update)
        except Exception as e:
            print(
                "Warning: sync_project_address_from_agreement(agreement snapshots) failed:",
                repr(e),
                file=sys.stderr,
            )
