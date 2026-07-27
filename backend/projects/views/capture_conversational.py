from __future__ import annotations

import hashlib

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from projects.models import (
    Agreement,
    Capture,
    CaptureArtifact,
    CaptureEvent,
    CaptureRoutingAttempt,
    Milestone,
)
from projects.serializers.capture import CaptureCreateSerializer, CaptureSerializer
from projects.services.capture_conversational import (
    MAX_FOLLOW_UP_ROUNDS,
    ConversationalCaptureError,
    append_audit,
    parse_dimensions,
    resolve_context,
    route_attempt,
)
from projects.services.capture_profiles import PROFILE_MAP, registry_response, resolve_profiles
from projects.services.capture_permissions import visible_project_capture_projects
from projects.utils.accounts import get_contractor_for_user
from projects.views.capture import _validate_project_upload


def _enabled():
    return bool(
        getattr(settings, "CAPTURE_FOUNDATION_ENABLED", False)
        and getattr(settings, "CAPTURE_CONVERSATIONAL_ENABLED", False)
    )


def _disabled():
    return Response(
        {"detail": "Conversational Capture is not enabled.", "code": "capture_conversational_disabled"},
        status=status.HTTP_404_NOT_FOUND,
    )


def _error(exc):
    return Response(
        {"detail": str(exc), "code": getattr(exc, "code", "capture_routing_error")},
        status=status.HTTP_409_CONFLICT
        if getattr(exc, "code", "") == "routing_version_conflict"
        else status.HTTP_400_BAD_REQUEST,
    )


class RouteSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    capture_method = serializers.ChoiceField(
        choices=(Capture.METHOD_TYPED, Capture.METHOD_VOICE_TRANSCRIPT),
        default=Capture.METHOD_TYPED,
    )
    project_id = serializers.IntegerField(required=False)
    milestone_id = serializers.IntegerField(required=False)
    agreement_id = serializers.IntegerField(required=False)
    explicit_profile = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    artifacts = serializers.ListField(
        child=serializers.DictField(), required=False, max_length=10, default=list
    )

    def validate_artifacts(self, value):
        result = []
        for row in value:
            if set(row) - {"name", "mime_type", "size"}:
                raise serializers.ValidationError("Artifact metadata contains unsupported fields.")
            size = int(row.get("size") or 0)
            max_bytes = int(getattr(settings, "CAPTURE_MAX_DOCUMENT_SIZE_MB", 15)) * 1024 * 1024
            if size < 0 or size > max_bytes:
                raise serializers.ValidationError("Artifact size is invalid.")
            result.append({
                "name": str(row.get("name") or "")[:255],
                "mime_type": str(row.get("mime_type") or "")[:120],
                "size": size,
            })
        return result


class FollowUpSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    expected_version = serializers.IntegerField(min_value=1)
    answers = serializers.ListField(
        child=serializers.DictField(), min_length=1, max_length=3
    )
    selected_profile = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    project_id = serializers.IntegerField(required=False)
    milestone_id = serializers.IntegerField(required=False)
    agreement_id = serializers.IntegerField(required=False)

    def validate_answers(self, value):
        result = []
        for row in value:
            if set(row) - {"question_key", "value"}:
                raise serializers.ValidationError("Follow-up answer contains unsupported fields.")
            key = str(row.get("question_key") or "")
            if key not in {
                "description", "profile", "project", "agreement", "milestone",
                "customer", "equipment", "verification", "area",
            }:
                raise serializers.ValidationError("Follow-up question is invalid.")
            raw_value = row.get("value")
            value = (
                [str(item)[:120] for item in raw_value[:10]]
                if isinstance(raw_value, list)
                else str(raw_value or "")[:500]
            )
            result.append({"question_key": key, "value": value})
        return result


class ContextSearchSerializer(serializers.Serializer):
    context_type = serializers.ChoiceField(
        choices=("project", "agreement", "milestone")
    )
    q = serializers.CharField(required=False, allow_blank=True, max_length=100, default="")
    project_id = serializers.IntegerField(required=False)

    def validate_q(self, value):
        value = value.strip()
        if value and len(value) < 2:
            raise serializers.ValidationError("Enter at least 2 characters.")
        return value


class ConfirmSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    expected_version = serializers.IntegerField(min_value=1)
    selected_profile = serializers.CharField(max_length=64)
    project_id = serializers.IntegerField(required=False)
    milestone_id = serializers.IntegerField(required=False)
    agreement_id = serializers.IntegerField(required=False)
    confirmed = serializers.BooleanField()


class CancelSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    expected_version = serializers.IntegerField(min_value=1)


class CompleteHandoffSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    capture_id = serializers.UUIDField()


def _attempt_for(request, attempt_id):
    contractor = get_contractor_for_user(request.user)
    if not contractor:
        return None
    return CaptureRoutingAttempt.objects.filter(
        pk=attempt_id, contractor=contractor, actor=request.user
    ).first()


class CaptureProfileListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (
            getattr(settings, "CAPTURE_FOUNDATION_ENABLED", False)
            and (
                getattr(settings, "CAPTURE_PROFILE_REGISTRY_ENABLED", False)
                or getattr(settings, "CAPTURE_CONVERSATIONAL_ENABLED", False)
            )
        ):
            return _disabled()
        try:
            _, project, milestone, agreement = resolve_context(
                user=request.user, payload=request.query_params
            )
        except ConversationalCaptureError as exc:
            return _error(exc)
        return Response(registry_response(
            user=request.user, project=project, milestone=milestone, agreement=agreement
        ))


class CaptureConversationalContextSearchView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "capture_conversational"

    def get(self, request):
        if not _enabled():
            return _disabled()
        serializer = ContextSearchSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        projects = visible_project_capture_projects(request.user)
        contractor = get_contractor_for_user(request.user)
        if projects is None or not contractor:
            return Response({"results": []})
        query = data["q"]
        context_type = data["context_type"]
        project_id = data.get("project_id")
        rows = []
        if context_type == "project":
            queryset = projects.select_related("homeowner").order_by("-updated_at", "-id")
            if query:
                queryset = queryset.filter(title__icontains=query)
            for project in queryset[:10]:
                rows.append({
                    "context_type": "project",
                    "id": project.id,
                    "display_name": project.title or f"Project #{project.id}",
                    "secondary_text": f"{project.number} · {project.get_status_display()}",
                    "project_id": project.id,
                })
        elif context_type == "agreement":
            queryset = Agreement.objects.select_related("project").filter(
                contractor=contractor, project__in=projects
            ).order_by("-project__updated_at", "-id")
            if project_id:
                queryset = queryset.filter(project_id=project_id)
            if query:
                queryset = queryset.filter(project__title__icontains=query)
            for agreement in queryset[:10]:
                rows.append({
                    "context_type": "agreement",
                    "id": agreement.id,
                    "display_name": agreement.project.title or f"Agreement #{agreement.id}",
                    "secondary_text": (
                        f"Agreement #{agreement.id} · {agreement.get_status_display()}"
                    ),
                    "project_id": agreement.project_id,
                })
        else:
            queryset = Milestone.objects.select_related("agreement__project").filter(
                agreement__contractor=contractor,
                agreement__project__in=projects,
            ).order_by("order", "id")
            if project_id:
                queryset = queryset.filter(agreement__project_id=project_id)
            if query:
                queryset = queryset.filter(title__icontains=query)
            for milestone in queryset[:10]:
                rows.append({
                    "context_type": "milestone",
                    "id": milestone.id,
                    "display_name": milestone.title or f"Milestone #{milestone.id}",
                    "secondary_text": milestone.agreement.project.title,
                    "project_id": milestone.agreement.project_id,
                })
        return Response({"results": rows})


