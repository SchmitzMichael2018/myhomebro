from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.serializers import DateTimeField
from rest_framework.views import APIView

from projects.models import Contractor, PlatformFeePromotionAuditEvent, PlatformFeePromotionGrant

from .permissions import IsAdminUserRole


def _serialize_grant(grant):
    return {
        "id": grant.id,
        "contractor_id": grant.contractor_id,
        "contractor_name": grant.contractor.business_name or grant.contractor.user.get_full_name() or grant.contractor.user.email,
        "contractor_email": grant.contractor.user.email,
        "code": grant.code,
        "waiver_percent": str(grant.waiver_percent),
        "starts_at": grant.starts_at.isoformat(),
        "ends_at": grant.ends_at.isoformat(),
        "active": grant.active,
        "effective_now": grant.is_effective(),
        "reason": grant.reason,
        "granted_by": grant.granted_by.get_full_name() or grant.granted_by.email,
        "created_at": grant.created_at.isoformat(),
        "updated_at": grant.updated_at.isoformat(),
    }


def _parse_datetime(value, field_name, errors):
    field = DateTimeField()
    try:
        return field.run_validation(value)
    except Exception:
        errors[field_name] = ["Enter a valid date and time."]
        return None


def _validated_payload(data, *, instance=None):
    errors = {}
    contractor = instance.contractor if instance else None
    if "contractor_id" in data or instance is None:
        try:
            contractor = Contractor.objects.select_related("user").get(pk=int(data.get("contractor_id")))
        except (Contractor.DoesNotExist, TypeError, ValueError):
            errors["contractor_id"] = ["Choose a valid contractor."]

    code = str(data.get("code", instance.code if instance else "") or "").strip().upper()
    if not code:
        errors["code"] = ["Enter an internal promotion code or label."]

    try:
        waiver_percent = Decimal(str(data.get("waiver_percent", instance.waiver_percent if instance else "100.00")))
        if waiver_percent <= 0 or waiver_percent > 100:
            raise InvalidOperation
    except (InvalidOperation, TypeError, ValueError):
        waiver_percent = Decimal("100.00")
        errors["waiver_percent"] = ["Waiver must be greater than 0% and no more than 100%."]

    starts_at = instance.starts_at if instance else None
    ends_at = instance.ends_at if instance else None
    if "starts_at" in data or instance is None:
        starts_at = _parse_datetime(data.get("starts_at"), "starts_at", errors)
    if "ends_at" in data or instance is None:
        ends_at = _parse_datetime(data.get("ends_at"), "ends_at", errors)
    if starts_at and ends_at and ends_at <= starts_at:
        errors["ends_at"] = ["End time must be after the start time."]

    active = bool(data.get("active", instance.active if instance else True))
    if contractor and starts_at and ends_at and active:
        overlap = PlatformFeePromotionGrant.objects.filter(
            contractor=contractor,
            active=True,
            starts_at__lt=ends_at,
            ends_at__gt=starts_at,
        )
        if instance:
            overlap = overlap.exclude(pk=instance.pk)
        if overlap.exists():
            errors["starts_at"] = ["This contractor already has an active waiver overlapping that period."]
    if contractor and code:
        duplicate_code = PlatformFeePromotionGrant.objects.filter(contractor=contractor, code=code)
        if instance:
            duplicate_code = duplicate_code.exclude(pk=instance.pk)
        if duplicate_code.exists():
            errors["code"] = ["That internal code is already assigned to this contractor."]

    return errors, {
        "contractor": contractor,
        "code": code,
        "waiver_percent": waiver_percent,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "active": active,
        "reason": str(data.get("reason", instance.reason if instance else "") or "").strip(),
    }


class AdminPlatformFeePromotions(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        grants = PlatformFeePromotionGrant.objects.select_related("contractor", "contractor__user", "granted_by")
        contractors = Contractor.objects.select_related("user").order_by("business_name", "user__email")
        return Response(
            {
                "results": [_serialize_grant(grant) for grant in grants],
                "contractors": [
                    {
                        "id": contractor.id,
                        "name": contractor.business_name or contractor.user.get_full_name() or contractor.user.email,
                        "email": contractor.user.email,
                    }
                    for contractor in contractors
                ],
                "server_time": timezone.now().isoformat(),
            }
        )

    @transaction.atomic
    def post(self, request):
        errors, values = _validated_payload(request.data)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        grant = PlatformFeePromotionGrant(granted_by=request.user, **values)
        grant.save()
        PlatformFeePromotionAuditEvent.objects.create(
            grant=grant,
            action=PlatformFeePromotionAuditEvent.ACTION_CREATED,
            actor=request.user,
            metadata={"effective_window": [grant.starts_at.isoformat(), grant.ends_at.isoformat()]},
        )
        return Response(_serialize_grant(grant), status=status.HTTP_201_CREATED)


class AdminPlatformFeePromotionDetail(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def _get_grant(self, grant_id):
        return PlatformFeePromotionGrant.objects.select_related("contractor", "contractor__user", "granted_by").filter(pk=grant_id).first()

    @transaction.atomic
    def patch(self, request, grant_id):
        grant = self._get_grant(grant_id)
        if grant is None:
            return Response({"detail": "Platform fee waiver not found."}, status=status.HTTP_404_NOT_FOUND)
        errors, values = _validated_payload(request.data, instance=grant)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        changed = {}
        for field, value in values.items():
            old_value = getattr(grant, field)
            old_comparable = getattr(old_value, "pk", old_value)
            new_comparable = getattr(value, "pk", value)
            if old_comparable != new_comparable:
                changed[field] = {"from": str(old_comparable), "to": str(new_comparable)}
                setattr(grant, field, value)
        grant.save()
        PlatformFeePromotionAuditEvent.objects.create(
            grant=grant,
            action=(
                PlatformFeePromotionAuditEvent.ACTION_DEACTIVATED
                if changed.get("active", {}).get("to") == "False"
                else PlatformFeePromotionAuditEvent.ACTION_UPDATED
            ),
            actor=request.user,
            metadata={"changes": changed},
        )
        return Response(_serialize_grant(grant))

    @transaction.atomic
    def delete(self, request, grant_id):
        grant = self._get_grant(grant_id)
        if grant is None:
            return Response({"detail": "Platform fee waiver not found."}, status=status.HTTP_404_NOT_FOUND)
        if grant.active:
            grant.active = False
            grant.save(update_fields=["active", "updated_at"])
            PlatformFeePromotionAuditEvent.objects.create(
                grant=grant,
                action=PlatformFeePromotionAuditEvent.ACTION_DEACTIVATED,
                actor=request.user,
                metadata={"method": "delete"},
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
