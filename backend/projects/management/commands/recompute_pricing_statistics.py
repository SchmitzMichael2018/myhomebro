from __future__ import annotations

from statistics import mean, median
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from projects.models_templates import PricingObservation, PricingStatistic


class Command(BaseCommand):
    help = "Recompute aggregated pricing statistics from PricingObservation"

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE("Recomputing pricing statistics..."))

        observations = PricingObservation.objects.all()

        if not observations.exists():
            self.stdout.write(self.style.WARNING("No observations found."))
            return

        groups = defaultdict(list)

        for obs in observations:
            key = (
                obs.project_type,
                obs.project_subtype,
                obs.normalized_milestone_type,
                obs.region_state,
                obs.region_city,
            )

            groups[key].append(obs)

        created = 0

        with transaction.atomic():

            PricingStatistic.objects.all().delete()

            for (
                project_type,
                project_subtype,
                milestone_type,
                state,
                city,
            ), rows in groups.items():

                amounts = [float(r.amount) for r in rows if r.amount is not None]

                if not amounts:
                    continue

                days_from_start = [
                    r.milestone_days_from_start
                    for r in rows
                    if r.milestone_days_from_start is not None
                ]

                duration_days = [
                    r.milestone_duration_days
                    for r in rows
                    if r.milestone_duration_days is not None
                ]

                total_days = [
                    r.estimated_days
                    for r in rows
                    if r.estimated_days is not None and r.estimated_days > 0
                ]

                stat = PricingStatistic.objects.create(
                    scope="market",
                    contractor=None,
                    region_state=state or "",
                    region_city=city or "",
                    project_type=project_type or "",
                    project_subtype=project_subtype or "",
                    normalized_milestone_type=milestone_type or "",
                    sample_size=len(amounts),
                    low_amount=min(amounts),
                    median_amount=median(amounts),
                    high_amount=max(amounts),
                    avg_amount=mean(amounts),
                    avg_days_from_start=mean(days_from_start) if days_from_start else 0,
                    avg_duration_days=mean(duration_days) if duration_days else 0,
                    avg_total_project_days=mean(total_days) if total_days else 0,
                    source_note="Computed from pricing observations",
                )

                created += 1

        self.stdout.write(
            self.style.SUCCESS(f"Created {created} pricing statistic rows.")
        )