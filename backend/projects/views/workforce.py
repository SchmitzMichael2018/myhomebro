from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Skill
from projects.serializers.workforce import WorkforceSkillSerializer, skill_level_options
from projects.services.workforce_assignments import normalize_workforce_assignments
from projects.utils.accounts import get_contractor_for_user


class WorkforceCatalogView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        skills = Skill.objects.order_by("name", "id")
        return Response(
            {
                "skills": WorkforceSkillSerializer(skills, many=True).data,
                "skill_levels": skill_level_options(),
            }
        )


class WorkforceAssignmentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response(
                {
                    "results": [],
                    "summary": {},
                    "capacity": [],
                    "skills_matrix": [],
                    "assistant": {
                        "summary": "No contractor workspace was found for this user.",
                        "confidence": "needs_more_information",
                        "recommendations": [],
                        "safe_actions": [],
                        "human_only_actions": [],
                    },
                }
            )
        return Response(normalize_workforce_assignments(contractor))
