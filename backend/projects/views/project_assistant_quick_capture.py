from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ProjectAssistantCaptureSession
from projects.services.project_assistant_quick_capture import (
    append_turn,
    approve_session,
    prepare_capture_payload,
)
from projects.views.homeowner import _get_contractor_for_user


def session_payload(session: ProjectAssistantCaptureSession) -> dict:
    return {
        "id": str(session.id),
        "status": session.status,
        "intent": session.intent,
        "source_text": session.source_text,
        "conversation_payload": session.conversation_payload or {},
        "prepared_payload": {
            **(session.prepared_payload or {}),
            "conversation_id": str(session.id),
        },
        "created_customer": session.created_customer_id,
        "created_opportunity": session.created_opportunity_id,
        "created_note": session.created_note_id,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


class ProjectAssistantQuickCaptureSessionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = _get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        sessions = ProjectAssistantCaptureSession.objects.filter(contractor=contractor).order_by("-updated_at")[:20]
        return Response({"results": [session_payload(row) for row in sessions]})

    def post(self, request, *args, **kwargs):
        contractor = _get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        text = str(request.data.get("text") or request.data.get("message") or "").strip()
        if not text:
            return Response({"detail": "Enter customer or job details for Project Assistant to capture."}, status=status.HTTP_400_BAD_REQUEST)
        prepared = prepare_capture_payload(text, contractor=contractor)
        conversation = {
            "turns": [{"role": "contractor", "text": text}],
            "last_follow_up_question": prepared.get("follow_up_question", ""),
        }
        session = ProjectAssistantCaptureSession.objects.create(
            contractor=contractor,
            user=request.user,
            status=ProjectAssistantCaptureSession.STATUS_DRAFT,
            intent=prepared.get("intent", ""),
            source_text=text,
            conversation_payload=conversation,
            prepared_payload=prepared,
            audit_metadata={
                "original_input": text,
                "extracted_fields": prepared,
                "duplicate_matches_shown": prepared.get("possible_duplicates", []),
                "created_by": getattr(request.user, "id", None),
            },
        )
        return Response(session_payload(session), status=status.HTTP_201_CREATED)


class ProjectAssistantQuickCaptureSessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_session(self, request, session_id):
        contractor = _get_contractor_for_user(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        session = ProjectAssistantCaptureSession.objects.filter(contractor=contractor, pk=session_id).first()
        if session is None:
            return None, Response({"detail": "Capture session not found."}, status=status.HTTP_404_NOT_FOUND)
        return session, None

    def get(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        return Response(session_payload(session))

    def post(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        text = str(request.data.get("text") or request.data.get("message") or "").strip()
        if not text:
            return Response({"detail": "Enter a follow-up answer."}, status=status.HTTP_400_BAD_REQUEST)
        if session.status != ProjectAssistantCaptureSession.STATUS_DRAFT:
            return Response({"detail": "This capture session is no longer editable."}, status=status.HTTP_400_BAD_REQUEST)
        session = append_turn(session, text)
        return Response(session_payload(session))


class ProjectAssistantQuickCaptureApproveView(ProjectAssistantQuickCaptureSessionDetailView):
    def post(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        action = str(request.data.get("action") or "").strip()
        selected_customer_id = request.data.get("selected_customer_id")
        if action not in {"create_customer", "create_customer_and_opportunity", "create_opportunity_for_existing_customer", "create_reminder"}:
            return Response({"detail": "Choose a supported approval action."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            session = approve_session(
                session,
                action=action,
                actor=request.user,
                selected_customer_id=selected_customer_id,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(session_payload(session))


class ProjectAssistantQuickCaptureCancelView(ProjectAssistantQuickCaptureSessionDetailView):
    def post(self, request, session_id, *args, **kwargs):
        session, error = self.get_session(request, session_id)
        if error:
            return error
        if session.status != ProjectAssistantCaptureSession.STATUS_DRAFT:
            return Response({"detail": "This capture session is no longer editable."}, status=status.HTTP_400_BAD_REQUEST)
        session.audit_metadata = {
            **(session.audit_metadata or {}),
            "cancelled_by": getattr(request.user, "id", None),
        }
        session.mark_cancelled()
        session.save()
        return Response(session_payload(session))
