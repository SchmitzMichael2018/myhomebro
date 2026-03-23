# backend/projects/views/contractor_me.py
from __future__ import annotations

from datetime import date, datetime
from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from projects.models import Contractor, Skill


INTRO_DAYS_TOTAL = 60


def _contractor_for_user(user):
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


def _safe_url(f):
    try:
        if f and getattr(f, "name", ""):
            return f.url
    except Exception:
        return None
    return None


def _safe_dt(val):
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    return val


def _parse_dt(val):
    """
    Accept datetime/date/ISO strings and return a timezone-aware datetime if possible.
    """
    if val is None:
        return None
    if isinstance(val, datetime):
        if timezone.is_naive(val):
            return timezone.make_aware(val, timezone.get_current_timezone())
        return val
    if isinstance(val, date):
        d = datetime(val.year, val.month, val.day)
        return timezone.make_aware(d, timezone.get_current_timezone())
    if isinstance(val, str):
        try:
            s = val.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            return dt
        except Exception:
            return None
    return None


def _compute_intro(created_dt: datetime | None):
    """
    Returns (intro_active: bool, days_remaining: int|None)
    """
    if not created_dt:
        return False, None
    now = timezone.now()
    delta_days = (now - created_dt).days
    remaining = INTRO_DAYS_TOTAL - delta_days
    intro_active = remaining > 0
    return intro_active, max(0, remaining)


def _ai_payload() -> dict:
    return {
        "access": "included",
        "enabled": True,
        "unlimited": True,
        "rule": "AI is included with your account.",
    }


class ContractorMeView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, *args, **kwargs):
        c = _contractor_for_user(request.user)
        if c is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        u = getattr(c, "user", None)

        contractor_created_raw = getattr(c, "created_at", None) or getattr(c, "created", None) or None
        user_joined_raw = getattr(u, "date_joined", None) if u else None

        contractor_created_dt = _parse_dt(contractor_created_raw)
        user_joined_dt = _parse_dt(user_joined_raw)

        pricing_start_dt = user_joined_dt or contractor_created_dt
        intro_active, intro_days_remaining = _compute_intro(pricing_start_dt)

        ai_summary = _ai_payload()

        payload = {
            "id": c.id,
            "business_name": c.business_name,
            "phone": c.phone,

            # ✅ address pieces
            "address": c.address,
            "city": getattr(c, "city", ""),
            "state": getattr(c, "state", ""),
            "zip": getattr(c, "zip", ""),  # ✅ FIX: include zip in /me payload

            "license_number": c.license_number,
            "license_expiration": _safe_dt(c.license_expiration),
            "logo": _safe_url(c.logo),
            "license_file": _safe_url(c.license_file),
            "insurance_file": _safe_url(getattr(c, "insurance_file", None)),
            "skills": [s.name for s in c.skills.all()],

            # intro pricing / UI
            "created_at": _safe_dt(contractor_created_raw),
            "user_date_joined": _safe_dt(user_joined_raw),
            "pricing_start_at": _safe_dt(pricing_start_dt),
            "intro_days_total": INTRO_DAYS_TOTAL,
            "intro_active": bool(intro_active),
            "intro_days_remaining": intro_days_remaining,

            # included-by-default AI status
            "ai": ai_summary,
        }

        if u:
            fn, ln = getattr(u, "first_name", ""), getattr(u, "last_name", "")
            payload.update(
                {
                    "email": getattr(u, "email", ""),
                    "first_name": fn,
                    "last_name": ln,
                    "full_name": f"{fn} {ln}".strip(),
                }
            )

        return Response(payload, status=200)

    def patch(self, request, *args, **kwargs):
        data = request.data
        with transaction.atomic():
            c = _contractor_for_user(request.user)
            if c is None:
                c = Contractor.objects.create(
                    user=request.user,
                    business_name=data.get("business_name") or "My Contractor",
                )

            # linked user
            u = c.user
            email = (data.get("email") or "").strip()
            if email:
                u.email = email
            fn = (data.get("first_name") or "").strip()
            ln = (data.get("last_name") or "").strip()
            full = (data.get("full_name") or "").strip()
            if full and not (fn or ln):
                parts = full.split()
                fn, ln = parts[0], " ".join(parts[1:]) if len(parts) > 1 else ""
            if fn:
                u.first_name = fn
            if ln:
                u.last_name = ln
            u.save()

            # ✅ scalar fields (include zip)
            for f in [
                "business_name",
                "phone",
                "address",
                "city",
                "state",
                "zip",  # ✅ FIX: persist zip from request
                "license_number",
            ]:
                if f in data:
                    setattr(c, f, data.get(f))

            # license date
            lic_date = data.get("license_expiration_date") or data.get("license_expiration")
            if lic_date:
                c.license_expiration = lic_date

            # skills (M2M)
            import json

            skills_values = None
            if "skills_json" in data:
                try:
                    skills_values = json.loads(data.get("skills_json") or "[]")
                except Exception:
                    pass
            if skills_values is None and "skills" in data:
                val = data.getlist("skills") if hasattr(data, "getlist") else data.get("skills")
                if isinstance(val, str):
                    skills_values = [v.strip() for v in val.split(",") if v.strip()]
                elif isinstance(val, (list, tuple)):
                    skills_values = list(val)

            if skills_values is not None:
                objs = []
                for name in skills_values:
                    obj, _ = Skill.objects.get_or_create(
                        name=name,
                        slug=name.lower().replace(" ", "-"),
                    )
                    objs.append(obj)
                c.skills.set(objs)

            # files
            if "logo" in request.FILES:
                c.logo = request.FILES["logo"]
            if "license_file" in request.FILES:
                c.license_file = request.FILES["license_file"]
            if "insurance_file" in request.FILES:
                c.insurance_file = request.FILES["insurance_file"]

            c.save()

        return Response({"detail": "Profile updated."}, status=200)


ContractorMe = ContractorMeView
