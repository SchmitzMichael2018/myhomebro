from __future__ import annotations

import csv
import io
import json

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import OuterRef, Subquery
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_contractor_discovery import (
    ContractorDirectoryClaimToken,
    ContractorDirectoryDiscovery,
    ContractorDirectoryEntry,
    ContractorDirectoryOutreachLog,
    ContractorDiscoveryInvite,
    ContractorOpportunity,
)
from projects.models import Contractor
from projects.models_customer_portal import PropertyWorkOrder, PropertyWorkOrderActivity
from projects.models_project_intake import ProjectIntake
from projects.services.contractor_directory import (
    normalize_business_name,
    normalize_phone,
    normalize_state,
    normalize_website_domain,
    normalize_zip,
    upsert_directory_entry_from_place,
)
from projects.services.contractor_directory_claims import (
    claim_directory_entry_with_token,
    directory_entry_prefill_payload,
    generate_directory_claim_token,
    manually_mark_directory_entry_claimed,
)
from projects.services.contractor_marketplace_join_invites import (
    join_invite_for_claim_token,
    join_invite_payload,
    mark_join_invites_claimed_for_token,
    send_marketplace_join_invite,
)
from projects.services.contractor_contactability import refresh_contactability
from projects.services.contractor_service_taxonomy import clean_raw_services
from projects.services.contractor_opportunities import (
    accept_contractor_opportunity,
    create_or_update_opportunity_from_selection,
)
from projects.services.contractor_discovery import (
    build_contractor_recommendations,
    claim_discovery_invite,
    create_discovery_invites,
)
from projects.services.google_places_contractors import geocode_project_location, search_google_places_contractors_with_diagnostics
from projects.services.contractor_trade_relevance import contractor_entity_excluded, project_trade_intent, trade_fit


def _safe_text(value) -> str:
    return "" if value is None else str(value).strip()


EMAIL_NOT_LISTED_SENTINELS = {"email not listed", "not listed", "none", "null", "n/a"}


def _null_if_blank(value):
    text = _safe_text(value)
    return text or None


def _normalize_email_value(value, *, reject_placeholder=True):
    text = _safe_text(value)
    if not text:
        return None, None
    if text.lower() in EMAIL_NOT_LISTED_SENTINELS:
        if reject_placeholder:
            return None, "Do not save placeholder email text."
        return None, None
    try:
        validate_email(text)
    except ValidationError:
        return None, "Enter a valid public email address."
    return text.lower(), None


def _parse_services(value):
    if value is None:
        return []
    if isinstance(value, list):
        raw_items = value
    else:
        text = _safe_text(value)
        if not text:
            return []
        if text.startswith("["):
            try:
                parsed = json.loads(text)
                raw_items = parsed if isinstance(parsed, list) else [text]
            except (TypeError, ValueError, json.JSONDecodeError):
                raw_items = [text]
        else:
            raw_items = text.replace("\n", ",").replace(";", ",").split(",")
    services = []
    for item in raw_items:
        text = _safe_text(item)
        if text and text not in services:
            services.append(text)
    return services


def _parse_label_list(value):
    if value is None:
        return []
    raw_items = value if isinstance(value, list) else str(value or "").replace("\n", ",").replace(";", ",").split(",")
    labels = []
    for item in raw_items:
        text = _safe_text(item)
        if text and text not in labels:
            labels.append(text)
    return labels


def _changed_services(existing, proposed):
    return list(existing or []) != list(proposed or [])


def _get_intake_from_request(request):
    token = _safe_text(request.query_params.get("token") or request.data.get("token"))
    if token:
        intake = ProjectIntake.objects.filter(share_token=token).first()
        if intake is None:
            return None, Response({"detail": "Intake link not found."}, status=status.HTTP_404_NOT_FOUND)
        return intake, None
    intake_id = request.query_params.get("public_intake_id") or request.data.get("public_intake_id")
    if intake_id:
        intake = ProjectIntake.objects.filter(pk=intake_id).first()
        if intake is None:
            return None, Response({"detail": "Intake not found."}, status=status.HTTP_404_NOT_FOUND)
        return intake, None
    return None, Response({"detail": "Missing intake token."}, status=status.HTTP_400_BAD_REQUEST)


class PublicIntakeContractorSearchView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        intake, error = _get_intake_from_request(request)
        if error:
            return error

        query = _safe_text(request.query_params.get("query"))
        latitude = request.query_params.get("lat")
        longitude = request.query_params.get("lng")
        radius_miles = request.query_params.get("radius_miles")
        limit = request.query_params.get("limit")
        try:
            limit = max(1, min(int(limit or 40), 50))
        except (TypeError, ValueError):
            limit = 40
        try:
            radius_miles = int(float(radius_miles or 25))
        except (TypeError, ValueError):
            radius_miles = 25
        radius_miles = radius_miles if radius_miles in {5, 10, 15, 25, 50, 100} else 25
        project_context = {
            "project_type": request.query_params.get("project_type"),
            "project_subtype": request.query_params.get("project_subtype"),
            "project_title": request.query_params.get("project_title"),
            "description": request.query_params.get("description"),
            "project_scope_summary": request.query_params.get("project_scope_summary"),
            "project_city": request.query_params.get("city") or request.query_params.get("project_city"),
            "project_state": request.query_params.get("state") or request.query_params.get("project_state"),
            "project_postal_code": request.query_params.get("zip") or request.query_params.get("project_postal_code"),
            "project_address_line1": request.query_params.get("address") or request.query_params.get("project_address_line1"),
            "project_class": request.query_params.get("project_class"),
            "project_mode": request.query_params.get("project_mode"),
            "payment_preference": request.query_params.get("payment_preference"),
        }

        result = build_contractor_recommendations(
            intake=intake,
            payload=project_context,
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius_miles,
            limit=limit,
        )
        return Response(result, status=status.HTTP_200_OK)


class PublicIntakeSendContractorInvitesView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        intake, error = _get_intake_from_request(request)
        if error:
            return error

        selected = request.data.get("selected_contractors") or request.data.get("selected") or []
        if isinstance(selected, str):
            try:
                import json

                selected = json.loads(selected)
            except Exception:
                selected = []
        preferred_channel = _safe_text(request.data.get("preferred_channel"))

        try:
            result = create_discovery_invites(
                intake=intake,
                selected_targets=selected,
                preferred_channel=preferred_channel,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_200_OK)


