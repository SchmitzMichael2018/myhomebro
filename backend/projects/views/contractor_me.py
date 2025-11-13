# backend/projects/views/contractor_me.py
from __future__ import annotations
from datetime import date, datetime
from django.db import transaction
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status as drf_status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from projects.models import Contractor, Skill

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

class ContractorMeView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, *args, **kwargs):
        c = _contractor_for_user(request.user)
        if c is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        u = getattr(c, "user", None)
        payload = {
            "id": c.id,
            "business_name": c.business_name,
            "phone": c.phone,
            "address": c.address,
            "city": getattr(c, "city", ""),
            "state": getattr(c, "state", ""),
            "license_number": c.license_number,
            "license_expiration": _safe_dt(c.license_expiration),
            "logo": _safe_url(c.logo),
            "license_file": _safe_url(c.license_file),
            "skills": [s.name for s in c.skills.all()],
        }
        if u:
            fn, ln = getattr(u, "first_name", ""), getattr(u, "last_name", "")
            payload.update({
                "email": getattr(u, "email", ""),
                "first_name": fn,
                "last_name": ln,
                "full_name": f"{fn} {ln}".strip(),
            })
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

            # scalar fields
            for f in ["business_name", "phone", "address", "city", "state", "license_number"]:
                if f in data:
                    setattr(c, f, data.get(f))

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
                    obj, _ = Skill.objects.get_or_create(name=name, slug=name.lower().replace(" ", "-"))
                    objs.append(obj)
                c.skills.set(objs)

            # files
            if "logo" in request.FILES:
                c.logo = request.FILES["logo"]
            if "license_file" in request.FILES:
                c.license_file = request.FILES["license_file"]

            c.save()

        return Response({"detail": "Profile updated."}, status=200)

ContractorMe = ContractorMeView