class CaptureConversationalRouteView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "capture_conversational"

    def post(self, request):
        if not _enabled():
            return _disabled()
        serializer = RouteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            contractor, _, _, _ = resolve_context(user=request.user, payload=data)
            with transaction.atomic():
                attempt = CaptureRoutingAttempt.objects.create(
                    contractor=contractor,
                    actor=request.user,
                    raw_user_text=data["text"],
                    capture_method=data["capture_method"],
                    context_payload={
                        key: data[key]
                        for key in ("project_id", "milestone_id", "agreement_id")
                        if data.get(key)
                    },
                    artifact_metadata=data["artifacts"],
                    audit_events=[{
                        "event_type": "conversational_intake_started",
                        "at": timezone.now().isoformat(),
                        "actor_id": request.user.id,
                        "metadata": {
                            "has_text": bool(data["text"]),
                            "artifact_count": len(data["artifacts"]),
                        },
                    }],
                )
                append_audit(attempt, "routing_requested")
                result = route_attempt(attempt, explicit_profile=data["explicit_profile"])
        except ConversationalCaptureError as exc:
            return _error(exc)
        return Response({
            "attempt_id": str(attempt.id),
            "version": attempt.version,
            **result,
            "classifier_source": attempt.classifier_source,
            "fallback_used": bool(attempt.fallback_reason),
        }, status=status.HTTP_201_CREATED)


class CaptureConversationalFollowUpView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "capture_conversational"

    def post(self, request):
        if not _enabled():
            return _disabled()
        serializer = FollowUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        attempt = _attempt_for(request, data["attempt_id"])
        if not attempt:
            return Response({"detail": "Routing attempt not found."}, status=404)
        if attempt.version != data["expected_version"]:
            return _error(ConversationalCaptureError(
                "The routing suggestion changed. Refresh and try again.",
                code="routing_version_conflict",
            ))
        if attempt.follow_up_rounds >= MAX_FOLLOW_UP_ROUNDS:
            return Response(
                {"detail": "The follow-up limit was reached.", "code": "follow_up_limit"},
                status=400,
            )
        for key in ("project_id", "milestone_id", "agreement_id"):
            if data.get(key):
                attempt.context_payload[key] = data[key]
        for answer in data["answers"]:
            if answer["question_key"] == "description" and answer["value"]:
                attempt.raw_user_text = answer["value"]
        attempt.follow_up_answers = [*(attempt.follow_up_answers or []), *data["answers"]][-6:]
        attempt.follow_up_rounds += 1
        append_audit(attempt, "follow_up_answered", {
            "question_keys": [row["question_key"] for row in data["answers"]],
            "round": attempt.follow_up_rounds,
        })
        try:
            result = route_attempt(attempt, explicit_profile=data["selected_profile"])
        except ConversationalCaptureError as exc:
            return _error(exc)
        return Response({
            "attempt_id": str(attempt.id),
            "version": attempt.version,
            **result,
            "classifier_source": attempt.classifier_source,
            "fallback_used": bool(attempt.fallback_reason),
        })


def _raw_payload(profile_key, attempt):
    text = attempt.raw_user_text
    metadata = {
        "orchestration_version": attempt.orchestration_version,
    }
    if profile_key in {"punch_item", "site_condition"}:
        metadata["capture_profile"] = profile_key
        metadata["issue_classification"] = profile_key
    elif profile_key == "issue":
        metadata["issue_classification"] = "project_issue"
    elif profile_key == "communication":
        metadata.update({"communication_type": "other", "communication_direction": "internal"})
    elif profile_key == "change_request":
        metadata.update({
            "capture_profile": profile_key,
            "communication_type": "other",
            "communication_direction": "inbound",
            "change_kind": "other",
            "decision_boundary": "change_request",
        })
    return {
        "title": text[:120],
        "text": text,
        "transcript": text if attempt.capture_method == Capture.METHOD_VOICE_TRANSCRIPT else "",
        "capture_profile": (
            profile_key if profile_key in {"punch_item", "site_condition", "change_request"} else ""
        ),
        "input_metadata": metadata,
    }