def _opportunity_payload(opportunity: ContractorOpportunity) -> dict:
    directory_entry = getattr(opportunity, "directory_entry", None)
    work_order = getattr(opportunity, "property_work_order", None)
    project_description = opportunity.project_description or ""
    refined_description = opportunity.refined_description or ""
    next_url = (
        f"/app/agreements/{opportunity.converted_agreement_id}/wizard?step=1"
        if opportunity.converted_agreement_id
        else ""
    )
    payload = {
        "id": opportunity.id,
        "opportunity_id": opportunity.id,
        "directory_entry_id": opportunity.directory_entry_id,
        "contractor_business_name": getattr(directory_entry, "business_name", ""),
        "directory_business_name": getattr(directory_entry, "business_name", ""),
        "homeowner_name": opportunity.homeowner_name,
        "homeowner_email": opportunity.homeowner_email,
        "homeowner_phone": opportunity.homeowner_phone,
        "full_name": opportunity.homeowner_name,
        "email": opportunity.homeowner_email,
        "phone": opportunity.homeowner_phone,
        "project_title": opportunity.project_title,
        "project_type": opportunity.project_type,
        "project_subtype": opportunity.project_subtype,
        "project_description": project_description,
        "short_description": project_description[:180],
        "refined_description": refined_description,
        "project_city": opportunity.project_city,
        "project_state": opportunity.project_state,
        "city": opportunity.project_city,
        "state": opportunity.project_state,
        "project_address": opportunity.project_address,
        "project_zip": opportunity.project_zip,
        "zip_code": opportunity.project_zip,
        "budget_min": opportunity.budget_min,
        "budget_max": opportunity.budget_max,
        "timeline": opportunity.timeline,
        "preferred_timeline": opportunity.timeline,
        "measurements": opportunity.measurements or [],
        "photos": opportunity.photos or [],
        "photos_count": len(opportunity.photos or []),
        "selected_by_homeowner": opportunity.selected_by_homeowner,
        "status": opportunity.status,
        "source": "contractor_opportunity",
        "selected_at": opportunity.selected_at,
        "created_at": opportunity.selected_at,
        "accepted_at": opportunity.accepted_at,
        "converted_customer_id": opportunity.converted_customer_id,
        "converted_agreement_id": opportunity.converted_agreement_id,
        "converted_agreement": opportunity.converted_agreement_id,
        "agreement_id": opportunity.converted_agreement_id,
        "next_url": next_url,
    }
    if work_order is not None:
        payload.update(
            {
                "source": "property_work_order",
                "property_work_order_id": work_order.id,
                "work_order_id": work_order.id,
                "work_order_number": work_order.work_order_number or f"PWO-{work_order.id:06d}",
                "marketplace_status": work_order.marketplace_status,
                "marketplace_status_label": work_order.get_marketplace_status_display(),
                "requested_date": work_order.scheduled_for or work_order.created_at,
                "priority": work_order.priority,
                "priority_label": work_order.get_priority_display(),
                "category": work_order.category,
                "category_label": work_order.get_category_display(),
            }
        )
    return payload


