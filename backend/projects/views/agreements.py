from __future__ import annotations

import base64
import io
import os
import sys
import traceback
import logging
from typing import Set, Optional

from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.http import FileResponse, Http404
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.timezone import now

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied

from projects.models import Agreement, Milestone, Project, Homeowner, Contractor
from projects.serializers.agreement import AgreementSerializer
from projects.services.mailer import email_signing_invite
from projects.services.sms import sms_link_to_parties  # NEW import

from .funding import send_funding_link_for_agreement

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------------------
# Resilient PDF loader:
#  - Prefer projects.services.pdf (build_agreement_pdf_bytes + generate_full_agreement_pdf)
#  - Fallback to projects.utils.pdf.generate_full_agreement_pdf(...) with adapters:
#       build_agreement_pdf_bytes(agreement, is_preview=True) -> bytes
#       generate_full_agreement_pdf(agreement) -> saves FileField + bumps pdf_version
# ---------------------------------------------------------------------------------------
build_agreement_pdf_bytes = None  # type: ignore
generate_full_agreement_pdf = None  # type: ignore


def _abs_media_path(rel_path: str) -> Optional[str]:
  if not rel_path:
    return None
  mr = getattr(settings, "MEDIA_ROOT", "") or ""
  return os.path.join(mr, rel_path)


# Try preferred service first
try:
  from projects.services.pdf import (  # type: ignore
    build_agreement_pdf_bytes as _svc_build_bytes,
    generate_full_agreement_pdf as _svc_generate_full,
  )

  build_agreement_pdf_bytes = _svc_build_bytes  # type: ignore
  generate_full_agreement_pdf = _svc_generate_full  # type: ignore
except Exception:
  # Fallback: adapt the utils generator
  try:
    from projects.utils.pdf import (  # type: ignore
      generate_full_agreement_pdf as _utils_generate_full,
    )
    from django.core.files.base import ContentFile as _CF  # local alias

    def _fallback_build_bytes(ag: Agreement, is_preview: bool = True) -> bytes:
      """
      Call the utils generator in 'preview' mode, which returns a relative path,
      then read the bytes and return them.
      """
      rel_path = _utils_generate_full(ag.id, preview=True)  # returns RELATIVE media path
      abs_path = _abs_media_path(rel_path)
      if not abs_path or not os.path.exists(abs_path):
        return b"%PDF-1.4\n% Empty preview\n"
      with open(abs_path, "rb") as fh:
        return fh.read()

    def _fallback_generate_full(ag: Agreement):
      """
      Use utils generator in final mode, then attach to FileField and bump version.
      """
      version = int(getattr(ag, "pdf_version", 0) or 0) + 1
      rel_path = _utils_generate_full(ag.id, preview=False)  # RELATIVE
      abs_path = _abs_media_path(rel_path)
      if not abs_path or not os.path.exists(abs_path):
        raise RuntimeError("PDF generator returned a path that does not exist.")
      with open(abs_path, "rb") as fh:
        content = _CF(fh.read(), name=os.path.basename(abs_path))
        ag.pdf_file.save(content.name, content, save=True)
      if hasattr(ag, "pdf_version"):
        ag.pdf_version = version
        ag.save(update_fields=["pdf_version", "pdf_file"])

    build_agreement_pdf_bytes = _fallback_build_bytes  # type: ignore
    generate_full_agreement_pdf = _fallback_generate_full  # type: ignore
  except Exception:
    pass


RETENTION_YEARS = 3

ALWAYS_OK_FIELDS: Set[str] = {
  "reviewed",
  "reviewed_at",
  "reviewed_by",
  "pdf_archived",
  "is_archived",
}

DRAFT_ONLY_FIELDS: Set[str] = {
  "project_type",
  "project_subtype",
  "standardized_category",
  "description",
  "warranty_type",
  "warranty_text_snapshot",
  "total_cost",
  "total_time_estimate",
  "milestone_count",
  "start",
  "end",
  "terms_text",
  "privacy_text",
  "contractor",
  "homeowner",
}

_PREVIEW_SALT = "agreements.preview.link.v1"
_PREVIEW_MAX_AGE = 10 * 60  # 10 minutes

_PUBLIC_SIGN_SALT = "agreements.public.sign.v1"
_PUBLIC_SIGN_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def _changed_fields(instance: Agreement, data: dict) -> Set[str]:
  changed: Set[str] = set()
  for k, v in data.items():
    if not hasattr(instance, k):
      continue
    try:
      cur = getattr(instance, k)
      if (cur is None and v not in (None, "")) or (
        cur is not None and str(cur) != str(v)
      ):
        changed.add(k)
    except Exception:
      changed.add(k)
  return changed


