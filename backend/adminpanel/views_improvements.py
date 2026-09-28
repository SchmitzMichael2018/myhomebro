"""Admin Console editorial workflow for the public Improvement Library."""

from django.contrib.admin.models import ADDITION, CHANGE, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_templates import ProjectTemplate
from projects.views.public_improvements import serialize_improvement
from .permissions import IsAdminUserRole


TEXT_FIELDS = (
    "name", "public_title", "public_slug", "public_category_slug",
    "public_summary", "public_intro", "default_scope", "difficulty",
    "cost_guidance", "tools_guidance", "preparation", "safety_guidance",
    "common_mistakes", "diy_guidance", "pro_guidance", "seo_title",
    "seo_description", "social_image",
)
DAY_FIELDS = ("estimated_duration_min_days", "estimated_duration_max_days")


def _editorial_templates():
    return ProjectTemplate.objects.filter(is_system=True, contractor__isnull=True).filter(
        Q(public_slug__isnull=False) | ~Q(public_publication_status="draft")
    )


def _serialize(template):
    return {
        "id": template.pk,
        **{field: getattr(template, field) for field in TEXT_FIELDS + DAY_FIELDS},
        "is_featured_public": template.is_featured_public,
        "contractor_template_visible": template.is_published,
        "public_faqs": template.public_faqs,
        "public_preview": serialize_improvement(template, detail=True),
        "status": template.public_publication_status,
        "reviewed_at": template.public_reviewed_at,
        "published_at": template.public_published_at,
        "updated_at": template.updated_at,
        "public_url": (
            f"/improvements/{template.public_category_slug}/{template.public_slug}/"
            if template.public_slug and template.public_category_slug else None
        ),
    }


def _apply_fields(template, data):
    if not isinstance(data, dict):
        return {"detail": ["Submit a valid guide object."]}
    errors = {}
    for field in ("public_publication_status", "public_reviewed_at", "public_reviewed_by", "public_published_at", "is_published", "is_system", "contractor"):
        if field in data:
            errors[field] = ["This field cannot be edited through the guide form."]
    for field in TEXT_FIELDS:
        if field in data:
            if not isinstance(data[field], str):
                errors[field] = ["Enter text."]
            else:
                setattr(template, field, data[field].strip() or (None if field == "public_slug" else ""))
    for field in DAY_FIELDS:
        if field in data:
            value = data[field]
            if value in ("", None):
                setattr(template, field, None)
            elif isinstance(value, int) and not isinstance(value, bool) and 0 < value <= 3650:
                setattr(template, field, value)
            else:
                errors[field] = ["Enter a number of days between 1 and 3650."]
    if "is_featured_public" in data:
        if not isinstance(data["is_featured_public"], bool):
            errors["is_featured_public"] = ["Choose true or false."]
        else:
            template.is_featured_public = data["is_featured_public"]
    if "public_faqs" in data:
        template.public_faqs = data["public_faqs"]
    return errors


def _validate(template):
    try:
        template.full_clean()
    except ValidationError as exc:
        return exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}
    return {}


def _log(request, template, action, message):
    LogEntry.objects.create(
        user=request.user,
        content_type=ContentType.objects.get_for_model(ProjectTemplate),
        object_id=str(template.pk),
        object_repr=str(template)[:200],
        action_flag=action,
        change_message=message,
    )


class AdminImprovementLibrary(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        rows = _editorial_templates().order_by("-updated_at", "-pk")
        return Response({"results": [_serialize(row) for row in rows]})

    def post(self, request):
        template = ProjectTemplate(is_system=True, is_system_template=True, is_published=False)
        errors = _apply_fields(template, request.data)
        errors.update(_validate(template) if not errors else {})
        if not template.name:
            errors["name"] = ["Enter a working title."]
        if errors:
            return Response(errors, status=400)
        try:
            with transaction.atomic():
                template.save()
                _log(request, template, ADDITION, "Created public improvement draft")
        except IntegrityError:
            return Response({"public_slug": ["This URL slug is already in use."]}, status=400)
        return Response(_serialize(template), status=201)


class AdminImprovementDetail(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request, template_id):
        template = _editorial_templates().filter(pk=template_id).first()
        if template is None:
            raise Http404
        return Response(_serialize(template))

    def patch(self, request, template_id):
        with transaction.atomic():
            template = _editorial_templates().select_for_update().filter(pk=template_id).first()
            if template is None:
                raise Http404
            if template.public_publication_status == ProjectTemplate.PublicPublicationStatus.PUBLISHED:
                return Response({"detail": "Archive the live guide before editing it."}, status=409)
            if template.is_published and any(
                field in request.data and request.data[field] != getattr(template, field)
                for field in ("name", "default_scope")
            ):
                return Response({"detail": "The working title and agreement scope belong to a contractor-visible template and cannot be edited here."}, status=400)
            errors = _apply_fields(template, request.data)
            if template.public_publication_status == ProjectTemplate.PublicPublicationStatus.READY_FOR_REVIEW:
                template.public_publication_status = ProjectTemplate.PublicPublicationStatus.DRAFT
            template.public_reviewed_at = None
            template.public_reviewed_by = None
            errors.update(_validate(template) if not errors else {})
            if errors:
                return Response(errors, status=400)
            try:
                template.save()
            except IntegrityError:
                return Response({"public_slug": ["This URL slug is already in use."]}, status=400)
            _log(request, template, CHANGE, "Updated public improvement draft")
        return Response(_serialize(template))


class AdminImprovementTransition(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request, template_id):
        action = request.data.get("action")
        with transaction.atomic():
            template = _editorial_templates().select_for_update().filter(pk=template_id).first()
            if template is None:
                raise Http404
            current = template.public_publication_status
            states = ProjectTemplate.PublicPublicationStatus
            transitions = {
                (states.DRAFT, "request_review"): states.READY_FOR_REVIEW,
                (states.ARCHIVED, "request_review"): states.READY_FOR_REVIEW,
                (states.READY_FOR_REVIEW, "publish"): states.PUBLISHED,
                (states.PUBLISHED, "archive"): states.ARCHIVED,
                (states.READY_FOR_REVIEW, "return_to_draft"): states.DRAFT,
            }
            target = transitions.get((current, action))
            if target is None:
                return Response({"detail": "This action is not available for the guide's current status."}, status=409)
            if action == "publish" and request.data.get("confirmed") is not True:
                return Response({"detail": "Confirm that you reviewed the guide before publishing."}, status=400)
            if action == "publish" and not template.is_active:
                return Response({"detail": "This template is inactive. Activate it before publishing."}, status=400)
            template.public_publication_status = target
            if action == "publish":
                template.public_reviewed_by = request.user
                template.public_reviewed_at = timezone.now()
            errors = _validate(template)
            if errors:
                return Response(errors, status=400)
            template.save()
            _log(request, template, CHANGE, f"Public improvement: {current} → {target}")
        return Response(_serialize(template))
