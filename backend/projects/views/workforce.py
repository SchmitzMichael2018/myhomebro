from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Skill
from projects.serializers.workforce import WorkforceSkillSerializer, skill_level_options


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
