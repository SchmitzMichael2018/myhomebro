from __future__ import annotations

from collections import defaultdict
from datetime import date as _date, timedelta
from decimal import Decimal
from typing import Any, Dict, Optional, List, Tuple

from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import PasswordResetForm
from django.db.models import Q, Sum
from django.http import FileResponse, Http404
from django.utils.timezone import now

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from .permissions import IsAdminUserRole
from .utils import safe_get

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

# Contractor/Homeowner have moved around across builds: try both.
Contractor = _get_first_model([("projects", "Contractor"), ("accounts", "Contractor")])
Homeowner = _get_first_model([("projects", "Homeowner"), ("accounts", "Homeowner")])

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
            },
            "money": {
                "gross_paid_revenue": "0.00",
                "platform_fee_total": "0.00",
                "escrow_funded_total": "0.00",
                "escrow_released_total": "0.00",
                "escrow_refunded_total": "0.00",
                "escrow_in_flight_total": "0.00",
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

        return Response(data, status=status.HTTP_200_OK)


class AdminContractors(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        if Contractor is None:
            return Response(
                {"count": 0, "results": [], "warning": "Contractor model not found in this deployment."},
                status=status.HTTP_200_OK,
            )

        qs = Contractor.objects.all()
        if hasattr(Contractor, "created_at"):
            qs = qs.order_by("-created_at")
        else:
            qs = qs.order_by("-id")

        qs = qs[:500]

        items = []
        for c in qs:
            user = safe_get(c, ["user"], None)

            items.append({
                "id": safe_get(c, ["id"], None),
                "created_at": safe_get(c, ["created_at"], None),
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

        qs = Homeowner.objects.all()
        if hasattr(Homeowner, "created_at"):
            qs = qs.order_by("-created_at")
        else:
            qs = qs.order_by("-id")

        qs = qs[:500]

        results = []
        for h in qs:
            created_by = safe_get(h, ["created_by"], None)
            results.append({
                "id": safe_get(h, ["id"], None),
                "created_at": safe_get(h, ["created_at"], None),
                "name": safe_get(h, ["full_name", "name"], None),
                "email": safe_get(h, ["email"], None),
                "phone": safe_get(h, ["phone_number", "phone"], None),
                "city": safe_get(h, ["city"], None),
                "state": safe_get(h, ["state"], None),
                "zip": safe_get(h, ["zip_code", "zipcode", "postal_code"], None),
                "created_by_contractor_id": safe_get(created_by, ["id"], None) if created_by else None,
            })

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
            qs = Dispute.objects.all().order_by("-id")[:500]
            results = []
            for d in qs:
                results.append({
                    "id": safe_get(d, ["id"], None),
                    "created_at": safe_get(d, ["created_at"], None),
                    "status": safe_get(d, ["status"], None),
                    "agreement_id": safe_get(d, ["agreement_id"], None) or safe_get(safe_get(d, ["agreement"], None), ["id"], None),
                    "invoice_id": safe_get(d, ["invoice_id"], None) or safe_get(safe_get(d, ["invoice"], None), ["id"], None),
                    "reason": safe_get(d, ["reason", "notes", "description"], None),
                })
            return Response({"count": len(results), "results": results}, status=status.HTTP_200_OK)

        # Fallback: derive disputes from invoices
        if Invoice is None:
            return Response({"count": 0, "results": [], "warning": "No Dispute model and Invoice model not available."}, status=status.HTTP_200_OK)

        qs = Invoice.objects.filter(_invoice_disputed_q()).order_by("-created_at")[:500]
        results = []
        for inv in qs:
            results.append({
                "id": inv.id,
                "created_at": safe_get(inv, ["created_at"], None),
                "status": safe_get(inv, ["status"], None),
                "agreement_id": safe_get(inv, ["agreement_id"], None),
                "invoice_id": inv.id,
                "reason": safe_get(inv, ["dispute_reason"], None),
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
