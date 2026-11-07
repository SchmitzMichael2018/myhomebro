"""Database-enforced six-per-hour admission shared by all application workers."""

import logging
from datetime import timedelta
from ipaddress import ip_address

from django.conf import settings
from django.db import DatabaseError, IntegrityError, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from projects.models_public_planning import PublicImprovementPlanSlot


logger = logging.getLogger(__name__)
ADMISSION_SLOTS = 6
ADMISSION_WINDOW = timedelta(hours=1)
EXPIRED_SLOT_CLEANUP_BATCH = 100


class PublicPlanClientIPUnavailable(ValueError):
    """The deployment cannot establish its configured trusted client identity."""


def _canonical_ip(value):
    if not isinstance(value, str) or len(value) > 64 or "%" in value:
        raise PublicPlanClientIPUnavailable("Missing or invalid client IP.")
    try:
        address = ip_address(value.strip())
    except ValueError:
        raise PublicPlanClientIPUnavailable("Missing or invalid client IP.") from None
    # Do not give IPv4-mapped IPv6 and the corresponding IPv4 separate buckets.
    return str(getattr(address, "ipv4_mapped", None) or address)


def public_plan_client_ip(request):
    """Resolve identity only under the explicitly verified hosting contract.

    PythonAnywhere overwrites X-Real-IP with its inbound peer and guarantees only
    the final X-Forwarded-For item. Never use that mode on a directly reachable
    origin or infer trust from Host, an arbitrary header, or a private IP range.
    See https://help.pythonanywhere.com/pages/WebAppClientIPAddresses/.
    """
    peer = _canonical_ip(request.META.get("REMOTE_ADDR"))
    source = getattr(settings, "PUBLIC_PLANNING_CLIENT_IP_SOURCE", "direct")
    if source == "direct":
        return peer
    if source != "pythonanywhere" or getattr(
        settings, "PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED", False,
    ) is not True:
        raise PublicPlanClientIPUnavailable("Client-IP trust configuration is not verified.")
    client = _canonical_ip(request.META.get("HTTP_X_REAL_IP"))
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded is not None:
        if not isinstance(forwarded, str) or len(forwarded) > 4096:
            raise PublicPlanClientIPUnavailable("Invalid trusted proxy metadata.")
        # All earlier values can be supplied by a malicious client. Ignore them.
        if _canonical_ip(forwarded.rsplit(",", 1)[-1]) != client:
            raise PublicPlanClientIPUnavailable("Inconsistent trusted proxy metadata.")
    return client


def _slot_expirations(keys):
    return dict(PublicImprovementPlanSlot.objects.filter(pk__in=keys).values_list("key", "available_at"))


def _prune_expired_slots(now):
    # Recheck expiry in DELETE: another worker may have renewed a selected slot.
    cutoff = now - ADMISSION_WINDOW
    try:
        with transaction.atomic():
            expired = list(PublicImprovementPlanSlot.objects.filter(available_at__lt=cutoff)
                           .order_by("available_at").values_list("pk", flat=True)[:EXPIRED_SLOT_CLEANUP_BATCH])
            if expired:
                PublicImprovementPlanSlot.objects.filter(pk__in=expired, available_at__lt=cutoff).delete()
    except DatabaseError:
        # The admission itself has already committed. Cleanup cannot grant any
        # additional capacity and can safely be retried by a later admission.
        logger.warning("Could not prune expired public planning admission slots.")


def reserve_public_plan_slot(peer):
    """Return None on admission, otherwise seconds until a slot becomes free.

    A slot can be claimed once per rolling hour. The database's unique primary
    key decides competing inserts; a conditional UPDATE decides competing reuse.
    Reads only optimize the attempt order and never authorize admission.
    """
    now = timezone.now()
    available_at = now + ADMISSION_WINDOW
    keys = [salted_hmac("public-improvement-plan-slot", f"{peer}:{index}", algorithm="sha256").hexdigest()
            for index in range(ADMISSION_SLOTS)]
    existing = _slot_expirations(keys)
    for key in keys:
        if key in existing:
            if existing[key] > now:
                continue
            claimed = PublicImprovementPlanSlot.objects.filter(pk=key, available_at__lte=now).update(
                available_at=available_at,
            )
            if not claimed:
                continue
        else:
            try:
                # A savepoint prevents an expected uniqueness race from breaking
                # an enclosing transaction. No read/modify/write counter exists.
                with transaction.atomic():
                    PublicImprovementPlanSlot.objects.create(key=key, available_at=available_at)
            except IntegrityError:
                continue
        _prune_expired_slots(now)
        return None
    deadlines = _slot_expirations(keys).values()
    return max(1, (min(deadlines) - now).total_seconds()) if deadlines else 1
