from __future__ import annotations

from django.db.models import Count, Q
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_templates import ProjectTemplate
from projects.serializers_template import ProjectTemplateListSerializer
from projects.services.template_apply import get_request_contractor
from projects.services.template_recommend import recommend_template

HIGH_CONFIDENCE_SCORE = 70
MEDIUM_CONFIDENCE_SCORE = 50


class TemplateRecommendInputSerializer(serializers.Serializer):
    project_title = serializers.CharField(required=False, allow_blank=True, default="")
    project_type = serializers.CharField(required=False, allow_blank=True, default="")
    project_subtype = serializers.CharField(required=False, allow_blank=True, default="")
    description = serializers.CharField(required=False, allow_blank=True, default="")


class TemplateRecommendView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @staticmethod
    def _confidence_level_from_score(score: int) -> str:
        if score >= HIGH_CONFIDENCE_SCORE:
            return "high"
        if score >= MEDIUM_CONFIDENCE_SCORE:
            return "medium"
        return "low"

    def post(self, request):
        contractor = get_request_contractor(request.user)

        serializer = TemplateRecommendInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project_type = (data.get("project_type") or "").strip()
        project_subtype = (data.get("project_subtype") or "").strip()
        project_title = (data.get("project_title") or "").strip()
        description = (data.get("description") or "").strip()

        # Broad accessible pool first — let scoring decide.
        # This avoids forcing bad matches just because they happen to share a weak type/subtype.
        base_qs = (
            ProjectTemplate.objects.annotate(
                template_milestone_count=Count("milestones")
            )
            .filter(Q(is_system=True) | Q(contractor=contractor))
            .filter(is_active=True)
            .order_by("-is_system", "name")
        )

        templates = list(base_qs)

        if not templates:
            return Response(
                {
                    "recommended_template": None,
                    "possible_match": None,
                    "confidence": "none",
                    "score": 0,
                    "reason": "No templates available.",
                    "candidates": [],
                    "detail": "No templates available.",
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
        possible_match = None
        confidence = "none"
        confidence_level = self._confidence_level_from_score(int(result.score or 0))

        if result.template is not None:
            serialized = ProjectTemplateListSerializer(
                result.template,
                context={"request": request},
            ).data

            if confidence_level == "high":
                recommended_template = serialized
                confidence = "recommended"
            elif confidence_level == "medium":
                possible_match = serialized
                confidence = "possible"
            else:
                confidence = "none"

        if confidence_level == "high":
            detail = "High-confidence template recommendation found."
        elif confidence_level == "medium":
            detail = "Possible template match found."
        else:
            if project_subtype or project_type:
                detail = "No confident matching template exists yet for this Type/Subtype."
            else:
                detail = "No confident template recommendation."

        return Response(
            {
                "recommended_template": recommended_template,
                "possible_match": possible_match,
                "confidence": confidence,
                "confidence_level": confidence_level,
                "score": result.score,
                "reason": result.reason,
                "candidates": result.candidates,
                "detail": detail,
            },
            status=status.HTTP_200_OK,
        )
