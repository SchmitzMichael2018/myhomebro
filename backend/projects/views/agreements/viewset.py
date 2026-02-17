# backend/projects/views/agreements/viewset.py
from __future__ import annotations

import sys
import traceback

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Agreement
from projects.serializers.agreement import AgreementSerializer

from projects.services.agreements.create import create_agreement_from_validated
from projects.services.agreements.address import sync_project_address_from_agreement
from projects.services.agreements.editability import enforce_editability, prepare_payload
from projects.services.agreements.refunds import build_refund_preview, execute_refund
from projects.services.agreements.pdf_loader import load_pdf_services
from projects.services.agreements.pdf_stream import serve_agreement_preview_or_final

# ✅ FIX: correct import name (your final_link.py exports send_final_link_for_agreement)
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

# Stripe is required for refund endpoints
try:
    import stripe  # type: ignore
except Exception:
    stripe = None  # type: ignore

build_agreement_pdf_bytes, generate_full_agreement_pdf = load_pdf_services()
RETENTION_YEARS = 3


class AgreementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AgreementSerializer

    # IMPORTANT:
    # - Do NOT use .all() as a public queryset for contractors; it leaks data.
    # - get_queryset() below filters by the authenticated contractor (staff can see all).
    queryset = Agreement.objects.select_related("project", "contractor", "homeowner").order_by(
        "-updated_at"
    )

    def get_queryset(self):
        """
        ✅ SECURITY FIX:
        Contractors must only see their own agreements.
        Staff/superusers can see all.
        """
        qs = Agreement.objects.select_related("project", "contractor", "homeowner").order_by(
            "-updated_at"
        )

        user = getattr(self.request, "user", None)
        if not user or not user.is_authenticated:
            return qs.none()

        # Staff can see everything
        if user.is_staff or user.is_superuser:
            return qs

        # Contractors: restrict to their own agreements
        contractor = resolve_contractor_for_user(user)
        if contractor is None:
            return qs.none()

        return qs.filter(contractor=contractor)

    def _enforce_editability(self, instance: Agreement, data: dict):
        return enforce_editability(self.request, instance, data)

    def _prepare_payload(self, request):
        return prepare_payload(request)

    # ---------------------------------------------------------------------
    # ✅ Completion Gate: require BOTH Home Address + Project Address
    # ---------------------------------------------------------------------
    def _validate_required_addresses(self, ag: Agreement):
        """
        Invite acceptance may create a Customer with minimal info (name/email/phone).
        But a FINAL agreement must have:
          - Customer (home) address complete
          - Project address complete

        Returns:
          - None if OK
          - Response(400) with missing fields if incomplete
        """
        missing = {
            "home_address": [],
            "project_address": [],
        }

        # ---- Customer/Homeowner address ----
        h = getattr(ag, "homeowner", None)

        if not h or not getattr(h, "street_address", "").strip():
            missing["home_address"].append("street_address")
        if not h or not getattr(h, "city", "").strip():
            missing["home_address"].append("city")
        if not h or not getattr(h, "state", "").strip():
            missing["home_address"].append("state")
        if not h or not getattr(h, "zip_code", "").strip():
            missing["home_address"].append("zip_code")

        # ---- Project address (Agreement fields) ----
        if not getattr(ag, "project_address_line1", "").strip():
            missing["project_address"].append("project_address_line1")
        if not getattr(ag, "project_address_city", "").strip():
            missing["project_address"].append("project_address_city")
        if not getattr(ag, "project_address_state", "").strip():
            missing["project_address"].append("project_address_state")
        if not getattr(ag, "project_postal_code", "").strip():
            missing["project_address"].append("project_postal_code")

        # prune empties
        missing = {k: v for k, v in missing.items() if v}

        if missing:
            return Response(
                {
                    "detail": "Agreement is missing required address information.",
                    "missing": missing,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return None

    # ---------------------------------------------------------------------
    # CREATE
    # ---------------------------------------------------------------------
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        try:
            user = request.user
            contractor = resolve_contractor_for_user(user)

            if contractor is None and not (user.is_staff or user.is_superuser):
                return Response(
                    {
                        "detail": "Authenticated user has no contractor profile linked. "
                        "Create a Contractor for this user or log in as a contractor."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            payload, _created_project = ensure_project_for_agreement_payload(
                payload=request.data.copy() if hasattr(request.data, "copy") else dict(request.data),
                contractor=contractor,
            )

            if contractor is not None:
                payload["contractor"] = contractor.pk

            serializer = self.get_serializer(data=payload)
            serializer.is_valid(raise_exception=False)
            if serializer.errors:
                print("AgreementSerializer errors on create():", serializer.errors, file=sys.stderr)
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            self.perform_create(serializer)

            # Address sync (best-effort)
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

    # ---------------------------------------------------------------------
    # UPDATE
    # ---------------------------------------------------------------------
    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        data = self._prepare_payload(request)
        self._enforce_editability(instance, data)
        serializer = self.get_serializer(instance, data=data, partial=False)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            self.perform_update(serializer)
            try:
                sync_project_address_from_agreement(serializer.instance)
            except Exception as e:
                print("Warning: address sync failed on update:", repr(e), file=sys.stderr)
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
                sync_project_address_from_agreement(serializer.instance)
            except Exception as e:
                print("Warning: address sync failed on partial_update:", repr(e), file=sys.stderr)
        return Response(serializer.data)

    def perform_update(self, serializer):
        serializer.save()

    # ---------------------------------------------------------------------
    # ✅ AI: Suggest milestones + persist scope Q/A
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="ai/suggest-milestones")
    def ai_suggest_milestones(self, request, pk=None):
        """
        POST /api/projects/agreements/<pk>/ai/suggest-milestones/
        Body (optional):
          { "notes": "...", "ai_answers": {...} }
        Returns:
          { scope_text, milestones, questions }
        Persists:
          AgreementAIScope.questions + AgreementAIScope.answers
        """
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

    # ---------------------------------------------------------------------
    # REFUNDS
    # ---------------------------------------------------------------------
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

    # ---------------------------------------------------------------------
    # PDF PREVIEW + FINAL
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="preview_pdf")
    def preview_pdf(self, request, pk=None):
        stream = request.query_params.get("stream")
        if not stream:
            url = request.build_absolute_uri("?stream=1")
            return Response({"url": url}, status=status.HTTP_200_OK)

        ag: Agreement = self.get_object()
        force_preview = (request.query_params.get("preview") or "").strip() == "1"
        return serve_agreement_preview_or_final(
            ag,
            stream=True,
            force_preview=force_preview,
            build_agreement_pdf_bytes=build_agreement_pdf_bytes,
            generate_full_agreement_pdf=generate_full_agreement_pdf,
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

        try:
            pdf_url = finalize_agreement_pdf(ag, generate_full_agreement_pdf=generate_full_agreement_pdf)
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as e:
            return Response({"detail": f"PDF generation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"ok": True, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

    # ---------------------------------------------------------------------
    # SIGNING
    # ---------------------------------------------------------------------
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
            return Response(
                {"detail": f"Unexpected error: {type(e).__name__}: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

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
            return Response(
                {"detail": f"Unexpected error: {type(e).__name__}: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["post"])
    def contractor_sign(self, request, pk=None):
        ag: Agreement = self.get_object()
        require_contractor_sign_allowed(request.user, ag)

        addr_error = self._validate_required_addresses(ag)
        if addr_error:
            return addr_error

        name = (request.data.get("typed_name") or request.data.get("name") or "").strip()
        signature_file = request.FILES.get("signature")
        data_url = request.data.get("signature_data_url")
        ip = (
            request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR")
        )

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