class PublicIntakeSelectContractorView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        intake, error = _get_intake_from_request(request)
        if error:
            return error

        selected = request.data.get("selected_contractors") or request.data.get("selected") or []
        if request.data.get("directory_entry_id") or request.data.get("id") or request.data.get("place"):
            selected = [request.data]
        if not isinstance(selected, list) or not selected:
            return Response({"detail": "Select at least one contractor."}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        payload = request.data.get("project_context") if isinstance(request.data.get("project_context"), dict) else request.data
        for selection in selected:
            if not isinstance(selection, dict):
                continue
            try:
                opportunity = create_or_update_opportunity_from_selection(
                    {
                        "intake_request": intake,
                        "selection": selection,
                        "payload": payload,
                    }
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            created.append(_opportunity_payload(opportunity))

        return Response(
            {
                "success": True,
                "status": ContractorOpportunity.STATUS_PENDING,
                "created": created,
                "opportunity_count": len(created),
                "opportunity_id": created[0]["opportunity_id"] if created else None,
                "directory_entry_id": created[0]["directory_entry_id"] if created else None,
            },
            status=status.HTTP_200_OK,
        )


def _directory_entry_payload(entry: ContractorDirectoryEntry) -> dict:
    latest_outreach = entry.outreach_logs.order_by("-created_at", "-id").first()
    latest_join_invite = entry.marketplace_join_invites.select_related("claim_token").order_by("-created_at", "-id").first()
    outreach_attempt_count = entry.outreach_logs.count()
    outreach_status = "no_outreach"
    if entry.claimed:
        outreach_status = "claimed"
    elif latest_outreach is not None:
        outreach_status = {
            ContractorDirectoryOutreachLog.TYPE_PHONE: "phone_outreach_logged",
            ContractorDirectoryOutreachLog.TYPE_WEBSITE_FORM: "website_outreach_logged",
            ContractorDirectoryOutreachLog.TYPE_CLAIM_LINK_COPIED: "claim_link_generated",
            ContractorDirectoryOutreachLog.TYPE_MANUAL_NOTE: "manual_review_needed",
            ContractorDirectoryOutreachLog.TYPE_EMAIL: "email_outreach_logged",
            ContractorDirectoryOutreachLog.TYPE_SMS: "sms_outreach_logged",
        }.get(latest_outreach.outreach_type, "outreach_logged")
    elif entry.contact_status == ContractorDirectoryEntry.CONTACT_STATUS_MANUAL_REVIEW_NEEDED:
        outreach_status = "manual_review_needed"
    return {
        "id": entry.id,
        "business_name": entry.business_name,
        "website": entry.website,
        "phone": entry.phone,
        "public_email": entry.public_email,
        "has_public_email": entry.has_public_email,
        "has_phone": entry.has_phone,
        "has_website": entry.has_website,
        "has_contact_form": entry.has_contact_form,
        "contact_form_url": entry.contact_form_url,
        "preferred_outreach_method": entry.preferred_outreach_method,
        "contact_confidence": entry.contact_confidence,
        "contact_status": entry.contact_status,
        "outreach_notes": entry.outreach_notes,
        "outreach_status": outreach_status,
        "outreach_attempt_count": outreach_attempt_count,
        "latest_outreach_type": latest_outreach.outreach_type if latest_outreach else None,
        "latest_outreach_status": latest_outreach.status if latest_outreach else None,
        "latest_outreach_at": latest_outreach.created_at if latest_outreach else None,
        "latest_outreach_notes": latest_outreach.notes if latest_outreach else None,
        "marketplace_join_invite": join_invite_payload(latest_join_invite) if latest_join_invite else None,
        "claim_readiness_status": entry.claim_readiness_status,
        "claim_readiness_notes": entry.claim_readiness_notes,
        "address_line1": entry.address_line1,
        "city": entry.city,
        "state": entry.state,
        "zip_code": entry.zip_code,
        "rating": entry.rating,
        "review_count": entry.review_count,
        "services": entry.services or [],
        "service_radius_miles": entry.service_radius_miles,
        "service_city": entry.service_city,
        "service_state": entry.service_state,
        "service_zip": entry.service_zip,
        "primary_service": entry.primary_service,
        "normalized_services": entry.normalized_services or [],
        "raw_services": entry.raw_services or [],
        "service_normalization_status": entry.service_normalization_status,
        "source": entry.source,
        "claimed": entry.claimed,
        "claimed_contractor_id": entry.claimed_by_contractor_id,
        "profile_status": entry.profile_status,
        "enrichment_status": entry.enrichment_status,
        "email_source_url": entry.email_source_url,
        "services_source_url": entry.services_source_url,
        "enrichment_notes": entry.enrichment_notes,
        "enriched_at": entry.enriched_at,
        "enriched_by": entry.enriched_by_id,
        "is_archived": entry.is_archived,
        "archived_at": entry.archived_at,
        "first_seen_at": entry.first_seen_at,
        "last_seen_at": entry.last_seen_at,
    }


def _normalize_csv_header(value) -> str:
    return _safe_text(value).lstrip("\ufeff").strip().lower().replace(" ", "_")


def _normalize_import_row(row: dict) -> dict:
    normalized = {}
    for key, value in (row or {}).items():
        header = _normalize_csv_header(key)
        if not header:
            continue
        normalized[header] = value
    aliases = {
        "directory_entry_id": "id",
        "entry_id": "id",
        "contractor_directory_entry_id": "id",
        "business": "business_name",
        "name": "business_name",
        "website_url": "website",
        "url": "website",
        "phone_number": "phone",
        "zip": "zip_code",
        "postal_code": "zip_code",
    }
    for source, target in aliases.items():
        if source in normalized and target not in normalized:
            normalized[target] = normalized[source]
    return normalized


def _find_directory_match(row: dict) -> tuple[ContractorDirectoryEntry | None, str]:
    raw_id = _safe_text(row.get("id") or row.get("matched_entry_id") or row.get("entry_id") or row.get("directory_entry_id"))
    if raw_id.isdigit():
        found = ContractorDirectoryEntry.objects.filter(pk=int(raw_id)).first()
        if found:
            return found, "id"

    website_domain = normalize_website_domain(row.get("website"))
    if website_domain:
        found = ContractorDirectoryEntry.objects.filter(website_domain=website_domain).first()
        if found:
            return found, "website"

    normalized_phone = normalize_phone(row.get("phone"))
    if normalized_phone:
        found = ContractorDirectoryEntry.objects.filter(normalized_phone=normalized_phone).first()
        if found:
            return found, "phone"

    normalized_name = normalize_business_name(row.get("business_name"))
    zip_code = normalize_zip(row.get("zip_code") or row.get("zip"))
    if normalized_name and zip_code:
        found = ContractorDirectoryEntry.objects.filter(normalized_name=normalized_name, zip_code=zip_code).first()
        if found:
            return found, "name_zip"

    city = _safe_text(row.get("city"))
    state_value = _safe_text(row.get("state"))
    if normalized_name and city and state_value:
        found = ContractorDirectoryEntry.objects.filter(
            normalized_name=normalized_name,
            city__iexact=city,
            state__iexact=state_value,
        ).first()
        if found:
            return found, "name_city_state"
    if normalized_name:
        matches = list(ContractorDirectoryEntry.objects.filter(normalized_name=normalized_name)[:2])
        if len(matches) == 1:
            return matches[0], "name"
    return None, ""


def _preview_import_row(row: dict) -> dict:
    row = _normalize_import_row(row)
    entry, matched_by = _find_directory_match(row)
    proposed_email, email_error = _normalize_email_value(row.get("public_email"), reject_placeholder=True)
    proposed_phone = _null_if_blank(row.get("phone"))
    proposed_services = _parse_services(row.get("services"))
    proposed_normalized_services = _parse_label_list(row.get("normalized_services"))
    proposed_raw_services = clean_raw_services(row.get("raw_services", "").replace(";", ",").split(",") if isinstance(row.get("raw_services"), str) else row.get("raw_services"))
    proposed_primary_service = _null_if_blank(row.get("primary_service"))
    proposed_website = _null_if_blank(row.get("website"))
    proposed_location = {
        "address_line1": _null_if_blank(row.get("address_line1")),
        "city": _null_if_blank(row.get("city")),
        "state": _null_if_blank(normalize_state(row.get("state"))),
        "zip_code": _null_if_blank(normalize_zip(row.get("zip_code") or row.get("zip"))),
    }
    warnings = []
    row_status = "ready"

    if entry is None:
        row_status = "no_match"
        warnings.append("No matching directory entry found.")
    elif email_error:
        row_status = "invalid_email"
        warnings.append(email_error)
    elif proposed_email:
        duplicate = ContractorDirectoryEntry.objects.filter(public_email__iexact=proposed_email).exclude(pk=entry.pk).first()
        if duplicate:
            row_status = "duplicate_email_warning"
            warnings.append(f"Email is already used by entry #{duplicate.pk}.")

    if entry is not None and row_status == "ready":
        has_changes = False
        if proposed_email and proposed_email != (entry.public_email or ""):
            has_changes = True
        if proposed_phone and proposed_phone != (entry.phone or ""):
            has_changes = True
        if proposed_website and proposed_website != (entry.website or ""):
            has_changes = True
        if proposed_services and _changed_services(entry.services, proposed_services):
            has_changes = True
        if proposed_primary_service and proposed_primary_service != (entry.primary_service or ""):
            has_changes = True
        if proposed_normalized_services and _changed_services(entry.normalized_services, proposed_normalized_services):
            has_changes = True
        if proposed_raw_services and _changed_services(entry.raw_services, proposed_raw_services):
            has_changes = True
        for field, value in proposed_location.items():
            if value and _safe_text(value) != _safe_text(getattr(entry, field, "")):
                has_changes = True
        for field in ["email_source_url", "services_source_url", "enrichment_notes"]:
            if _safe_text(row.get(field)) and _safe_text(row.get(field)) != _safe_text(getattr(entry, field, "")):
                has_changes = True
        if not has_changes:
            row_status = "no_changes"
            warnings.append("No changes detected.")

    return {
        "matched_entry_id": entry.pk if entry else None,
        "matched_by": matched_by,
        "business_name": _safe_text(row.get("business_name")) or (entry.business_name if entry else ""),
        "submitted_id": _safe_text(row.get("id") or row.get("entry_id") or row.get("directory_entry_id")),
        "submitted_business_name": _safe_text(row.get("business_name")),
        "submitted_website": _safe_text(row.get("website")),
        "existing_public_email": entry.public_email if entry else None,
        "proposed_public_email": proposed_email,
        "existing_phone": entry.phone if entry else None,
        "proposed_phone": proposed_phone,
        "existing_website": entry.website if entry else None,
        "proposed_website": proposed_website,
        "existing_services": entry.services if entry else [],
        "proposed_services": proposed_services,
        "existing_primary_service": entry.primary_service if entry else None,
        "proposed_primary_service": proposed_primary_service,
        "existing_normalized_services": entry.normalized_services if entry else [],
        "proposed_normalized_services": proposed_normalized_services,
        "existing_raw_services": entry.raw_services if entry else [],
        "proposed_raw_services": proposed_raw_services,
        "existing_location": {
            "address_line1": entry.address_line1 if entry else None,
            "city": entry.city if entry else None,
            "state": entry.state if entry else None,
            "zip_code": entry.zip_code if entry else None,
        },
        "proposed_location": proposed_location,
        "email_source_url": _safe_text(row.get("email_source_url")),
        "services_source_url": _safe_text(row.get("services_source_url")),
        "enrichment_notes": _safe_text(row.get("enrichment_notes")),
        "contact_status": _safe_text(row.get("contact_status")),
        "preferred_outreach_method": _safe_text(row.get("preferred_outreach_method")),
        "contact_confidence": _safe_text(row.get("contact_confidence")),
        "has_contact_form": _safe_text(row.get("has_contact_form")),
        "contact_form_url": _safe_text(row.get("contact_form_url")),
        "outreach_notes": _safe_text(row.get("outreach_notes")),
        "claim_readiness_status": _safe_text(row.get("claim_readiness_status")),
        "claim_readiness_notes": _safe_text(row.get("claim_readiness_notes")),
        "status": row_status,
        "warnings": warnings,
    }


def _admin_search_place_name(place: dict) -> str:
    display_name = place.get("displayName")
    if isinstance(display_name, dict):
        return _safe_text(display_name.get("text"))
    return _safe_text(
        place.get("business_name")
        or place.get("name")
        or display_name
        or place.get("formatted_address")
        or place.get("formattedAddress")
    )


def _admin_search_tokens(value: str) -> set[str]:
    normalized = normalize_business_name(value)
    return {part for part in normalized.split() if len(part) > 2}


def _score_admin_search_relevance(place: dict, query: str) -> dict:
    query_text = _safe_text(query)
    place_name = _admin_search_place_name(place)
    query_normalized = normalize_business_name(query_text)
    name_normalized = normalize_business_name(place_name)
    query_tokens = _admin_search_tokens(query_text)
    name_tokens = _admin_search_tokens(place_name)
    overlap = query_tokens & name_tokens

    score = 0
    reason = "Limited overlap with the search term."
    if query_normalized and name_normalized:
        if query_normalized == name_normalized:
            score = 100
            reason = "Business name exactly matches the search term."
        elif query_normalized in name_normalized or name_normalized in query_normalized:
            score = 88
            reason = "Business name closely matches the search term."
        elif query_tokens and query_tokens.issubset(name_tokens):
            score = 82
            reason = "Business name includes all search words."
        elif overlap:
            score = min(72, 42 + (len(overlap) * 12))
            reason = "Business name shares search words."

    raw_services = []
    for key in ["primaryType", "types", "services", "raw_services", "normalized_services", "primary_service", "primary_trade", "trade_categories"]:
        value = place.get(key)
        if isinstance(value, list):
            raw_services.extend(_safe_text(item) for item in value)
        elif value:
            raw_services.append(_safe_text(value))
    service_tokens = _admin_search_tokens(" ".join(raw_services))
    service_overlap = query_tokens & service_tokens
    if service_overlap and score < 68:
        score = max(score, 58 + min(len(service_overlap) * 6, 18))
        reason = "Service/category data overlaps with the search term."

    trade_text = " ".join([place_name, " ".join(raw_services), _safe_text(place.get("formatted_address") or place.get("formattedAddress"))])
    intent = project_trade_intent(query)
    if contractor_entity_excluded(trade_text):
        score = 0
        reason = "Non-contractor entity filtered from contractor search."
    elif intent:
        fit = trade_fit(intent, trade_text)
        if fit.get("level") == "primary":
            score = max(score, 84)
            reason = fit.get("reason") or "Primary trade matches the search."
        elif fit.get("level") == "secondary":
            score = min(max(score, 44), 49)
            reason = fit.get("reason") or "Related trade may support part of the search."
        else:
            score = min(score, 35)
            reason = fit.get("reason") or "Trade metadata does not match the search."

    if score >= 80:
        label = "Strong Match"
    elif score >= 50:
        label = "Possible Match"
    else:
        label = "Weak Match"

    return {
        "relevance_score": score,
        "relevance_label": label,
        "relevance_reason": reason,
        "is_relevant": label in {"Strong Match", "Possible Match"},
    }


def _with_admin_search_relevance(results: list[dict], query: str) -> list[dict]:
    enriched = []
    for index, place in enumerate(results or []):
        if not isinstance(place, dict):
            continue
        relevance = _score_admin_search_relevance(place, query)
        enriched.append({**place, **relevance, "_original_index": index})
    return sorted(
        enriched,
        key=lambda row: (
            -int(row.get("relevance_score") or 0),
            -(float(row.get("rating") or row.get("google_rating") or 0)),
            -(int(row.get("review_count") or row.get("google_review_count") or 0)),
            int(row.get("_original_index") or 0),
        ),
    )


def _admin_search_params(source) -> dict:
    return {
        "query": _safe_text(source.get("query")),
        "city": _safe_text(source.get("city")),
        "state": _safe_text(source.get("state")),
        "zip_code": _safe_text(source.get("zip") or source.get("postal_code")),
        "latitude": source.get("lat"),
        "longitude": source.get("lng"),
        "radius_miles": source.get("radius_miles"),
        "limit": source.get("limit"),
    }


def _coerce_admin_search_radius(value) -> int:
    try:
        radius_miles = int(float(value or 25))
    except (TypeError, ValueError):
        radius_miles = 25
    return radius_miles if radius_miles in {5, 10, 15, 25, 50, 100} else 25


def _coerce_admin_search_limit(value) -> int:
    try:
        return max(1, min(int(value or 20), 50))
    except (TypeError, ValueError):
        return 20


def _admin_search_context(request, params: dict, radius_miles: int) -> dict:
    return {
        "source_type": ContractorDirectoryDiscovery.SOURCE_ADMIN_SEARCH,
        "search_term": params["query"],
        "search_city": params["city"],
        "search_state": params["state"],
        "search_zip": params["zip_code"],
        "radius_miles": radius_miles,
        "admin_user": request.user,
    }


def _expanded_admin_search_query(query: str) -> str:
    text = _safe_text(query)
    lowered = text.lower()
    if not text or any(term in lowered for term in ["contractor", "company", "installer", "electrician", "plumber", "roofer"]):
        return text
    trade_aliases = {
        "pool": "pool contractor pool builder pool service company",
        "pool installation": "pool contractor pool builder pool service company",
        "appliance": "appliance repair contractor",
        "dryer": "appliance repair contractor",
        "refrigerator": "appliance repair contractor",
        "gutter": "gutter contractor gutter installation",
        "gutters": "gutter contractor gutter installation",
        "roof": "roofing contractor",
        "roofing": "roofing contractor",
        "floor": "flooring contractor",
        "flooring": "flooring contractor",
        "concrete": "concrete contractor",
        "patio": "patio contractor",
        "plumbing": "plumber",
        "electrical": "electrician",
        "electric": "electrician",
        "hvac": "hvac contractor",
        "remodel": "remodeling contractor",
        "remodeling": "remodeling contractor",
    }
    return trade_aliases.get(lowered, f"{text} contractor")


def _admin_google_preview_search(
    *,
    query: str,
    latitude,
    longitude,
    radius_miles: int,
    limit: int,
) -> dict:
    first = search_google_places_contractors_with_diagnostics(
        query=query,
        latitude=latitude,
        longitude=longitude,
        radius_miles=radius_miles,
        limit=limit,
        enforce_radius=True,
    )
    if first.get("results"):
        return first
    expanded_query = _expanded_admin_search_query(query)
    if not expanded_query or expanded_query == query:
        return first
    retry = search_google_places_contractors_with_diagnostics(
        query=expanded_query,
        latitude=latitude,
        longitude=longitude,
        radius_miles=radius_miles,
        limit=limit,
        enforce_radius=True,
    )
    retry_diagnostic = retry.get("diagnostic") or {}
    retry_diagnostic["fallback_from_query"] = query
    retry_diagnostic["fallback_query"] = expanded_query
    retry["diagnostic"] = retry_diagnostic
    return retry if retry.get("results") else first | {"diagnostic": {**(first.get("diagnostic") or {}), "fallback_query": expanded_query}}


class AdminContractorSearchView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, *args, **kwargs):
        return self._preview(request, request.query_params)

    def post(self, request, *args, **kwargs):
        return self._preview(request, request.data)

    def _preview(self, request, source):
        params = _admin_search_params(source)
        radius_miles = _coerce_admin_search_radius(params["radius_miles"])
        limit = _coerce_admin_search_limit(params["limit"])
        latitude = params["latitude"]
        longitude = params["longitude"]

        if not latitude or not longitude:
            geocode = geocode_project_location(city=params["city"], state=params["state"], postal_code=params["zip_code"])
            latitude = geocode.get("latitude")
            longitude = geocode.get("longitude")

        google_result = _admin_google_preview_search(
            query=params["query"],
            latitude=latitude,
            longitude=longitude,
            radius_miles=radius_miles,
            limit=limit,
        )
        results = _with_admin_search_relevance(google_result.get("results") or [], params["query"])
        relevant_count = len([row for row in results if row.get("is_relevant")])

        return Response(
            {
                "summary": {
                    "search_query": params["query"],
                    "radius_miles": radius_miles,
                    "results_count": len(results),
                    "relevant_results_count": relevant_count,
                    "directory_entries_count": 0,
                    "capture_required": True,
                    "external_search": google_result.get("diagnostic") or {},
                },
                "results": results,
                "directory_entries": [],
            },
            status=status.HTTP_200_OK,
        )


class AdminContractorSearchCaptureView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, *args, **kwargs):
        selected_results = request.data.get("selected_results") or request.data.get("results") or []
        if not isinstance(selected_results, list) or not selected_results:
            return Response({"detail": "Select at least one contractor result to capture."}, status=status.HTTP_400_BAD_REQUEST)

        params = _admin_search_params(request.data)
        radius_miles = _coerce_admin_search_radius(params["radius_miles"])
        context = _admin_search_context(request, params, radius_miles)
        entries = []
        captured_results = []
        for place in selected_results:
            if not isinstance(place, dict):
                continue
            entry = upsert_directory_entry_from_place(place, context=context)
            if entry is None:
                continue
            entries.append(_directory_entry_payload(entry))
            captured_results.append({**place, "directory_entry_id": entry.id, "captured": True})

        return Response(
            {
                "summary": {
                    "search_query": params["query"],
                    "radius_miles": radius_miles,
                    "selected_count": len(selected_results),
                    "directory_entries_count": len(entries),
                    "captured_count": len(entries),
                },
                "results": captured_results,
                "directory_entries": entries,
            },
            status=status.HTTP_200_OK,
        )


