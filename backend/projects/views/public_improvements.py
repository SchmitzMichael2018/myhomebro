from django.db.models import Q
from django.http import Http404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_templates import ProjectTemplate


DEFAULT_SOCIAL_IMAGE = "/static/social/myhomebro-default-1200x630.png"


def published_improvements():
    return ProjectTemplate.objects.filter(
        public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
        is_active=True,
    ).prefetch_related("milestones", "related_public_templates")


def category_label(slug):
    return str(slug or "").replace("-", " ").title()


def serialize_improvement(template, *, detail=False):
    payload = {
        "id": template.pk,
        "slug": template.public_slug,
        "category_slug": template.public_category_slug,
        "category_name": category_label(template.public_category_slug),
        "title": template.name,
        "summary": template.public_summary,
        "difficulty": template.difficulty,
        "difficulty_label": template.get_difficulty_display() if template.difficulty else "",
        "estimated_duration_min_days": template.estimated_duration_min_days,
        "estimated_duration_max_days": template.estimated_duration_max_days,
        "featured": template.is_featured_public,
        "updated_at": template.updated_at,
        "reviewed_at": template.public_reviewed_at,
        "published_at": template.public_published_at,
        "canonical_path": f"/improvements/{template.public_category_slug}/{template.public_slug}/",
        "seo_title": template.seo_title or f"{template.name}: DIY & Project Guide | MyHomeBro",
        "seo_description": template.seo_description or template.public_summary,
        "social_image": template.social_image or DEFAULT_SOCIAL_IMAGE,
    }
    if not detail:
        return payload
    payload.update(
        {
            "intro": template.public_intro or template.description,
            "scope": template.default_scope,
            "cost_guidance": template.cost_guidance,
            "preparation": template.preparation,
            "safety_guidance": template.safety_guidance,
            "common_mistakes": template.common_mistakes,
            "diy_guidance": template.diy_guidance,
            "pro_guidance": template.pro_guidance,
            "materials": template.project_materials_hint,
            "faqs": template.public_faqs,
            "milestones": [
                {
                    "id": item.pk,
                    "title": item.title,
                    "description": item.description,
                    "materials": item.materials_hint,
                    "duration_days": item.duration_days or item.recommended_duration_days,
                    "optional": item.is_optional,
                }
                for item in template.milestones.all()
            ],
            "related": [
                serialize_improvement(item)
                for item in template.related_public_templates.filter(
                    public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
                    is_active=True,
                )
            ],
        }
    )
    return payload


class PublicImprovementLibraryView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        queryset = published_improvements()
        query = str(request.query_params.get("q") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(name__icontains=query)
                | Q(project_type__icontains=query)
                | Q(project_subtype__icontains=query)
                | Q(public_summary__icontains=query)
                | Q(description__icontains=query)
            )
        rows = list(queryset.order_by("-is_featured_public", "name"))
        categories = {}
        for item in rows:
            bucket = categories.setdefault(
                item.public_category_slug,
                {"slug": item.public_category_slug, "name": category_label(item.public_category_slug), "count": 0},
            )
            bucket["count"] += 1
        return Response({"categories": list(categories.values()), "improvements": [serialize_improvement(item) for item in rows]})


class PublicImprovementCategoryView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, category_slug):
        queryset = published_improvements().filter(public_category_slug=category_slug).order_by("-is_featured_public", "name")
        if not queryset.exists():
            raise Http404("Published improvement category not found.")
        return Response({
            "slug": category_slug,
            "name": category_label(category_slug),
            "improvements": [serialize_improvement(item) for item in queryset],
        })


class PublicImprovementDetailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, category_slug, improvement_slug):
        template = published_improvements().filter(
            public_category_slug=category_slug,
            public_slug=improvement_slug,
        ).first()
        if template is None:
            raise Http404("Published improvement not found.")
        return Response(serialize_improvement(template, detail=True))
