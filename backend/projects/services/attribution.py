from __future__ import annotations

import re
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from projects.models_attribution import (
    AccountAcquisition,
    AttributionEvent,
    ProjectAttributionSnapshot,
    RevenueAttributionSnapshot,
)
from projects.models_referrals import ContractorReferral, ReferralEarning, ReferralParticipant, ReferralVisit


SAFE_VALUE = re.compile(r"[^a-zA-Z0-9 _./:+-]")
BOT_UA = re.compile(r"bot|crawler|spider|slurp|headless|healthcheck|uptime", re.I)
ROLE_VALUES = {
    ReferralParticipant.ROLE_HOMEOWNER,
    ReferralParticipant.ROLE_CONTRACTOR,
    ReferralParticipant.ROLE_PROPERTY_MANAGER,
}
MEANINGFUL_EVENTS = set(AttributionEvent.EVENT_TYPES)


def normalize_value(value, *, maximum=100, lower=False):
    value = SAFE_VALUE.sub("", str(value or "").strip())[:maximum]
    return value.lower() if lower else value


def normalize_path(value):
    raw = str(value or "").strip()[:1000]
    try:
        value = urlparse(raw).path
    except ValueError:
        value = "/"
    value = normalize_value(value, maximum=255)
    return value if value.startswith("/") else "/"


def _referrer_parts(value):
    raw = str(value or "").strip()[:2000]
    try:
        parsed = urlparse(raw)
        safe_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"[:500] if parsed.scheme and parsed.netloc else ""
        return safe_url, (parsed.hostname or "").lower()[:255]
    except ValueError:
        return "", ""


def classify_touch(*, params=None, referrer="", campaign=None):
    """The sole source/medium classifier for public acquisition traffic."""
    params = params or {}
    if campaign is not None:
        return {
            "source": normalize_value(campaign.source, maximum=64, lower=True),
            "medium": normalize_value(campaign.medium, maximum=64, lower=True),
            "campaign": normalize_value(campaign.campaign_name),
            "content": normalize_value(campaign.content),
            "term": "",
        }
    source = normalize_value(params.get("utm_source"), maximum=64, lower=True)
    medium = normalize_value(params.get("utm_medium"), maximum=64, lower=True)
    campaign_name = normalize_value(params.get("utm_campaign"))
    content = normalize_value(params.get("utm_content"))
    term = normalize_value(params.get("utm_term"))
    if source or medium:
        if source in {"google", "bing"} and medium in {"cpc", "ppc", "paid", "paid-search"}:
            medium = "paid-search"
        elif source in {"facebook", "instagram"} and medium in {"cpc", "paid", "paid-social"}:
            medium = "paid-social"
        elif source in {"facebook", "instagram"} and medium in {"social", "organic", "organic-social"}:
            medium = "organic-social"
        return {"source": source or "unknown", "medium": medium or "unknown", "campaign": campaign_name, "content": content, "term": term}
    _raw, domain = _referrer_parts(referrer)
    if not domain or domain in {"myhomebro.com", "www.myhomebro.com"} or domain.endswith(".myhomebro.com"):
        return {"source": "direct", "medium": "none", "campaign": "", "content": "", "term": ""}
    if domain == "google.com" or domain.endswith(".google.com"):
        return {"source": "google", "medium": "organic", "campaign": "", "content": "", "term": ""}
    if domain == "bing.com" or domain.endswith(".bing.com"):
        return {"source": "bing", "medium": "organic", "campaign": "", "content": "", "term": ""}
    if domain in {"facebook.com", "www.facebook.com", "m.facebook.com", "l.facebook.com"}:
        return {"source": "facebook", "medium": "organic-social", "campaign": "", "content": "", "term": ""}
    if domain in {"instagram.com", "www.instagram.com", "l.instagram.com"}:
        return {"source": "instagram", "medium": "organic-social", "campaign": "", "content": "", "term": ""}
    return {"source": domain, "medium": "referral", "campaign": "", "content": "", "term": ""}