class AdminContractorDirectoryView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, *args, **kwargs):
        latest_outreach_type = ContractorDirectoryOutreachLog.objects.filter(directory_entry=OuterRef("pk")).order_by("-created_at", "-id").values("outreach_type")[:1]
        qs = ContractorDirectoryEntry.objects.annotate(latest_outreach_type=Subquery(latest_outreach_type)).order_by("-last_seen_at", "business_name")
        archived = _safe_text(request.query_params.get("archived") or "active").lower()
        if archived in {"archived", "true"}:
            qs = qs.filter(is_archived=True)
        elif archived not in {"all", "*"}:
            qs = qs.filter(is_archived=False)
        if _safe_text(request.query_params.get("missing_email")).lower() == "true":
            qs = qs.filter(public_email__isnull=True)
        if _safe_text(request.query_params.get("has_email")).lower() == "true":
            qs = qs.exclude(public_email__isnull=True).exclude(public_email="")
        if _safe_text(request.query_params.get("has_website")).lower() == "true":
            qs = qs.exclude(website__isnull=True).exclude(website="")
        if _safe_text(request.query_params.get("has_contact_form")).lower() == "true":
            qs = qs.filter(has_contact_form=True)
        for param, field in [
            ("city", "city__iexact"),
            ("state", "state__iexact"),
            ("source", "source"),
            ("primary_service", "primary_service__iexact"),
            ("profile_status", "profile_status"),
            ("enrichment_status", "enrichment_status"),
            ("contact_status", "contact_status"),
            ("preferred_outreach_method", "preferred_outreach_method"),
            ("contact_confidence", "contact_confidence"),
            ("claim_readiness_status", "claim_readiness_status"),
        ]:
            value = _safe_text(request.query_params.get(param))
            if value:
                qs = qs.filter(**{field: value})
        claimed = _safe_text(request.query_params.get("claimed")).lower()
        if claimed in {"true", "false"}:
            qs = qs.filter(claimed=claimed == "true")
        outreach_status = _safe_text(request.query_params.get("outreach_status")).lower()
        if outreach_status:
            if outreach_status == "claimed":
                qs = qs.filter(claimed=True)
            elif outreach_status == "no_outreach":
                qs = qs.filter(claimed=False, latest_outreach_type__isnull=True).exclude(
                    contact_status=ContractorDirectoryEntry.CONTACT_STATUS_MANUAL_REVIEW_NEEDED
                )
            elif outreach_status == "manual_review_needed":
                qs = qs.filter(contact_status=ContractorDirectoryEntry.CONTACT_STATUS_MANUAL_REVIEW_NEEDED)
            else:
                outreach_type_by_status = {
                    "phone_outreach_logged": ContractorDirectoryOutreachLog.TYPE_PHONE,
                    "website_outreach_logged": ContractorDirectoryOutreachLog.TYPE_WEBSITE_FORM,
                    "claim_link_generated": ContractorDirectoryOutreachLog.TYPE_CLAIM_LINK_COPIED,
                    "email_outreach_logged": ContractorDirectoryOutreachLog.TYPE_EMAIL,
                    "sms_outreach_logged": ContractorDirectoryOutreachLog.TYPE_SMS,
                }
                outreach_type = outreach_type_by_status.get(outreach_status)
                if outreach_type:
                    qs = qs.filter(latest_outreach_type=outreach_type)

        total_count = qs.count()
        try:
            page_size = max(1, min(int(request.query_params.get("page_size") or 50), 250))
        except (TypeError, ValueError):
            page_size = 50
        try:
            page = max(1, int(request.query_params.get("page") or 1))
        except (TypeError, ValueError):
            page = 1
        total_pages = max(1, (total_count + page_size - 1) // page_size)
        page = min(page, total_pages)
        start = (page - 1) * page_size
        end = start + page_size
        return Response(
            {
                "results": [_directory_entry_payload(entry) for entry in qs[start:end]],
                "total_count": total_count,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "has_next": page < total_pages,
                "has_previous": page > 1,
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)

        errors = {}
        data = request.data
        enrichment_touched = False

        if "public_email" in data:
            email_value, email_error = _normalize_email_value(data.get("public_email"), reject_placeholder=True)
            if email_error:
                errors["public_email"] = email_error
            else:
                entry.public_email = email_value
                enrichment_touched = True

        if errors:
            return Response({"errors": errors, "detail": "Please correct the highlighted fields."}, status=status.HTTP_400_BAD_REQUEST)

        if "business_name" in data:
            entry.business_name = _safe_text(data.get("business_name")) or entry.business_name
            entry.normalized_name = normalize_business_name(entry.business_name)
        if "website" in data:
            entry.website = _null_if_blank(data.get("website"))
            entry.website_domain = _null_if_blank(normalize_website_domain(entry.website))
        if "phone" in data:
            entry.phone = _null_if_blank(data.get("phone"))
            entry.normalized_phone = _null_if_blank(normalize_phone(entry.phone))
        for field in ["has_contact_form", "contact_form_url", "preferred_outreach_method", "contact_status", "contact_confidence", "outreach_notes", "claim_readiness_status", "claim_readiness_notes"]:
            if field in data:
                if field == "has_contact_form":
                    setattr(entry, field, bool(data.get(field)))
                else:
                    setattr(entry, field, _null_if_blank(data.get(field)))
        if "address_line1" in data:
            entry.address_line1 = _null_if_blank(data.get("address_line1"))
        if "city" in data:
            entry.city = _null_if_blank(data.get("city"))
        if "state" in data:
            entry.state = _null_if_blank(normalize_state(data.get("state")))
        if "zip_code" in data:
            entry.zip_code = _null_if_blank(normalize_zip(data.get("zip_code")))
        if "service_radius_miles" in data:
            try:
                radius = int(data.get("service_radius_miles"))
            except (TypeError, ValueError):
                radius = 25
            entry.service_radius_miles = radius if radius in {5, 10, 15, 25, 50, 100} else 25
        for field in ["service_city", "service_state", "service_zip", "primary_service"]:
            if field in data:
                value = normalize_state(data.get(field)) if field == "service_state" else normalize_zip(data.get(field)) if field == "service_zip" else _safe_text(data.get(field))
                setattr(entry, field, _null_if_blank(value))
        if "primary_service" in data:
            entry.primary_service = _null_if_blank(data.get("primary_service"))
            entry.service_normalization_status = ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL
        if "normalized_services" in data:
            raw_value = data.get("normalized_services")
            entry.normalized_services = _parse_label_list(raw_value)
            entry.service_normalization_status = ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL
        if "raw_services" in data:
            raw_value = data.get("raw_services")
            entry.raw_services = clean_raw_services(raw_value.replace(";", ",").split(",") if isinstance(raw_value, str) else raw_value)
        if "services" in data:
            entry.services = _parse_services(data.get("services"))
            enrichment_touched = True
        if "profile_status" in data:
            entry.profile_status = _safe_text(data.get("profile_status")) or ContractorDirectoryEntry.PROFILE_BASIC
        if "enrichment_status" in data:
            entry.enrichment_status = _safe_text(data.get("enrichment_status")) or ContractorDirectoryEntry.ENRICHMENT_NOT_STARTED
        for field in ["email_source_url", "services_source_url", "enrichment_notes"]:
            if field in data:
                setattr(entry, field, _null_if_blank(data.get(field)))
                enrichment_touched = True

        if enrichment_touched:
            if "enrichment_status" not in data:
                entry.enrichment_status = ContractorDirectoryEntry.ENRICHMENT_REVIEWED
            entry.enriched_at = timezone.now()
            entry.enriched_by = request.user

        entry.save()
        manual_contact_fields = {
            field: _null_if_blank(data.get(field))
            for field in ["preferred_outreach_method", "contact_status", "contact_confidence", "claim_readiness_status", "claim_readiness_notes"]
            if field in data
        }
        refresh_contactability(entry)
        if manual_contact_fields:
            for field, value in manual_contact_fields.items():
                setattr(entry, field, value)
            entry.save(update_fields=[*manual_contact_fields.keys(), "last_seen_at"])
        return Response(_directory_entry_payload(entry), status=status.HTTP_200_OK)


class AdminContractorDirectoryArchiveView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)
        if not entry.is_archived:
            entry.is_archived = True
            entry.archived_at = timezone.now()
            entry.save(update_fields=["is_archived", "archived_at", "last_seen_at"])
        return Response(_directory_entry_payload(entry), status=status.HTTP_200_OK)


class AdminContractorDirectoryRestoreView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)
        if entry.is_archived:
            entry.is_archived = False
            entry.archived_at = None
            entry.save(update_fields=["is_archived", "archived_at", "last_seen_at"])
        return Response(_directory_entry_payload(entry), status=status.HTTP_200_OK)


