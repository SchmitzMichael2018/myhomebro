from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from django.utils.dateparse import parse_date

from projects.ai.template_builder import (
    create_template_from_scope,
    improve_template_description,
    suggest_template_type_subtype,
)
from projects.models import Agreement, Project
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.serializers.agreement import AgreementSerializer
from projects.serializers_template import (
    ApplyTemplateSerializer,
    ProjectTemplateCreateUpdateSerializer,
    ProjectTemplateDetailSerializer,
    ProjectTemplateListSerializer,
    SaveAgreementAsTemplateSerializer,
)
from projects.services.agreements.create import create_agreement_from_validated
from projects.services.agreements.project_create import ensure_project_for_agreement_payload
from projects.services.template_apply import (
    agreement_belongs_to_contractor,
    apply_template_to_agreement,
    get_request_contractor,
    save_agreement_as_template,
    user_can_use_template_ai,
)
from projects.services.edit_lineage import (
    build_agreement_edit_lineage_state,
    capture_agreement_edit_lineage_events,
)
from projects.services.template_discovery import (
    attach_template_learning_metrics,
    can_access_template,
    discover_templates,
    get_template_detail_queryset,
)
from projects.services.template_pricing import suggest_template_pricing
from projects.services.regions import build_normalized_region_key


def _safe_str(value) -> str:
    return str(value or "").strip()


def _to_decimal(value, default: str = "0.00") -> Decimal:
    try:
        if value in (None, ""):
            return Decimal(default)
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _template_queryset():
    return get_template_detail_queryset()


def _is_admin_user(user) -> bool:
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


class TemplateListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = get_request_contractor(request.user)
        is_admin = _is_admin_user(request.user)
        project_type = request.query_params.get("project_type", "").strip()
        project_subtype = request.query_params.get("project_subtype", "").strip()
        q = request.query_params.get("q", "").strip()
        source = request.query_params.get("source", "").strip().lower()
        include_inactive = (
            request.query_params.get("include_inactive", "false").lower() == "true"
        )

        if is_admin:
            qs = _template_queryset()
            if source == "system":
                qs = qs.filter(is_system_template=True)
            elif source == "regional":
                qs = qs.filter(
                    is_system_template=False,
                    visibility=ProjectTemplate.Visibility.REGIONAL,
                    allow_discovery=True,
                )
            elif source == "public":
                qs = qs.filter(
                    is_system_template=False,
                    visibility=ProjectTemplate.Visibility.PUBLIC,
                    allow_discovery=True,
                )
            elif source == "contractor":
                qs = qs.filter(is_system_template=False)
        else:
            qs = _template_queryset().filter(Q(is_system_template=True, is_published=True) | Q(contractor=contractor))

        if not include_inactive:
            qs = qs.filter(is_active=True)

        if q:
            qs = qs.filter(
                Q(name__icontains=q)
                | Q(project_type__icontains=q)
                | Q(project_subtype__icontains=q)
                | Q(description__icontains=q)
            )

        if project_type:
            qs = qs.filter(project_type__iexact=project_type)

        if project_subtype:
            qs = qs.filter(project_subtype__iexact=project_subtype)

        qs = qs.order_by("-is_system_template", "name")

        serializer = ProjectTemplateListSerializer(qs, many=True)
        return Response(serializer.data)

    def post(self, request):
        contractor = get_request_contractor(request.user)
        is_admin = _is_admin_user(request.user)
        if contractor is None and not is_admin:
            raise PermissionDenied("Only contractors can create templates.")

        serializer = ProjectTemplateCreateUpdateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        is_system_requested = bool(request.data.get("is_system", False)) or is_admin
        template = serializer.save(
            contractor=None if is_system_requested else contractor,
            is_system=is_system_requested,
            is_published=bool(request.data.get("is_published", False)),
        )

        template = _template_queryset().get(pk=template.pk)
        response_data = ProjectTemplateDetailSerializer(template).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class TemplateDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request, pk: int) -> ProjectTemplate:
        contractor = get_request_contractor(request.user)
        is_admin = _is_admin_user(request.user)

        try:
            template = _template_queryset().get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        region_key = request.query_params.get("normalized_region_key", "").strip()
        if is_admin:
            attach_template_learning_metrics([template])
            return template
        if not can_access_template(template, contractor, region_key=region_key):
            raise PermissionDenied("You do not have access to this template.")
        attach_template_learning_metrics([template])

        return template

    def get(self, request, pk: int):
        template = self.get_object(request, pk)
        serializer = ProjectTemplateDetailSerializer(template)
        return Response(serializer.data)

    def patch(self, request, pk: int):
        template = self.get_object(request, pk)
        is_admin = _is_admin_user(request.user)

        if template.is_system_template and not is_admin:
            raise PermissionDenied("System templates cannot be edited here.")

        serializer = ProjectTemplateCreateUpdateSerializer(
            template,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        template = serializer.save()

        template = _template_queryset().get(pk=template.pk)
        return Response(ProjectTemplateDetailSerializer(template).data)

    def delete(self, request, pk: int):
        template = self.get_object(request, pk)

        if template.is_system_template:
            raise PermissionDenied("System templates cannot be deleted here.")

        template.delete()
        return Response({"detail": "Template deleted."}, status=status.HTTP_204_NO_CONTENT)


class ApplyTemplateToAgreementView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _serialize_apply_response(self, *, agreement: Agreement, request, result: dict, template: ProjectTemplate):
        agreement.refresh_from_db()
        agreement = (
            Agreement.objects.select_related(
                "project",
                "homeowner",
                "contractor",
                "selected_template",
                "project_type_ref",
                "project_subtype_ref",
            )
            .prefetch_related("milestones")
            .get(pk=agreement.id)
        )

        return Response(
            {
                "detail": "Template applied successfully.",
                "result": {
                    **result,
                    "start_date": result["start_date"].isoformat()
                    if result.get("start_date")
                    else None,
                    "end_date": result["end_date"].isoformat()
                    if result.get("end_date")
                    else None,
                },
                "agreement": AgreementSerializer(
                    agreement,
                    context={"request": request},
                ).data,
                "template": ProjectTemplateDetailSerializer(template).data,
            },
            status=status.HTTP_200_OK,
        )

    def _apply_template(self, *, request, contractor, agreement: Agreement, template: ProjectTemplate):
        serializer = ApplyTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        overwrite_existing = serializer.validated_data["overwrite_existing"]
        copy_text_fields = serializer.validated_data["copy_text_fields"]
        try:
            before_lineage_state = build_agreement_edit_lineage_state(agreement)
        except Exception:
            before_lineage_state = None

        try:
            result = apply_template_to_agreement(
                agreement=agreement,
                template=template,
                application_mode=serializer.validated_data.get("application_mode", "enhance"),
                overwrite_existing=overwrite_existing,
                copy_text_fields=copy_text_fields,
                estimated_days=serializer.validated_data.get("estimated_days"),
                start_date_override=(
                    serializer.validated_data.get("project_start_date")
                    or serializer.validated_data.get("start")
                ),
                auto_schedule=serializer.validated_data.get("auto_schedule", False),
                spread_enabled=serializer.validated_data.get("spread_enabled", False),
                spread_total=serializer.validated_data.get("spread_total"),
            )
        except ValueError as exc:
            raise ValidationError(str(exc))

        if before_lineage_state is not None:
            try:
                agreement.refresh_from_db()
                capture_agreement_edit_lineage_events(
                    agreement,
                    before_state=before_lineage_state,
                    source="template",
                    change_reason="template_applied",
                    metadata={
                        "capture_point": "template_apply_view",
                        "template_id": template.id,
                        "template_name": template.name,
                        "application_mode": serializer.validated_data.get("application_mode", "enhance"),
                    },
                )
            except Exception:
                pass

        return self._serialize_apply_response(
            agreement=agreement,
            request=request,
            result=result,
            template=template,
        )

    def post(self, request, agreement_id: int):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can apply templates.")

        try:
            agreement = Agreement.objects.get(pk=agreement_id)
        except Agreement.DoesNotExist:
            raise ValidationError("Agreement not found.")

        if not agreement_belongs_to_contractor(agreement, contractor):
            raise PermissionDenied("You do not have access to this agreement.")

        serializer = ApplyTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        template_id = serializer.validated_data["template_id"]

        try:
            template = ProjectTemplate.objects.get(pk=template_id)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if not can_access_template(template, contractor):
            raise PermissionDenied("You do not have access to this template.")

        return self._apply_template(
            request=request,
            contractor=contractor,
            agreement=agreement,
            template=template,
        )


class ApplyTemplateToNewAgreementView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _split_fresh_apply_payload(self, request):
        raw_payload = request.data.copy() if hasattr(request.data, "copy") else dict(request.data or {})
        payload = dict(raw_payload)
        apply_serializer = ApplyTemplateSerializer(data=payload)
        apply_serializer.is_valid(raise_exception=True)
        apply_options = dict(apply_serializer.validated_data)

        create_payload = dict(payload)
        for key in (
            "template_id",
            "overwrite_existing",
            "copy_text_fields",
            "application_mode",
            "estimated_days",
            "auto_schedule",
            "spread_enabled",
            "spread_total",
            "wizard_step",
            "is_draft",
            "scope_of_work",
            "project_family_key",
            "project_family_label",
        ):
            create_payload.pop(key, None)

        return create_payload, apply_options

    def _create_draft_agreement(self, create_payload, contractor) -> Agreement:
        payload = dict(create_payload)
        project = None

        try:
            normalized_payload, _project = ensure_project_for_agreement_payload(
                payload=payload,
                contractor=contractor,
            )
            project = _project or None
            if project is None and normalized_payload.get("project"):
                try:
                    project = Project.objects.get(pk=normalized_payload["project"])
                except Project.DoesNotExist:
                    project = None
        except ValueError:
            normalized_payload = dict(payload)
            draft_title = _safe_str(
                normalized_payload.get("project_title")
                or normalized_payload.get("title")
                or normalized_payload.get("name")
            ) or "Draft Agreement"
            draft_description = str(
                normalized_payload.get("description")
                or normalized_payload.get("scope_of_work")
                or ""
            ).strip()
            project = Project.objects.create(
                contractor=contractor,
                homeowner=None,
                title=draft_title,
                description=draft_description,
            )
            normalized_payload["project"] = project
        else:
            draft_title = _safe_str(
                normalized_payload.get("project_title")
                or normalized_payload.get("title")
                or normalized_payload.get("name")
            ) or "Draft Agreement"
            draft_description = str(
                normalized_payload.get("description")
                or normalized_payload.get("scope_of_work")
                or ""
            ).strip()

        normalized_payload["contractor"] = contractor
        normalized_payload["homeowner"] = normalized_payload.get("homeowner", None)
        normalized_payload["title"] = draft_title
        normalized_payload["project_title"] = draft_title
        normalized_payload["description"] = draft_description
        normalized_payload["scope_of_work"] = draft_description
        normalized_payload["step_status"] = "step1"
        if project is not None:
            normalized_payload["project"] = project
        normalized_payload.pop("is_draft", None)
        normalized_payload.pop("wizard_step", None)

        agreement = create_agreement_from_validated(normalized_payload)
        return agreement

    @transaction.atomic
    def post(self, request):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can apply templates.")

        try:
            create_payload, apply_options = self._split_fresh_apply_payload(request)
            agreement = self._create_draft_agreement(create_payload, contractor)
            agreement = Agreement.objects.get(pk=agreement.pk)

            requested_start = create_payload.get("project_start_date") or create_payload.get("start")
            parsed_start = parse_date(str(requested_start)) if requested_start else None
            if parsed_start and getattr(agreement, "start", None) != parsed_start:
                agreement.start = parsed_start
                agreement.save(update_fields=["start"])
                agreement.refresh_from_db()

            template_id = apply_options["template_id"]
            try:
                template = ProjectTemplate.objects.get(pk=template_id)
            except ProjectTemplate.DoesNotExist:
                raise ValidationError("Template not found.")

            if not can_access_template(template, contractor):
                raise PermissionDenied("You do not have access to this template.")

            return ApplyTemplateToAgreementView()._apply_template(
                request=request,
                contractor=contractor,
                agreement=agreement,
                template=template,
            )
        except (ValidationError, PermissionDenied):
            raise
        except Exception as exc:
            return Response(
                {
                    "detail": "Could not create draft agreement.",
                    "error": str(exc),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )


class ResetAgreementStep1View(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, agreement_id: int):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can reset draft agreements.")

        try:
            agreement = (
                Agreement.objects.select_related("project", "selected_template")
                .prefetch_related("milestones")
                .get(pk=agreement_id)
            )
        except Agreement.DoesNotExist:
            raise ValidationError("Agreement not found.")

        if not agreement_belongs_to_contractor(agreement, contractor):
            raise PermissionDenied("You do not have access to this agreement.")

        status_value = str(getattr(agreement, "status", "") or "").strip().lower()
        if (
            status_value != "draft"
            or bool(getattr(agreement, "is_archived", False))
            or bool(getattr(agreement, "signed_by_contractor", False))
            or bool(getattr(agreement, "signed_by_homeowner", False))
            or bool(getattr(agreement, "is_fully_signed", False))
        ):
            raise ValidationError("Only editable draft agreements can be reset here.")

        project = getattr(agreement, "project", None)
        try:
            before_lineage_state = build_agreement_edit_lineage_state(agreement)
        except Exception:
            before_lineage_state = None

        with transaction.atomic():
            agreement.selected_template = None
            agreement.selected_template_name_snapshot = ""
            agreement.homeowner = None
            agreement.project_type_ref = None
            agreement.project_subtype_ref = None
            agreement.project_type = ""
            agreement.project_subtype = ""
            agreement.description = ""
            agreement.payment_structure = "simple"
            agreement.retainage_percent = Decimal("0.00")
            agreement.agreement_mode = "standard"
            if hasattr(agreement, "step_status"):
                agreement.step_status = ""
            agreement.recurring_service_enabled = False
            agreement.recurrence_pattern = ""
            agreement.recurrence_interval = 1
            agreement.recurrence_start_date = None
            agreement.recurrence_end_date = None
            agreement.next_occurrence_date = None
            agreement.auto_generate_next_occurrence = False
            agreement.maintenance_status = "active"
            agreement.service_window_notes = ""
            agreement.recurring_summary_label = ""
            agreement.project_address_line1 = ""
            agreement.project_address_line2 = ""
            agreement.project_address_city = ""
            agreement.project_address_state = ""
            agreement.project_postal_code = ""
            agreement.start = None
            agreement.end = None
            agreement.total_cost = Decimal("0.00")
            agreement.milestone_count = 0
            agreement.save(
                update_fields=[
                    "selected_template",
                    "selected_template_name_snapshot",
                    "homeowner",
                    "project_type_ref",
                    "project_subtype_ref",
                    "project_type",
                    "project_subtype",
                    "description",
                    "payment_structure",
                    "retainage_percent",
                    "agreement_mode",
                    "step_status",
                    "recurring_service_enabled",
                    "recurrence_pattern",
                    "recurrence_interval",
                    "recurrence_start_date",
                    "recurrence_end_date",
                    "next_occurrence_date",
                    "auto_generate_next_occurrence",
                    "maintenance_status",
                    "service_window_notes",
                    "recurring_summary_label",
                    "project_address_line1",
                    "project_address_line2",
                    "project_address_city",
                    "project_address_state",
                    "project_postal_code",
                    "start",
                    "end",
                    "total_cost",
                    "milestone_count",
                ],
            )

            agreement.milestones.all().delete()

            if hasattr(agreement, "ai_scope") and agreement.ai_scope is not None:
                agreement.ai_scope.delete()

            if project is not None:
                project.homeowner = None
                project.title = ""
                project.description = ""
                project.project_street_address = ""
                project.project_address_line_2 = ""
                project.project_city = ""
                project.project_state = ""
                project.project_zip_code = ""
                project.save(
                    update_fields=[
                        "homeowner",
                        "title",
                        "description",
                        "project_street_address",
                        "project_address_line_2",
                        "project_city",
                        "project_state",
                        "project_zip_code",
                    ]
                )

        if before_lineage_state is not None:
            try:
                agreement.refresh_from_db()
                capture_agreement_edit_lineage_events(
                    agreement,
                    before_state=before_lineage_state,
                    source="contractor",
                    change_reason="step1_reset",
                    metadata={"capture_point": "reset_agreement_step1_view"},
                )
            except Exception:
                pass

        agreement.refresh_from_db()
        agreement = (
            Agreement.objects.select_related(
                "project",
                "homeowner",
                "contractor",
                "selected_template",
                "project_type_ref",
                "project_subtype_ref",
            )
            .prefetch_related("milestones")
            .get(pk=agreement.id)
        )

        return Response(
            {
                "detail": "Agreement setup reset.",
                "agreement": AgreementSerializer(
                    agreement,
                    context={"request": request},
                ).data,
            },
            status=status.HTTP_200_OK,
        )


class SaveAgreementAsTemplateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, agreement_id: int):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can save templates.")

        try:
            agreement = Agreement.objects.get(pk=agreement_id)
        except Agreement.DoesNotExist:
            raise ValidationError("Agreement not found.")

        if not agreement_belongs_to_contractor(agreement, contractor):
            raise PermissionDenied("You do not have access to this agreement.")

        serializer = SaveAgreementAsTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            template = save_agreement_as_template(
                agreement=agreement,
                contractor=contractor,
                name=serializer.validated_data["name"],
                description=serializer.validated_data.get("description", ""),
                scope_description=serializer.validated_data.get("scope_description", ""),
                is_active=serializer.validated_data.get("is_active", True),
            )
        except ValueError as exc:
            raise ValidationError(str(exc))

        template = _template_queryset().get(pk=template.pk)

        return Response(
            {
                "detail": "Template saved successfully.",
                "template": ProjectTemplateDetailSerializer(template).data,
            },
            status=status.HTTP_201_CREATED,
        )


class TemplateSuggestPricingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk: int):
        contractor = get_request_contractor(request.user)

        try:
            template = ProjectTemplate.objects.get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if not can_access_template(template, contractor):
            raise PermissionDenied("You do not have access to this template.")

        region_state = _safe_str(request.data.get("region_state"))
        region_city = _safe_str(request.data.get("region_city"))

        if contractor is not None:
            if not region_state:
                region_state = _safe_str(getattr(contractor, "state", None))
            if not region_city:
                region_city = _safe_str(getattr(contractor, "city", None))

        suggestions = suggest_template_pricing(
            template,
            contractor=contractor,
            region_state=region_state,
            region_city=region_city,
        )

        return Response(
            {
                "template_id": template.id,
                "template_name": template.name,
                "region_state": region_state,
                "region_city": region_city,
                "suggestions": suggestions,
            },
            status=status.HTTP_200_OK,
        )


class TemplateApplyPricingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk: int):
        contractor = get_request_contractor(request.user)

        try:
            template = ProjectTemplate.objects.get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if template.is_system_template:
            raise PermissionDenied("System templates cannot be modified.")

        if contractor is None or template.contractor_id != contractor.id:
            raise PermissionDenied("You do not have permission to modify this template.")

        rows = request.data.get("suggestions")
        if not isinstance(rows, list) or not rows:
            raise ValidationError("No pricing suggestions were provided.")

        milestone_map = {
            m.id: m for m in ProjectTemplateMilestone.objects.filter(template=template)
        }

        applied = 0

        with transaction.atomic():
            for row in rows:
                if not isinstance(row, dict):
                    continue

                milestone_id = row.get("template_milestone_id")
                if not milestone_id:
                    continue

                try:
                    milestone_id = int(milestone_id)
                except Exception:
                    continue

                milestone = milestone_map.get(milestone_id)
                if milestone is None:
                    continue

                suggested_amount = _to_decimal(row.get("suggested_amount"))
                low_amount = _to_decimal(row.get("low_amount"))
                high_amount = _to_decimal(row.get("high_amount"))
                confidence = _safe_str(row.get("confidence"))
                source_note = _safe_str(row.get("source_note"))
                normalized_type = _safe_str(row.get("normalized_milestone_type"))

                update_fields = []

                if (
                    normalized_type
                    and milestone.normalized_milestone_type != normalized_type
                ):
                    milestone.normalized_milestone_type = normalized_type
                    update_fields.append("normalized_milestone_type")

                if suggested_amount > 0:
                    milestone.suggested_amount_fixed = suggested_amount
                    update_fields.append("suggested_amount_fixed")

                if low_amount > 0:
                    milestone.suggested_amount_low = low_amount
                    update_fields.append("suggested_amount_low")

                if high_amount > 0:
                    milestone.suggested_amount_high = high_amount
                    update_fields.append("suggested_amount_high")

                if confidence != milestone.pricing_confidence:
                    milestone.pricing_confidence = confidence
                    update_fields.append("pricing_confidence")

                if source_note != milestone.pricing_source_note:
                    milestone.pricing_source_note = source_note[:255]
                    update_fields.append("pricing_source_note")

                if update_fields:
                    milestone.save(update_fields=update_fields)
                    applied += 1

        return Response(
            {
                "detail": f"Applied pricing updates to {applied} template milestone(s).",
                "applied_count": applied,
                "template_id": template.id,
            },
            status=status.HTTP_200_OK,
        )


class TemplateImproveDescriptionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not user_can_use_template_ai(request.user):
            raise PermissionDenied("AI tools are available to contractors and admins")

        try:
            result = improve_template_description(
                name=_safe_str(request.data.get("name")),
                project_type=_safe_str(request.data.get("project_type")),
                project_subtype=_safe_str(request.data.get("project_subtype")),
                description=_safe_str(request.data.get("description")),
            )
        except Exception as exc:
            raise ValidationError(str(exc))

        return Response(result, status=status.HTTP_200_OK)


class TemplateSuggestTypeSubtypeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not user_can_use_template_ai(request.user):
            raise PermissionDenied("AI tools are available to contractors and admins")

        try:
            result = suggest_template_type_subtype(
                name=_safe_str(request.data.get("name")),
                description=_safe_str(request.data.get("description")),
            )
        except Exception as exc:
            raise ValidationError(str(exc))

        return Response(result, status=status.HTTP_200_OK)


class TemplateCreateFromScopeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not user_can_use_template_ai(request.user):
            raise PermissionDenied("AI tools are available to contractors and admins")

        try:
            result = create_template_from_scope(
                name=_safe_str(request.data.get("name")),
                project_type=_safe_str(request.data.get("project_type")),
                project_subtype=_safe_str(request.data.get("project_subtype")),
                description=_safe_str(request.data.get("description")),
            )
        except Exception as exc:
            raise ValidationError(str(exc))

        return Response(result, status=status.HTTP_200_OK)


