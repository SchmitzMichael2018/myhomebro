from __future__ import annotations

import base64
import io
import os
import sys
import traceback
import logging
from typing import Set, Optional, List, Dict, Any

from django.conf import settings
from django.core import signing
from django.core.cache import cache  # ✅ final-email idempotency guard
from django.core.files.base import ContentFile
from django.http import FileResponse, Http404
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.timezone import now
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied

from projects.models import Agreement, Milestone, Project, Homeowner, Contractor, Invoice
from projects.serializers.agreement import AgreementSerializer
from projects.services.mailer import email_signing_invite, email_final_agreement_copy
from projects.services.sms import sms_link_to_parties  # NEW import

from .funding import send_funding_link_for_agreement

logger = logging.getLogger(__name__)

# Stripe is required for refund endpoints
try:
  import stripe  # type: ignore
except Exception:
  stripe = None  # type: ignore


# ---------------------------------------------------------------------------------------
# Resilient PDF loader:
#  - Prefer projects.services.pdf (build_agreement_pdf_bytes + generate_full_agreement_pdf)
#  - Fallback to projects.utils.pdf.generate_full_agreement_pdf(.) with adapters:
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


# -----------------------------------------------------------------------------
# ✅ "Send final email only once per pdf_version" guard (cache-based, no migrations)
# -----------------------------------------------------------------------------
_FINAL_EMAIL_GUARD_TTL_SECONDS = 60 * 60 * 24 * 365  # 365 days

def _final_email_cache_key(agreement: Agreement) -> str:
  pdf_v = int(getattr(agreement, "pdf_version", 0) or 0)
  return f"mhb:final_email_sent:agreement:{agreement.id}:pdfv:{pdf_v}"

def _final_email_already_sent_for_version(agreement: Agreement) -> bool:
  try:
    return bool(cache.get(_final_email_cache_key(agreement)))
  except Exception:
    # If cache is not configured, fail open (do not block sending)
    return False

def _mark_final_email_sent_for_version(agreement: Agreement) -> None:
  try:
    cache.set(_final_email_cache_key(agreement), True, timeout=_FINAL_EMAIL_GUARD_TTL_SECONDS)
  except Exception:
    pass


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


def _send_final_link_for_agreement(ag: Agreement, *, force_send: bool = False) -> dict:
  """Shared implementation: send a fresh public VIEW link for the FINAL signed agreement.

  Guard:
    - If force_send=False, email sends only once per pdf_version (cache guard).
    - If force_send=True, always sends (manual resend).
  """
  if not _is_fully_signed(ag):
    raise ValueError("Agreement must be fully signed before sending a final copy link.")

  homeowner = getattr(ag, "homeowner", None)
  homeowner_email = getattr(homeowner, "email", None)
  if not homeowner_email:
    raise ValueError("Agreement has no homeowner email.")

  signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
  token_payload = {"agreement_id": ag.id, "ts": float(now().timestamp())}
  token = signer.sign_object(token_payload)

  domain = (
    getattr(settings, "PUBLIC_APP_ORIGIN", None)
    or getattr(settings, "SITE_URL", None)
    or "https://www.myhomebro.com"
  ).rstrip("/")

  view_url = f"{domain}/public-sign/{token}?mode=final"

  should_send_email = force_send or (not _final_email_already_sent_for_version(ag))

  if should_send_email:
    try:
      # ✅ final-copy email + attach PDF by default
      email_final_agreement_copy(ag, view_url=view_url, attach_pdf=True)
      _mark_final_email_sent_for_version(ag)
    except Exception as e:
      print("_send_final_link_for_agreement email error:", repr(e), file=sys.stderr)

  # SMS can still be sent; it’s okay if this is called manually multiple times
  try:
    sms_sent = sms_link_to_parties(
      ag,
      link_url=view_url,
      note="Here is a copy of your final signed MyHomeBro agreement.",
    )
    print(f"_send_final_link_for_agreement SMS sent count: {sms_sent}", file=sys.stderr)
  except Exception as e:
    print("_send_final_link_for_agreement SMS error:", repr(e), file=sys.stderr)

  return {"ok": True, "view_url": view_url, "email_sent": bool(should_send_email)}


# -----------------------------------------------------------------------------
# ✅ Refund helpers (updated)
# -----------------------------------------------------------------------------

