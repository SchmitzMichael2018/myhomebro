from django.db.models import Case, IntegerField, Q, Value, When
from django.db import DatabaseError
from django.http import Http404
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from projects.models_templates import ProjectTemplate
from projects.services.diy_planner import clean_text
from projects.services.public_improvement_planner import build_public_plan_preview
from projects.services.public_plan_admission import reserve_public_plan_slot


DEFAULT_SOCIAL_IMAGE = "/static/social/myhomebro-default-1200x630.png"


def published_improvements():
    return ProjectTemplate.objects.filter(
        public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
        is_active=True,
    ).prefetch_related("milestones", "related_public_templates")


def category_label(slug):
    return str(slug or "").replace("-", " ").title()


def reviewed_video(template):
    """A walkthrough is visible only after complete metadata receives article review."""
    if not template.public_reviewed_at or not all((
        template.public_video_url, template.public_video_title,
        template.public_video_description, template.public_video_poster_url,
    )) or not (template.public_video_text_summary or template.public_video_transcript_url):
        return None
    return {
        "url": template.public_video_url,
        "title": template.public_video_title,
        "description": template.public_video_description,
        "poster_url": template.public_video_poster_url,
        "text_summary": template.public_video_text_summary,
        "transcript_url": template.public_video_transcript_url,
    }


def serialize_improvement(template, *, detail=False):
    audiences = template.public_audiences or [template.public_audience]
    audience_actions = {
        audience: template.public_audience_actions.get(audience, template.public_next_action)
        for audience in audiences
    }
    payload = {
        "id": template.pk,
        "slug": template.public_slug,
        "category_slug": template.public_category_slug,
        "category_name": category_label(template.public_category_slug),
        "title": template.public_title or template.name,
        "summary": template.public_summary,
        "audience": template.public_audience,
        "audience_label": template.get_public_audience_display(),
        "audiences": audiences,
        "audience_labels": [
            dict(ProjectTemplate.PublicAudience.choices).get(value, value)
            for value in audiences
        ],
        "audience_actions": audience_actions,
        "difficulty": template.difficulty,
        "difficulty_label": template.get_difficulty_display() if template.difficulty else "",
        "estimated_duration_min_days": template.estimated_duration_min_days,
        "estimated_duration_max_days": template.estimated_duration_max_days,
        "featured": template.is_featured_public,
        "updated_at": template.updated_at,
        "reviewed_at": template.public_reviewed_at,
        "published_at": template.public_published_at,
        "canonical_path": f"/improvements/{template.public_category_slug}/{template.public_slug}/",
        "seo_title": template.seo_title or f"{template.public_title or template.name}: DIY & Project Guide | MyHomeBro",
        "seo_description": template.seo_description or template.public_summary,
        "social_image": template.social_image or DEFAULT_SOCIAL_IMAGE,
    }
    if not detail:
        return payload
    payload.update(
        {
            "intro": template.public_intro or template.description,
            "problem": template.public_problem,
            "evidence": template.public_evidence,
            "evidence_source": template.public_evidence_source,
            "viewpoint": template.public_viewpoint,
            "practical_steps": template.public_practical_steps,
            "sections": template.public_sections,
            "next_action": template.public_next_action,
            "video": reviewed_video(template),
            "scope": template.default_scope,
            "cost_guidance": template.cost_guidance,
            "tools_guidance": template.tools_guidance,
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
        all_published = published_improvements()
        queryset = all_published
        query = str(request.query_params.get("q") or "").strip()
        audience = str(request.query_params.get("audience") or "").strip()
        category = str(request.query_params.get("category") or "").strip()
        if audience in ProjectTemplate.PublicAudience.values:
            queryset = queryset.filter(
                Q(public_audiences__icontains=audience) | Q(public_audience=audience)
            )
        if category:
            queryset = queryset.filter(public_category_slug=category)
        if query:
            queryset = queryset.filter(
                Q(name__icontains=query)
                | Q(public_title__icontains=query)
                | Q(project_type__icontains=query)
                | Q(project_subtype__icontains=query)
                | Q(public_summary__icontains=query)
                | Q(public_problem__icontains=query)
                | Q(public_practical_steps__icontains=query)
                | Q(description__icontains=query)
            )
        rows = list(queryset.annotate(
            launch_order=Case(
                When(
                    Q(public_audiences__icontains=ProjectTemplate.PublicAudience.CONTRACTOR)
                    | Q(public_audience=ProjectTemplate.PublicAudience.CONTRACTOR),
                    then=Value(0),
                ),
                default=Value(1),
                output_field=IntegerField(),
            )
        ).order_by("launch_order", "-is_featured_public", "-public_published_at", "name", "pk"))
        categories = {}
        for item in all_published.order_by("pk"):
            bucket = categories.setdefault(
                item.public_category_slug,
                {"slug": item.public_category_slug, "name": category_label(item.public_category_slug), "count": 0},
            )
            bucket["count"] += 1
        return Response({
            "categories": list(categories.values()),
            "published_count": sum(category["count"] for category in categories.values()),
            "contractor_published_count": all_published.filter(
                Q(public_audiences__icontains=ProjectTemplate.PublicAudience.CONTRACTOR)
                | Q(public_audience=ProjectTemplate.PublicAudience.CONTRACTOR)
            ).count(),
            "improvements": [serialize_improvement(item) for item in rows],
        })


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


class PublicPlanAdmissionUnavailable(APIException):
    status_code = 503
    default_detail = "Project planning is temporarily unavailable. Please try again shortly."
    default_code = "planning_unavailable"


class PublicImprovementPlanThrottle(BaseThrottle):
    scope = "public_improvement_plan"
    rate = "6/hour"

    def get_ident(self, request):
        # Never trust caller-supplied X-Forwarded-For chains for a paid public
        # operation. A trusted deployment proxy must normalize REMOTE_ADDR to
        # preserve per-client limits; otherwise its clients share one bucket.
        return request.META.get("REMOTE_ADDR") or "unknown"

    def allow_request(self, request, view):
        try:
            self.retry_after = reserve_public_plan_slot(self.get_ident(request))
        except DatabaseError:
            # An absent migration or unavailable database must never bypass the
            # admission limit and invoke the paid planning provider.
            raise PublicPlanAdmissionUnavailable() from None
        return self.retry_after is None

    def wait(self):
        return self.retry_after


class PublicImprovementPlanSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False)
    desired_outcome = serializers.CharField(max_length=2000)
    existing_conditions = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    additional_context = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    confidence_notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError("Only project planning answers may be submitted.")
        for name, value in attrs.items():
            attrs[name] = clean_text(value, self.fields[name].max_length)
        for name in ("title", "desired_outcome"):
            if name in attrs and not attrs[name]:
                raise serializers.ValidationError({name: "Enter a description using plain text."})
        return attrs


class PublicImprovementPlanView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicImprovementPlanThrottle]

    def post(self, request, category_slug, improvement_slug):
        template = published_improvements().filter(
            public_category_slug=category_slug, public_slug=improvement_slug,
        ).first()
        if template is None:
            raise Http404("Published improvement not found.")
        serializer = PublicImprovementPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        inputs = dict(serializer.validated_data)
        inputs.setdefault("title", clean_text(template.public_title or template.name, 200))
        try:
            preview = build_public_plan_preview(template, inputs)
        except (TypeError, ValueError):
            raise serializers.ValidationError({
                "detail": "This plan preview is too large. Shorten your answers and generate a new preview.",
            })
        response = Response(preview)
        response["Cache-Control"] = "private, no-store"
        return response
