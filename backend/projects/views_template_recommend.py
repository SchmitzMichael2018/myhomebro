from __future__ import annotations

from django.db.models import Count, Q
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_templates import ProjectTemplate
from projects.serializers_template import ProjectTemplateListSerializer
from projects.services.template_apply import get_request_contractor
from projects.services.template_recommend import recommend_template


class TemplateRecommendInputSerializer(serializers.Serializer):
    project_title = serializers.CharField(required=False, allow_blank=True, default="")
    project_type = serializers.CharField(required=False, allow_blank=True, default="")
    project_subtype = serializers.CharField(required=False, allow_blank=True, default="")
    description = serializers.CharField(required=False, allow_blank=True, default="")


class TemplateRecommendView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        contractor = get_request_contractor(request.user)

        serializer = TemplateRecommendInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project_type = (data.get("project_type") or "").strip()
        project_subtype = (data.get("project_subtype") or "").strip()
        project_title = (data.get("project_title") or "").strip()
        description = (data.get("description") or "").strip()

        qs = (
            ProjectTemplate.objects.annotate(
                template_milestone_count=Count("milestones")
            )
            .filter(Q(is_system=True) | Q(contractor=contractor))
            .filter(is_active=True)
        )

        if project_type:
            qs = qs.filter(project_type__iexact=project_type)

        templates = list(qs.order_by("-is_system", "name"))

        if not templates:
            return Response(
                {
                    "recommended_template": None,
                    "score": 0,
                    "reason": "No templates available for this project type.",
                    "candidates": [],
                },
                status=status.HTTP_200_OK,
            )

        result = recommend_template(
            templates=templates,
            project_title=project_title,
            project_type=project_type,
            project_subtype=project_subtype,
            description=description,
        )

        recommended_template = None
        if result.template is not None:
            recommended_template = ProjectTemplateListSerializer(
                result.template,
                context={"request": request},
            ).data

        return Response(
            {
                "recommended_template": recommended_template,
                "score": result.score,
                "reason": result.reason,
                "candidates": result.candidates,
            },
            status=status.HTTP_200_OK,
        )