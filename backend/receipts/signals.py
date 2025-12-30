from django.db.models.signals import post_save
from django.dispatch import receiver

from receipts.models import Receipt


@receiver(post_save, sender=Receipt)
def receipt_post_save(sender, instance: Receipt, created: bool, **kwargs):
    """
    On creation:
      1) Ensure PDF exists
      2) Email receipt to homeowner (once)
    """
    if not created:
        return

    try:
        instance.generate_pdf()
    except Exception:
        return  # backfill can fix later

    try:
        instance.send_email_to_homeowner()
    except Exception:
        return
