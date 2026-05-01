from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Agreement, Milestone
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorQuoteRequest,
)
from projects.serializers.subcontractor_quotes import SubcontractorQuoteRequestSerializer
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.subcontractor_quotes import (
    accept_quote_request,
    build_quote_scope_snapshot,
    cancel_quote_request,
    create_quote_request,
    decline_quote_request,
    get_latest_subcontractor_quote_request,
    get_pricing_readiness_for_agreement,
    request_quote_revision,
    respond_to_quote_request,
)


def _get_owned_agreement(*, user, agreement_id: int) -> tuple[Agreement, object]:
    contractor = resolve_contractor_for_user(user)
    if contractor is None:
        raise PermissionError("Only contractors can manage subcontractor quotes.")
    agreement = get_object_or_404(
        Agreement.objects.select_related("project", "contractor"),
        pk=agreement_id,
        project__contractor=contractor,
    )
    return agreement, contractor


def _quote_queryset_for_contractor(contractor):
    return SubcontractorQuoteRequest.objects.select_related(
        "contractor",
        "subcontractor",
        "subcontractor_invitation",
        "subcontractor_invitation__accepted_by_user",
        "agreement",
        "agreement__project",
        "milestone",
        "linked_subcontractor_milestone_agreement",
    ).filter(contractor=contractor)


def _quote_queryset_for_subcontractor(user):
    return SubcontractorQuoteRequest.objects.select_related(
        "contractor",
        "subcontractor",
        "subcontractor_invitation",
        "subcontractor_invitation__accepted_by_user",
        "agreement",
        "agreement__project",
        "milestone",
        "linked_subcontractor_milestone_agreement",
    ).filter(subcontractor=user)


class SubcontractorQuoteRequestViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SubcontractorQuoteRequestSerializer
    queryset = SubcontractorQuoteRequest.objects.all()

    def get_queryset(self):
        user = getattr(self.request, "user", None)
        if not user or not user.is_authenticated:
            return SubcontractorQuoteRequest.objects.none()

        contractor = resolve_contractor_for_user(user)
        if contractor is not None:
            qs = _quote_queryset_for_contractor(contractor)
            agreement_id = self.request.query_params.get("agreement_id")
            milestone_id = self.request.query_params.get("milestone_id")
            if agreement_id:
                qs = qs.filter(agreement_id=agreement_id)
            if milestone_id:
                qs = qs.filter(milestone_id=milestone_id)
            return qs

        return SubcontractorQuoteRequest.objects.none()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = getattr(self.request, "user", None)
        contractor = resolve_contractor_for_user(user) if user is not None else None
        context["contractor_view"] = contractor is not None
        context["subcontractor_view"] = contractor is None and getattr(user, "is_authenticated", False)
        return context

    def list(self, request, *args, **kwargs):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can list subcontractor quotes."}, status=status.HTTP_403_FORBIDDEN)
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        response = {"results": serializer.data}
        agreement_id = request.query_params.get("agreement_id")
        if agreement_id:
            try:
                agreement = get_object_or_404(Agreement, pk=int(agreement_id), project__contractor=contractor)
                response["pricing_readiness"] = get_pricing_readiness_for_agreement(agreement)
            except Exception:
                response["pricing_readiness"] = None
        return Response(response)

    def retrieve(self, request, *args, **kwargs):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can view quote details."}, status=status.HTTP_403_FORBIDDEN)
        return super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        try:
            agreement_id = int(request.data.get("agreement_id") or 0)
            milestone_id = int(request.data.get("milestone_id") or 0)
            invitation_id = int(request.data.get("subcontractor_invitation_id") or 0)
        except (TypeError, ValueError):
            return Response({"detail": "agreement_id, milestone_id, and subcontractor_invitation_id are required."}, status=status.HTTP_400_BAD_REQUEST)

        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can create subcontractor quotes."}, status=status.HTTP_403_FORBIDDEN)

        agreement = get_object_or_404(Agreement.objects.select_related("project", "contractor"), pk=agreement_id, project__contractor=contractor)
        milestone = get_object_or_404(Milestone.objects.select_related("agreement"), pk=milestone_id, agreement=agreement)
        invitation = get_object_or_404(
            SubcontractorInvitation.objects.select_related("accepted_by_user", "agreement", "contractor"),
            pk=invitation_id,
            agreement=agreement,
            contractor=contractor,
        )

        if invitation.accepted_by_user_id is None:
            return Response({"detail": "The selected subcontractor must accept the invitation first."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = SubcontractorQuoteRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            quote = create_quote_request(
                contractor=contractor,
                agreement=agreement,
                milestone=milestone,
                subcontractor_invitation=invitation,
                contractor_message=serializer.validated_data.get("contractor_message", ""),
                scope_snapshot=serializer.validated_data.get("scope_snapshot") or build_quote_scope_snapshot(
                    contractor=contractor,
                    agreement=agreement,
                    milestone=milestone,
                    invitation=invitation,
                ),
                created_by=request.user,
            )
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)

        out = self.get_serializer(quote)
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["GET"], url_path="assigned")
    def assigned(self, request):
        qs = _quote_queryset_for_subcontractor(request.user)
        serializer = self.get_serializer(qs, many=True)
        return Response({"results": serializer.data})

    @action(detail=True, methods=["POST"])
    def respond(self, request, pk=None):
        quote = get_object_or_404(SubcontractorQuoteRequest.objects.select_related(
            "contractor",
            "subcontractor",
            "subcontractor_invitation",
            "agreement",
            "milestone",
            "linked_subcontractor_milestone_agreement",
        ), pk=pk)
        if quote.subcontractor_id != getattr(request.user, "id", None):
            return Response({"detail": "You are not allowed to respond to this quote."}, status=status.HTTP_403_FORBIDDEN)

        serializer = SubcontractorQuoteRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            quote = respond_to_quote_request(
                quote=quote,
                user=request.user,
                quoted_amount=serializer.validated_data.get("quoted_amount"),
                subcontractor_message=serializer.validated_data.get("subcontractor_message", ""),
                estimated_start_date=serializer.validated_data.get("estimated_start_date"),
                estimated_completion_date=serializer.validated_data.get("estimated_completion_date"),
            )
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)

        out = self.get_serializer(quote)
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["POST"])
    def accept(self, request, pk=None):
        quote = get_object_or_404(SubcontractorQuoteRequest.objects.select_related(
            "contractor",
            "subcontractor",
            "subcontractor_invitation",
            "agreement",
            "milestone",
            "linked_subcontractor_milestone_agreement",
        ), pk=pk)
        serializer = SubcontractorQuoteRequestSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        try:
            quote = accept_quote_request(
                quote=quote,
                user=request.user,
                payment_release_mode=serializer.validated_data.get("payment_release_mode") or "manual_release",
                override_reason=serializer.validated_data.get("override_reason", ""),
            )
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)

        out = self.get_serializer(quote)
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["POST"])
    def decline(self, request, pk=None):
        quote = get_object_or_404(SubcontractorQuoteRequest.objects.select_related(
            "contractor",
            "subcontractor",
            "subcontractor_invitation",
            "agreement",
            "milestone",
        ), pk=pk)
        try:
            quote = decline_quote_request(quote=quote, user=request.user)
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)
        out = self.get_serializer(quote)
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["POST"], url_path="request-revision")
    def request_revision(self, request, pk=None):
        quote = get_object_or_404(SubcontractorQuoteRequest.objects.select_related(
            "contractor",
            "subcontractor",
            "subcontractor_invitation",
            "agreement",
            "milestone",
        ), pk=pk)
        serializer = SubcontractorQuoteRequestSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        try:
            quote = request_quote_revision(
                quote=quote,
                user=request.user,
                revision_note=serializer.validated_data.get("revision_note", ""),
            )
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)
        out = self.get_serializer(quote)
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["POST"])
    def cancel(self, request, pk=None):
        quote = get_object_or_404(SubcontractorQuoteRequest.objects.select_related(
            "contractor",
            "subcontractor",
            "subcontractor_invitation",
            "agreement",
            "milestone",
        ), pk=pk)
        try:
            quote = cancel_quote_request(quote=quote, user=request.user)
        except (PermissionError, ValueError) as exc:
            code = status.HTTP_403_FORBIDDEN if isinstance(exc, PermissionError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)
        out = self.get_serializer(quote)
        return Response(out.data, status=status.HTTP_200_OK)