def _stripe_init_or_raise():
  if stripe is None:
    raise RuntimeError("stripe library not installed.")
  key = getattr(settings, "STRIPE_SECRET_KEY", None)
  if not key:
    raise RuntimeError("STRIPE_SECRET_KEY is not configured.")
  stripe.api_key = key


def _agreement_payment_intent_id(ag: Agreement) -> Optional[str]:
  # Include your real field name first
  for fname in (
    "escrow_payment_intent_id",
    "stripe_payment_intent_id",
    "payment_intent_id",
    "escrow_funding_payment_intent_id",
    "stripe_pi_id",
  ):
    if hasattr(ag, fname):
      val = getattr(ag, fname, None)
      if val:
        return str(val)
  return None


def _is_owner_or_admin_for_agreement(request, ag: Agreement) -> bool:
  u = request.user
  if not u or not u.is_authenticated:
    return False
  if getattr(u, "is_staff", False) or getattr(u, "is_superuser", False):
    return True

  contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
  if contractor_user and u == contractor_user:
    role = getattr(u, "role", None)
    if role:
      return str(role).lower() in {"contractor_owner", "owner", "admin"}
    return True
  return False


def _milestone_amount_cents(m: Milestone) -> int:
  if hasattr(m, "amount_cents") and getattr(m, "amount_cents", None) is not None:
    return int(getattr(m, "amount_cents") or 0)
  amt = getattr(m, "amount", None) or 0
  try:
    return int(round(float(amt) * 100))
  except Exception:
    return 0


def _milestone_started(m: Milestone) -> bool:
  """
  IMPORTANT:
  A scheduled completion_date is NOT evidence of 'started'.
  In MyHomeBro v1, treat work as started if:
    - started/started_at flags exist and are set, OR
    - completed == True, OR
    - is_invoiced == True, OR
    - invoice_id is set
  """
  if hasattr(m, "started") and bool(getattr(m, "started")):
    return True
  if hasattr(m, "started_at") and getattr(m, "started_at", None):
    return True
  if bool(getattr(m, "completed", False)):
    return True
  if bool(getattr(m, "is_invoiced", False)):
    return True
  if getattr(m, "invoice_id", None):
    return True

  st = str(getattr(m, "status", "") or "").lower()
  if st in {"in_progress", "started"}:
    return True

  return False


def _milestone_refunded_or_removed(m: Milestone) -> bool:
  """Return True if milestone is already refunded/removed/descoped."""
  # Prefer new descope_status field if present
  if hasattr(m, "descope_status"):
    ds = str(getattr(m, "descope_status", "") or "").lower()
    if ds == "refunded":
      return True

  st = str(getattr(m, "status", "") or "").lower()
  if st in {"descoped_refunded", "refunded", "removed", "descoped"}:
    return True
  if hasattr(m, "descoped") and bool(getattr(m, "descoped")):
    return True
  return False


def _milestone_disputed(m: Milestone) -> bool:
  st = str(getattr(m, "status", "") or "").lower()
  if "disput" in st:
    return True
  if hasattr(m, "is_disputed") and bool(getattr(m, "is_disputed")):
    return True
  return False


