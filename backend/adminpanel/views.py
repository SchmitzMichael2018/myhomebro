from __future__ import annotations

from collections import defaultdict
from datetime import date as _date, timedelta
from decimal import Decimal
from typing import Any, Dict, Optional, List, Tuple

from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import PasswordResetForm
from django.db.models import Count, Max, Q, Sum
from django.http import FileResponse, Http404
from django.utils.timezone import now

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from .permissions import IsAdminUserRole
from .utils import safe_get
from projects.api.ai_agreement_views import _persist_pricing_estimates, suggest_pricing_refresh
from projects.services.agreements.contractor_signing import send_signature_request_to_homeowner

User = get_user_model()


# -------------------------------------------------------------------
# Model loaders (defensive + multi-app)
# -------------------------------------------------------------------
def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None


def _get_first_model(candidates: List[Tuple[str, str]]):
    for app_label, model_name in candidates:
        m = _get_model(app_label, model_name)
        if m is not None:
            return m
    return None


# Prefer current canonical locations; fall back to older layouts
Agreement = _get_first_model([("projects", "Agreement")])
Invoice = _get_first_model([("projects", "Invoice")])
Milestone = _get_first_model([("projects", "ProjectMilestone")])

# Contractor/Homeowner have moved around across builds: try both.
Contractor = _get_first_model([("projects", "Contractor"), ("accounts", "Contractor")])
Homeowner = _get_first_model([("projects", "Homeowner"), ("accounts", "Homeowner")])
ContractorPublicProfile = _get_first_model([("projects", "ContractorPublicProfile")])
PublicContractorLead = _get_first_model([("projects", "PublicContractorLead")])
ContractorReview = _get_first_model([("projects", "ContractorReview")])
ContractorGalleryItem = _get_first_model([("projects", "ContractorGalleryItem")])
Project = _get_first_model([("projects", "Project")])
SubcontractorInvitation = _get_first_model([("projects", "SubcontractorInvitation")])

# Dispute may be a model or derived from invoices
Dispute = _get_first_model([("projects", "Dispute")])

# Payments/Receipts apps
Receipt = _get_first_model([("receipts", "Receipt")])
Payment = _get_first_model([("payments", "Payment")])
Refund = _get_first_model([("payments", "Refund")])


# -------------------------------------------------------------------
# Money helpers
# -------------------------------------------------------------------
D0 = Decimal("0.00")
HUNDRED = Decimal("100")


def _to_dec(value) -> Decimal:
    try:
        if value is None:
            return D0
        return Decimal(str(value)).quantize(D0)
    except Exception:
        return D0


def _cents_to_dollars_dec(cents: int) -> Decimal:
    try:
        return (Decimal(int(cents or 0)) / HUNDRED).quantize(D0)
    except Exception:
        return D0


def _fmt_money(dec: Decimal) -> str:
    try:
        return f"{Decimal(str(dec)).quantize(D0):.2f}"
    except Exception:
        return "0.00"


def parse_date(value: str) -> Optional[_date]:
    """
    Safe date parser for query params like 'YYYY-MM-DD'.
    Returns None if invalid.
    """
    try:
        value = (value or "").strip()
        if not value:
            return None
        parts = value.split("-")
        if len(parts) != 3:
            return None
        y, m, d = (int(parts[0]), int(parts[1]), int(parts[2]))
        return _date(y, m, d)
    except Exception:
        return None


def _invoice_released_q() -> Q:
    """
    Released = money left escrow to contractor.
    Hard signals:
      - escrow_released True
      - escrow_released_at not null
      - stripe_transfer_id not blank
      - status == 'paid'
    """
    q = Q()
    q |= Q(escrow_released=True)
    q |= Q(escrow_released_at__isnull=False)
    q |= Q(stripe_transfer_id__isnull=False) & ~Q(stripe_transfer_id="")
    q |= Q(status="paid")
    return q


def _invoice_disputed_q() -> Q:
    q = Q()
    q |= Q(status="disputed")
    q |= Q(disputed=True)
    return q