class AdminContractorDirectoryOutreachLogView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)
        outreach_type = _safe_text(request.data.get("outreach_type") or ContractorDirectoryOutreachLog.TYPE_MANUAL_NOTE)
        allowed_types = {choice[0] for choice in ContractorDirectoryOutreachLog.TYPE_CHOICES}
        if outreach_type not in allowed_types:
            return Response({"detail": "Unsupported outreach type."}, status=status.HTTP_400_BAD_REQUEST)
        log = ContractorDirectoryOutreachLog.objects.create(
            directory_entry=entry,
            outreach_type=outreach_type,
            destination=_null_if_blank(request.data.get("destination")),
            status=_null_if_blank(request.data.get("status")) or "logged",
            created_by=request.user,
            notes=_null_if_blank(request.data.get("notes")),
        )
        if outreach_type == ContractorDirectoryOutreachLog.TYPE_MANUAL_NOTE:
            entry.contact_status = ContractorDirectoryEntry.CONTACT_STATUS_MANUAL_REVIEW_NEEDED
            entry.outreach_notes = _null_if_blank(request.data.get("notes")) or entry.outreach_notes
            entry.save(update_fields=["contact_status", "outreach_notes", "last_seen_at"])
        return Response(
            {
                "id": log.id,
                "directory_entry_id": entry.id,
                "outreach_type": log.outreach_type,
                "destination": log.destination,
                "status": log.status,
                "notes": log.notes,
                "created_at": log.created_at,
                "entry": _directory_entry_payload(entry),
            },
            status=status.HTTP_200_OK,
        )


