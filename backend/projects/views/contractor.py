# backend/projects/views/contractor.py
from __future__ import annotations

from typing import Iterable, Optional

from django.apps import apps
from django.db.models import QuerySet
from rest_framework import viewsets, permissions, serializers, status
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.request import Request
from rest_framework.response import Response
from datetime import datetime


def _get_model(app_label: str, model_name: str):
  try:
    return apps.get_model(app_label, model_name)
  except Exception:
    return None


Contractor = _get_model("projects", "Contractor")

# ---------------------- Serializers ---------------------- #

# Try your real serializer first; fall back to a minimal one if not available.
ContractorSerializer = None
try:
  mod = __import__("projects.serializers.contractor", fromlist=["ContractorSerializer"])
  ContractorSerializer = getattr(mod, "ContractorSerializer", None)
except Exception:
  ContractorSerializer = None

if Contractor is not None and ContractorSerializer is None:
  class _FallbackContractorSerializer(serializers.ModelSerializer):
    email = serializers.SerializerMethodField()

    class Meta:
      model = Contractor  # type: ignore
      fields = [
        "id",
        "business_name",
        "user",
        "email",
        "phone",
        "address",
        "license_number",
        "license_expiration",
        "logo",
        "license_file",
        "stripe_account_id",
        "onboarding_status",
        "created_at",
        "updated_at",
        "terms_accepted_at",
        "terms_version",
      ]

    def get_email(self, obj):
      try:
        return getattr(obj.user, "email", "")
      except Exception:
        return ""

  ContractorSerializer = _FallbackContractorSerializer  # type: ignore


class _LicenseUploadSerializer(serializers.Serializer):
  """
  Serializer for license uploads/updates.
  Accepts a file and optional metadata.
  """
  file = serializers.FileField(required=True)
  license_number = serializers.CharField(required=False, allow_blank=True)
  license_expiration = serializers.DateField(required=False, allow_null=True, input_formats=["%Y-%m-%d"])


# ---------------------- Permissions ---------------------- #

class IsAuthed(permissions.BasePermission):
  def has_permission(self, request, view):
    return bool(request.user and request.user.is_authenticated)


# ---------------------- ViewSets ---------------------- #

class ContractorViewSet(viewsets.ModelViewSet):
  """
  /api/projects/contractors/
  /api/projects/contractors/me/  -> return/update the contractor bound to request.user
  """
  permission_classes = [IsAuthed]
  parser_classes = (JSONParser, MultiPartParser, FormParser)

  @property
  def queryset(self) -> QuerySet | list:
    mdl = Contractor or _get_model("projects", "Contractor")
    if mdl is None:
      return []
    return mdl.objects.select_related("user").all().order_by("id")

  serializer_class = ContractorSerializer  # type: ignore

  def get_queryset(self) -> Iterable:
    return self.queryset

  @action(detail=False, methods=["get", "put", "patch"], parser_classes=[JSONParser, MultiPartParser, FormParser])
  def me(self, request: Request) -> Response:
    """
    GET:  return the contractor for the signed-in user
    PUT/PATCH: update fields on the signed-in contractor (supports multipart for logo/license updates)
    """
    mdl = Contractor or _get_model("projects", "Contractor")
    if mdl is None:
      return Response({"detail": "Contractor model unavailable."}, status=503)
    try:
      c = mdl.objects.select_related("user").get(user=request.user)
    except mdl.DoesNotExist:
      return Response({"detail": "No contractor profile for this account."}, status=404)

    if request.method.lower() == "get":
      return Response(self.get_serializer(c).data, status=200)

    ser = self.get_serializer(c, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data, status=200)


class ContractorLicenseUploadView(viewsets.ViewSet):
  """
  POST /api/projects/contractors/license-upload/
    Body (multipart/form-data):
      - file (required): the license file to upload
      - license_number (optional)
      - license_expiration (optional, YYYY-MM-DD)

  Effect:
    Updates the signed-in contractor's license_file (and optional fields).
    Returns the full contractor profile.
  """
  permission_classes = [IsAuthed]
  parser_classes = (MultiPartParser, FormParser)

  def create(self, request: Request) -> Response:
    mdl = Contractor or _get_model("projects", "Contractor")
    if mdl is None:
      return Response({"detail": "Contractor model unavailable."}, status=503)

    # Locate the contractor for the signed-in user
    try:
      contractor = mdl.objects.select_related("user").get(user=request.user)
    except mdl.DoesNotExist:
      return Response({"detail": "No contractor profile for this account."}, status=404)

    # Validate input
    ser = _LicenseUploadSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data

    # Update fields
    file = data.get("file")
    if not file:
      return Response({"detail": "file is required."}, status=400)

    contractor.license_file = file

    if "license_number" in data:
      contractor.license_number = data.get("license_number", "") or ""

    if "license_expiration" in data:
      contractor.license_expiration = data.get("license_expiration")

    contractor.save()

    # Return updated contractor profile
    return Response(ContractorSerializer(contractor).data, status=201)