class CaptureConversationalConfirmView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "capture_conversational"

    def post(self, request):
        if not _enabled():
            return _disabled()
        serializer = ConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not data["confirmed"]:
            return Response({"detail": "Confirm the selected Capture profile."}, status=400)
        attempt = _attempt_for(request, data["attempt_id"])
        if not attempt:
            return Response({"detail": "Routing attempt not found."}, status=404)
        if attempt.capture_id:
            return Response({
                "status": "created",
                "attempt_id": str(attempt.id),
                "version": attempt.version,
                "capture": CaptureSerializer(attempt.capture).data,
            })
        if attempt.version != data["expected_version"]:
            return _error(ConversationalCaptureError(
                "The routing suggestion changed. Refresh and try again.",
                code="routing_version_conflict",
            ))
        context_payload = {
            key: data.get(key) or (attempt.context_payload or {}).get(key)
            for key in ("project_id", "milestone_id", "agreement_id")
        }
        try:
            contractor, project, milestone, agreement = resolve_context(
                user=request.user, payload=context_payload
            )
        except ConversationalCaptureError as exc:
            return _error(exc)
        profile = PROFILE_MAP.get(data["selected_profile"])
        available = {
            row.profile_key: row
            for row in resolve_profiles(
                user=request.user, project=project, milestone=milestone, agreement=agreement
            )
        }
        if not profile or profile.profile_key not in available:
            return Response(
                {"detail": "The selected Capture profile is unavailable.", "code": "profile_unavailable"},
                status=400,
            )
        append_audit(attempt, "route_confirmed", {
            "selected_profile": profile.profile_key,
            "project_id": getattr(project, "id", None),
            "agreement_id": getattr(agreement, "id", None),
        })
        prefill = {
            "profile_key": profile.profile_key,
            "capture_type": profile.capture_type,
            "text": attempt.raw_user_text,
            "project_id": getattr(project, "id", None),
            "milestone_id": getattr(milestone, "id", None),
            "agreement_id": getattr(agreement, "id", None),
            "dimensions": parse_dimensions(attempt.raw_user_text),
            "source_text": attempt.raw_user_text,
            "artifact_metadata": attempt.artifact_metadata,
            "routing_attempt_id": str(attempt.id),
        }
        if profile.handoff_required:
            attempt.status = CaptureRoutingAttempt.STATUS_HANDED_OFF
            attempt.selected_profile = profile.profile_key
            attempt.selected_context = context_payload
            attempt.confirmed_at = timezone.now()
            attempt.version += 1
            append_audit(attempt, "explicit_form_opened", {"profile": profile.profile_key})
            attempt.save()
            return Response({
                "status": "handoff",
                "attempt_id": str(attempt.id),
                "version": attempt.version,
                "handoff": prefill,
            })
        uploads = request.FILES.getlist("files") or request.FILES.getlist("file")
        if len(uploads) > int(getattr(settings, "CAPTURE_PROJECT_MAX_FILES", 10)):
            return Response({"detail": "Choose no more than 10 files."}, status=400)
        for upload in uploads:
            upload_error = _validate_project_upload(upload, profile.capture_type)
            if upload_error:
                return Response({"detail": upload_error}, status=400)
        if profile.profile_key in {"photo", "progress_photo", "document"} and not uploads:
            return Response(
                {"detail": "Attach the required supporting file before continuing.", "code": "artifact_required"},
                status=400,
            )
        raw = _raw_payload(profile.profile_key, attempt)
        create_serializer = CaptureCreateSerializer(
            data={
                "capture_type": profile.capture_type,
                "capture_method": attempt.capture_method if not uploads else Capture.METHOD_FILE_UPLOAD,
                "raw_text_payload": raw,
            },
            context={
                "has_file": bool(uploads),
                "project": project,
                "agreement": agreement,
            },
        )
        create_serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            capture = create_serializer.save(
                contractor=contractor,
                captured_by=request.user,
                status=Capture.STATUS_SAVED,
                source_category="project_assistant",
                source_detail="conversational_capture",
                project=project,
                milestone=milestone,
                agreement=agreement,
                customer=project.homeowner if project else None,
                audit_metadata={
                    "routing_attempt_id": str(attempt.id),
                    "orchestration_version": attempt.orchestration_version,
                    "classifier_source": attempt.classifier_source,
                    "classifier_version": attempt.classifier_version,
                    "selected_profile": profile.profile_key,
                    "user_confirmed": True,
                },
            )
            for upload in uploads:
                digest = hashlib.sha256()
                for chunk in upload.chunks():
                    digest.update(chunk)
                upload.seek(0)
                CaptureArtifact.objects.create(
                    capture=capture,
                    artifact_type=(
                        CaptureArtifact.TYPE_PHOTO
                        if str(upload.content_type or "").startswith("image/")
                        else CaptureArtifact.TYPE_DOCUMENT
                    ),
                    file=upload,
                    original_filename=str(upload.name or "")[:255],
                    mime_type=str(upload.content_type or "")[:120],
                    file_size=upload.size or 0,
                    file_sha256=digest.hexdigest(),
                    uploaded_by=request.user,
                )
            CaptureEvent.objects.create(
                capture=capture,
                event_type="conversational_capture_created",
                to_status=Capture.STATUS_SAVED,
                actor=request.user,
                metadata={
                    "routing_attempt_id": str(attempt.id),
                    "selected_profile": profile.profile_key,
                    "classifier_source": attempt.classifier_source,
                },
            )
            attempt.capture = capture
            attempt.status = CaptureRoutingAttempt.STATUS_CONFIRMED
            attempt.selected_profile = profile.profile_key
            attempt.selected_context = context_payload
            attempt.confirmed_at = timezone.now()
            attempt.version += 1
            append_audit(attempt, "capture_created", {"capture_id": str(capture.id)})
            attempt.save()
        return Response({
            "status": "created",
            "attempt_id": str(attempt.id),
            "version": attempt.version,
            "capture": CaptureSerializer(capture).data,
        }, status=201)


