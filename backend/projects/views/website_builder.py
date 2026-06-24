from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ContractorWebsitePage
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.website_builder import (
    build_contractor_website_payload,
    build_contractor_website_preview_payload,
    ensure_contractor_website,
    get_contractor_website_entitlements,
    list_website_pages,
    pause_contractor_website,
    public_website_snapshot,
    publish_contractor_website,
    update_contractor_website,
    update_website_page,
)


class ContractorWebsiteView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can access Website Builder readiness."}, status=403)
        return Response(build_contractor_website_payload(contractor, request=request))

    def patch(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can edit Website Builder settings."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        try:
            update_contractor_website(
                website,
                request.data if isinstance(request.data, dict) else {},
                entitlements=get_contractor_website_entitlements(contractor),
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(build_contractor_website_payload(contractor, request=request))


class ContractorWebsitePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can preview Website Builder data."}, status=403)
        return Response(build_contractor_website_preview_payload(contractor, request=request))


class ContractorWebsitePublishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can publish Website Builder data."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        result = publish_contractor_website(
            website,
            request=request,
            entitlements=get_contractor_website_entitlements(contractor),
        )
        if not result.get("ok"):
            return Response(result, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class ContractorWebsitePauseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can pause Website Builder data."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        return Response(pause_contractor_website(website))


class ContractorWebsitePagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can view Website Builder pages."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        return Response({"results": list_website_pages(website)})


class ContractorWebsitePageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, page_id: int):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can edit Website Builder pages."}, status=403)
        entitlements = get_contractor_website_entitlements(contractor)
        if not entitlements["features"]["website_builder"]["enabled"]:
            return Response(
                {"detail": entitlements["features"]["website_builder"]["reason"]},
                status=status.HTTP_403_FORBIDDEN,
            )
        website = ensure_contractor_website(contractor, request=request)
        try:
            page = website.pages.get(pk=page_id)
        except ContractorWebsitePage.DoesNotExist:
            return Response({"detail": "Page not found."}, status=status.HTTP_404_NOT_FOUND)
        page = update_website_page(page, request.data if isinstance(request.data, dict) else {})
        pages = list_website_pages(website)
        return Response({
            "page": next((row for row in pages if row["id"] == page.id), None),
            "pages": pages,
        })


class PublicWebsiteView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, slug: str, page_slug: str | None = None):
        snapshot = public_website_snapshot(slug, page_slug=page_slug)
        if snapshot is None:
            return Response({"detail": "Website not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(snapshot)
