from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone

from projects.ai.template_builder import (
    create_template_from_scope,
    improve_template_description,
    suggest_template_type_subtype,
)
from projects.models import Agreement
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.serializers.agreement import AgreementSerializer
from projects.serializers_template import (
    ApplyTemplateSerializer,
    ProjectTemplateCreateUpdateSerializer,
    ProjectTemplateDetailSerializer,
    ProjectTemplateListSerializer,
    SaveAgreementAsTemplateSerializer,
)
from projects.services.template_apply import (
    agreement_belongs_to_contractor,
    apply_template_to_agreement,
    get_request_contractor,
    save_agreement_as_template,
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


class TemplateListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = get_request_contractor(request.user)
        project_type = request.query_params.get("project_type", "").strip()
        project_subtype = request.query_params.get("project_subtype", "").strip()
        include_inactive = (
            request.query_params.get("include_inactive", "false").lower() == "true"
        )

        qs = _template_queryset().filter(Q(is_system=True) | Q(contractor=contractor))

        if not include_inactive:
            qs = qs.filter(is_active=True)

        if project_type:
            qs = qs.filter(project_type__iexact=project_type)

        if project_subtype:
            qs = qs.filter(project_subtype__iexact=project_subtype)

        qs = qs.order_by("-is_system", "name")

        serializer = ProjectTemplateListSerializer(qs, many=True)
        return Response(serializer.data)

    def post(self, request):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can create templates.")

        serializer = ProjectTemplateCreateUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        template = serializer.save(
            contractor=contractor,
            is_system=False,
        )

        template = _template_queryset().get(pk=template.pk)
        response_data = ProjectTemplateDetailSerializer(template).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class TemplateDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request, pk: int) -> ProjectTemplate:
        contractor = get_request_contractor(request.user)

        try:
            template = _template_queryset().get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        region_key = request.query_params.get("normalized_region_key", "").strip()
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

        if template.is_system:
            raise PermissionDenied("System templates cannot be edited here.")

        serializer = ProjectTemplateCreateUpdateSerializer(
            template,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        template = serializer.save()

        template = _template_queryset().get(pk=template.pk)
        return Response(ProjectTemplateDetailSerializer(template).data)

    def delete(self, request, pk: int):
        template = self.get_object(request, pk)

        if template.is_system:
            raise PermissionDenied("System templates cannot be deleted here.")

        template.delete()
        return Response({"detail": "Template deleted."}, status=status.HTTP_204_NO_CONTENT)


class ApplyTemplateToAgreementView(APIView):
    permission_classes = [permissions.IsAuthenticated]

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

        # Force full template application so agreement fields and milestones
        # stay in sync with the selected template.
        overwrite_existing = True
        copy_text_fields = True

        try:
            template = ProjectTemplate.objects.get(pk=template_id)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if not can_access_template(template, contractor):
            raise PermissionDenied("You do not have access to this template.")

        try:
            result = apply_template_to_agreement(
                agreement=agreement,
                template=template,
                overwrite_existing=overwrite_existing,
                copy_text_fields=copy_text_fields,
                estimated_days=serializer.validated_data.get("estimated_days"),
                auto_schedule=serializer.validated_data.get("auto_schedule", False),
                spread_enabled=serializer.validated_data.get("spread_enabled", False),
                spread_total=serializer.validated_data.get("spread_total"),
            )
        except ValueError as exc:
            raise ValidationError(str(exc))

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

        if template.is_system:
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
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can use template AI tools.")

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
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can use template AI tools.")

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
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can use template AI tools.")

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
        if contractor is None:
            raise PermissionDenied("Only contractors can update template visibility.")

        try:
            template = ProjectTemplate.objects.get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if template.is_system:
            raise PermissionDenied("System templates are managed through the system seed/admin path.")
        if template.contractor_id != contractor.id:
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
