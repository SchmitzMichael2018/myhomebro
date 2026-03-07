# backend/projects/views/agreements/viewset.py
from __future__ import annotations

import sys
import traceback
import json

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Agreement, ProjectStatus
from projects.serializers.agreement import AgreementSerializer

from projects.services.agreements.create import create_agreement_from_validated
from projects.services.agreements.address import sync_project_address_from_agreement
from projects.services.agreements.editability import enforce_editability, prepare_payload
from projects.services.agreements.refunds import build_refund_preview, execute_refund
from projects.services.agreements.pdf_loader import load_pdf_services
from projects.services.agreements.pdf_stream import serve_agreement_preview_or_final

from projects.services.agreements.final_link import send_final_link_for_agreement

from projects.services.agreements.contractor_signing import (
    send_signature_request_to_homeowner,
    apply_contractor_signature,
    unsign_contractor,
)
from projects.services.agreements.project_create import (
    resolve_contractor_for_user,
    ensure_project_for_agreement_payload,
)
from projects.services.agreements.permissions import (
    require_delete_allowed,
    require_contractor_sign_allowed,
    require_contractor_unsign_allowed,
)
from projects.services.agreements.pdf_actions import (
    mark_agreement_previewed,
    finalize_agreement_pdf,
)

from projects.ai.agreement_milestone_writer import suggest_scope_and_milestones
from projects.models_ai_scope import AgreementAIScope  # ✅ persisted Q/A model

from projects.services.agreement_completion import (
    check_agreement_completion,
    recompute_and_apply_agreement_completion,
)

try:
    import stripe  # type: ignore
except Exception:
    stripe = None  # type: ignore

try:
    from projects.models import Milestone, Invoice  # type: ignore
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore
    Invoice = None  # type: ignore

try:
    from projects.models import ExpenseRequest  # type: ignore
except Exception:  # pragma: no cover
    ExpenseRequest = None  # type: ignore


_PDF_BUILD_FN = None
_PDF_GEN_FN = None


def _get_pdf_services():
    global _PDF_BUILD_FN, _PDF_GEN_FN
    if callable(_PDF_BUILD_FN):
        return _PDF_BUILD_FN, _PDF_GEN_FN
    b, g = load_pdf_services()
    _PDF_BUILD_FN, _PDF_GEN_FN = b, g
    return _PDF_BUILD_FN, _PDF_GEN_FN


RETENTION_YEARS = 3


class AgreementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AgreementSerializer

    queryset = Agreement.objects.select_related("project", "contractor", "homeowner").order_by("-updated_at")

    def get_queryset(self):
        qs = Agreement.objects.select_related("project", "contractor", "homeowner").order_by("-updated_at")

        user = getattr(self.request, "user", None)
        if not user or not user.is_authenticated:
            return qs.none()

        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None:
                return qs.none()
            qs = qs.filter(contractor=contractor)

        include_archived_param = (self.request.query_params.get("include_archived") or "").strip() == "1"
        action_allows_archived = getattr(self, "action", None) in ("archive", "unarchive", "mark_complete")
        if not (include_archived_param or action_allows_archived):
            qs = qs.filter(is_archived=False)

        return qs

    def _enforce_editability(self, instance: Agreement, data: dict):
        return enforce_editability(self.request, instance, data)

    def _prepare_payload(self, request):
        return prepare_payload(request)

    def _preserve_signature_requirement_fields(self, request, data: dict) -> dict:
        if not isinstance(data, dict):
            return data
        src = getattr(request, "data", None)
        if src is None:
            return data

        def _norm_bool(raw):
            if raw in (True, "true", "True", "1", 1, "yes", "Yes", "on", "ON"):
                return True
            if raw in (False, "false", "False", "0", 0, "no", "No", "off", "OFF"):
                return False
            return raw

        try:
            if hasattr(src, "get"):
                for k in ("require_contractor_signature", "require_customer_signature"):
                    try:
                        present = k in src
                    except Exception:
                        present = src.get(k, None) is not None
                    if present:
                        data[k] = _norm_bool(src.get(k))
        except Exception:
            pass
        return data

    def _validate_required_addresses(self, ag: Agreement):
        missing = {"home_address": [], "project_address": []}
        h = getattr(ag, "homeowner", None)

        if not h or not getattr(h, "street_address", "").strip():
            missing["home_address"].append("street_address")
        if not h or not getattr(h, "city", "").strip():
            missing["home_address"].append("city")
        if not h or not getattr(h, "state", "").strip():
            missing["home_address"].append("state")
        if not h or not getattr(h, "zip_code", "").strip():
            missing["home_address"].append("zip_code")

        if not getattr(ag, "project_address_line1", "").strip():
            missing["project_address"].append("project_address_line1")
        if not getattr(ag, "project_address_city", "").strip():
            missing["project_address"].append("project_address_city")
        if not getattr(ag, "project_address_state", "").strip():
            missing["project_address"].append("project_address_state")
        if not getattr(ag, "project_postal_code", "").strip():
            missing["project_address"].append("project_postal_code")

        missing = {k: v for k, v in missing.items() if v}
        if missing:
            return Response(
                {"detail": "Agreement is missing required address information.", "missing": missing},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None

    def _is_step1_draft(self, payload: dict) -> bool:
        if not isinstance(payload, dict):
            return False
        if bool(payload.get("is_draft")):
            return True
        step = payload.get("wizard_step", payload.get("step"))
        if step is None:
            return False
        try:
            return str(step).strip() == "1"
        except Exception:
            return False

    def _extract_milestones_payload(self, payload: dict):
        if not isinstance(payload, dict):
            return []
        for key in ("milestones", "milestone_items", "milestone_list"):
            if key not in payload:
                continue
            v = payload.get(key)
            if v is None:
                return []
            if isinstance(v, list):
                return v
            if isinstance(v, str) and v.strip():
                try:
                    parsed = json.loads(v.strip())
                    if isinstance(parsed, list):
                        return parsed
                except Exception:
                    return []
            return []
        return []

    def _require_milestones_on_create(self, payload: dict):
        ms = self._extract_milestones_payload(payload)
        if not ms or not isinstance(ms, list) or len(ms) < 1:
            return Response(
                {"detail": "At least one milestone is required to create an agreement.",
                 "missing": {"milestones": "Provide at least one milestone item."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        meaningful = 0
        for m in ms:
            if not isinstance(m, dict):
                continue
            title = str(m.get("title") or "").strip()
            amt = m.get("amount") or m.get("amount_cents") or m.get("amount_dollars")
            has_amt = False
            try:
                if amt is not None and str(amt).strip() != "":
                    has_amt = True
            except Exception:
                has_amt = False
            if title or has_amt:
                meaningful += 1

        if meaningful < 1:
            return Response(
                {"detail": "Milestones cannot be empty. Add at least one milestone with a title and/or amount.",
                 "missing": {"milestones": "Add a real milestone (title/amount)."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return None

    # ---------------------------------------------------------------------
    # ✅ NEW: Auto finalize PDF once signature becomes satisfied
    # ---------------------------------------------------------------------
    def _signature_satisfied(self, ag: Agreement) -> bool:
        try:
            return bool(getattr(ag, "signature_is_satisfied", False))
        except Exception:
            return False

    def _auto_finalize_if_signature_satisfied_transition(self, *, before: bool, ag: Agreement) -> None:
        """
        If signature satisfaction transitions False -> True, finalize PDF once.
        This creates AgreementPDFVersion history rows and sets Agreement.pdf_file/pdf_version.
        """
        after = self._signature_satisfied(ag)
        if before or not after:
            return

        # Address requirement is enforced by finalize_pdf endpoint; do the same here.
        addr_error = self._validate_required_addresses(ag)
        if addr_error is not None:
            # Don't hard-fail the request; just skip finalize.
            print("Auto-finalize skipped: missing required address fields", file=sys.stderr)
            return

        build_fn, gen_fn = _get_pdf_services()
        if not callable(gen_fn):
            print("Auto-finalize skipped: PDF generator not loaded", file=sys.stderr)
            return

        try:
            finalize_agreement_pdf(ag, generate_full_agreement_pdf=gen_fn)
            # Ensure caller sees updated pdf_version/pdf_file if they refresh
            try:
                ag.refresh_from_db()
            except Exception:
                pass
        except Exception as e:
            # Don't block signing / updates if PDF generation fails
            print("Auto-finalize failed:", repr(e), file=sys.stderr)
            traceback.print_exc()

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        try:
            user = request.user
            contractor = resolve_contractor_for_user(user)

            if contractor is None and not (user.is_staff or user.is_superuser):
                return Response(
                    {"detail": "Authenticated user has no contractor profile linked. Create a Contractor for this user or log in as a contractor."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            payload, _created_project = ensure_project_for_agreement_payload(
                payload=request.data.copy() if hasattr(request.data, "copy") else dict(request.data),
                contractor=contractor,
            )

            if contractor is not None:
                payload["contractor"] = contractor.pk

            if not self._is_step1_draft(payload):
                ms_err = self._require_milestones_on_create(payload)
                if ms_err:
                    return ms_err

            serializer = self.get_serializer(data=payload)
            serializer.is_valid(raise_exception=False)
            if serializer.errors:
                print("AgreementSerializer errors on create():", serializer.errors, file=sys.stderr)
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            self.perform_create(serializer)

            try:
                sync_project_address_from_agreement(serializer.instance)
            except Exception as e:
                print("Warning: address sync failed on create:", repr(e), file=sys.stderr)

            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            print("AgreementViewSet.create() unexpected error:", repr(e), file=sys.stderr)
            traceback.print_exc()
            return Response(
                {"detail": f"Unexpected error while creating agreement: {type(e).__name__}: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def perform_create(self, serializer: AgreementSerializer) -> None:
        instance = create_agreement_from_validated(serializer.validated_data)
        serializer.instance = instance

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        satisfied_before = self._signature_satisfied(instance)

        data = self._prepare_payload(request)
        data = self._preserve_signature_requirement_fields(request, data)
        self._enforce_editability(instance, data)
        data = self._preserve_signature_requirement_fields(request, data)

        serializer = self.get_serializer(instance, data=data, partial=False)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            self.perform_update(serializer)
            try:
                sync_project_address_from_agreement(serializer.instance)
            except Exception as e:
                print("Warning: address sync failed on update:", repr(e), file=sys.stderr)

        # ✅ Auto finalize if we just transitioned to satisfied due to waiver/policy change
        self._auto_finalize_if_signature_satisfied_transition(before=satisfied_before, ag=serializer.instance)

        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        satisfied_before = self._signature_satisfied(instance)

        data = self._prepare_payload(request)
        data = self._preserve_signature_requirement_fields(request, data)
        self._enforce_editability(instance, data)
        data = self._preserve_signature_requirement_fields(request, data)

        serializer = self.get_serializer(instance, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            self.perform_update(serializer)
            try:
                sync_project_address_from_agreement(serializer.instance)
            except Exception as e:
                print("Warning: address sync failed on partial_update:", repr(e), file=sys.stderr)

        # ✅ Auto finalize if we just transitioned to satisfied due to waiver/policy change
        self._auto_finalize_if_signature_satisfied_transition(before=satisfied_before, ag=serializer.instance)

        return Response(serializer.data)

    def perform_update(self, serializer):
        serializer.save()

    # ---------------------------------------------------------------------
    # Mark Complete (policy-aware, canonical)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="mark_complete")
    def mark_complete(self, request, pk=None):
        ag: Agreement = self.get_object()

        user = request.user
        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None or getattr(ag, "contractor_id", None) != contractor.id:
                return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)

        if ag.status == ProjectStatus.CANCELLED:
            return Response(
                {"detail": "Agreement is cancelled and cannot be completed.", "status": ag.status},
                status=status.HTTP_409_CONFLICT,
            )

        chk = check_agreement_completion(ag)
        if not chk.ok:
            return Response(
                {
                    "ok": False,
                    "detail": chk.reason,
                    "code": "AGREEMENT_NOT_ELIGIBLE_FOR_COMPLETION",
                    "agreement_id": ag.id,
                    "status": ag.status,
                    "mode": chk.mode,
                    "milestones_total": chk.milestones_total,
                    "milestones_invoiced": chk.milestones_invoiced,
                    "invoices_total": chk.invoices_total,
                    "invoices_paid": chk.invoices_paid,
                },
                status=status.HTTP_409_CONFLICT,
            )

        changed, chk2 = recompute_and_apply_agreement_completion(ag.id)
        ag.refresh_from_db()

        ser = self.get_serializer(ag)
        return Response(
            {
                "ok": True,
                "changed": changed,
                "detail": "Agreement marked completed." if changed else "Agreement already completed.",
                "agreement_id": ag.id,
                "status": ag.status,
                "mode": chk2.mode,
                "milestones_total": chk2.milestones_total,
                "milestones_invoiced": chk2.milestones_invoiced,
                "invoices_total": chk2.invoices_total,
                "invoices_paid": chk2.invoices_paid,
                "agreement": ser.data,
            },
            status=status.HTTP_200_OK,
        )

    # ---------------------------------------------------------------------
    # Archive / Unarchive
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        ag: Agreement = self.get_object()

        user = request.user
        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None or getattr(ag, "contractor_id", None) != contractor.id:
                return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            ag = Agreement.objects.select_for_update().get(pk=ag.pk)
            ag.is_archived = True
            ag.updated_at = timezone.now()
            ag.save(update_fields=["is_archived", "updated_at"])

            if ExpenseRequest is not None:
                try:
                    ExpenseRequest.objects.filter(agreement=ag, is_archived=False).update(
                        is_archived=True,
                        archived_at=timezone.now(),
                        archived_reason="Agreement archived",
                    )
                except Exception:
                    pass

        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        ag: Agreement = self.get_object()

        user = request.user
        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None or getattr(ag, "contractor_id", None) != contractor.id:
                return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            ag = Agreement.objects.select_for_update().get(pk=ag.pk)
            ag.is_archived = False
            ag.updated_at = timezone.now()
            ag.save(update_fields=["is_archived", "updated_at"])

            if ExpenseRequest is not None:
                try:
                    ExpenseRequest.objects.filter(agreement=ag, is_archived=True).update(
                        is_archived=False,
                        archived_at=None,
                        archived_reason="",
                    )
                except Exception:
                    pass

        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request, pk=None):
        ag: Agreement = self.get_object()

        user = request.user
        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None or getattr(ag, "contractor_id", None) != contractor.id:
                return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)

        reviewed = bool(request.data.get("contractor_ack_reviewed", False))
        tos = bool(request.data.get("contractor_ack_tos", False))
        esign = bool(request.data.get("contractor_ack_esign", False))

        ag.contractor_ack_reviewed = reviewed
        ag.contractor_ack_tos = tos
        ag.contractor_ack_esign = esign

        if reviewed and tos and esign:
            ag.contractor_ack_at = timezone.now()
        else:
            ag.contractor_ack_at = None

        ag.save(
            update_fields=[
                "contractor_ack_reviewed",
                "contractor_ack_tos",
                "contractor_ack_esign",
                "contractor_ack_at",
            ]
        )

        return Response(
            {
                "contractor_ack_reviewed": bool(ag.contractor_ack_reviewed),
                "contractor_ack_tos": bool(ag.contractor_ack_tos),
                "contractor_ack_esign": bool(ag.contractor_ack_esign),
                "contractor_ack_at": ag.contractor_ack_at,
            },
            status=status.HTTP_200_OK,
        )

    # ---------------------------------------------------------------------
    # AI / Refund / PDF / Signing
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="ai/suggest-milestones")
    def ai_suggest_milestones(self, request, pk=None):
        ag: Agreement = self.get_object()
        user = request.user
        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None:
                return Response({"detail": "Contractor only."}, status=status.HTTP_403_FORBIDDEN)
            if getattr(getattr(ag, "project", None), "contractor_id", None) != contractor.id:
                return Response({"detail": "Not authorized for this agreement."}, status=status.HTTP_403_FORBIDDEN)

        notes = ""
        ai_answers = {}
        try:
            if isinstance(request.data, dict):
                notes = (request.data.get("notes") or "").strip()
                ai_answers = request.data.get("ai_answers") or {}
        except Exception:
            notes = ""
            ai_answers = {}

        try:
            out = suggest_scope_and_milestones(agreement=ag, notes=notes)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        questions = out.get("questions", []) or []
        scope_obj, _ = AgreementAIScope.objects.get_or_create(agreement=ag)
        scope_obj.questions = questions

        if isinstance(ai_answers, dict) and ai_answers:
            merged = dict(scope_obj.answers or {})
            merged.update(ai_answers)
            scope_obj.answers = merged

        scope_obj.save()

        return Response(
            {
                "detail": "OK",
                "scope_text": out.get("scope_text", ""),
                "milestones": out.get("milestones", []),
                "questions": questions,
                "_model": out.get("_model"),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"], url_path="refund_preview")
    def refund_preview(self, request, pk=None):
        ag: Agreement = self.get_object()
        payload, code = build_refund_preview(request, ag, stripe)
        return Response(payload, status=code)

    @action(detail=True, methods=["post"], url_path="refund")
    def refund(self, request, pk=None):
        ag: Agreement = self.get_object()
        payload, code = execute_refund(request, ag, stripe)
        return Response(payload, status=code)

    # ✅ FINAL-AWARE: if executed (waiver-aware), remove watermark by serving final PDF
    @action(detail=True, methods=["get"], url_path="preview_pdf")
    def preview_pdf(self, request, pk=None):
        stream = request.query_params.get("stream")
        if not stream:
            url = request.build_absolute_uri("?stream=1")
            return Response({"url": url}, status=status.HTTP_200_OK)

        ag: Agreement = self.get_object()

        explicit_preview = (request.query_params.get("preview") or "").strip() == "1"
        executed = bool(getattr(ag, "signature_is_satisfied", False))

        force_preview = True
        if executed and not explicit_preview:
            force_preview = False
        if explicit_preview:
            force_preview = True

        build_fn, gen_fn = _get_pdf_services()
        if not callable(build_fn):
            return Response(
                {
                    "detail": "PDF preview not available.",
                    "hint": "build_agreement_pdf_bytes not loaded. Check server logs for pdf_loader import errors.",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return serve_agreement_preview_or_final(
            ag,
            stream=True,
            force_preview=force_preview,
            build_agreement_pdf_bytes=build_fn,
            generate_full_agreement_pdf=gen_fn,
            request=request,
        )

    @action(detail=True, methods=["get"], url_path="preview_link")
    def preview_link(self, request, pk=None):
        stream = request.query_params.get("stream")
        if not stream:
            url = request.build_absolute_uri("?stream=1")
            return Response({"url": url}, status=status.HTTP_200_OK)

        ag: Agreement = self.get_object()

        explicit_preview = (request.query_params.get("preview") or "").strip() == "1"
        executed = bool(getattr(ag, "signature_is_satisfied", False))

        force_preview = True
        if executed and not explicit_preview:
            force_preview = False
        if explicit_preview:
            force_preview = True

        build_fn, gen_fn = _get_pdf_services()
        if not callable(build_fn):
            return Response(
                {
                    "detail": "PDF preview not available.",
                    "hint": "build_agreement_pdf_bytes not loaded. Check server logs for pdf_loader import errors.",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return serve_agreement_preview_or_final(
            ag,
            stream=True,
            force_preview=force_preview,
            build_agreement_pdf_bytes=build_fn,
            generate_full_agreement_pdf=gen_fn,
            request=request,
        )

    @action(detail=True, methods=["post"], url_path="mark_previewed")
    def mark_previewed(self, request, pk=None):
        ag: Agreement = self.get_object()
        mark_agreement_previewed(ag, reviewed_by="contractor")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def finalize_pdf(self, request, pk=None):
        ag = self.get_object()
        addr_error = self._validate_required_addresses(ag)
        if addr_error:
            return addr_error

        build_fn, gen_fn = _get_pdf_services()
        if not callable(gen_fn):
            return Response(
                {"detail": "Final PDF generation not available (generator not loaded)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            pdf_url = finalize_agreement_pdf(ag, generate_full_agreement_pdf=gen_fn)
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as e:
            return Response({"detail": f"PDF generation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"ok": True, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def send_signature_request(self, request, pk=None):
        ag: Agreement = self.get_object()
        addr_error = self._validate_required_addresses(ag)
        if addr_error:
            return addr_error

        try:
            payload = send_signature_request_to_homeowner(ag)
            return Response(payload, status=status.HTTP_200_OK)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({"detail": f"Unexpected error: {type(e).__name__}: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["post"], url_path="send_final_agreement_link")
    def send_final_agreement_link(self, request, pk=None):
        ag: Agreement = self.get_object()
        addr_error = self._validate_required_addresses(ag)
        if addr_error:
            return addr_error

        try:
            payload = send_final_link_for_agreement(ag, force_send=True)
            return Response(payload, status=status.HTTP_200_OK)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({"detail": f"Unexpected error: {type(e).__name__}: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["post"])
    def contractor_sign(self, request, pk=None):
        ag: Agreement = self.get_object()
        require_contractor_sign_allowed(request.user, ag)

        # Track transition
        satisfied_before = self._signature_satisfied(ag)

        addr_error = self._validate_required_addresses(ag)
        if addr_error:
            return addr_error

        name = (request.data.get("typed_name") or request.data.get("name") or "").strip()
        signature_file = request.FILES.get("signature")
        data_url = request.data.get("signature_data_url")
        ip = (request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
              or request.META.get("REMOTE_ADDR"))

        try:
            ag = apply_contractor_signature(
                ag,
                typed_name=name,
                signature_file=signature_file,
                signature_data_url=data_url,
                signed_ip=ip or None,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # ✅ Auto finalize if this signature satisfies requirements (waiver-aware)
        self._auto_finalize_if_signature_satisfied_transition(before=satisfied_before, ag=ag)

        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def contractor_unsign(self, request, pk=None):
        ag: Agreement = self.get_object()
        require_contractor_unsign_allowed(request.user, ag)
        ag = unsign_contractor(ag)
        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        ag: Agreement = self.get_object()
        require_delete_allowed(request.user, ag, retention_years=RETENTION_YEARS)
        return super().destroy(request, *args, **kwargs)