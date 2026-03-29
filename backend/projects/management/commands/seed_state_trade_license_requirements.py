from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.services.licensing_seed import seed_state_trade_license_requirements


class Command(BaseCommand):
    help = "Seed state/trade licensing requirement rules."

    def handle(self, *args, **options):
        result = seed_state_trade_license_requirements()
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded licensing requirements (created: +{result['created']} / updated: +{result['updated']})."
            )
        )