def _agreement_has_any_released_funds(ag: Agreement) -> bool:
  """
  Returns True if we have evidence any escrow funds were released/payout to contractor.
  We only use concrete signals:
    - Invoice.escrow_released == True
    - Invoice.stripe_transfer_id present (non-empty)
    - Agreement-level released cents fields (if present)
  """
  for fname in ("escrow_released_total_cents", "released_total_cents"):
    if hasattr(ag, fname) and int(getattr(ag, fname) or 0) > 0:
      return True

  try:
    inv_rel = None
    if hasattr(ag, "invoices"):
      inv_rel = ag.invoices
    elif hasattr(ag, "invoice_set"):
      inv_rel = ag.invoice_set

    if inv_rel is None:
      return False

    qs = inv_rel.all()

    try:
      if qs.filter(escrow_released=True).exists():
        return True
    except Exception:
      pass

    try:
      if qs.exclude(stripe_transfer_id="").exclude(stripe_transfer_id__isnull=True).exists():
        return True
    except Exception:
      pass

    return False
  except Exception:
    return False


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

  # ---------------------------------------------------------------------------
  # ✅ UPDATED STEP 2: Refund Preview + Refund (milestone-based)
  # Allow selecting unstarted milestones even if some payouts happened,
  # but cap refund by remaining unreleased escrow + Stripe remaining refundable.
  # ---------------------------------------------------------------------------

  @action(detail=True, methods=["get"], url_path="refund_preview")
  def refund_preview(self, request, pk=None):
    ag: Agreement = self.get_object()

    if not _is_owner_or_admin_for_agreement(request, ag):
      return Response({"detail": "Not allowed. Owner/admin only."}, status=status.HTTP_403_FORBIDDEN)

    if not getattr(ag, "escrow_funded", False):
      return Response({"detail": "Escrow is not funded for this agreement."}, status=status.HTTP_400_BAD_REQUEST)

    # Funded total (agreement-level)
    funded_total = 0
    if hasattr(ag, "escrow_funded_amount"):
      try:
        funded_total = int(round(float(getattr(ag, "escrow_funded_amount") or 0) * 100))
      except Exception:
        funded_total = 0
    if funded_total <= 0:
      funded_total = sum(_milestone_amount_cents(m) for m in Milestone.objects.filter(agreement=ag))

    # Invoice queryset
    try:
      inv_qs = ag.invoices.all()
    except Exception:
      try:
        inv_qs = ag.invoice_set.all()
      except Exception:
        inv_qs = Invoice.objects.filter(agreement=ag)

    # Build invoice map by id for quick lookup
    invoice_by_id = {}
    try:
      for inv in inv_qs:
        invoice_by_id[getattr(inv, "id", None)] = inv
    except Exception:
      pass

    # Determine which invoices are "released/paid" (money left escrow)
    released_invoice_ids = set()
    try:
      released_invoice_ids |= set(inv_qs.filter(escrow_released=True).values_list("id", flat=True))
    except Exception:
      pass
    try:
      released_invoice_ids |= set(inv_qs.filter(status="paid").values_list("id", flat=True))
    except Exception:
      pass
    try:
      released_invoice_ids |= set(inv_qs.exclude(stripe_transfer_id="").exclude(stripe_transfer_id__isnull=True).values_list("id", flat=True))
    except Exception:
      pass
    try:
      released_invoice_ids |= set(inv_qs.exclude(escrow_released_at__isnull=True).values_list("id", flat=True))
    except Exception:
      pass

    # Stripe remaining refundable (safety cap; best-effort)
    stripe_remaining = None
    pi_id = _agreement_payment_intent_id(ag)
    if pi_id:
      try:
        _stripe_init_or_raise()
        pi = stripe.PaymentIntent.retrieve(pi_id)
        received = int(pi.get("amount_received") or 0)
        refunded = int(pi.get("amount_refunded") or 0)
        stripe_remaining = max(0, received - refunded)
      except Exception:
        stripe_remaining = None

    qs = Milestone.objects.filter(agreement=ag).order_by("order", "id")

    milestones_payload: List[Dict[str, Any]] = []
    released_total = 0
    unreleased_total = 0

    for m in qs:
      amount_cents = _milestone_amount_cents(m)
      started = _milestone_started(m)
      refunded = _milestone_refunded_or_removed(m)

      # ─────────────────────────────────────────────
      # ✅ NEW: compute released/unreleased using invoices
      # ─────────────────────────────────────────────
      released_cents = 0
      unreleased_cents = amount_cents

      inv_id = getattr(m, "invoice_id", None)
      if inv_id:
        inv_obj = invoice_by_id.get(inv_id)
        # Treat as released if invoice is paid/escrow released/transfer exists
        if inv_id in released_invoice_ids or (
          inv_obj
          and (
            getattr(inv_obj, "escrow_released", False) is True
            or str(getattr(inv_obj, "status", "") or "").lower() == "paid"
            or getattr(inv_obj, "escrow_released_at", None)
            or (getattr(inv_obj, "stripe_transfer_id", None) not in (None, ""))
          )
        ):
          released_cents = amount_cents
          unreleased_cents = 0

      # If milestone already refunded/descoped, it has no unreleased balance
      if refunded:
        released_cents = 0
        unreleased_cents = 0

      released_total += int(released_cents)
      unreleased_total += int(unreleased_cents)

      # Refund eligibility: must be unstarted, undisputed, not refunded, and have unreleased balance
      refundable = True
      reason = None

      if refunded:
        refundable = False
        reason = "Milestone already refunded."
      elif started:
        refundable = False
        reason = "Work started (completed/invoiced). Use dispute flow."
      elif _milestone_disputed(m):
        refundable = False
        reason = "Milestone is disputed. Use dispute resolution."
      elif amount_cents <= 0:
        refundable = False
        reason = "Invalid milestone amount."
      elif unreleased_cents <= 0:
        refundable = False
        reason = "No unreleased escrow remaining for this milestone."
      elif unreleased_cents > max(0, funded_total - released_total + unreleased_cents):
        # defensive: should never happen, but keep old semantics
        refundable = False
        reason = "Not enough unreleased escrow remaining."
      elif stripe_remaining is not None and unreleased_cents > stripe_remaining:
        refundable = False
        reason = "Not enough refundable balance remaining on Stripe."

      ds = str(getattr(m, "descope_status", "") or "").lower() if hasattr(m, "descope_status") else ""
      if ds == "refunded":
        st = "descoped_refunded"
      elif released_cents > 0:
        st = "paid"
      elif refundable:
        st = "funded_unstarted"
      elif started:
        st = "started"
      else:
        st = "unknown"

      milestones_payload.append(
        {
          "id": m.id,
          "title": getattr(m, "title", None) or f"Milestone #{m.id}",
          "amount_cents": amount_cents,
          "funded_cents": amount_cents,

          # ✅ Correct fields:
          "released_cents": int(released_cents),
          "unreleased_cents": int(unreleased_cents),

          "status": st,
          "refundable": refundable,
          "refund_block_reason": reason,
          "descope_status": getattr(m, "descope_status", None) if hasattr(m, "descope_status") else None,
        }
      )

    resp = {
      "agreement_id": ag.id,
      "currency": "usd",
      "owner_only": True,
      "has_releases": bool(released_total > 0),
      "escrow": {
        "funded_total_cents": int(funded_total),
        "already_released_total_cents": int(released_total),
        "unreleased_total_cents": int(max(unreleased_total, 0)),
      },
      "stripe": {"remaining_refundable_cents": stripe_remaining} if stripe_remaining is not None else None,
      "milestones": milestones_payload,
      "notes": [
        "Released amounts are computed from invoices with escrow released / paid status.",
        "Refunds apply only to unreleased escrow.",
        "If work has started (completed/invoiced), refunds must go through dispute resolution.",
      ],
    }
    return Response(resp, status=status.HTTP_200_OK)


  @action(detail=True, methods=["post"], url_path="refund")
  def refund(self, request, pk=None):
    ag: Agreement = self.get_object()

    if not _is_owner_or_admin_for_agreement(request, ag):
      return Response({"detail": "Not allowed. Owner/admin only."}, status=status.HTTP_403_FORBIDDEN)

    if not getattr(ag, "escrow_funded", False):
      return Response({"detail": "Escrow is not funded for this agreement."}, status=status.HTTP_400_BAD_REQUEST)

    confirm = str(request.data.get("confirm", "")).strip().upper()
    if confirm != "REFUND":
      return Response({"detail": "Confirmation required. Type REFUND."}, status=status.HTTP_400_BAD_REQUEST)

    milestone_ids = request.data.get("milestone_ids") or []
    if not isinstance(milestone_ids, list) or len(milestone_ids) == 0:
      return Response({"detail": "milestone_ids must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

    qs = Milestone.objects.filter(agreement=ag, id__in=milestone_ids).order_by("order", "id")
    found_ids = set(m.id for m in qs)
    wanted_ids = set(int(x) for x in milestone_ids if str(x).isdigit())

    missing = sorted(list(wanted_ids - found_ids))
    if missing:
      return Response({"detail": f"Milestone(s) not found on this agreement: {missing}"}, status=status.HTTP_400_BAD_REQUEST)

    # Totals from DB
    funded_total = 0
    if hasattr(ag, "escrow_funded_amount"):
      try:
        funded_total = int(round(float(getattr(ag, "escrow_funded_amount") or 0) * 100))
      except Exception:
        funded_total = 0
    if funded_total <= 0:
      funded_total = sum(_milestone_amount_cents(m) for m in Milestone.objects.filter(agreement=ag))

    # invoice queryset
    try:
      inv_qs = ag.invoices.all()
    except Exception:
      try:
        inv_qs = ag.invoice_set.all()
      except Exception:
        inv_qs = Invoice.objects.filter(agreement=ag)

    released_ids = set()
    try:
      released_ids |= set(inv_qs.filter(escrow_released=True).values_list("id", flat=True))
    except Exception:
      pass
    try:
      released_ids |= set(
        inv_qs.exclude(stripe_transfer_id="").exclude(stripe_transfer_id__isnull=True).values_list("id", flat=True)
      )
    except Exception:
      pass

    released_total = 0
    if released_ids:
      for inv in inv_qs.filter(id__in=list(released_ids)):
        try:
          released_total += int(round(float(getattr(inv, "amount", 0) or 0) * 100))
        except Exception:
          pass

    unreleased_total = max(0, funded_total - released_total)

    # Stripe remaining refundable
    pi_id = _agreement_payment_intent_id(ag)
    if not pi_id:
      return Response({"detail": "Agreement has no PaymentIntent on record. Cannot refund."}, status=status.HTTP_400_BAD_REQUEST)

    try:
      _stripe_init_or_raise()
      pi = stripe.PaymentIntent.retrieve(pi_id)
      received = int(pi.get("amount_received") or 0)
      already_refunded = int(pi.get("amount_refunded") or 0)
      stripe_remaining = max(0, received - already_refunded)
    except Exception as e:
      return Response({"detail": f"Stripe not ready: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    blocked = []
    refundable_rows = []
    refund_total_cents = 0

    for m in qs:
      amount_cents = _milestone_amount_cents(m)
      started = _milestone_started(m)
      refunded = _milestone_refunded_or_removed(m)

      if refunded:
        blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Already refunded."})
        continue
      if started:
        blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Work started (completed/invoiced). Use dispute flow."})
        continue
      if _milestone_disputed(m):
        blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Milestone is disputed."})
        continue
      if amount_cents <= 0:
        blocked.append({"id": m.id, "title": getattr(m, "title", ""), "reason": "Invalid milestone amount."})
        continue

      refundable_rows.append((m, amount_cents))
      refund_total_cents += amount_cents

    if blocked:
      return Response({"detail": "One or more selected milestones cannot be refunded.", "blocked": blocked}, status=status.HTTP_400_BAD_REQUEST)

    if refund_total_cents <= 0:
      return Response({"detail": "Nothing to refund."}, status=status.HTTP_400_BAD_REQUEST)

    if refund_total_cents > unreleased_total:
      return Response(
        {
          "detail": "Refund exceeds remaining unreleased escrow.",
          "requested_refund_cents": int(refund_total_cents),
          "unreleased_escrow_cents": int(unreleased_total),
        },
        status=status.HTTP_400_BAD_REQUEST,
      )

    if refund_total_cents > stripe_remaining:
      return Response(
        {
          "detail": "Refund exceeds remaining refundable amount on Stripe PaymentIntent.",
          "requested_refund_cents": int(refund_total_cents),
          "stripe_remaining_refundable_cents": int(stripe_remaining),
        },
        status=status.HTTP_400_BAD_REQUEST,
      )

    mid_part = "_".join(str(m.id) for m, _amt in refundable_rows)
    idempotency_key = f"mhb_refund_agreement_{ag.id}_{mid_part}"

    try:
      with transaction.atomic():
        refund_obj = stripe.Refund.create(
          payment_intent=pi_id,
          amount=int(refund_total_cents),
          reason="requested_by_customer",
          idempotency_key=idempotency_key,
          metadata={
            "agreement_id": str(ag.id),
            "milestone_ids": ",".join(str(m.id) for m, _amt in refundable_rows),
            "requested_by_user_id": str(request.user.id),
            "requested_by_email": getattr(request.user, "email", "") or "",
            "type": "agreement_level_refund",
          },
        )

        ts = timezone.now()
        for m, amt in refundable_rows:
          if hasattr(m, "descope_status"):
            m.descope_status = "refunded"
          # legacy best-effort fields
          if hasattr(m, "status"):
            m.status = "descoped_refunded"
          if hasattr(m, "descoped"):
            m.descoped = True
          if hasattr(m, "descoped_at"):
            m.descoped_at = ts
          if hasattr(m, "refunded_at"):
            m.refunded_at = ts
          if hasattr(m, "refunded_cents"):
            m.refunded_cents = int(amt)
          if hasattr(m, "refund_amount_cents"):
            m.refund_amount_cents = int(amt)
          if hasattr(m, "descope_decision_at"):
            m.descope_decision_at = ts
          if hasattr(m, "descope_decision_note"):
            m.descope_decision_note = "Refunded via agreement refund tool."
          m.save()

    except Exception as e:
      msg = getattr(e, "user_message", None) or str(e)
      return Response({"detail": f"Refund failed: {msg}"}, status=status.HTTP_400_BAD_REQUEST)

    return Response(
      {
        "message": f"Refund submitted for ${refund_total_cents/100:.2f}.",
        "refund_total_cents": int(refund_total_cents),
        "currency": "usd",
        "stripe_refund_id": getattr(refund_obj, "id", None) if hasattr(refund_obj, "id") else refund_obj.get("id"),
        "milestone_ids": [m.id for m, _amt in refundable_rows],
      },
      status=status.HTTP_200_OK,
    )

  # ---------------------------------------------------------------------------
  # Existing endpoints continue below (preview_pdf, mark_previewed, finalize_pdf, etc.)
  # ---------------------------------------------------------------------------

  @action(detail=True, methods=["get"], url_path="preview_pdf")
  def preview_pdf(self, request, pk=None):
    """
    ✅ FIXED BEHAVIOR (AUTO):
      - If agreement is fully signed AND preview is not explicitly forced,
        serve FINAL PDF (no watermark + includes handwritten signatures).
      - Otherwise serve PREVIEW bytes (watermark).
    Optional query:
      - ?preview=1 forces preview even if fully signed.
      - ?stream=1 streams pdf directly (existing behavior).
    """
    stream = request.query_params.get("stream")
    if not stream:
      url = request.build_absolute_uri("?stream=1")
      return Response({"url": url}, status=status.HTTP_200_OK)

    ag: Agreement = self.get_object()
    force_preview = (request.query_params.get("preview") or "").strip() == "1"

    def _serve_final_pdf_file(agreement: Agreement):
      if generate_full_agreement_pdf:
        try:
          generate_full_agreement_pdf(agreement)
          agreement.refresh_from_db()
        except Exception as e:
          return Response(
            {"detail": f"Could not generate final PDF: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
          )

      if getattr(agreement, "pdf_file", None) and getattr(agreement.pdf_file, "name", ""):
        try:
          return FileResponse(agreement.pdf_file.open("rb"), content_type="application/pdf")
        except Exception:
          raise Http404("Final PDF not available")

      if build_agreement_pdf_bytes:
        try:
          pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=False)
          buf = io.BytesIO(pdf_bytes)
          filename = f"agreement_{agreement.pk}_final.pdf"
          resp = FileResponse(buf, content_type="application/pdf")
          resp["Content-Disposition"] = f'inline; filename="{filename}"'
          return resp
        except Exception:
          pass

      raise Http404("Final PDF not available")

    if _is_fully_signed(ag) and not force_preview:
      return _serve_final_pdf_file(ag)

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

  @action(detail=True, methods=["post"], url_path="send_final_agreement_link")
  def send_final_agreement_link(self, request, pk=None):
    """
    Manual resend: ALWAYS send (force_send=True), even if already sent for this pdf_version.
    """
    ag: Agreement = self.get_object()
    try:
      payload = _send_final_link_for_agreement(ag, force_send=True)
      return Response(payload, status=status.HTTP_200_OK)
    except ValueError as e:
      return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
      return Response(
        {"detail": f"Unexpected error: {type(e).__name__}: {e}"},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def send_final_agreement_link_view(request, agreement_id: int):
  """Fallback endpoint not dependent on DRF router actions. Manual resend ALWAYS sends."""
  ag = get_object_or_404(Agreement, pk=agreement_id)
  try:
    payload = _send_final_link_for_agreement(ag, force_send=True)
    return Response(payload, status=status.HTTP_200_OK)
  except ValueError as e:
    return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
  except Exception as e:
    return Response(
      {"detail": f"Unexpected error: {type(e).__name__}: {e}"},
      status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


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
      "is_fully_signed": _is_fully_signed(ag),
    }
    return Response(data, status=200)

  token = request.data.get("token")
  if not token:
    return Response({"detail": "Missing token."}, status=400)

  ag = _unsign_public_token(token)

  was_homeowner_signed = bool(getattr(ag, "signed_by_homeowner", False))

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

  # ✅ Auto-send final email once per pdf_version (guarded)
  try:
    if _is_fully_signed(ag) and not was_homeowner_signed:
      _send_final_link_for_agreement(ag, force_send=False)
  except Exception as e:
    print("agreement_public_sign auto final email error:", repr(e), file=sys.stderr)

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
