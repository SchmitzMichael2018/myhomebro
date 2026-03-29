from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.services.system_template_seed import seed_system_benchmark_foundation


class Command(BaseCommand):
    help = "Seed MyHomeBro system templates and seeded benchmark profiles."

    def handle(self, *args, **kwargs):
        result = seed_system_benchmark_foundation()
        self.stdout.write(
            self.style.SUCCESS(
                "Seeded system benchmark foundation "
                f"(profiles: +{result['created_profiles']} created / {result['updated_profiles']} updated, "
                f"templates: +{result['created_templates']} created / {result['updated_templates']} updated)."
            )
        )