def _get_project_geo(project) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Best-effort extraction of city/state/zip from Project model.
    Tries multiple common field names.
    """
    city = safe_get(project, ["city", "project_city", "address_city"], None)
    state = safe_get(project, ["state", "project_state", "address_state"], None)
    zipc = safe_get(project, ["zip", "zip_code", "zipcode", "postal_code", "project_zip"], None)
    if city:
        city = str(city).strip()
    if state:
        state = str(state).strip().upper()
    if zipc:
        zipc = str(zipc).strip()
    return city, state, zipc


def _to_iso(value):
    try:
        return value.isoformat() if value is not None else None
    except Exception:
        return value


def _month_start(anchor: _date, months_back: int = 0) -> _date:
    year = anchor.year
    month = anchor.month - months_back
    while month <= 0:
        month += 12
        year -= 1
    return _date(year, month, 1)


def _contractor_display(contractor) -> str:
    return (
        safe_get(contractor, ["business_name", "name"], None)
        or safe_get(getattr(contractor, "user", None), ["email"], None)
        or f"Contractor #{safe_get(contractor, ['id'], '')}"
    )


def _homeowner_display(homeowner) -> str:
    return (
        safe_get(homeowner, ["full_name", "name"], None)
        or safe_get(homeowner, ["email"], None)
        or f"Customer #{safe_get(homeowner, ['id'], '')}"
    )


def _account_status(contractor) -> str:
    if contractor is None:
        return "unknown"
    if getattr(contractor, "stripe_deauthorized_at", None):
        return "deauthorized"
    if bool(getattr(contractor, "charges_enabled", False)) and bool(
        getattr(contractor, "payouts_enabled", False)
    ):
        return "active"
    if bool(getattr(contractor, "details_submitted", False)):
        return "pending_stripe"
    return "not_onboarded"


def _public_profile_status(profile) -> str:
    if profile is None:
        return "missing"
    if bool(getattr(profile, "is_public", False)):
        return "public"
    return "private"


def _is_active_agreement(agreement) -> bool:
    status_value = str(getattr(agreement, "status", "") or "").strip().lower()
    if bool(getattr(agreement, "is_archived", False)):
        return False
    return status_value not in {"completed", "cancelled", "canceled", "closed", "archived"}


def _is_open_dispute_status(status_value: str) -> bool:
    return str(status_value or "").strip().lower() not in {
        "resolved_contractor",
        "resolved_homeowner",
        "resolved",
        "closed",
        "canceled",
        "cancelled",
    }


# -------------------------------------------------------------------
# Views
# -------------------------------------------------------------------
class AdminOverview(APIView):
    """
    Stripe-accurate admin metrics.

    Financial sources of truth:
      - Escrow funded: Agreement.escrow_funded_amount
      - Escrow released: Invoice.amount where released signals are present
      - Escrow refunded: payments.Refund.amount_cents (succeeded) [if installed]
      - Gross paid revenue: receipts.Receipt.amount_paid_cents
      - Platform fees: receipts.Receipt.platform_fee_cents
    """
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        today = now().date()
        week_start = today - timedelta(days=today.weekday())
        month_start = today.replace(day=1)
        data: Dict[str, Any] = {
            "generated_at": now().isoformat(),
            "counts": {
                "contractors": 0,
                "homeowners": 0,
                "agreements": 0,
                "invoices": 0,
                "disputes": 0,
                "receipts": 0,
                "refunds": 0,
                "subcontractors": 0,
            },
            "money": {
                "gross_paid_revenue": "0.00",
                "platform_fee_total": "0.00",
                "escrow_funded_total": "0.00",
                "escrow_released_total": "0.00",
                "escrow_refunded_total": "0.00",
                "escrow_in_flight_total": "0.00",
                "platform_fee_this_month": "0.00",
            },
            "summary": {
                "new_contractors_this_week": 0,
                "new_contractors_this_month": 0,
                "active_agreements": 0,
                "open_disputes": 0,
                "leads_this_month": 0,
                "agreements_this_month": 0,
            },
            "fee_trend": [],
            "fee_by_contractor": [],
            "fee_by_payment_mode": [],
            "top_categories": [],
            "top_regions": [],
            "insights": [],
            "admin_views": {
                "contractors": "contractors",
                "subcontractors": "subcontractors",
                "homeowners": "homeowners",
                "agreements": "agreements",
                "disputes": "disputes",
                "fee_audit": "fee_audit",
                "geo": "geo",
            },
        }

        # Counts
        if Contractor is not None:
            data["counts"]["contractors"] = Contractor.objects.count()
        if Homeowner is not None:
            data["counts"]["homeowners"] = Homeowner.objects.count()
        if Agreement is not None:
            data["counts"]["agreements"] = Agreement.objects.count()
        if Invoice is not None:
            data["counts"]["invoices"] = Invoice.objects.count()

        if Dispute is not None:
            data["counts"]["disputes"] = Dispute.objects.count()
        elif Invoice is not None:
            data["counts"]["disputes"] = Invoice.objects.filter(_invoice_disputed_q()).count()

        if Receipt is not None:
            data["counts"]["receipts"] = Receipt.objects.count()
        if Refund is not None:
            data["counts"]["refunds"] = Refund.objects.count()
        if SubcontractorInvitation is not None:
            data["counts"]["subcontractors"] = SubcontractorInvitation.objects.count()

        # Money: escrow funded
        funded_total = D0
        if Agreement is not None and hasattr(Agreement, "escrow_funded_amount"):
            agg = Agreement.objects.aggregate(total=Sum("escrow_funded_amount"))
            funded_total = _to_dec(agg.get("total"))

        # Money: escrow released
        released_total = D0
        if Invoice is not None and hasattr(Invoice, "amount"):
            agg = Invoice.objects.filter(_invoice_released_q()).aggregate(total=Sum("amount"))
            released_total = _to_dec(agg.get("total"))

        # Money: escrow refunded
        refunded_total = D0
        if Refund is not None:
            try:
                agg = Refund.objects.filter(status="succeeded").aggregate(total=Sum("amount_cents"))
                refunded_total = _cents_to_dollars_dec(int(agg.get("total") or 0))
            except Exception:
                refunded_total = D0

        # Money: paid revenue + platform fees (from Receipt)
        gross_paid = D0
        platform_fee = D0
        platform_fee_this_month = D0
        if Receipt is not None:
            try:
                agg_paid = Receipt.objects.aggregate(total=Sum("amount_paid_cents"))
                gross_paid = _cents_to_dollars_dec(int(agg_paid.get("total") or 0))
            except Exception:
                gross_paid = D0

            try:
                agg_fee = Receipt.objects.aggregate(total=Sum("platform_fee_cents"))
                platform_fee = _cents_to_dollars_dec(int(agg_fee.get("total") or 0))
            except Exception:
                platform_fee = D0
            try:
                agg_fee_month = Receipt.objects.filter(created_at__date__gte=month_start).aggregate(total=Sum("platform_fee_cents"))
                platform_fee_this_month = _cents_to_dollars_dec(int(agg_fee_month.get("total") or 0))
            except Exception:
                platform_fee_this_month = D0

        # In flight
        in_flight = funded_total - released_total - refunded_total
        if in_flight < D0:
            in_flight = D0

        data["money"]["gross_paid_revenue"] = _fmt_money(gross_paid)
        data["money"]["platform_fee_total"] = _fmt_money(platform_fee)
        data["money"]["escrow_funded_total"] = _fmt_money(funded_total)
        data["money"]["escrow_released_total"] = _fmt_money(released_total)
        data["money"]["escrow_refunded_total"] = _fmt_money(refunded_total)
        data["money"]["escrow_in_flight_total"] = _fmt_money(in_flight)
        data["money"]["platform_fee_this_month"] = _fmt_money(platform_fee_this_month)

        contractor_stats: Dict[int, Dict[str, Any]] = {}
        if Contractor is not None:
            for contractor in Contractor.objects.all():
                contractor_stats[contractor.id] = {
                    "name": _contractor_display(contractor),
                    "lead_count": 0,
                    "agreement_count": 0,
                    "fee_cents": 0,
                    "latest_activity": safe_get(contractor, ["updated_at", "created_at"], None),
                    "profile_missing": True,
                    "profile_private": False,
                    "gallery_count": 0,
                    "review_count": 0,
                }
            if hasattr(Contractor, "created_at"):
                data["summary"]["new_contractors_this_week"] = Contractor.objects.filter(created_at__date__gte=week_start).count()
                data["summary"]["new_contractors_this_month"] = Contractor.objects.filter(created_at__date__gte=month_start).count()

        if ContractorPublicProfile is not None and contractor_stats:
            for profile in ContractorPublicProfile.objects.select_related("contractor").all():
                stats = contractor_stats.get(profile.contractor_id)
                if stats is None:
                    continue
                stats["profile_missing"] = False
                stats["profile_private"] = not bool(getattr(profile, "is_public", False))
                profile_time = safe_get(profile, ["updated_at", "created_at"], None)
                if profile_time and (stats["latest_activity"] is None or profile_time > stats["latest_activity"]):
                    stats["latest_activity"] = profile_time

        if ContractorGalleryItem is not None and contractor_stats:
            for row in ContractorGalleryItem.objects.values("contractor_id").annotate(total=Count("id")):
                if row["contractor_id"] in contractor_stats:
                    contractor_stats[row["contractor_id"]]["gallery_count"] = int(row["total"] or 0)

        if ContractorReview is not None and contractor_stats:
            for row in ContractorReview.objects.values("contractor_id").annotate(total=Count("id")):
                if row["contractor_id"] in contractor_stats:
                    contractor_stats[row["contractor_id"]]["review_count"] = int(row["total"] or 0)

        if PublicContractorLead is not None:
            data["summary"]["leads_this_month"] = PublicContractorLead.objects.filter(created_at__date__gte=month_start).count()
            for row in PublicContractorLead.objects.values("contractor_id").annotate(total=Count("id"), latest=Max("updated_at")):
                stats = contractor_stats.get(row["contractor_id"])
                if stats is None:
                    continue
                stats["lead_count"] = int(row["total"] or 0)
                latest = row.get("latest")
                if latest and (stats["latest_activity"] is None or latest > stats["latest_activity"]):
                    stats["latest_activity"] = latest

        active_agreements = 0
        category_fee_cents = defaultdict(int)
        region_fee_cents = defaultdict(int)
        if Agreement is not None:
            agreements = list(Agreement.objects.select_related("project", "contractor").all())
            data["summary"]["agreements_this_month"] = sum(
                1 for agreement in agreements if safe_get(agreement, ["created_at"], None) and agreement.created_at.date() >= month_start
            )
            for agreement in agreements:
                if _is_active_agreement(agreement):
                    active_agreements += 1
                contractor_id = getattr(agreement, "contractor_id", None)
                if contractor_id in contractor_stats:
                    contractor_stats[contractor_id]["agreement_count"] += 1
                    latest = safe_get(agreement, ["updated_at", "created_at"], None)
                    if latest and (
                        contractor_stats[contractor_id]["latest_activity"] is None
                        or latest > contractor_stats[contractor_id]["latest_activity"]
                    ):
                        contractor_stats[contractor_id]["latest_activity"] = latest
            data["summary"]["active_agreements"] = active_agreements

        open_disputes = 0
        dispute_count_by_contractor = defaultdict(int)
        if Dispute is not None:
            for dispute in Dispute.objects.select_related("agreement", "agreement__contractor").all():
                if _is_open_dispute_status(getattr(dispute, "status", "")):
                    open_disputes += 1
                contractor_id = safe_get(getattr(dispute, "agreement", None), ["contractor_id"], None)
                if contractor_id:
                    dispute_count_by_contractor[contractor_id] += 1
        elif Invoice is not None:
            open_disputes = Invoice.objects.filter(_invoice_disputed_q()).count()
        data["summary"]["open_disputes"] = open_disputes

        if Receipt is not None:
            month_buckets = {
                _month_start(today, months_back): {
                    "label": _month_start(today, months_back).strftime("%b %Y"),
                    "fee_cents": 0,
                    "gross_cents": 0,
                }
                for months_back in range(5, -1, -1)
            }
            fee_by_payment_mode = defaultdict(int)
            receipts = list(
                Receipt.objects.select_related("agreement", "agreement__contractor", "agreement__project").order_by("-created_at")[:20000]
            )
            for receipt in receipts:
                fee_cents = int(getattr(receipt, "platform_fee_cents", 0) or 0)
                gross_cents = int(getattr(receipt, "amount_paid_cents", 0) or 0)
                created_at = safe_get(receipt, ["created_at"], None)
                if created_at:
                    bucket = month_buckets.get(_month_start(created_at.date(), 0))
                    if bucket is not None:
                        bucket["fee_cents"] += fee_cents
                        bucket["gross_cents"] += gross_cents
                agreement = getattr(receipt, "agreement", None)
                contractor_id = getattr(agreement, "contractor_id", None) if agreement else None
                if contractor_id in contractor_stats:
                    contractor_stats[contractor_id]["fee_cents"] += fee_cents
                payment_mode = str(getattr(agreement, "payment_mode", "") or "unknown")
                fee_by_payment_mode[payment_mode] += fee_cents
                category = (
                    getattr(agreement, "standardized_category", None)
                    or getattr(agreement, "project_type", None)
                    or safe_get(getattr(agreement, "project", None), ["title"], None)
                    or "Unknown"
                )
                category_fee_cents[str(category).strip() or "Unknown"] += fee_cents
                project = getattr(agreement, "project", None)
                _, region_state, _ = _get_project_geo(project)
                region_fee_cents[region_state or "Unknown"] += fee_cents

            data["fee_trend"] = [
                {
                    "label": bucket["label"],
                    "platform_fee": _fmt_money(_cents_to_dollars_dec(bucket["fee_cents"])),
                    "gross_paid": _fmt_money(_cents_to_dollars_dec(bucket["gross_cents"])),
                }
                for _, bucket in sorted(month_buckets.items())
            ]
            data["fee_by_payment_mode"] = [
                {
                    "payment_mode": mode,
                    "platform_fee": _fmt_money(_cents_to_dollars_dec(total_cents)),
                }
                for mode, total_cents in sorted(fee_by_payment_mode.items(), key=lambda item: item[1], reverse=True)
            ]

        data["fee_by_contractor"] = [
            {
                "contractor_id": contractor_id,
                "contractor_name": stats["name"],
                "platform_fee": _fmt_money(_cents_to_dollars_dec(stats["fee_cents"])),
                "lead_count": stats["lead_count"],
                "agreement_count": stats["agreement_count"],
            }
            for contractor_id, stats in sorted(contractor_stats.items(), key=lambda item: item[1]["fee_cents"], reverse=True)[:8]
        ]
        data["top_categories"] = [
            {"category": category, "platform_fee": _fmt_money(_cents_to_dollars_dec(total_cents))}
            for category, total_cents in sorted(category_fee_cents.items(), key=lambda item: item[1], reverse=True)[:5]
        ]
        data["top_regions"] = [
            {"region": region, "platform_fee": _fmt_money(_cents_to_dollars_dec(total_cents))}
            for region, total_cents in sorted(region_fee_cents.items(), key=lambda item: item[1], reverse=True)[:5]
        ]

        missing_profile_count = sum(1 for stats in contractor_stats.values() if stats["profile_missing"])
        private_profile_count = sum(1 for stats in contractor_stats.values() if stats["profile_private"])
        leads_no_agreements_count = sum(1 for stats in contractor_stats.values() if stats["lead_count"] > 0 and stats["agreement_count"] == 0)
        inactive_promising_count = sum(
            1
            for stats in contractor_stats.values()
            if (stats["lead_count"] >= 2 or stats["fee_cents"] > 0)
            and stats["latest_activity"]
            and (today - stats["latest_activity"].date()).days >= 21
        )
        insights = []
        if missing_profile_count:
            insights.append({
                "tone": "warn",
                "title": f"{missing_profile_count} contractor profiles still need setup",
                "detail": "These signups are less likely to convert until their public presence is finished.",
                "view": "contractors",
            })
        if leads_no_agreements_count:
            insights.append({
                "tone": "warn",
                "title": f"{leads_no_agreements_count} contractors have leads but no agreements",
                "detail": "They are attracting demand but not moving work into signed or draft agreements.",
                "view": "contractors",
            })
        if private_profile_count:
            insights.append({
                "tone": "neutral",
                "title": f"{private_profile_count} contractor profiles are private",
                "detail": "Review public visibility, intake, gallery, and reviews to unlock organic conversion.",
                "view": "contractors",
            })
        if data["top_categories"]:
            top_category = data["top_categories"][0]
            insights.append({
                "tone": "good",
                "title": f"{top_category['category']} is the top fee category",
                "detail": f"Platform fees are strongest here at ${top_category['platform_fee']}.",
                "view": "agreements",
            })
        if data["top_regions"]:
            top_region = data["top_regions"][0]
            insights.append({
                "tone": "good",
                "title": f"{top_region['region']} is the strongest fee region",
                "detail": "Use this market as a benchmark for recruiting and activation.",
                "view": "geo",
            })
        if dispute_count_by_contractor:
            contractor_id, total = max(dispute_count_by_contractor.items(), key=lambda item: item[1])
            contractor_name = contractor_stats.get(contractor_id, {}).get("name") or f"Contractor #{contractor_id}"
            insights.append({
                "tone": "bad" if total >= 2 else "warn",
                "title": f"{contractor_name} leads current dispute volume",
                "detail": f"{total} dispute(s) are tied to this contractor right now.",
                "view": "disputes",
            })
        if inactive_promising_count:
            insights.append({
                "tone": "warn",
                "title": f"{inactive_promising_count} promising contractors look inactive",
                "detail": "They have prior lead or fee activity but no meaningful movement in the last 21 days.",
                "view": "contractors",
            })
        data["insights"] = insights[:6]

        return Response(data, status=status.HTTP_200_OK)


class AdminContractors(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if Contractor is None:
            return Response(
                {"count": 0, "results": [], "warning": "Contractor model not found in this deployment."},
                status=status.HTTP_200_OK,
            )

        qs = Contractor.objects.select_related("user").all()
        if hasattr(Contractor, "created_at"):
            qs = qs.order_by("-created_at")
        else:
            qs = qs.order_by("-id")

        contractors = list(qs[:500])
        contractor_ids = [contractor.id for contractor in contractors]
        profile_by_contractor_id = {}
        lead_counts = defaultdict(int)
        agreement_counts = defaultdict(int)
        fee_cents_by_contractor = defaultdict(int)
        latest_activity = {}
        gallery_counts = defaultdict(int)
        review_counts = defaultdict(int)

        if ContractorPublicProfile is not None and contractor_ids:
            for profile in ContractorPublicProfile.objects.filter(contractor_id__in=contractor_ids):
                profile_by_contractor_id[profile.contractor_id] = profile
                profile_time = safe_get(profile, ["updated_at", "created_at"], None)
                if profile_time:
                    latest_activity[profile.contractor_id] = profile_time

        if PublicContractorLead is not None and contractor_ids:
            for row in PublicContractorLead.objects.filter(contractor_id__in=contractor_ids).values("contractor_id").annotate(
                total=Count("id"),
                latest=Max("updated_at"),
            ):
                lead_counts[row["contractor_id"]] = int(row["total"] or 0)
                if row.get("latest"):
                    latest_activity[row["contractor_id"]] = max(
                        latest_activity.get(row["contractor_id"]) or row["latest"],
                        row["latest"],
                    )

        if Agreement is not None and contractor_ids:
            for row in Agreement.objects.filter(contractor_id__in=contractor_ids).values("contractor_id").annotate(
                total=Count("id"),
                latest=Max("updated_at"),
            ):
                agreement_counts[row["contractor_id"]] = int(row["total"] or 0)
                if row.get("latest"):
                    latest_activity[row["contractor_id"]] = max(
                        latest_activity.get(row["contractor_id"]) or row["latest"],
                        row["latest"],
                    )

        if Receipt is not None and contractor_ids:
            for row in Receipt.objects.filter(agreement__contractor_id__in=contractor_ids).values("agreement__contractor_id").annotate(
                total=Sum("platform_fee_cents")
            ):
                fee_cents_by_contractor[row["agreement__contractor_id"]] = int(row["total"] or 0)

        if ContractorGalleryItem is not None and contractor_ids:
            for row in ContractorGalleryItem.objects.filter(contractor_id__in=contractor_ids).values("contractor_id").annotate(total=Count("id")):
                gallery_counts[row["contractor_id"]] = int(row["total"] or 0)

        if ContractorReview is not None and contractor_ids:
            for row in ContractorReview.objects.filter(contractor_id__in=contractor_ids).values("contractor_id").annotate(total=Count("id")):
                review_counts[row["contractor_id"]] = int(row["total"] or 0)

        items = []
        for c in contractors:
            user = safe_get(c, ["user"], None)
            profile = profile_by_contractor_id.get(c.id)
            recent_activity = latest_activity.get(c.id) or safe_get(c, ["updated_at", "created_at"], None)

            items.append({
                "id": safe_get(c, ["id"], None),
                "created_at": _to_iso(safe_get(c, ["created_at"], None)),
                "name": safe_get(c, ["name"], None),
                "business_name": safe_get(c, ["business_name", "company_name"], None),
                "email": safe_get(c, ["email"], None) or safe_get(user, ["email"], None),
                "phone": safe_get(c, ["phone", "phone_number"], None),
                "city": safe_get(c, ["city"], None),
                "state": safe_get(c, ["state"], None),
                "zip": safe_get(c, ["zip_code", "zipcode", "postal_code"], None),
                "stripe_account_id": safe_get(c, ["stripe_account_id"], None),
                "charges_enabled": safe_get(c, ["charges_enabled"], None),
                "payouts_enabled": safe_get(c, ["payouts_enabled"], None),
                "details_submitted": safe_get(c, ["details_submitted"], None),
                "requirements_due_count": safe_get(c, ["requirements_due_count"], None),
                "account_status": _account_status(c),
                "public_profile_status": _public_profile_status(profile),
                "public_profile_slug": safe_get(profile, ["slug"], None) if profile else None,
                "public_profile_is_public": bool(getattr(profile, "is_public", False)) if profile else False,
                "allow_public_intake": bool(getattr(profile, "allow_public_intake", False)) if profile else False,
                "allow_public_reviews": bool(getattr(profile, "allow_public_reviews", False)) if profile else False,
                "gallery_count": gallery_counts.get(c.id, 0),
                "review_count": review_counts.get(c.id, 0),
                "lead_count": lead_counts.get(c.id, 0),
                "agreement_count": agreement_counts.get(c.id, 0),
                "fee_revenue": _fmt_money(_cents_to_dollars_dec(fee_cents_by_contractor.get(c.id, 0))),
                "recent_activity_at": _to_iso(recent_activity),
            })

        return Response({"count": len(items), "results": items}, status=status.HTTP_200_OK)


class AdminHomeowners(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if Homeowner is None:
            return Response(
                {"count": 0, "results": [], "warning": "Homeowner model not found in this deployment."},
                status=status.HTTP_200_OK,
            )

        qs = Homeowner.objects.select_related("created_by", "created_by__user").all()
        if hasattr(Homeowner, "created_at"):
            qs = qs.order_by("-created_at")
        else:
            qs = qs.order_by("-id")

        homeowners = list(qs[:500])
        homeowner_ids = [homeowner.id for homeowner in homeowners]
        lead_counts = defaultdict(int)
        agreement_counts = defaultdict(int)
        project_counts = defaultdict(int)

        if PublicContractorLead is not None and homeowner_ids:
            for row in PublicContractorLead.objects.filter(converted_homeowner_id__in=homeowner_ids).values("converted_homeowner_id").annotate(total=Count("id")):
                lead_counts[row["converted_homeowner_id"]] = int(row["total"] or 0)

        if Agreement is not None and homeowner_ids:
            for row in Agreement.objects.filter(homeowner_id__in=homeowner_ids).values("homeowner_id").annotate(total=Count("id")):
                agreement_counts[row["homeowner_id"]] = int(row["total"] or 0)

        if Project is not None and homeowner_ids:
            for row in Project.objects.filter(homeowner_id__in=homeowner_ids).values("homeowner_id").annotate(total=Count("id")):
                project_counts[row["homeowner_id"]] = int(row["total"] or 0)

        results = []
        for h in homeowners:
            created_by = safe_get(h, ["created_by"], None)
            results.append({
                "id": safe_get(h, ["id"], None),
                "created_at": _to_iso(safe_get(h, ["created_at"], None)),
                "name": safe_get(h, ["full_name", "name"], None),
                "email": safe_get(h, ["email"], None),
                "phone": safe_get(h, ["phone_number", "phone"], None),
                "city": safe_get(h, ["city"], None),
                "state": safe_get(h, ["state"], None),
                "zip": safe_get(h, ["zip_code", "zipcode", "postal_code"], None),
                "created_by_contractor_id": safe_get(created_by, ["id"], None) if created_by else None,
                "contractor_name": _contractor_display(created_by) if created_by else "",
                "lead_count": lead_counts.get(h.id, 0),
                "agreement_count": agreement_counts.get(h.id, 0),
                "project_count": project_counts.get(h.id, 0),
                "status": safe_get(h, ["status"], None),
            })

        return Response({"count": len(results), "results": results}, status=status.HTTP_200_OK)


class AdminSubcontractors(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if SubcontractorInvitation is None:
            return Response(
                {"count": 0, "results": [], "warning": "Subcontractor invitations are not available in this deployment."},
                status=status.HTTP_200_OK,
            )

        invitations = list(
            SubcontractorInvitation.objects.select_related(
                "contractor",
                "contractor__user",
                "agreement",
                "agreement__project",
                "accepted_by_user",
            ).order_by("-invited_at")[:500]
        )
        invitation_ids = [invitation.id for invitation in invitations]
        assigned_counts = defaultdict(int)
        latest_activity = {}

        if Milestone is not None and invitation_ids:
            for row in Milestone.objects.filter(assigned_subcontractor_invitation_id__in=invitation_ids).values(
                "assigned_subcontractor_invitation_id"
            ).annotate(total=Count("id"), latest=Max("updated_at")):
                invitation_id = row["assigned_subcontractor_invitation_id"]
                assigned_counts[invitation_id] = int(row["total"] or 0)
                latest_activity[invitation_id] = row.get("latest")

        results = []
        for invitation in invitations:
            agreement = getattr(invitation, "agreement", None)
            project = getattr(agreement, "project", None) if agreement else None
            accepted_user = getattr(invitation, "accepted_by_user", None)
            display_name = (
                (getattr(accepted_user, "get_full_name", lambda: "")() or "").strip()
                or getattr(accepted_user, "email", "")
                or invitation.invite_name
                or invitation.invite_email
            )
            latest = latest_activity.get(invitation.id) or invitation.accepted_at or invitation.invited_at
            effective_status = getattr(invitation, "effective_status", None) or getattr(invitation, "status", "")
            results.append(
                {
                    "id": invitation.id,
                    "name": display_name,
                    "email": invitation.invite_email,
                    "contractor_id": invitation.contractor_id,
                    "contractor_name": _contractor_display(getattr(invitation, "contractor", None)),
                    "agreement_id": invitation.agreement_id,
                    "agreement_title": safe_get(project, ["title"], None) or f"Agreement #{invitation.agreement_id}",
                    "status": effective_status,
                    "assigned_work_count": assigned_counts.get(invitation.id, 0),
                    "invited_at": _to_iso(invitation.invited_at),
                    "accepted_at": _to_iso(invitation.accepted_at),
                    "recent_activity_at": _to_iso(latest),
                }
            )

        return Response({"count": len(results), "results": results}, status=status.HTTP_200_OK)


class AdminAgreements(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if Agreement is None:
            return Response(
                {"count": 0, "results": [], "warning": "Agreement model not found in this deployment."},
                status=status.HTTP_200_OK,
            )

        qs = Agreement.objects.all().order_by("-updated_at")[:500]

        results = []
        for a in qs:
            funded_amt = _to_dec(getattr(a, "escrow_funded_amount", None))

            released_amt = D0
            if Invoice is not None:
                try:
                    agg = Invoice.objects.filter(agreement_id=a.id).filter(_invoice_released_q()).aggregate(total=Sum("amount"))
                    released_amt = _to_dec(agg.get("total"))
                except Exception:
                    released_amt = D0

            refunded_amt = D0
            if Refund is not None and Payment is not None:
                try:
                    agg = Refund.objects.filter(payment__agreement_id=a.id, status="succeeded").aggregate(total=Sum("amount_cents"))
                    refunded_amt = _cents_to_dollars_dec(int(agg.get("total") or 0))
                except Exception:
                    refunded_amt = D0

            in_flight = funded_amt - released_amt - refunded_amt
            if in_flight < D0:
                in_flight = D0

            contractor_signed = bool(getattr(a, "signed_by_contractor", False))
            homeowner_signed = bool(getattr(a, "signed_by_homeowner", False))

            pdf_field = safe_get(a, ["pdf_file"], None)
            pdf_name = getattr(pdf_field, "name", None) if pdf_field else None

            total_cost = _to_dec(getattr(a, "total_cost", None))
            project = getattr(a, "project", None)
            project_title = safe_get(project, ["title"], None) or f"Agreement #{a.id}"

            project_city, project_state, project_zip = _get_project_geo(project)

            results.append({
                "id": a.id,
                "project_title": project_title,
                "project_city": project_city,
                "project_state": project_state,
                "project_zip": project_zip,
                "source_lead_id": safe_get(a, ["source_lead_id"], None),

                "created_at": safe_get(a, ["created_at"], None),
                "updated_at": safe_get(a, ["updated_at"], None),
                "total_cost": _fmt_money(total_cost),

                "escrow_funded": bool(getattr(a, "escrow_funded", False)),
                "escrow_funded_amount": _fmt_money(funded_amt),
                "escrow_released_amount": _fmt_money(released_amt),
                "escrow_refunded_amount": _fmt_money(refunded_amt),
                "escrow_in_flight_amount": _fmt_money(in_flight),

                "contractor_signed": contractor_signed,
                "homeowner_signed": homeowner_signed,

                "pdf_available": bool(pdf_name),
                "pdf_version": int(getattr(a, "pdf_version", 0) or 0),
                "is_archived": bool(getattr(a, "is_archived", False)),
                "amendment_number": int(getattr(a, "amendment_number", 0) or 0),
            })

        return Response({"count": len(results), "results": results}, status=status.HTTP_200_OK)


class AdminGeo(APIView):
    """
    Revenue-weighted geo summary (state → city → zip) based on project address.
    Uses last 365 days of Agreements/Receipts.
    """
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if Agreement is None or Receipt is None:
            return Response(
                {"generated_at": now().isoformat(), "states": [], "cities_by_state": {}, "zips_by_state": {},
                 "warning": "Agreement or Receipt model not available."},
                status=status.HTTP_200_OK,
            )

        start = now() - timedelta(days=365)

        escrow_by_state = defaultdict(lambda: D0)
        escrow_by_city = defaultdict(lambda: D0)
        escrow_by_zip = defaultdict(lambda: D0)
        agreements_by_state = defaultdict(int)
        agreements_by_city = defaultdict(int)
        agreements_by_zip = defaultdict(int)

        # Agreements (escrow)
        qs_a = Agreement.objects.filter(created_at__gte=start).select_related("project")
        qs_a = qs_a.only("id", "created_at", "project", "escrow_funded_amount")

        for a in qs_a:
          project = getattr(a, "project", None)
          city, state, zipc = _get_project_geo(project)
          if not state:
              continue

          escrow_amt = _to_dec(getattr(a, "escrow_funded_amount", None))
          escrow_by_state[state] += escrow_amt
          agreements_by_state[state] += 1

          if city:
              escrow_by_city[(city, state)] += escrow_amt
              agreements_by_city[(city, state)] += 1

          if zipc:
              escrow_by_zip[(zipc, state)] += escrow_amt
              agreements_by_zip[(zipc, state)] += 1

        # Receipts (platform fees)
        fees_by_state = defaultdict(lambda: D0)
        fees_by_city = defaultdict(lambda: D0)
        fees_by_zip = defaultdict(lambda: D0)

        qs_r = Receipt.objects.filter(created_at__gte=start).select_related(
            "agreement",
            "agreement__project",
        ).only("created_at", "platform_fee_cents", "agreement", "agreement__project")

        # Safety limit to keep admin snappy
        qs_r = qs_r.order_by("-created_at")[:10000]

        for r in qs_r:
            fee = _cents_to_dollars_dec(int(getattr(r, "platform_fee_cents", 0) or 0))
            ag = getattr(r, "agreement", None)
            project = getattr(ag, "project", None) if ag else None
            city, state, zipc = _get_project_geo(project)
            if not state:
                continue
            fees_by_state[state] += fee
            if city:
                fees_by_city[(city, state)] += fee
            if zipc:
                fees_by_zip[(zipc, state)] += fee

        # Build response
        states = []
        all_states = set(list(escrow_by_state.keys()) + list(fees_by_state.keys()))
        for state in all_states:
            fees = fees_by_state[state]
            escrow = escrow_by_state[state]
            take = float(fees / escrow) if escrow and escrow > D0 else 0.0
            states.append({
                "state": state,
                "fees": _fmt_money(fees),
                "escrow": _fmt_money(escrow),
                "take_rate": take,
                "agreements": agreements_by_state[state],
            })
        states.sort(key=lambda s: Decimal(s["fees"]), reverse=True)

        cities_by_state: Dict[str, List[Dict[str, Any]]] = {}
        for (city, state), escrow in escrow_by_city.items():
            fees = fees_by_city.get((city, state), D0)
            take = float(fees / escrow) if escrow and escrow > D0 else 0.0
            cities_by_state.setdefault(state, []).append({
                "city": city,
                "state": state,
                "fees": _fmt_money(fees),
                "escrow": _fmt_money(escrow),
                "take_rate": take,
                "agreements": agreements_by_city[(city, state)],
            })
        for st in cities_by_state:
            cities_by_state[st].sort(key=lambda r: Decimal(r["fees"]), reverse=True)

        zips_by_state: Dict[str, List[Dict[str, Any]]] = {}
        for (zipc, state), escrow in escrow_by_zip.items():
            fees = fees_by_zip.get((zipc, state), D0)
            zips_by_state.setdefault(state, []).append({
                "zip": zipc,
                "state": state,
                "fees": _fmt_money(fees),
                "escrow": _fmt_money(escrow),
                "agreements": agreements_by_zip[(zipc, state)],
            })
        for st in zips_by_state:
            zips_by_state[st].sort(key=lambda r: Decimal(r["fees"]), reverse=True)

        return Response(
            {
                "generated_at": now().isoformat(),
                "states": states,
                "cities_by_state": cities_by_state,
                "zips_by_state": zips_by_state,
            },
            status=status.HTTP_200_OK,
        )


class AdminFeeLedger(APIView):
    """
    Fee audit ledger (authoritative).

    Source of truth:
      - receipts.Receipt (snapshot fields)
    Compares:
      - fee_charged vs fee_expected (from stored snapshot)
    """
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if Receipt is None:
            return Response({"count": 0, "results": [], "warning": "Receipt model not found."}, status=status.HTTP_200_OK)

        start = parse_date((request.query_params.get("start") or "").strip())
        end = parse_date((request.query_params.get("end") or "").strip())
        mismatch_only = (request.query_params.get("mismatch_only") or "").lower() in ("1", "true", "yes")
        limit = min(int(request.query_params.get("limit", 500)), 2000)

        qs = Receipt.objects.select_related(
            "invoice",
            "agreement",
            "invoice__agreement",
            "invoice__agreement__contractor",
        ).order_by("-created_at")

        if start:
            qs = qs.filter(created_at__date__gte=start)
        if end:
            qs = qs.filter(created_at__date__lte=end)

        rows = []
        totals = {
            "gross_cents": 0,
            "fee_charged_cents": 0,
            "fee_expected_cents": 0,
            "delta_cents": 0,
            "mismatches": 0,
        }

        for r in qs[:limit]:
            charged = int(getattr(r, "platform_fee_cents", 0) or 0)

            # Expected fee = min(uncapped, cap_remaining_before)
            uncapped = getattr(r, "platform_fee_uncapped_cents", None)
            remaining = getattr(r, "cap_remaining_cents", None)

            if uncapped is None:
                expected = charged
            else:
                uncapped = int(uncapped or 0)
                remaining = int(remaining or 0) if remaining is not None else uncapped
                expected = max(min(uncapped, max(remaining, 0)), 0)

            delta = charged - expected
            is_mismatch = abs(delta) > 1  # > $0.01

            if mismatch_only and not is_mismatch:
                continue

            inv = getattr(r, "invoice", None)
            ag = getattr(r, "agreement", None) or getattr(inv, "agreement", None)
            contractor = getattr(ag, "contractor", None) if ag else None

            rows.append({
                "receipt_number": getattr(r, "receipt_number", None),
                "created_at": r.created_at.isoformat() if getattr(r, "created_at", None) else None,

                "agreement_id": getattr(ag, "id", None),
                "invoice_id": getattr(inv, "id", None) if inv else None,

                "contractor": safe_get(contractor, ["business_name", "name"], None)
                    or safe_get(getattr(contractor, "user", None), ["email"], None),

                "gross_cents": getattr(r, "amount_paid_cents", 0),
                "fee_charged_cents": charged,
                "fee_expected_cents": expected,
                "delta_cents": delta,
                "mismatch": is_mismatch,

                "fee_plan_code": getattr(r, "fee_plan_code", None),
                "tier_name": getattr(r, "tier_name", None),
                "fee_engine_version": getattr(r, "fee_engine_version", None),

                "cap_total_cents": getattr(r, "cap_total_cents", None),
                "cap_already_collected_cents": getattr(r, "cap_already_collected_cents", None),
                "cap_remaining_cents": getattr(r, "cap_remaining_cents", None),

                "stripe_payment_intent_id": getattr(r, "stripe_payment_intent_id", None),
                "stripe_charge_id": getattr(r, "stripe_charge_id", None),
            })

            totals["gross_cents"] += int(getattr(r, "amount_paid_cents", 0) or 0)
            totals["fee_charged_cents"] += charged
            totals["fee_expected_cents"] += expected
            totals["delta_cents"] += delta
            if is_mismatch:
                totals["mismatches"] += 1

        return Response(
            {
                "count": len(rows),
                "results": rows,
                "summary": {
                    "gross_paid": _fmt_money(_cents_to_dollars_dec(totals["gross_cents"])),
                    "fee_charged": _fmt_money(_cents_to_dollars_dec(totals["fee_charged_cents"])),
                    "fee_expected": _fmt_money(_cents_to_dollars_dec(totals["fee_expected_cents"])),
                    "delta": _fmt_money(_cents_to_dollars_dec(totals["delta_cents"])),
                    "mismatches": totals["mismatches"],
                },
            },
            status=status.HTTP_200_OK,
        )


class AdminDisputes(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        # Prefer Dispute model if present
        if Dispute is not None:
            qs = Dispute.objects.select_related(
                "agreement",
                "agreement__contractor",
                "agreement__contractor__user",
                "agreement__homeowner",
                "agreement__project",
                "milestone",
            ).order_by("-id")[:500]
            results = []
            for d in qs:
                agreement = safe_get(d, ["agreement"], None)
                homeowner = safe_get(agreement, ["homeowner"], None) if agreement else None
                project = safe_get(agreement, ["project"], None) if agreement else None
                results.append({
                    "id": safe_get(d, ["id"], None),
                    "created_at": _to_iso(safe_get(d, ["created_at"], None)),
                    "updated_at": _to_iso(safe_get(d, ["updated_at", "last_activity_at"], None)),
                    "status": safe_get(d, ["status"], None),
                    "agreement_id": safe_get(d, ["agreement_id"], None) or safe_get(safe_get(d, ["agreement"], None), ["id"], None),
                    "invoice_id": safe_get(d, ["invoice_id"], None) or safe_get(safe_get(d, ["invoice"], None), ["id"], None),
                    "reason": safe_get(d, ["reason", "notes", "description"], None),
                    "contractor_name": _contractor_display(safe_get(agreement, ["contractor"], None)) if agreement else "",
                    "homeowner_name": _homeowner_display(homeowner) if homeowner else "",
                    "project_title": safe_get(project, ["title"], None) or f"Agreement #{safe_get(agreement, ['id'], '')}",
                    "amount": _fmt_money(_to_dec(safe_get(d, ["fee_amount"], None))),
                    "initiator": safe_get(d, ["initiator"], None),
                    "milestone_title": safe_get(safe_get(d, ["milestone"], None), ["title"], None),
                })
            return Response({"count": len(results), "results": results}, status=status.HTTP_200_OK)

        # Fallback: derive disputes from invoices
        if Invoice is None:
            return Response({"count": 0, "results": [], "warning": "No Dispute model and Invoice model not available."}, status=status.HTTP_200_OK)

        qs = Invoice.objects.filter(_invoice_disputed_q()).order_by("-created_at")[:500]
        results = []
        for inv in qs:
            agreement = safe_get(inv, ["agreement"], None)
            project = safe_get(agreement, ["project"], None) if agreement else None
            results.append({
                "id": inv.id,
                "created_at": _to_iso(safe_get(inv, ["created_at"], None)),
                "updated_at": _to_iso(safe_get(inv, ["updated_at"], None)),
                "status": safe_get(inv, ["status"], None),
                "agreement_id": safe_get(inv, ["agreement_id"], None),
                "invoice_id": inv.id,
                "reason": safe_get(inv, ["dispute_reason"], None),
                "contractor_name": _contractor_display(safe_get(agreement, ["contractor"], None)) if agreement else "",
                "homeowner_name": _homeowner_display(safe_get(agreement, ["homeowner"], None)) if agreement else "",
                "project_title": safe_get(project, ["title"], None) or f"Agreement #{safe_get(agreement, ['id'], '')}",
                "amount": _fmt_money(_to_dec(safe_get(inv, ["amount"], None))),
                "initiator": "",
                "milestone_title": "",
            })
        return Response({"count": len(results), "results": results}, status=status.HTTP_200_OK)


class AdminDownloadAgreementPDF(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request, agreement_id: int):
        if Agreement is None:
            raise Http404("Agreement model not found.")

        try:
            a = Agreement.objects.get(id=agreement_id)
        except Exception:
            raise Http404("Agreement not found.")

        pdf_field = safe_get(a, ["pdf_file"], None)
        if not pdf_field or not getattr(pdf_field, "name", None):
            raise Http404("PDF not available for this agreement.")

        try:
            return FileResponse(pdf_field.open("rb"), as_attachment=False, filename=pdf_field.name.split("/")[-1])
        except Exception:
            raise Http404("Unable to open PDF file.")


class AdminAgreementAIContext(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request, agreement_id: int):
        if Agreement is None:
            raise Http404("Agreement model not found.")

        try:
            agreement = Agreement.objects.select_related("source_lead").get(id=agreement_id)
        except Exception:
            raise Http404("Agreement not found.")

        lead = getattr(agreement, "source_lead", None)
        analysis = getattr(lead, "ai_analysis", {}) or {}
        pricing_sources = []
        pricing_confidence_levels = []
        if Milestone is not None:
            try:
                for milestone in Milestone.objects.filter(agreement_id=agreement.id).order_by("order", "id")[:12]:
                    source_note = (getattr(milestone, "pricing_source_note", "") or "").strip()
                    confidence = (getattr(milestone, "pricing_confidence", "") or "").strip()
                    if source_note and source_note not in pricing_sources:
                        pricing_sources.append(source_note)
                    if confidence and confidence not in pricing_confidence_levels:
                        pricing_confidence_levels.append(confidence)
            except Exception:
                pricing_sources = pricing_sources or []
                pricing_confidence_levels = pricing_confidence_levels or []
        return Response(
            {
                "agreement_id": agreement.id,
                "source_lead_id": getattr(lead, "id", None),
                "has_ai_analysis": bool(analysis),
                "suggested_title": analysis.get("suggested_title") or "",
                "template_name": analysis.get("template_name") or "",
                "confidence": analysis.get("confidence") or "",
                "reason": analysis.get("reason") or "",
                "pricing_sources": pricing_sources,
                "pricing_confidence_levels": pricing_confidence_levels,
                "ai_analysis": analysis,
            },
            status=status.HTTP_200_OK,
        )


class AdminAgreementRefreshPricing(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request, agreement_id: int):
        if Agreement is None:
            raise Http404("Agreement model not found.")

        try:
            agreement = Agreement.objects.get(id=agreement_id)
        except Exception:
            raise Http404("Agreement not found.")

        try:
            out = suggest_pricing_refresh(agreement=agreement)
            persisted_count = _persist_pricing_estimates(agreement, out.get("pricing_estimates", []))
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "detail": "Pricing guidance refreshed.",
                "persisted_count": persisted_count,
            },
            status=status.HTTP_200_OK,
        )


class AdminAgreementResendSignature(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request, agreement_id: int):
        if Agreement is None:
            raise Http404("Agreement model not found.")

        try:
            agreement = Agreement.objects.select_related("homeowner").get(id=agreement_id)
        except Exception:
            raise Http404("Agreement not found.")

        try:
            result = send_signature_request_to_homeowner(agreement)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "detail": "Signature invite resent.",
                "sign_url": result.get("sign_url"),
            },
            status=status.HTTP_200_OK,
        )


class AdminTriggerPasswordReset(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not User.objects.filter(email__iexact=email).exists():
            return Response({"detail": "No user found with that email."}, status=status.HTTP_404_NOT_FOUND)

        form = PasswordResetForm(data={"email": email})
        if not form.is_valid():
            return Response({"detail": "Invalid email."}, status=status.HTTP_400_BAD_REQUEST)

        form.save(
            request=request,
            use_https=getattr(request, "is_secure", lambda: False)(),
            from_email=None,
            email_template_name="registration/password_reset_email.html",
            subject_template_name="registration/password_reset_subject.txt",
        )

        return Response({"detail": "Password reset email sent."}, status=status.HTTP_200_OK)
