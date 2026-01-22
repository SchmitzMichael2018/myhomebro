from __future__ import annotations

from datetime import date


def ranges_overlap(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    """
    True if [a_start, a_end] overlaps [b_start, b_end]
    """
    if not a_start or not a_end or not b_start or not b_end:
        return False
    return a_start <= b_end and b_start <= a_end


def is_supervisor_role(role: str) -> bool:
    return (role or "").strip().lower() == "employee_supervisor"