class TemplateDiscoverView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = get_request_contractor(request.user)
        discovery = discover_templates(
            contractor=contractor,
            source=request.query_params.get("source", "mine"),
            project_type=request.query_params.get("project_type", ""),
            project_subtype=request.query_params.get("project_subtype", ""),
            query=request.query_params.get("q", ""),
            sort=request.query_params.get("sort", "relevant"),
            benchmark_match_key=request.query_params.get("benchmark_match_key", ""),
            region_state=request.query_params.get("region_state", ""),
            region_city=request.query_params.get("region_city", ""),
            normalized_region_key=request.query_params.get("normalized_region_key", ""),
        )
        serializer = ProjectTemplateListSerializer(discovery["results"], many=True)
        return Response(
            {
                "results": serializer.data,
                "meta": discovery["meta"],
            },
            status=status.HTTP_200_OK,
        )


class TemplateVisibilityUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk: int):
        contractor = get_request_contractor(request.user)
        is_admin = _is_admin_user(request.user)
        if contractor is None and not is_admin:
            raise PermissionDenied("Only contractors can update template visibility.")

        try:
            template = ProjectTemplate.objects.get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if template.is_system_template and not is_admin:
            raise PermissionDenied("System templates are managed through the system seed/admin path.")
        if not is_admin and template.contractor_id != contractor.id:
            raise PermissionDenied("You do not have permission to update this template.")

        visibility = _safe_str(request.data.get("visibility")).lower() or ProjectTemplate.Visibility.PRIVATE
        if visibility not in {
            ProjectTemplate.Visibility.PRIVATE,
            ProjectTemplate.Visibility.REGIONAL,
            ProjectTemplate.Visibility.PUBLIC,
        }:
            raise ValidationError({"visibility": "Invalid template visibility."})

        allow_discovery = visibility in {
            ProjectTemplate.Visibility.REGIONAL,
            ProjectTemplate.Visibility.PUBLIC,
        }
        normalized_region_key = _safe_str(request.data.get("normalized_region_key"))
        region_state = _safe_str(request.data.get("region_state")) or _safe_str(getattr(contractor, "state", ""))
        region_city = _safe_str(request.data.get("region_city")) or _safe_str(getattr(contractor, "city", ""))

        if visibility == ProjectTemplate.Visibility.REGIONAL and not normalized_region_key:
            normalized_region_key = build_normalized_region_key(
                country="US",
                state=region_state,
                city=region_city,
            )
            if normalized_region_key == "US":
                raise ValidationError({"normalized_region_key": "Regional templates require a normalized region key."})

        template.visibility = visibility
        template.allow_discovery = allow_discovery
        template.normalized_region_key = normalized_region_key if visibility == ProjectTemplate.Visibility.REGIONAL else (normalized_region_key if visibility == ProjectTemplate.Visibility.PUBLIC else "")

        if allow_discovery:
            template.published_at = timezone.now()
            template.published_by = request.user
        else:
            template.published_at = None
            template.published_by = None

        template.save(
            update_fields=[
                "visibility",
                "allow_discovery",
                "normalized_region_key",
                "published_at",
                "published_by",
                "updated_at",
            ]
        )
        template = _template_queryset().get(pk=template.pk)
        return Response(ProjectTemplateDetailSerializer(template).data, status=status.HTTP_200_OK)
