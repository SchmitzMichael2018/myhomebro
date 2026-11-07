"""Database-enforced six-per-hour admission shared by all application workers."""

import logging
from datetime import timedelta

from django.db import DatabaseError, IntegrityError, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from projects.models_public_planning import PublicImprovementPlanSlot


logger = logging.getLogger(__name__)
ADMISSION_SLOTS = 6
ADMISSION_WINDOW = timedelta(hours=1)
EXPIRED_SLOT_CLEANUP_BATCH = 100


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