def _exclusion_for_request(request):
    ua = str(request.META.get("HTTP_USER_AGENT") or "")
    if BOT_UA.search(ua):
        return "obvious_bot"
    if str(request.META.get("HTTP_X_MYHOMEBRO_TEST_TRAFFIC") or "").lower() in {"1", "true", "yes"}:
        return "declared_test_traffic"
    host = str(request.get_host() or "").split(":", 1)[0].lower()
    if settings.DEBUG or host in {"localhost", "127.0.0.1", "testserver"}:
        return "development_or_test"
    return ""


def _touch_dict(visit, *, first):
    prefix = "first" if first else "last"
    return {
        "source": getattr(visit, f"{prefix}_source"),
        "medium": getattr(visit, f"{prefix}_medium"),
        "campaign": getattr(visit, f"{prefix}_campaign"),
        "content": getattr(visit, f"{prefix}_content"),
        "term": getattr(visit, f"{prefix}_term"),
        "landing_page": visit.landing_page if first else visit.last_landing_page,
        "referrer_domain": visit.referrer_domain if first else visit.last_referrer_domain,
        "campaign_id": str(visit.campaign_id or ""),
        "referral_code": visit.referral_code,
    }


@transaction.atomic
def capture_visit(request, *, campaign=None, landing_page=None, params=None):
    if not request.session.session_key:
        request.session.create()
    now = timezone.now()
    referrer_url, referrer_domain = _referrer_parts(request.META.get("HTTP_REFERER"))
    touch = classify_touch(params=params or request.GET, referrer=referrer_url, campaign=campaign)
    visit_id = request.session.get("attribution_visit_id")
    visit = ReferralVisit.objects.select_for_update().filter(pk=visit_id).first() if visit_id else None
    if visit is None:
        visit = ReferralVisit.objects.create(
            participant=getattr(campaign, "referral_participant", None),
            referral_code=str(request.session.get("referral_code") or "")[:20],
            medium=touch["medium"][:24],
            landing_page=normalize_path(landing_page or request.path),
            referrer_url=referrer_url,
            referrer_domain=referrer_domain,
            first_source=touch["source"], first_medium=touch["medium"],
            first_campaign=touch["campaign"], first_content=touch["content"], first_term=touch["term"],
            last_source=touch["source"], last_medium=touch["medium"],
            last_campaign=touch["campaign"], last_content=touch["content"], last_term=touch["term"],
            last_landing_page=normalize_path(landing_page or request.path),
            last_referrer_url=referrer_url, last_referrer_domain=referrer_domain,
            last_touch_at=now, campaign=campaign,
            session_key=request.session.session_key or "",
            first_touch_at=now,
            excluded_from_reporting=bool(_exclusion_for_request(request)),
            exclusion_reason=_exclusion_for_request(request),
        )
        request.session["attribution_visit_id"] = visit.pk
    elif touch["source"] != "direct" or touch["medium"] != "none":
        visit.last_source, visit.last_medium = touch["source"], touch["medium"]
        visit.last_campaign, visit.last_content, visit.last_term = touch["campaign"], touch["content"], touch["term"]
        visit.last_landing_page = normalize_path(landing_page or request.path)
        visit.last_referrer_url, visit.last_referrer_domain = referrer_url, referrer_domain
        visit.last_touch_at = now
        if campaign is not None:
            visit.campaign = campaign
        visit.save(update_fields=["last_source", "last_medium", "last_campaign", "last_content", "last_term", "last_landing_page", "last_referrer_url", "last_referrer_domain", "last_touch_at", "campaign"])
    request.session.modified = True
    return visit


def update_visit_referral(visit, participant):
    if visit.referral_code:
        return visit
    visit.participant = participant
    visit.referral_code = participant.code
    visit.save(update_fields=["participant", "referral_code"])
    return visit


