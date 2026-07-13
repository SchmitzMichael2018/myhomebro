from __future__ import annotations

from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ProjectAssistantSmartCaptureSession
from projects.services.project_assistant_smart_capture import (
    approve_smart_capture,
    create_smart_capture_session,
    run_extraction,
    smart_capture_price,
    update_smart_capture_draft,
)
from projects.views.homeowner import _get_contractor_for_user


def smart_capture_payload(session: ProjectAssistantSmartCaptureSession, request=None) -> dict:
    source_url = ""
    if session.original_file and hasattr(session.original_file, "url"):
        source_url = session.original_file.url
        if request is not None:
            try:
                source_url = request.build_absolute_uri(source_url)
            except Exception:
                pass
    audit_metadata = dict(session.audit_metadata or {})
    audit_metadata.pop("provider_error_details", None)
    audit_metadata.pop("raw_provider_output", None)
    return {
        "id": str(session.id),
        "capture_type": session.capture_type,
        "status": session.status,
        "original_filename": session.original_filename,
        "mime_type": session.mime_type,
        "file_size": session.file_size,
        "extraction_provider": session.extraction_provider,
        "extraction_model": session.extraction_model,
        "extraction_prompt_version": session.extraction_prompt_version,
        "billable_price": str(smart_capture_price(session.capture_type)),
        "source_url": source_url,
        "source_metadata": session.source_metadata or {},
        "raw_extracted_text": session.raw_extracted_text,
        "structured_payload": session.structured_payload or {},
        "field_confidence": session.field_confidence or {},
        "missing_fields": session.missing_fields or [],
        "warnings": session.warnings or [],
        "possible_matches": session.possible_matches or [],
        "approved_payload": session.approved_payload or {},
        "created_expense": session.created_expense_id,
        "created_asset": session.created_asset_id,
        "created_property_record": session.created_property_record_id,
        "approved_at": session.approved_at,
        "cancelled_at": session.cancelled_at,
        "audit_metadata": audit_metadata,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


class ProjectAssistantSmartCaptureListView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, *args, **kwargs):
        contractor = _get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        qs = ProjectAssistantSmartCaptureSession.objects.filter(contractor=contractor).order_by("-updated_at")[:20]
        return Response({"results": [smart_capture_payload(row, request=request) for row in qs]})

    def post(self, request, *args, **kwargs):
        contractor = _get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        capture_type = str(request.data.get("capture_type") or "").strip()
        file_obj = request.FILES.get("file") or request.FILES.get("original_file")
        if file_obj is None:
            return Response({"detail": "Upload a source file for Smart Capture."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            session = create_smart_capture_session(
                contractor=contractor,
                actor=request.user,
                capture_type=capture_type,
                file_obj=file_obj,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(smart_capture_payload(session, request=request), status=status.HTTP_201_CREATED)


class ProjectAssistantSmartCaptureDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_session(self, request, session_id):
        contractor = _get_contractor_for_user(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        session = ProjectAssistantSmartCaptureSession.objects.filter(contractor=contractor, pk=session_id).first()
        if session is None:
            return None, Response({"detail": "Smart Capture session not found."}, status=status.HTTP_404_NOT_FOUND)
        return session, None

    def get(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        return Response(smart_capture_payload(session, request=request))

    def patch(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        if session.status in {
            ProjectAssistantSmartCaptureSession.STATUS_COMPLETED,
            ProjectAssistantSmartCaptureSession.STATUS_CANCELLED,
        }:
            return Response({"detail": "This Smart Capture session is no longer editable."}, status=status.HTTP_400_BAD_REQUEST)
        session = update_smart_capture_draft(session, request.data.get("structured_payload") or request.data)
        return Response(smart_capture_payload(session, request=request))


class ProjectAssistantSmartCaptureRetryView(ProjectAssistantSmartCaptureDetailView):
    def post(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        session = run_extraction(session)
        return Response(smart_capture_payload(session, request=request))


class ProjectAssistantSmartCaptureApproveView(ProjectAssistantSmartCaptureDetailView):
    def post(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        try:
            session = approve_smart_capture(
                session,
                actor=request.user,
                approved_payload=request.data.get("structured_payload") or {},
            )
        except ValueError as exc:
            return Response({"detail": str(exc), "session": smart_capture_payload(session, request=request)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(smart_capture_payload(session, request=request))


class ProjectAssistantSmartCaptureCancelView(ProjectAssistantSmartCaptureDetailView):
    def post(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        if session.status in {
            ProjectAssistantSmartCaptureSession.STATUS_COMPLETED,
            ProjectAssistantSmartCaptureSession.STATUS_CANCELLED,
        }:
            return Response({"detail": "This Smart Capture session is no longer editable."}, status=status.HTTP_400_BAD_REQUEST)
        session.mark_cancelled(request.user)
        session.save()
        return Response(smart_capture_payload(session, request=request))