def _is_fully_signed(ag: Agreement) -> bool:
  return bool(
    getattr(ag, "signed_by_contractor", False)
    and getattr(ag, "signed_by_homeowner", False)
  )


def _fully_signed_at(ag: Agreement):
  ch = getattr(ag, "signed_at_contractor", None)
  hh = getattr(ag, "signed_at_homeowner", None)
  if ch and hh:
    return ch if ch >= hh else hh
  return ch or hh


def _format_address_like_pdf(line1, line2, city, state, postal):
  parts = []
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

  loc_bits = []
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


def _sync_project_address_from_agreement(ag: Agreement) -> None:
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
        "Warning: _sync_project_address_from_agreement (project) failed:",
        repr(e),
        file=sys.stderr,
      )

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
    snap_line1,
    snap_line2,
    snap_city,
    snap_state,
    snap_postal,
  )

  if hasattr(ag, "project_address_snapshot"):
    ag.project_address_snapshot = p_snap
  if hasattr(ag, "project_address_text"):
    ag.project_address_text = p_snap

  fields_to_update = []
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
        "Warning: _sync_project_address_from_agreement (agreement snapshots) failed:",
        repr(e),
        file=sys.stderr,
      )


class AgreementViewSet(viewsets.ModelViewSet):
  permission_classes = [IsAuthenticated]
  serializer_class = AgreementSerializer
  queryset = (
    Agreement.objects.select_related("project", "contractor", "homeowner")
    .all()
    .order_by("-updated_at")
  )

  def _enforce_editability(self, instance: Agreement, data: dict):
    if self.request.user.is_staff or self.request.user.is_superuser:
      return
    if not _is_fully_signed(instance):
      return
    changed = _changed_fields(instance, data)
    illegal = {
      f
      for f in changed
      if f not in ALWAYS_OK_FIELDS and f in (DRAFT_ONLY_FIELDS | changed)
    }
    if illegal:
      raise ValidationError(
        {
          "detail": "Agreement is fully signed and locked. Create an amendment to change details.",
          "blocked_fields": sorted(illegal),
          "signed_by_contractor": instance.signed_by_contractor,
          "signed_by_homeowner": instance.signed_by_homeowner,
        }
      )

  def _prepare_payload(self, request):
    data = request.data.copy() if hasattr(request.data, "copy") else dict(
      request.data
    )
    data.pop("status", None)
    for k in (
      "description",
      "terms_text",
      "privacy_text",
      "project_subtype",
      "standardized_category",
    ):
      if k in data and data[k] == "":
        data[k] = None
    for k in ("start", "end", "total_time_estimate"):
      if k in data and data[k] == "":
        data[k] = None
    if "total_cost" in data and data["total_cost"] == "":
      data["total_cost"] = None
    if "milestone_count" in data and data["milestone_count"] == "":
      data["milestone_count"] = None
    return data

  @transaction.atomic
  def create(self, request, *args, **kwargs):
    try:
      data = request.data.copy()
      user = request.user

      contractor = getattr(user, "contractor", None)
      if contractor is None:
        contractor = getattr(user, "contractor_profile", None)
      if contractor is None:
        contractor = Contractor.objects.filter(user=user).first()

      if contractor is None and not (user.is_staff or user.is_superuser):
        return Response(
          {
            "detail": "Authenticated user has no contractor profile linked. "
            "Create a Contractor for this user or log in as a contractor."
          },
          status=status.HTTP_400_BAD_REQUEST,
        )

      desc = data.get("description")
      if desc is None:
        data["description"] = ""
      if data.get("description", "") is None:
        data["description"] = ""

      project_id = data.get("project")
      if not project_id:
        homeowner_id = data.get("homeowner")
        if not homeowner_id:
          return Response(
            {"homeowner": ["Homeowner is required to create a project."]},
            status=status.HTTP_400_BAD_REQUEST,
          )

        try:
          homeowner = Homeowner.objects.get(pk=homeowner_id)
        except Homeowner.DoesNotExist:
          return Response(
            {"homeowner": ["Homeowner does not exist."]},
            status=status.HTTP_400_BAD_REQUEST,
          )

        project_title = (
          data.get("project_title")
          or data.get("title")
          or "Untitled Project"
        )
        project_description = data.get("description") or ""

        project = Project.objects.create(
          title=project_title,
          contractor=contractor if contractor is not None else None,
          homeowner=homeowner,
          description=project_description,
        )

        data["project"] = project.pk

      data.pop("project_title", None)

      if contractor is not None:
        data["contractor"] = contractor.pk

      serializer = self.get_serializer(data=data)
      if not serializer.is_valid():
        print(
          "AgreementSerializer errors on create():",
          serializer.errors,
          file=sys.stderr,
        )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

      self.perform_create(serializer)

      try:
        _sync_project_address_from_agreement(serializer.instance)
      except Exception as e:
        print(
          "Warning: address sync failed on create:",
          repr(e),
          file=sys.stderr,
        )

      headers = self.get_success_headers(serializer.data)
      return Response(
        serializer.data, status=status.HTTP_201_CREATED, headers=headers
      )

    except Exception as e:
      print(
        "AgreementViewSet.create() unexpected error:",
        repr(e),
        file=sys.stderr,
      )
      traceback.print_exc()
      return Response(
        {
          "detail": f"Unexpected error while creating agreement: "
          f"{type(e).__name__}: {e}"
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
      )

  def perform_create(self, serializer: AgreementSerializer) -> None:
    validated = dict(serializer.validated_data)
    for key in [
      "use_default_warranty",
      "custom_warranty_text",
      "title",
      "project_title",
    ]:
      validated.pop(key, None)
    instance = Agreement.objects.create(**validated)

    instance.signed_by_contractor = False
    instance.signed_by_homeowner = False
    if hasattr(instance, "contractor_signature"):
      instance.contractor_signature = None
    if hasattr(instance, "homeowner_signature"):
      instance.homeowner_signature = None
    if hasattr(instance, "contractor_signature_name"):
      instance.contractor_signature_name = ""
    if hasattr(instance, "homeowner_signature_name"):
      instance.homeowner_signature_name = ""
    if hasattr(instance, "signed_at_contractor"):
      instance.signed_at_contractor = None
    if hasattr(instance, "signed_at_homeowner"):
      instance.signed_at_homeowner = None
    if hasattr(instance, "contractor_signed_ip"):
      instance.contractor_signed_ip = None
    if hasattr(instance, "homeowner_signed_ip"):
      instance.homeowner_signed_ip = None

    instance.save()
    serializer.instance = instance

  def update(self, request, *args, **kwargs):
    instance = self.get_object()
    data = self._prepare_payload(request)
    self._enforce_editability(instance, data)
    serializer = self.get_serializer(instance, data=data, partial=False)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
      self.perform_update(serializer)
      try:
        _sync_project_address_from_agreement(serializer.instance)
      except Exception as e:
        print(
          "Warning: address sync failed on update:",
          repr(e),
          file=sys.stderr,
        )
    return Response(serializer.data)

  def partial_update(self, request, *args, **kwargs):
    instance = self.get_object()
    data = self._prepare_payload(request)
    self._enforce_editability(instance, data)
    serializer = self.get_serializer(instance, data=data, partial=True)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
      self.perform_update(serializer)
      try:
        _sync_project_address_from_agreement(serializer.instance)
      except Exception as e:
        print(
          "Warning: address sync failed on partial_update:",
          repr(e),
          file=sys.stderr,
        )
    return Response(serializer.data)

  def perform_update(self, serializer):
    serializer.save()

  def destroy(self, request, *args, **kwargs):
    instance: Agreement = self.get_object()
    contractor_user = getattr(getattr(instance, "contractor", None), "user", None)
    if not (
      request.user.is_staff
      or request.user.is_superuser
      or request.user == contractor_user
    ):
      raise PermissionDenied(
        "Only the assigned contractor (or staff) can delete this agreement."
      )
    if _is_fully_signed(instance):
      signed_at = _fully_signed_at(instance)
      if not signed_at or (now() - signed_at).days < (RETENTION_YEARS * 365):
        raise PermissionDenied(
          f"Deletion blocked by retention policy ({RETENTION_YEARS} years)."
        )
    return super().destroy(request, *args, **kwargs)

  @action(detail=True, methods=["get"], url_path="preview_pdf")
  def preview_pdf(self, request, pk=None):
    stream = request.query_params.get("stream")
    if not stream:
      url = request.build_absolute_uri("?stream=1")
      return Response({"url": url}, status=status.HTTP_200_OK)

    if not build_agreement_pdf_bytes:
      return Response(
        {"detail": "PDF preview not available."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
      )

    ag: Agreement = self.get_object()
    try:
      pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
    except Exception as e:
      return Response(
        {"detail": f"Could not generate preview: {e}"},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
      )

    buf = io.BytesIO(pdf_bytes)
    filename = f"agreement_{ag.pk}_preview.pdf"
    resp = FileResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    return resp

  @action(detail=True, methods=["post"])
  def preview_link(self, request, pk=None):
    signer = signing.TimestampSigner(salt=_PREVIEW_SALT)
    token = signer.sign_object({"agreement_id": int(pk), "uid": request.user.id})
    absolute = request.build_absolute_uri(
      f"/api/projects/agreements/preview_signed/?t={token}"
    )
    return Response({"url": absolute}, status=status.HTTP_200_OK)

  @action(
    detail=False,
    methods=["get"],
    url_path="preview_signed",
    permission_classes=[AllowAny],
  )
  def preview_signed(self, request):
    if not build_agreement_pdf_bytes:
      return Response(
        {"detail": "PDF preview not available."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
      )

    token = request.query_params.get("t")
    if not token:
      return Response(
        {"detail": "Missing token."}, status=status.HTTP_400_BAD_REQUEST
      )

    signer = signing.TimestampSigner(salt=_PREVIEW_SALT)
    try:
      data = signer.unsign_object(token, max_age=_PREVIEW_MAX_AGE)
      agreement_id = int(data.get("agreement_id"))
    except signing.SignatureExpired:
      return Response(
        {"detail": "Preview link expired."}, status=status.HTTP_410_GONE
      )
    except Exception:
      return Response(
        {"detail": "Invalid preview token."}, status=status.HTTP_400_BAD_REQUEST
      )

    ag = get_object_or_404(Agreement, pk=agreement_id)
    try:
      pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
    except Exception as e:
      return Response(
        {"detail": f"Could not generate preview: {e}"},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
      )

    buf = io.BytesIO(pdf_bytes)
    filename = f"agreement_{ag.pk}_preview.pdf"
    resp = FileResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    return resp

  @action(detail=True, methods=["post"], url_path="mark_previewed")
  def mark_previewed(self, request, pk=None):
    ag: Agreement = self.get_object()
    ag.reviewed = True
    ag.reviewed_at = now()
    ag.reviewed_by = "contractor"
    ag.save(update_fields=["reviewed", "reviewed_at", "reviewed_by", "updated_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)

  @action(detail=True, methods=["post"])
  def finalize_pdf(self, request, pk=None):
    ag = self.get_object()
    if not generate_full_agreement_pdf:
      return Response(
        {"detail": "PDF finalization not available."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
      )
    try:
      generate_full_agreement_pdf(ag)
    except Exception as e:
      return Response(
        {"detail": f"PDF generation failed: {e}"},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
      )
    ag.refresh_from_db()
    pdf_url = getattr(getattr(ag, "pdf_file", None), "url", None)
    return Response({"ok": True, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

  @action(detail=True, methods=["post"])
  def send_signature_request(self, request, pk=None):
    ag: Agreement = self.get_object()
    homeowner = getattr(ag, "homeowner", None)
    homeowner_email = getattr(homeowner, "email", None)

    if not homeowner_email:
      return Response(
        {"detail": "Agreement has no homeowner email."},
        status=status.HTTP_400_BAD_REQUEST,
      )

    signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
    token_payload = {"agreement_id": ag.id, "ts": float(now().timestamp())}
    token = signer.sign_object(token_payload)

    domain = (
      getattr(settings, "PUBLIC_APP_ORIGIN", None)
      or getattr(settings, "SITE_URL", None)
      or "https://www.myhomebro.com"
    ).rstrip("/")

    sign_url = f"{domain}/public-sign/{token}"

    try:
      email_signing_invite(ag, sign_url=sign_url)
    except Exception as e:
      print("send_signature_request email_signing_invite error:", repr(e), file=sys.stderr)

    try:
      sms_sent = sms_link_to_parties(
        ag,
        link_url=sign_url,
        note="Please review and sign your agreement.",
      )
      print(f"send_signature_request SMS sent count: {sms_sent}", file=sys.stderr)
    except Exception as e:
      print("send_signature_request SMS error:", repr(e), file=sys.stderr)

    return Response(
      {
        "ok": True,
        "sign_url": sign_url,
      },
      status=status.HTTP_200_OK,
    )

  @action(detail=True, methods=["post"])
  def contractor_sign(self, request, pk=None):
    ag: Agreement = self.get_object()
    contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
    if not (
      request.user.is_staff
      or request.user.is_superuser
      or request.user == contractor_user
    ):
      raise PermissionDenied(
        "Only the assigned contractor (or staff) can sign as contractor."
      )

    name = (
      request.data.get("typed_name") or request.data.get("name") or ""
    ).strip()
    if not name:
      return Response(
        {"detail": "Signature name is required."},
        status=status.HTTP_400_BAD_REQUEST,
      )

    signature_file = request.FILES.get("signature")
    data_url = request.data.get("signature_data_url")
    try:
      if signature_file:
        ag.contractor_signature.save(
          signature_file.name, signature_file, save=False
        )
      elif data_url:
        header, b64 = data_url.split(",", 1)
        if ";base64" not in header:
          return Response(
            {"detail": "Invalid signature data URL."},
            status=status.HTTP_400_BAD_REQUEST,
          )
        ext = "png"
        if "image/jpeg" in header or "image/jpg" in header:
          ext = "jpg"
        content = ContentFile(
          base64.b64decode(b64),
          name=f"contractor_signature.{ext}",
        )
        ag.contractor_signature.save(content.name, content, save=False)
    except Exception:
      return Response(
        {"detail": "Could not process signature image."},
        status=status.HTTP_400_BAD_REQUEST,
      )

    ag.contractor_signature_name = name
    ag.signed_by_contractor = True
    ag.signed_at_contractor = now()
    ip = (
      request.META.get("HTTP_X_FORWARDED_FOR", "")
      .split(",")[0]
      .strip()
      or request.META.get("REMOTE_ADDR")
    )
    ag.contractor_signed_ip = ip or None
    ag.status = "draft"
    ag.save()

    ser = self.get_serializer(ag)
    return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)

  @action(detail=True, methods=["post"])
  def contractor_unsign(self, request, pk=None):
    ag: Agreement = self.get_object()
    contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
    if not (
      request.user.is_staff
      or request.user.is_superuser
      or request.user == contractor_user
    ):
      raise PermissionDenied(
        "Only the assigned contractor (or staff) can unsign as contractor."
      )
    if _is_fully_signed(ag):
      raise ValidationError("Cannot unsign after both parties have signed.")

    ag.signed_by_contractor = False
    ag.signed_at_contractor = None
    ag.contractor_signature_name = ""
    ag.contractor_signature = None
    ag.status = "draft"
    ag.save()

    ser = self.get_serializer(ag)
    return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_milestones(request, pk: int):
  ag = get_object_or_404(Agreement, pk=pk)
  qs = Milestone.objects.filter(agreement=ag).order_by("order")
  data = [
    {
      "id": m.id,
      "order": m.order,
      "title": m.title,
      "description": m.description,
      "amount": str(m.amount),
      "start_date": m.start_date,
      "completion_date": m.completion_date,
      "duration": m.duration.total_seconds() if m.duration else None,
      "is_invoiced": m.is_invoiced,
      "completed": m.completed,
    }
    for m in qs
  ]
  return Response(data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_pdf(request, agreement_id: int):
  ag = get_object_or_404(Agreement, pk=agreement_id)
  if (not getattr(ag, "pdf_file", None)) or (not getattr(ag.pdf_file, "name", "")):
    if generate_full_agreement_pdf:
      try:
        generate_full_agreement_pdf(ag)
        ag.refresh_from_db()
      except Exception:
        pass
  if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
    try:
      return FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
    except Exception:
      raise Http404("PDF not available")
  raise Http404("PDF not available")


def _unsign_public_token(token: str) -> Agreement:
  signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
  try:
    data = signer.unsign_object(token, max_age=_PUBLIC_SIGN_MAX_AGE)
    agreement_id = int(data.get("agreement_id"))
  except signing.SignatureExpired:
    raise Http404("Signing link expired.")
  except Exception:
    raise Http404("Invalid signing token.")

  return get_object_or_404(Agreement, pk=agreement_id)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def agreement_public_sign(request):
  if request.method == "GET":
    token = request.query_params.get("token")
    if not token:
      return Response({"detail": "Missing token."}, status=400)

    ag = _unsign_public_token(token)

    homeowner = getattr(ag, "homeowner", None)
    contractor = getattr(ag, "contractor", None)

    # ✅ IMPORTANT:
    # Always show the CURRENT preview version (not stale stored pdf_file)
    pdf_url = request.build_absolute_uri(
      f"/api/projects/agreements/public_pdf/?token={token}&stream=1&preview=1"
    )

    data = {
      "id": ag.id,
      "project_title": getattr(ag, "project_title", None)
      or getattr(ag, "title", None)
      or getattr(getattr(ag, "project", None), "title", None)
      or f"Agreement #{ag.id}",
      "homeowner_name": getattr(ag, "homeowner_name", None)
      or getattr(homeowner, "full_name", None)
      or "",
      "contractor_name": getattr(contractor, "business_name", None)
      or getattr(contractor, "full_name", None)
      or "",
      "status": getattr(ag, "status", "draft"),
      "pdf_url": pdf_url,
    }
    return Response(data, status=200)

  token = request.data.get("token")
  if not token:
    return Response({"detail": "Missing token."}, status=400)

  ag = _unsign_public_token(token)

  typed_name = (request.data.get("typed_name") or "").strip()
  if not typed_name:
    return Response(
      {"detail": "Typed name (signature) is required."},
      status=400,
    )

  signature_file = request.FILES.get("signature")
  data_url = request.data.get("signature_data_url")

  try:
    if signature_file and hasattr(ag, "homeowner_signature"):
      ag.homeowner_signature.save(
        signature_file.name, signature_file, save=False
      )
    elif data_url and hasattr(ag, "homeowner_signature"):
      header, b64 = data_url.split(",", 1)
      if ";base64" not in header:
        return Response(
          {"detail": "Invalid signature data URL."},
          status=400,
        )
      ext = "png"
      if "image/jpeg" in header or "image/jpg" in header:
        ext = "jpg"
      content = ContentFile(
        base64.b64decode(b64),
        name=f"homeowner_signature.{ext}",
      )
      ag.homeowner_signature.save(content.name, content, save=False)
  except Exception:
    return Response(
      {"detail": "Could not process signature image."},
      status=400,
    )

  ag.homeowner_signature_name = typed_name
  ag.signed_by_homeowner = True
  ag.signed_at_homeowner = now()
  ip = (
    request.META.get("HTTP_X_FORWARDED_FOR", "")
    .split(",")[0]
    .strip()
    or request.META.get("REMOTE_ADDR")
  )
  ag.homeowner_signed_ip = ip or None

  ag.save()

  # After homeowner signs, generate a final PDF if available
  if generate_full_agreement_pdf:
    try:
      generate_full_agreement_pdf(ag)
    except Exception:
      pass

  auto_funding = None
  try:
    if _is_fully_signed(ag) and not getattr(ag, "escrow_funded", False):
      auto_funding = send_funding_link_for_agreement(ag, request=request)
  except ValueError as exc:
    logger.info("Auto funding link skipped for Agreement %s: %s", ag.id, exc)
  except Exception:
    logger.exception("Auto funding link failed for Agreement %s", ag.id)

  resp = {"ok": True}
  if auto_funding:
    resp["funding_link_sent"] = True
    resp["funding"] = auto_funding

  return Response(resp, status=200)


@api_view(["GET"])
@permission_classes([AllowAny])
def agreement_public_pdf(request):
  """
  Public PDF stream for homeowner, protected by signing token.

  ✅ NEW BEHAVIOR:
    - If preview=1 OR agreement is not fully signed, serve LIVE preview bytes
      (so homeowner reviews the CURRENT amendment draft).
    - If fully signed and preview not requested, serve stored pdf_file (final).
  """
  token = request.query_params.get("token")
  if not token:
    return Response({"detail": "Missing token."}, status=400)

  ag = _unsign_public_token(token)

  preview_flag = (request.query_params.get("preview") or "").strip() == "1"

  # If preview is requested OR not fully signed -> stream preview bytes
  if preview_flag or not _is_fully_signed(ag):
    if not build_agreement_pdf_bytes:
      return Response(
        {"detail": "PDF preview not available."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
      )
    try:
      pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
    except Exception as e:
      return Response(
        {"detail": f"Could not generate preview: {e}"},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
      )
    buf = io.BytesIO(pdf_bytes)
    filename = f"agreement_{ag.pk}_preview.pdf"
    resp = FileResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    return resp

  # Otherwise serve final stored PDF file (fully signed)
  if (not getattr(ag, "pdf_file", None)) or (not getattr(ag.pdf_file, "name", "")):
    if generate_full_agreement_pdf:
      try:
        generate_full_agreement_pdf(ag)
        ag.refresh_from_db()
      except Exception:
        pass

  if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
    try:
      return FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
    except Exception:
      raise Http404("PDF not available")

  raise Http404("PDF not available")