@transaction.atomic
def associate_account(request, user, *, role):
    role = role if role in ROLE_VALUES else "unknown"
    visit_id = request.session.get("attribution_visit_id")
    visit = ReferralVisit.objects.select_for_update().filter(pk=visit_id).first() if visit_id else None
    if visit is None:
        visit = ReferralVisit.objects.filter(session_key=request.session.session_key or "").order_by("first_touch_at").first()
    referral = ContractorReferral.objects.filter(referred_user=user).first()
    acquisition, _ = AccountAcquisition.objects.select_for_update().get_or_create(user=user)
    roles = list(acquisition.roles or [])
    if role not in roles and role != "unknown":
        roles.append(role)
    acquisition.roles = roles
    acquisition.account_created_at = acquisition.account_created_at or timezone.now()
    if acquisition.first_touch_at is None:
        acquisition.first_visit = visit
        acquisition.first_touch_at = visit.first_touch_at if visit else acquisition.account_created_at
        acquisition.first_touch = _touch_dict(visit, first=True) if visit else {"source": "unknown", "medium": "legacy"}
    if visit:
        acquisition.last_visit = visit
        acquisition.last_touch_at = visit.last_touch_at or visit.first_touch_at
        acquisition.last_touch = _touch_dict(visit, first=False)
        known_roles = list(visit.known_roles or [])
        if role not in known_roles and role != "unknown":
            known_roles.append(role)
            visit.known_roles = known_roles
        if visit.registered_user_id is None:
            visit.registered_user = user
            visit.registration_at = timezone.now()
        visit.save(update_fields=["known_roles", "registered_user", "registration_at"])
    if referral and acquisition.referral_id is None:
        acquisition.referral = referral
    acquisition.save()
    record_event("account_created", visitor=visit, user=user, role=role, idempotency_key=f"account_created:user:{user.pk}")
    return acquisition


def add_role(user, role):
    acquisition, _ = AccountAcquisition.objects.get_or_create(
        user=user,
        defaults={"first_touch": {"source": "unknown", "medium": "legacy"}},
    )
    roles = list(acquisition.roles or [])
    if role in ROLE_VALUES and role not in roles:
        roles.append(role)
        acquisition.roles = roles
        acquisition.save(update_fields=["roles", "updated_at"])
    return acquisition


def mark_profile_completed(user, *, role, object_type, object_id):
    acquisition = add_role(user, role)
    if acquisition.profile_completed_at is None:
        acquisition.profile_completed_at = timezone.now()
        acquisition.save(update_fields=["profile_completed_at", "updated_at"])
    return record_event(
        "profile_completed", user=user, role=role, object_type=object_type, object_id=object_id,
        idempotency_key=f"profile_completed:{object_type}:{object_id}",
    )


def record_event(event_type, *, visitor=None, user=None, project=None, role="", object_type="", object_id="", idempotency_key=None, metadata=None, occurred_at=None):
    if event_type not in MEANINGFUL_EVENTS:
        raise ValueError("Unsupported attribution event type.")
    touch = _touch_dict(visitor, first=False) if visitor else {}
    values = {
        "event_type": event_type, "visitor": visitor, "user": user, "project": project,
        "campaign": visitor.campaign if visitor else None, "role": role if role in ROLE_VALUES else "",
        "source": touch.get("source", "unknown"), "medium": touch.get("medium", "unknown"),
        "campaign_name": touch.get("campaign", ""), "content": touch.get("content", ""),
        "landing_page": touch.get("landing_page", ""), "object_type": normalize_value(object_type, maximum=64, lower=True),
        "object_id": normalize_value(object_id, maximum=80), "occurred_at": occurred_at or timezone.now(),
        "metadata": {str(k)[:40]: normalize_value(v, maximum=200) for k, v in dict(metadata or {}).items()},
    }
    if idempotency_key:
        return AttributionEvent.objects.get_or_create(idempotency_key=str(idempotency_key)[:190], defaults=values)[0]
    return AttributionEvent.objects.create(**values)


def acquisition_for_user(user):
    if not user:
        return {}
    row = AccountAcquisition.objects.filter(user=user).first()
    if not row:
        return {"first_touch": {"source": "unknown", "medium": "legacy"}, "last_touch": {"source": "unknown", "medium": "legacy"}, "roles": []}
    return {"first_touch": row.first_touch, "last_touch": row.last_touch, "roles": row.roles, "referral_id": row.referral_id}


def _customer_user(project):
    email = str(getattr(project.homeowner, "email", "") or "").strip()
    return get_user_model().objects.filter(email__iexact=email).first() if email else None


