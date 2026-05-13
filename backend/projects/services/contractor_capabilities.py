from __future__ import annotations

from typing import Any


def get_contractor_capability_flags(contractor: Any | None) -> dict[str, bool]:
    if contractor is None:
        return {
            "accepts_diy_assistance": False,
            "accepts_consultation": False,
            "accepts_inspection_only": False,
            "legacy_homeowner_participation": False,
            "legacy_hourly_help": False,
        }

    accepts_diy_assistance = bool(
        getattr(contractor, "accepts_diy_assistance", False)
        or getattr(contractor, "accepts_homeowner_participation", False)
    )
    accepts_consultation = bool(getattr(contractor, "accepts_consultation_only", False))
    accepts_inspection_only = bool(getattr(contractor, "accepts_inspection_only", False))
    legacy_homeowner_participation = bool(getattr(contractor, "accepts_homeowner_participation", False))
    legacy_hourly_help = bool(getattr(contractor, "accepts_hourly_help", False))

    return {
        "accepts_diy_assistance": accepts_diy_assistance,
        "accepts_consultation": accepts_consultation,
        "accepts_inspection_only": accepts_inspection_only,
        "legacy_homeowner_participation": legacy_homeowner_participation,
        "legacy_hourly_help": legacy_hourly_help,
    }