class AdminContractorDirectoryClaimLinkView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)
        token = generate_directory_claim_token(entry, generated_by=request.user)
        ContractorDirectoryOutreachLog.objects.create(
            directory_entry=entry,
            outreach_type=ContractorDirectoryOutreachLog.TYPE_CLAIM_LINK_COPIED,
            destination=token.claim_url_path,
            status="generated",
            created_by=request.user,
            notes="Claim link generated by admin.",
        )
        return Response(
            {
                "directory_entry_id": entry.id,
                "claim_token": str(token.token),
                "claim_url": token.claim_url_path,
                "status": token.status,
                "entry": _directory_entry_payload(entry),
            },
            status=status.HTTP_200_OK,
        )


class AdminContractorDirectoryJoinInviteView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            invite = send_marketplace_join_invite(
                entry=entry,
                sent_by=request.user,
                request=request,
                preferred_channel=request.data.get("preferred_channel") or "",
                resend=bool(request.data.get("resend")),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "detail": "Marketplace join invite processed.",
                "invite": join_invite_payload(invite, request=request),
                "entry": _directory_entry_payload(entry),
            },
            status=status.HTTP_200_OK,
        )


class AdminContractorDirectoryManualClaimView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, entry_id: int, *args, **kwargs):
        entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first()
        if entry is None:
            return Response({"detail": "Directory entry not found."}, status=status.HTTP_404_NOT_FOUND)
        entry = manually_mark_directory_entry_claimed(entry, contractor_id=request.data.get("contractor_id"))
        return Response(_directory_entry_payload(entry), status=status.HTTP_200_OK)


