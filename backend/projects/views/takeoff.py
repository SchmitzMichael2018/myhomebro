from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    MaterialLibraryItem,
    MeasurementCalculatedResult,
    MeasurementSession,
    Proposal,
    TakeoffEvent,
    TakeoffItem,
    TakeoffSession,
)
from projects.serializers.takeoff import MaterialLibraryItemSerializer, TakeoffSessionSerializer
from projects.services.takeoff_calculations import TakeoffCalculationError, calculate_takeoff_item
from projects.services.takeoff_permissions import takeoff_capabilities


def _enabled():
    return getattr(settings, "TAKEOFF_ENABLED", False)


def _unavailable():
    return Response({"detail": "Intelligent Takeoff is unavailable."}, status=status.HTTP_404_NOT_FOUND)


def _session_for_user(request, session_id):
    session = get_object_or_404(
        TakeoffSession.objects.select_related(
            "project", "proposal", "measurement_session", "created_by", "reviewed_by"
        ).prefetch_related("events__actor"),
        pk=session_id,
    )
    capabilities = takeoff_capabilities(request.user, session.project)
    if session.contractor_id != getattr(capabilities["contractor"], "id", None) or not capabilities["view"]:
        return None, capabilities
    return session, capabilities


def _event(session, event_type, actor, metadata=None):
    TakeoffEvent.objects.create(
        session=session, event_type=event_type, actor=actor,
        session_version=session.version, metadata=metadata or {},
    )


def _totals(session):
    totals = session.items.filter(revision=session.version).aggregate(
        subtotal=Sum("subtotal"), tax=Sum("tax"), markup=Sum("markup"),
        total=Sum("final_estimated_cost"),
    )
    for key in ("subtotal", "tax", "markup", "total"):
        setattr(session, key, totals[key] or 0)
    session.save(update_fields=["subtotal", "tax", "markup", "total", "updated_at"])


class MaterialLibraryListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _enabled():
            return _unavailable()
        capabilities = takeoff_capabilities(request.user)
        if not capabilities["manage_pricing"]:
            return Response({"detail": "Pricing permission is required."}, status=403)
        contractor = capabilities["contractor"]
        rows = MaterialLibraryItem.objects.filter(contractor=contractor)
        if request.query_params.get("active") == "true":
            rows = rows.filter(is_active=True)
        return Response({"results": MaterialLibraryItemSerializer(rows, many=True).data})

    def post(self, request):
        if not _enabled():
            return _unavailable()
        capabilities = takeoff_capabilities(request.user)
        if not capabilities["manage_pricing"]:
            return Response({"detail": "Pricing permission is required."}, status=403)
        serializer = MaterialLibraryItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        material = serializer.save(
            contractor=capabilities["contractor"], price_entered_by=request.user,
        )
        return Response(MaterialLibraryItemSerializer(material).data, status=201)


class MaterialLibraryDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, material_id):
        if not _enabled():
            return _unavailable()
        capabilities = takeoff_capabilities(request.user)
        if not capabilities["manage_pricing"]:
            return Response({"detail": "Pricing permission is required."}, status=403)
        material = get_object_or_404(
            MaterialLibraryItem, pk=material_id, contractor=capabilities["contractor"],
        )
        serializer = MaterialLibraryItemSerializer(material, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed_price = "unit_price" in serializer.validated_data
        serializer.save(price_entered_by=request.user if changed_price else material.price_entered_by)
        return Response(serializer.data)


class TakeoffListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _enabled():
            return _unavailable()
        capabilities = takeoff_capabilities(request.user)
        if not capabilities["manage_pricing"]:
            return Response({"detail": "Pricing permission is required."}, status=403)
        contractor = capabilities["contractor"]
        sessions = TakeoffSession.objects.filter(contractor=contractor).select_related(
            "project", "measurement_session"
        )
        return Response({"results": TakeoffSessionSerializer(sessions, many=True).data})

    @transaction.atomic
    def post(self, request):
        if not _enabled():
            return _unavailable()
        measurement = get_object_or_404(
            MeasurementSession.objects.select_related("project", "contractor"),
            pk=request.data.get("measurement_session_id"),
        )
        capabilities = takeoff_capabilities(request.user, measurement.project)
        if measurement.contractor_id != getattr(capabilities["contractor"], "id", None) or not capabilities["create_provisional"]:
            return Response({"detail": "Measurement session not found."}, status=404)
        if not capabilities["manage_pricing"]:
            return Response({"detail": "Pricing permission is required to select material costs."}, status=403)
        profile = request.data.get("trade_profile")
        if profile not in dict(TakeoffSession.TRADE_CHOICES):
            return Response({"trade_profile": ["Choose a supported profile."]}, status=400)
        result = get_object_or_404(
            MeasurementCalculatedResult, pk=request.data.get("measurement_result_id"), session=measurement,
        )
        material = get_object_or_404(
            MaterialLibraryItem, pk=request.data.get("material_id"),
            contractor=measurement.contractor, is_active=True,
        )
        provisional = result.verification_status not in {"verified", "confirmed"}
        acknowledged = bool(request.data.get("acknowledge_provisional", False))
        if provisional and not acknowledged:
            return Response(
                {"acknowledge_provisional": ["Acknowledge that this measurement needs field verification."]},
                status=400,
            )
        proposal = None
        proposal_id = request.data.get("proposal_id")
        if proposal_id:
            proposal = get_object_or_404(Proposal, pk=proposal_id, contractor=measurement.contractor)
        try:
            calculation = calculate_takeoff_item(
                profile=profile, measurement_result=result, material=material,
                waste_percentage=request.data.get("waste_percentage"),
                waste_source="item_override" if request.data.get("waste_percentage") is not None else None,
                rounding_policy=request.data.get("rounding_policy", "ceil_to_package"),
                tax_rate=request.data.get("tax_rate", 0),
                markup_rate=request.data.get("markup_rate"),
                coats=request.data.get("coats", 1),
            )
        except TakeoffCalculationError as exc:
            return Response({"detail": str(exc)}, status=400)
        session = TakeoffSession.objects.create(
            contractor=measurement.contractor, project=measurement.project,
            proposal=proposal, measurement_session=measurement, trade_profile=profile,
            status="ready_for_review", provisional=provisional,
            provisional_acknowledged=acknowledged, created_by=request.user,
            price_snapshot_at=timezone.now(),
        )
        TakeoffItem.objects.create(
            session=session, material=material, measurement_result=result,
            trade_component=request.data.get("trade_component") or "primary_material",
            revision=session.version, **calculation,
        )
        _totals(session)
        _event(session, "takeoff_created", request.user, {"measurement_session_id": measurement.id})
        _event(session, "product_selected", request.user, {"material_id": material.id})
        _event(session, "calculation_regenerated", request.user, {"calculation_version": "1"})
        return Response(TakeoffSessionSerializer(session).data, status=201)


class TakeoffDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, session_id):
        if not _enabled():
            return _unavailable()
        session, _ = _session_for_user(request, session_id)
        if not session:
            return _unavailable()
        return Response(TakeoffSessionSerializer(session).data)

    @transaction.atomic
    def patch(self, request, session_id):
        if not _enabled():
            return _unavailable()
        session, capabilities = _session_for_user(request, session_id)
        if not session:
            return _unavailable()
        if not capabilities["manage_pricing"] or session.status == "archived":
            return Response({"detail": "Pricing permission is required."}, status=403)
        expected = request.data.get("expected_version")
        if expected != session.version:
            return Response({"detail": "Takeoff changed. Reload before saving."}, status=409)
        current = session.items.filter(revision=session.version).select_related("material", "measurement_result").first()
        material = current.material
        if request.data.get("material_id"):
            material = get_object_or_404(
                MaterialLibraryItem, pk=request.data["material_id"],
                contractor=session.contractor, is_active=True,
            )
        try:
            calculation = calculate_takeoff_item(
                profile=session.trade_profile, measurement_result=current.measurement_result,
                material=material, waste_percentage=request.data.get("waste_percentage", current.waste_percentage),
                waste_source="item_override", rounding_policy=request.data.get("rounding_policy", current.rounding_policy),
                tax_rate=request.data.get("tax_rate", 0), markup_rate=request.data.get("markup_rate"),
                coats=request.data.get("coats", current.assumptions.get("coats") or 1),
            )
        except TakeoffCalculationError as exc:
            return Response({"detail": str(exc)}, status=400)
        session.version += 1
        session.status = "ready_for_review"
        session.reviewed_by = None
        session.confirmed_at = None
        session.price_snapshot_at = timezone.now()
        session.save()
        TakeoffItem.objects.create(
            session=session, material=material, measurement_result=current.measurement_result,
            trade_component=current.trade_component, revision=session.version, **calculation,
        )
        _totals(session)
        _event(session, "calculation_regenerated", request.user, {"revised_from": session.version - 1})
        return Response(TakeoffSessionSerializer(session).data)


class TakeoffActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id, action):
        if not _enabled():
            return _unavailable()
        session, capabilities = _session_for_user(request, session_id)
        if not session:
            return _unavailable()
        if request.data.get("expected_version") != session.version:
            return Response({"detail": "Takeoff changed. Reload before continuing."}, status=409)
        if action == "confirm":
            if not capabilities["confirm"]:
                return Response({"detail": "Confirmation permission is required."}, status=403)
            if session.provisional:
                return Response({"detail": "Provisional takeoffs require verified measurements before confirmation."}, status=400)
            session.status = "confirmed"
            session.reviewed_by = request.user
            session.confirmed_at = timezone.now()
            session.save()
            _event(session, "takeoff_confirmed", request.user)
        elif action == "archive":
            if not capabilities["manage_pricing"]:
                return Response({"detail": "Pricing permission is required."}, status=403)
            session.status = "archived"
            session.save()
            _event(session, "archived", request.user)
        else:
            return Response({"detail": "Unsupported action."}, status=400)
        return Response(TakeoffSessionSerializer(session).data)


class TakeoffEstimatePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        if not _enabled():
            return _unavailable()
        session, capabilities = _session_for_user(request, session_id)
        if not session:
            return _unavailable()
        if not capabilities["estimate_handoff"]:
            return Response({"detail": "Estimate handoff permission is required."}, status=403)
        if session.provisional or session.status != "confirmed":
            return Response({"detail": "Confirm a verified takeoff before estimate preview."}, status=400)
        rows = []
        for item in session.items.filter(revision=session.version).select_related("material"):
            rows.append({
                "description": item.product_snapshot["name"],
                "category": "materials",
                "quantity": str(item.purchase_quantity),
                "unit": item.selling_unit,
                "unit_cost": str(item.unit_price_snapshot),
                "subtotal": str(item.subtotal),
                "markup": str(item.markup),
                "source_takeoff_item_id": item.id,
                "warnings": item.warnings,
            })
        session.handoff_previewed_at = timezone.now()
        session.save(update_fields=["handoff_previewed_at", "updated_at"])
        _event(session, "handoff_preview_generated", request.user, {"line_count": len(rows)})
        return Response({
            "takeoff_id": session.id,
            "proposal_id": session.proposal_id,
            "preview_only": True,
            "line_items": rows,
            "warnings": ["Preview only. No Estimate records were created or changed."],
        })
