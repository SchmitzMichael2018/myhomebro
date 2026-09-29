"""Staff-only editorial workflow for the public Improvement Library."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from projects.models_templates import ProjectTemplate
from projects.views.public_improvements import serialize_improvement
from projects.ai.improvement_editorial import proposal_review_flags, propose_article_sections


EDITABLE_FIELDS = (
    "public_title", "public_slug", "public_category_slug", "public_audience",
    "public_audiences", "public_audience_actions", "public_editorial_brief",
    "public_summary", "public_problem", "public_evidence", "public_evidence_source",
    "public_viewpoint", "public_practical_steps", "public_sections", "public_next_action",
    "public_video_url", "public_video_title", "public_video_description",
    "public_video_poster_url", "public_video_text_summary", "public_video_transcript_url",
    "seo_title", "seo_description", "is_featured_public",
)
REQUIRED_DRAFT_FIELDS = ("public_title", "public_slug", "public_category_slug")


class EditorialAssistThrottle(UserRateThrottle):
    scope = "editorial_ai"
    rate = "30/hour"


def article_payload(article):
    payload = serialize_improvement(article, detail=True)
    payload.update({field: getattr(article, field) for field in EDITABLE_FIELDS})
    payload["related_ids"] = list(article.related_public_templates.values_list("pk", flat=True))
    payload["related"] = [
        {"id": other.pk, "slug": other.public_slug, "title": other.public_title or other.name,
         "canonical_path": f"/improvements/{other.public_category_slug}/{other.public_slug}/",
         "publication_status": other.public_publication_status}
        for other in article.related_public_templates.all()
    ]
    payload.update(
        publication_status=article.public_publication_status,
        reviewed_by_id=article.public_reviewed_by_id,
        preview_path=f"/app/admin/improvements/preview/{article.public_slug}",
    )
    return payload


def validation_response(exc):
    return Response(getattr(exc, "message_dict", {"detail": exc.messages}), status=400)


def valid_related_ids(value):
    return isinstance(value, list) and all(isinstance(item, int) and not isinstance(item, bool) and item > 0 for item in value)


def sync_legacy_audience_fields(article):
    audiences = article.public_audiences or [article.public_audience]
    article.public_audiences = audiences
    article.public_audience = audiences[0]
    if not article.public_audience_actions:
        article.public_audience_actions = {
            audience: article.public_next_action or ProjectTemplate.PublicAction.CREATE_PROJECT
            for audience in audiences
        }
    article.public_next_action = article.public_audience_actions.get(
        article.public_audience,
        article.public_next_action or ProjectTemplate.PublicAction.CREATE_PROJECT,
    )


class AdminImprovementListView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        articles = ProjectTemplate.objects.filter(public_slug__isnull=False).exclude(public_slug="").order_by("-updated_at", "pk")
        return Response({"results": [article_payload(article) for article in articles]})

    def post(self, request):
        data = request.data
        if "related_ids" in data and not valid_related_ids(data["related_ids"]):
            return Response({"related_ids": ["Expected a list of article IDs."]}, status=400)
        missing = [field for field in REQUIRED_DRAFT_FIELDS if not str(data.get(field) or "").strip()]
        if missing:
            return Response({field: ["Required for a draft."] for field in missing}, status=400)
        article = ProjectTemplate(is_system=True, name=str(data["public_title"]).strip())
        for field in EDITABLE_FIELDS:
            if field in data:
                setattr(article, field, data[field])
        article.public_publication_status = ProjectTemplate.PublicPublicationStatus.DRAFT
        sync_legacy_audience_fields(article)
        try:
            article.full_clean()
        except ValidationError as exc:
            return validation_response(exc)
        article.save()
        if "related_ids" in data:
            related = ProjectTemplate.objects.filter(pk__in=data["related_ids"], public_slug__isnull=False).exclude(pk=article.pk)
            article.related_public_templates.set(related)
        return Response(article_payload(article), status=201)


class AdminImprovementAssistView(APIView):
    """Prepare a staff-only proposal; never save, review, or publish it."""

    permission_classes = [IsAuthenticated, IsAdminUser]
    throttle_classes = [EditorialAssistThrottle]

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Provide an article draft for assistance."}, status=400)
        context = request.data.get("article")
        mode = request.data.get("mode")
        section = request.data.get("section")
        if not isinstance(mode, str) or (section is not None and not isinstance(section, str)):
            return Response({"detail": "Choose a valid writing action."}, status=400)
        if not isinstance(context, dict) or len(str(context)) > 100000:
            return Response({"detail": "Provide an article draft for assistance."}, status=400)
        brief = context.get("public_editorial_brief") or {}
        if not str(context.get("public_problem") or context.get("public_title") or brief.get("idea") or brief.get("problem")).strip():
            return Response({"detail": "Add an article idea, problem, or title first."}, status=400)
        audiences = context.get("public_audiences") or [context.get("public_audience")]
        if not isinstance(audiences, list) or not audiences or any(
            value not in ProjectTemplate.PublicAudience.values for value in audiences
        ):
            return Response({"detail": "Choose at least one valid audience."}, status=400)
        try:
            proposal = propose_article_sections(mode=mode, section=section, context=context)
            review_flags = proposal_review_flags(proposal)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        except Exception:
            # Provider details, prompts, and credentials must not reach the client.
            return Response({"detail": "Project Assistant is unavailable. Continue editing manually."}, status=503)
        return Response({
            "proposal": proposal,
            "review_flags": review_flags,
            "saved": False,
            "publication_status": None,
        })


class AdminImprovementDetailView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, article_id):
        article = ProjectTemplate.objects.filter(pk=article_id, public_slug__isnull=False).first()
        if not article:
            raise Http404("Article not found")
        return Response(article_payload(article))


    @transaction.atomic
    def patch(self, request, article_id):
        article = ProjectTemplate.objects.select_for_update().filter(pk=article_id, public_slug__isnull=False).first()
        if not article:
            raise Http404("Article not found")
        if not request.data or any(field not in (*EDITABLE_FIELDS, "related_ids") for field in request.data):
            return Response({"detail": "Only editorial fields may be edited."}, status=400)
        if "related_ids" in request.data and not valid_related_ids(request.data["related_ids"]):
            return Response({"related_ids": ["Expected a list of article IDs."]}, status=400)
        for field in EDITABLE_FIELDS:
            if field in request.data:
                setattr(article, field, request.data[field])
        article.name = article.public_title or article.name
        # Any editorial edit invalidates prior review and unpublishes the old version.
        article.public_reviewed_at = None
        article.public_reviewed_by = None
        article.public_publication_status = ProjectTemplate.PublicPublicationStatus.DRAFT
        article.public_published_at = None
        sync_legacy_audience_fields(article)
        try:
            article.full_clean()
        except ValidationError as exc:
            return validation_response(exc)
        article.save()
        if "related_ids" in request.data:
            related = ProjectTemplate.objects.filter(pk__in=request.data["related_ids"], public_slug__isnull=False).exclude(pk=article.pk)
            article.related_public_templates.set(related)
        return Response(article_payload(article))


class AdminImprovementPreviewView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, public_slug):
        article = ProjectTemplate.objects.filter(public_slug=public_slug).first()
        if not article:
            raise Http404("Article not found")
        return Response(article_payload(article))


class AdminImprovementTransitionView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    @transaction.atomic
    def post(self, request, article_id, action):
        article = ProjectTemplate.objects.select_for_update().filter(pk=article_id, public_slug__isnull=False).first()
        if not article:
            raise Http404("Article not found")
        status = ProjectTemplate.PublicPublicationStatus
        if action == "submit" and article.public_publication_status == status.DRAFT:
            article.public_publication_status = status.READY_FOR_REVIEW
        elif action == "review" and article.public_publication_status == status.READY_FOR_REVIEW:
            article.public_reviewed_at = timezone.now()
            article.public_reviewed_by = request.user
        elif action == "publish" and article.public_publication_status == status.READY_FOR_REVIEW and article.public_reviewed_at:
            article.public_publication_status = status.PUBLISHED
        elif action == "withdraw" and article.public_publication_status in (status.READY_FOR_REVIEW, status.PUBLISHED):
            article.public_publication_status = status.DRAFT
            article.public_reviewed_at = None
            article.public_reviewed_by = None
            article.public_published_at = None
        else:
            return Response({"detail": "This editorial transition is not available."}, status=400)
        try:
            article.full_clean()
        except ValidationError as exc:
            return validation_response(exc)
        article.save()
        return Response(article_payload(article))