class ContractorDirectoryClaimView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token: str, *args, **kwargs):
        claim_token = ContractorDirectoryClaimToken.objects.select_related("directory_entry", "claimed_by_contractor").filter(token=token).first()
        if claim_token is None:
            return Response({"detail": "Claim link not found."}, status=status.HTTP_404_NOT_FOUND)
        join_invite = join_invite_for_claim_token(claim_token)
        if join_invite and join_invite.expires_at and join_invite.expires_at < timezone.now():
            if join_invite.status != join_invite.STATUS_CLAIMED:
                join_invite.status = join_invite.STATUS_EXPIRED
                join_invite.save(update_fields=["status", "updated_at"])
            return Response({"detail": "This marketplace join invite has expired."}, status=status.HTTP_410_GONE)
        entry = claim_token.directory_entry
        return Response(
            {
                "claim_token": str(claim_token.token),
                "status": claim_token.status,
                "invite_status": getattr(join_invite, "status", ""),
                "expires_at": getattr(join_invite, "expires_at", None),
                "claimed": entry.claimed,
                "directory_entry_id": entry.id,
                "business_name": entry.business_name,
                "city": entry.city or entry.service_city or "",
                "state": entry.state or entry.service_state or "",
                "project_summary": "",
                "project_mode": "",
                "claim_url": claim_token.claim_url_path,
                "prefill": directory_entry_prefill_payload(entry),
                "claimed_contractor_id": entry.claimed_by_contractor_id,
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request, token: str, *args, **kwargs):
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Sign in or create a contractor account to claim this profile."}, status=status.HTTP_401_UNAUTHORIZED)
        claim_token = ContractorDirectoryClaimToken.objects.select_related("directory_entry", "directory_entry__claimed_by_contractor").filter(token=token).first()
        if claim_token is None:
            return Response({"detail": "Claim link not found."}, status=status.HTTP_404_NOT_FOUND)
        join_invite = join_invite_for_claim_token(claim_token)
        if join_invite and join_invite.expires_at and join_invite.expires_at < timezone.now():
            if join_invite.status != join_invite.STATUS_CLAIMED:
                join_invite.status = join_invite.STATUS_EXPIRED
                join_invite.save(update_fields=["status", "updated_at"])
            return Response({"detail": "This marketplace join invite has expired."}, status=status.HTTP_410_GONE)
        try:
            result = claim_directory_entry_with_token(claim_token, user=request.user, payload=request.data)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        mark_join_invites_claimed_for_token(claim_token)
        return Response(result, status=status.HTTP_200_OK)


class AdminContractorDirectoryImportPreviewView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, *args, **kwargs):
        csv_text = _safe_text(request.data.get("csv_text"))
        uploaded = request.FILES.get("file") if hasattr(request, "FILES") else None
        if uploaded is not None:
            csv_text = uploaded.read().decode("utf-8-sig")
        if not csv_text:
            return Response({"detail": "Upload or paste CSV text first."}, status=status.HTTP_400_BAD_REQUEST)

        reader = csv.DictReader(io.StringIO(csv_text))
        if not reader.fieldnames:
            return Response({"detail": "Invalid CSV header."}, status=status.HTTP_400_BAD_REQUEST)
        rows = [_preview_import_row(row) for row in reader]
        matched_count = len([row for row in rows if row.get("matched_entry_id")])
        return Response({"results": rows, "count": len(rows), "matched_count": matched_count}, status=status.HTTP_200_OK)


