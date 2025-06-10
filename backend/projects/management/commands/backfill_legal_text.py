from django.core.management.base import BaseCommand
from projects.models import Agreement
import os

from django.conf import settings
LEGAL_PATH = os.path.join(settings.BASE_DIR, 'static', 'legal')


def load_legal_text(filename):
    path = os.path.join(LEGAL_PATH, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

class Command(BaseCommand):
    help = "Backfill missing terms_text and privacy_text into existing Agreements"

    def handle(self, *args, **kwargs):
        terms = load_legal_text("terms_of_service.txt")
        privacy = load_legal_text("privacy_policy.txt")

        updated = 0
        for agreement in Agreement.objects.all():
            changed = False
            if not agreement.terms_text:
                agreement.terms_text = terms
                changed = True
            if not agreement.privacy_text:
                agreement.privacy_text = privacy
                changed = True
            if changed:
                agreement.save(update_fields=["terms_text", "privacy_text"])
                updated += 1

        self.stdout.write(self.style.SUCCESS(f"✅ Updated {updated} agreement(s)."))