class CaptureConversationalCancelView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "capture_conversational"

    def post(self, request):
        if not _enabled():
            return _disabled()
        serializer = CancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        attempt = _attempt_for(request, serializer.validated_data["attempt_id"])
        if not attempt:
            return Response({"detail": "Routing attempt not found."}, status=404)
        if attempt.capture_id or attempt.status in {
            CaptureRoutingAttempt.STATUS_CONFIRMED,
            CaptureRoutingAttempt.STATUS_HANDED_OFF,
        }:
            return Response({"detail": "Confirmed routing cannot be cancelled."}, status=400)
        if attempt.version != serializer.validated_data["expected_version"]:
            return _error(ConversationalCaptureError(
                "The routing suggestion changed. Refresh and try again.",
                code="routing_version_conflict",
            ))
        attempt.status = CaptureRoutingAttempt.STATUS_CANCELLED
        attempt.version += 1
        append_audit(attempt, "routing_cancelled")
        attempt.save()
        return Response({"status": "cancelled", "version": attempt.version})


class CaptureConversationalCompleteHandoffView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "capture_conversational"

    def post(self, request):
        if not _enabled():
            return _disabled()
        serializer = CompleteHandoffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        attempt = _attempt_for(request, data["attempt_id"])
        contractor = get_contractor_for_user(request.user)
        if not attempt or attempt.status != CaptureRoutingAttempt.STATUS_HANDED_OFF:
            return Response({"detail": "Routing attempt not found."}, status=404)
        capture = Capture.objects.filter(
            pk=data["capture_id"],
            contractor=contractor,
            captured_by=request.user,
        ).first()
        if not capture:
            return Response({"detail": "Capture not found."}, status=404)
        if attempt.capture_id and attempt.capture_id != capture.id:
            return Response({"detail": "The routing handoff is already complete."}, status=409)
        attempt.capture = capture
        attempt.status = CaptureRoutingAttempt.STATUS_CONFIRMED
        attempt.version += 1
        append_audit(attempt, "structured_handoff_completed", {"capture_id": str(capture.id)})
        attempt.save()
        return Response({"status": "completed", "version": attempt.version})