class AdminContractorDirectoryImportApplyView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request, *args, **kwargs):
        rows = request.data.get("rows") or request.data.get("preview_rows") or []
        overwrite = bool(request.data.get("overwrite", False))
        updated_count = 0
        skipped_count = 0
        warnings = []

        if not isinstance(rows, list):
            return Response({"detail": "Rows must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        for row in rows:
            if not isinstance(row, dict):
                skipped_count += 1
                continue
            entry_id = row.get("matched_entry_id")
            entry = ContractorDirectoryEntry.objects.filter(pk=entry_id).first() if entry_id else None
            admin_approved = bool(row.get("admin_approved")) or row.get("status") == "admin_approved"
            if not admin_approved:
                skipped_count += 1
                continue
            if entry is None or row.get("status") not in {"ready", "admin_approved", "duplicate_email_warning"}:
                skipped_count += 1
                continue

            email_value, email_error = _normalize_email_value(row.get("proposed_public_email") or row.get("public_email"), reject_placeholder=True)
            if email_error:
                skipped_count += 1
                warnings.append(f"Entry #{entry.pk} skipped: {email_error}")
                continue
            if email_value and entry.public_email and entry.public_email.lower() != email_value.lower() and not overwrite and not admin_approved:
                skipped_count += 1
                warnings.append(f"Entry #{entry.pk} skipped because it already has an email.")
                continue

            if email_value:
                entry.public_email = email_value
            website_value = row.get("proposed_website") or row.get("website")
            if website_value:
                entry.website = _null_if_blank(website_value)
                entry.website_domain = _null_if_blank(normalize_website_domain(website_value))
            if row.get("proposed_phone") or row.get("phone"):
                entry.phone = _null_if_blank(row.get("proposed_phone") or row.get("phone"))
                entry.normalized_phone = _null_if_blank(normalize_phone(entry.phone))
            services = _parse_services(row.get("proposed_services") if "proposed_services" in row else row.get("services"))
            if services:
                entry.services = services
            primary_service = row.get("proposed_primary_service") or row.get("primary_service")
            if primary_service:
                entry.primary_service = _safe_text(primary_service)
                entry.service_normalization_status = ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL
            normalized_services = row.get("proposed_normalized_services") if "proposed_normalized_services" in row else row.get("normalized_services")
            normalized_services = _parse_label_list(normalized_services)
            if normalized_services:
                entry.normalized_services = normalized_services
                entry.service_normalization_status = ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL
            raw_services = row.get("proposed_raw_services") if "proposed_raw_services" in row else row.get("raw_services")
            raw_services = clean_raw_services(raw_services.replace(";", ",").split(",") if isinstance(raw_services, str) else raw_services)
            if raw_services:
                entry.raw_services = raw_services
            location_updates = row.get("proposed_location") if isinstance(row.get("proposed_location"), dict) else row
            for field in ["address_line1", "city", "state", "zip_code"]:
                value = location_updates.get(field) if isinstance(location_updates, dict) else None
                if field == "zip_code":
                    value = normalize_zip(value)
                if value not in (None, ""):
                    setattr(entry, field, normalize_state(value) if field == "state" else _safe_text(value))
            for field in ["email_source_url", "services_source_url", "enrichment_notes"]:
                if field in row:
                    setattr(entry, field, _null_if_blank(row.get(field)))
            manual_contact_fields = {}
            for field in ["contact_form_url", "preferred_outreach_method", "contact_status", "contact_confidence", "outreach_notes", "claim_readiness_status", "claim_readiness_notes"]:
                if field in row and _safe_text(row.get(field)):
                    setattr(entry, field, _null_if_blank(row.get(field)))
                    manual_contact_fields[field] = _null_if_blank(row.get(field))
            if "has_contact_form" in row:
                entry.has_contact_form = str(row.get("has_contact_form")).strip().lower() in {"true", "1", "yes", "y"}
            entry.enrichment_status = ContractorDirectoryEntry.ENRICHMENT_REVIEWED
            entry.enriched_at = timezone.now()
            entry.enriched_by = request.user
            entry.save()
            refresh_contactability(entry)
            if manual_contact_fields:
                for field, value in manual_contact_fields.items():
                    setattr(entry, field, value)
                entry.save(update_fields=[*manual_contact_fields.keys(), "last_seen_at"])
            updated_count += 1

        return Response(
            {"updated_count": updated_count, "skipped_count": skipped_count, "warnings": warnings},
            status=status.HTTP_200_OK,
        )


class ContractorOpportunityAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, opportunity_id: int, *args, **kwargs):
        contractor = getattr(request.user, "contractor_profile", None)
        if contractor is None:
            return Response({"detail": "Only contractors can accept opportunities."}, status=status.HTTP_403_FORBIDDEN)
        opportunity = ContractorOpportunity.objects.select_related("directory_entry", "property_work_order").filter(pk=opportunity_id).first()
        if opportunity is None:
            return Response({"detail": "Opportunity not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            result = accept_contractor_opportunity(opportunity, contractor)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        converted_opportunity = result["opportunity"]
        agreement = result.get("agreement")
        customer = result.get("customer")
        return Response(
            {
                "opportunity_id": converted_opportunity.id,
                "status": converted_opportunity.status,
                "customer_id": getattr(customer, "id", None),
                "agreement_id": getattr(agreement, "id", None),
                "next_url": f"/app/agreements/{agreement.id}/wizard?step=1" if agreement is not None else "",
                **_opportunity_payload(converted_opportunity),
            },
            status=status.HTTP_200_OK,
        )


class ContractorOpportunityListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = getattr(request.user, "contractor_profile", None)
        if contractor is None:
            return Response({"detail": "Only contractors can view opportunities."}, status=status.HTTP_403_FORBIDDEN)
        qs = ContractorOpportunity.objects.select_related("directory_entry", "property_work_order").filter(
            directory_entry__claimed_by_contractor=contractor
        ) | ContractorOpportunity.objects.select_related("directory_entry", "property_work_order").filter(
            accepted_by_contractor=contractor
        )
        qs = qs.distinct().order_by("-selected_at", "-id")
        for param, field in [
            ("status", "status"),
            ("project_type", "project_type__iexact"),
            ("project_subtype", "project_subtype__iexact"),
        ]:
            value = _safe_text(request.query_params.get(param))
            if value:
                qs = qs.filter(**{field: value})
        selected = _safe_text(request.query_params.get("selected_by_homeowner")).lower()
        if selected in {"true", "false"}:
            qs = qs.filter(selected_by_homeowner=selected == "true")
        return Response({"results": [_opportunity_payload(row) for row in qs[:100]]}, status=status.HTTP_200_OK)


class ContractorOpportunityDeclineView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, opportunity_id: int, *args, **kwargs):
        contractor = getattr(request.user, "contractor_profile", None)
        if contractor is None:
            return Response({"detail": "Only contractors can decline opportunities."}, status=status.HTTP_403_FORBIDDEN)
        opportunity = ContractorOpportunity.objects.select_related("directory_entry", "property_work_order").filter(pk=opportunity_id).first()
        if opportunity is None:
            return Response({"detail": "Opportunity not found."}, status=status.HTTP_404_NOT_FOUND)
        linked = opportunity.directory_entry.claimed_by_contractor_id == contractor.id or opportunity.accepted_by_contractor_id == contractor.id
        if not linked:
            return Response({"detail": "This opportunity is not linked to your contractor profile."}, status=status.HTTP_403_FORBIDDEN)
        if opportunity.converted_agreement_id:
            return Response({"detail": "Converted opportunities cannot be declined."}, status=status.HTTP_400_BAD_REQUEST)
        opportunity.status = ContractorOpportunity.STATUS_DECLINED
        opportunity.save(update_fields=["status", "updated_at"])
        work_order = opportunity.property_work_order
        if work_order is not None:
            now = timezone.now()
            pending_exists = ContractorOpportunity.objects.filter(property_work_order=work_order, status=ContractorOpportunity.STATUS_PENDING).exclude(pk=opportunity.pk).exists()
            if not pending_exists and work_order.marketplace_status == PropertyWorkOrder.MARKETPLACE_SENT:
                work_order.marketplace_status = PropertyWorkOrder.MARKETPLACE_DECLINED
                work_order.marketplace_response_at = now
                work_order.save(update_fields=["marketplace_status", "marketplace_response_at", "updated_at"])
            PropertyWorkOrderActivity.objects.create(
                work_order=work_order,
                activity_type=PropertyWorkOrderActivity.TYPE_MARKETPLACE_DECLINED,
                message=f"Marketplace opportunity declined by {contractor.business_name or contractor.name}.",
                actor=_safe_text(getattr(contractor.user, "email", "")).lower(),
            )
        return Response(_opportunity_payload(opportunity), status=status.HTTP_200_OK)


class AdminContractorOpportunityListView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request, *args, **kwargs):
        qs = ContractorOpportunity.objects.select_related("directory_entry", "converted_customer", "converted_agreement", "property_work_order").order_by("-selected_at")
        for param, field in [
            ("status", "status"),
            ("directory_entry", "directory_entry_id"),
            ("state", "project_state__iexact"),
            ("city", "project_city__iexact"),
            ("project_type", "project_type__iexact"),
        ]:
            value = _safe_text(request.query_params.get(param))
            if value:
                qs = qs.filter(**{field: value})
        selected_from = _safe_text(request.query_params.get("selected_from"))
        selected_to = _safe_text(request.query_params.get("selected_to"))
        if selected_from:
            qs = qs.filter(selected_at__date__gte=selected_from)
        if selected_to:
            qs = qs.filter(selected_at__date__lte=selected_to)
        try:
            limit = max(1, min(int(request.query_params.get("limit") or 100), 250))
        except (TypeError, ValueError):
            limit = 100
        return Response({"results": [_opportunity_payload(row) for row in qs[:limit]]}, status=status.HTTP_200_OK)


class ContractorDiscoveryClaimView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token: str):
        invite = ContractorDiscoveryInvite.objects.select_related(
            "public_intake",
            "contractor",
            "directory_listing",
            "directory_listing__claimed_contractor",
        ).filter(invite_token=token).first()
        if invite is None:
            return Response({"detail": "Invite not found."}, status=status.HTTP_404_NOT_FOUND)

        invite.touch_clicked()
        listing = invite.directory_listing
        contractor = invite.contractor or getattr(listing, "claimed_contractor", None)
        return Response(
            {
                "id": invite.id,
                "invite_token": str(invite.invite_token),
                "status": invite.status,
                "claimed": bool(invite.claimed_at),
                "contractor_name": getattr(contractor, "business_name", "") or getattr(contractor, "name", "") or getattr(listing, "business_name", ""),
                "business_name": getattr(listing, "business_name", "") or getattr(contractor, "business_name", ""),
                "city": getattr(listing, "city", "") or getattr(contractor, "city", ""),
                "state": getattr(listing, "state", "") or getattr(contractor, "state", ""),
                "project_summary": getattr(invite.public_intake, "accomplishment_text", "") or getattr(invite.public_intake, "ai_description", ""),
                "project_mode": getattr(invite.public_intake, "project_mode", "full_service"),
                "payment_preference": getattr(invite.public_intake, "payment_preference", "escrow"),
                "public_intake_id": getattr(invite.public_intake, "id", None),
                "directory_listing_id": getattr(listing, "id", None),
                "claim_url": invite.invite_url_path,
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request, token: str):
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Sign in to claim this listing."}, status=status.HTTP_401_UNAUTHORIZED)

        invite = ContractorDiscoveryInvite.objects.select_related(
            "public_intake",
            "contractor",
            "directory_listing",
            "directory_listing__claimed_contractor",
        ).filter(invite_token=token).first()
        if invite is None:
            return Response({"detail": "Invite not found."}, status=status.HTTP_404_NOT_FOUND)

        contractor = Contractor.objects.select_related("public_profile").filter(user=request.user).first()
        if contractor is None:
            return Response({"detail": "Only contractors can claim listings."}, status=status.HTTP_403_FORBIDDEN)

        result = claim_discovery_invite(invite, contractor=contractor)
        return Response(result, status=status.HTTP_200_OK)