@transaction.atomic
def snapshot_project(project, *, creator=None):
    customer_user = _customer_user(project)
    contractor_user = getattr(getattr(project, "contractor", None), "user", None)
    customer_referral = ContractorReferral.objects.filter(referred_user=customer_user).first() if customer_user else None
    contractor_referral = ContractorReferral.objects.filter(referred_user=contractor_user).first() if contractor_user else None
    snapshot, _ = ProjectAttributionSnapshot.objects.get_or_create(
        project=project,
        defaults={
            "creator": creator, "customer_user": customer_user, "contractor_user": contractor_user,
            "customer_attribution": acquisition_for_user(customer_user),
            "contractor_attribution": acquisition_for_user(contractor_user),
            "customer_referral": customer_referral, "contractor_referral": contractor_referral,
        },
    )
    record_event("project_created", user=creator or customer_user or contractor_user, project=project, role="homeowner" if creator == customer_user else "contractor", object_type="project", object_id=project.pk, idempotency_key=f"project_created:{project.pk}")
    return snapshot


@transaction.atomic
def snapshot_revenue(receipt):
    from projects.services.referrals import eligible_platform_fee_cents
    agreement = receipt.agreement or receipt.invoice.agreement
    project = agreement.project if agreement else None
    customer_user = _customer_user(project) if project else None
    contractor_user = getattr(getattr(agreement, "contractor", None) or getattr(project, "contractor", None), "user", None)
    earnings = list(ReferralEarning.objects.filter(receipt=receipt))
    fee = eligible_platform_fee_cents(receipt)
    customer_reward = sum(row.reward_cents for row in earnings if row.allocation_side in {"homeowner", "property_manager"})
    contractor_reward = sum(row.reward_cents for row in earnings if row.allocation_side == "contractor")
    total_reward = customer_reward + contractor_reward
    pool = max([row.maximum_reward_pool_cents for row in earnings] or [fee * 5000 // 10000])
    snapshot, _ = RevenueAttributionSnapshot.objects.get_or_create(
        receipt=receipt,
        defaults={"project": project, "customer_user": customer_user, "contractor_user": contractor_user,
                  "customer_attribution": acquisition_for_user(customer_user), "contractor_attribution": acquisition_for_user(contractor_user),
                  "eligible_platform_fee_cents": fee, "maximum_reward_pool_cents": pool,
                  "customer_reward_cents": customer_reward, "contractor_reward_cents": contractor_reward,
                  "total_referral_reward_cents": total_reward, "retained_platform_fee_cents": max(fee - total_reward, 0)},
    )
    record_event("platform_fee_generated", project=project, object_type="receipt", object_id=receipt.pk, idempotency_key=f"platform_fee_generated:receipt:{receipt.pk}", metadata={"fee_cents": fee})
    if project is not None:
        record_event("project_funded", project=project, object_type="receipt", object_id=receipt.pk,
                     idempotency_key=f"project_funded:project:{project.pk}")
    for earning in earnings:
        record_event("referral_reward_generated", project=project, object_type="referral_earning", object_id=earning.pk, idempotency_key=f"referral_reward_generated:{earning.pk}", metadata={"reward_cents": earning.reward_cents})
    return snapshot


def acquisition_report():
    excluded_users = Q(user__trust_classification__in=("test", "spam_fraud"))
    excluded_classes = ("test", "spam_fraud")
    included_visits = ReferralVisit.objects.filter(excluded_from_reporting=False).exclude(
        registered_user__trust_classification__in=excluded_classes
    )
    by_source = list(included_visits.values("first_source", "first_medium").annotate(visitors=Count("id")).order_by("first_source", "first_medium"))
    event_totals = dict(AttributionEvent.objects.filter(
        Q(visitor__isnull=True) | Q(visitor__excluded_from_reporting=False)
    ).exclude(excluded_users).values("event_type").annotate(total=Count("id")).values_list("event_type", "total"))
    by_campaign = list(included_visits.values("first_campaign", "first_content").exclude(first_campaign="").annotate(visitors=Count("id")).order_by("first_campaign", "first_content"))
    by_improvement = list(
        AttributionEvent.objects.filter(
            object_type="improvement",
            event_type__in=("improvement_template_view", "diy_project_started", "hire_pro_clicked"),
        ).exclude(excluded_users)
        .values("object_id", "event_type")
        .annotate(total=Count("id"))
        .order_by("object_id", "event_type")
    )
    by_improvement_category = list(
        AttributionEvent.objects.filter(
            object_type="improvement",
            event_type__in=("improvement_template_view", "diy_project_started", "hire_pro_clicked"),
        ).exclude(excluded_users)
        .values("metadata__category", "event_type")
        .annotate(total=Count("id"))
        .order_by("metadata__category", "event_type")
    )
    by_role = {role: 0 for role in ROLE_VALUES}
    source_funnel = {}

    def source_name(payload):
        return str(((payload or {}).get("first_touch") or {}).get("source") or "unknown")

    def bucket(source):
        return source_funnel.setdefault(source or "unknown", {
            "visitors": 0, "signups": 0, "activated_accounts": 0, "projects": 0, "funded_projects": 0,
            "platform_fee_cents": 0, "referral_reward_cents": 0, "retained_revenue_cents": 0,
        })

    for row in by_source:
        bucket(row["first_source"])["visitors"] += row["visitors"]
    for acquisition in AccountAcquisition.objects.exclude(user__trust_classification__in=("test", "spam_fraud")).iterator():
        source = str((acquisition.first_touch or {}).get("source") or "unknown")
        bucket(source)["signups"] += 1
        if acquisition.profile_completed_at:
            bucket(source)["activated_accounts"] += 1
        for role in acquisition.roles or []:
            if role in by_role:
                by_role[role] += 1
    included_project_snapshots = ProjectAttributionSnapshot.objects.exclude(
        Q(customer_user__trust_classification__in=excluded_classes)
        | Q(contractor_user__trust_classification__in=excluded_classes)
    )
    funded_project_ids = set(AttributionEvent.objects.filter(event_type="project_funded", project__isnull=False).values_list("project_id", flat=True))
    for snapshot in included_project_snapshots.iterator():
        source = source_name(snapshot.customer_attribution)
        bucket(source)["projects"] += 1
        if snapshot.project_id in funded_project_ids:
            bucket(source)["funded_projects"] += 1
    revenue_by_contractor_source = {}
    included_revenue = RevenueAttributionSnapshot.objects.exclude(
        Q(customer_user__trust_classification__in=excluded_classes)
        | Q(contractor_user__trust_classification__in=excluded_classes)
    )
    for row in included_revenue.iterator():
        customer_source = source_name(row.customer_attribution)
        customer_bucket = bucket(customer_source)
        customer_bucket["platform_fee_cents"] += row.eligible_platform_fee_cents
        customer_bucket["referral_reward_cents"] += row.total_referral_reward_cents
        customer_bucket["retained_revenue_cents"] += row.retained_platform_fee_cents
        contractor_source = source_name(row.contractor_attribution)
        contractor_bucket = revenue_by_contractor_source.setdefault(contractor_source, {
            "platform_fee_cents": 0, "referral_reward_cents": 0, "retained_revenue_cents": 0,
        })
        contractor_bucket["platform_fee_cents"] += row.eligible_platform_fee_cents
        contractor_bucket["referral_reward_cents"] += row.total_referral_reward_cents
        contractor_bucket["retained_revenue_cents"] += row.retained_platform_fee_cents
    revenue = included_revenue.aggregate(platform_fees=Sum("eligible_platform_fee_cents"), referral_rewards=Sum("total_referral_reward_cents"), retained_revenue=Sum("retained_platform_fee_cents"))
    return {"by_source": by_source, "source_funnel": source_funnel, "by_role": by_role,
            "revenue_by_contractor_source": revenue_by_contractor_source, "by_campaign_content": by_campaign,
            "by_improvement": by_improvement,
            "by_improvement_category": by_improvement_category,
            "funnel_events": event_totals, "revenue": {key: value or 0 for key, value in revenue.items()}}
