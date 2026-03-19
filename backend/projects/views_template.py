from __future__ import annotations

from django.db.models import Count, Q
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.ai.template_builder import generate_materials_from_scope
from projects.models import Agreement
from projects.models_templates import ProjectTemplate
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


class TemplateListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = get_request_contractor(request.user)
        project_type = request.query_params.get("project_type", "").strip()
        project_subtype = request.query_params.get("project_subtype", "").strip()
        include_inactive = request.query_params.get("include_inactive", "false").lower() == "true"

        qs = ProjectTemplate.objects.annotate(
            template_milestone_count=Count("milestones")
        ).filter(
            Q(is_system=True) | Q(contractor=contractor)
        )

        if not include_inactive:
            qs = qs.filter(is_active=True)

        if project_type:
            qs = qs.filter(project_type__iexact=project_type)

        if project_subtype:
            subtype_qs = qs.filter(project_subtype__iexact=project_subtype)

            # fallback to type-only templates if no subtype matches
            if subtype_qs.exists():
                qs = subtype_qs
            else:
                qs = qs.filter(Q(project_subtype__isnull=True) | Q(project_subtype=""))

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

        response_data = ProjectTemplateDetailSerializer(template).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class TemplateDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request, pk: int) -> ProjectTemplate:
        contractor = get_request_contractor(request.user)

        try:
            template = ProjectTemplate.objects.annotate(
                template_milestone_count=Count("milestones")
            ).get(pk=pk)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if template.is_system:
            return template

        if contractor is None or template.contractor_id != contractor.id:
            raise PermissionDenied("You do not have access to this template.")

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
        overwrite_existing = serializer.validated_data["overwrite_existing"]
        copy_text_fields = serializer.validated_data["copy_text_fields"]

        try:
            template = ProjectTemplate.objects.get(pk=template_id)
        except ProjectTemplate.DoesNotExist:
            raise ValidationError("Template not found.")

        if not template.is_system and template.contractor_id != contractor.id:
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

        # Re-read after apply so serializer returns the fresh hydrated agreement:
        # - selected_template / selected_template_id
        # - project_type / project_subtype
        # - project.title via project_title
        # - description
        # - ai_scope questions / answers
        # - milestone totals and date rollups
        agreement.refresh_from_db()

        # Load common related objects for a complete response shape.
        try:
            agreement = (
                Agreement.objects.select_related(
                    "project",
                    "homeowner",
                    "selected_template",
                    "project_type_ref",
                    "project_subtype_ref",
                )
                .get(pk=agreement.pk)
            )
        except Exception:
            # Fallback to the refreshed instance if select_related fails for any reason.
            pass

        agreement_payload = AgreementSerializer(
            agreement,
            context={"request": request},
        ).data

        return Response(
            {
                "detail": "Template applied successfully.",
                "result": {
                    **result,
                    "start_date": result["start_date"].isoformat() if result.get("start_date") else None,
                    "end_date": result["end_date"].isoformat() if result.get("end_date") else None,
                },
                "agreement": agreement_payload,
                "template": ProjectTemplateDetailSerializer(template).data,
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

        return Response(
            {
                "detail": "Template saved successfully.",
                "template": ProjectTemplateDetailSerializer(template).data,
            },
            status=status.HTTP_201_CREATED,
        )


class TemplateGenerateMaterialsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            raise PermissionDenied("Only contractors can use template AI tools.")

        data = request.data or {}

        try:
            result = generate_materials_from_scope(
                name=data.get("name", ""),
                project_type=data.get("project_type", ""),
                project_subtype=data.get("project_subtype", ""),
                description=data.get("description", ""),
                milestones=data.get("milestones") or [],
            )
        except Exception as exc:
            raise ValidationError(str(exc))

        return Response(result, status=status.HTTP_200_OK)