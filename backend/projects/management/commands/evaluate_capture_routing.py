import time

from django.conf import settings
from django.core.management.base import BaseCommand

from projects.capture_routing_cases import CAPTURE_ROUTING_CASES
from projects.services.capture_conversational import deterministic_candidates


class Command(BaseCommand):
    help = "Evaluate the deterministic conversational Capture router against synthetic cases."

    def handle(self, *args, **options):
        started = time.perf_counter()
        primary = acceptable = unsupported = prohibited = context = fallback = 0
        needs_information = 0
        for case in CAPTURE_ROUTING_CASES:
            result = deterministic_candidates(
                case["input_text"], case["available_profiles"]
            )
            predicted = result["ordered"][0] if result["ordered"] else ""
            if predicted == case["expected_primary_profile"]:
                primary += 1
            if predicted == case["expected_primary_profile"] or predicted in case["acceptable_alternatives"]:
                acceptable += 1
            expected_unsupported = case.get("expected_unsupported", False)
            if bool(result["unsupported"]) == expected_unsupported:
                unsupported += 1
            if predicted not in case["prohibited_profiles"]:
                prohibited += 1
            if bool(not predicted and not result["unsupported"]) == case["expected_needs_information"]:
                needs_information += 1
            if not case["expected_context_type"] or case["page_context"].get("context_type") == case["expected_context_type"]:
                context += 1
        elapsed_ms = (time.perf_counter() - started) * 1000
        provider = getattr(settings, "CAPTURE_ROUTING_PROVIDER", None)
        provider_enabled = bool(
            getattr(settings, "CAPTURE_CONVERSATIONAL_PROVIDER_ENABLED", False)
            and callable(provider)
        )
        total = len(CAPTURE_ROUTING_CASES)
        self.stdout.write(f"total_cases={total}")
        self.stdout.write(f"primary_profile_match={primary}/{total}")
        self.stdout.write(f"acceptable_match={acceptable}/{total}")
        self.stdout.write(f"needs_information_correct={needs_information}/{total}")
        self.stdout.write(f"unsupported_correct={unsupported}/{total}")
        self.stdout.write(f"prohibited_profile_safe={prohibited}/{total}")
        self.stdout.write(f"context_correct={context}/{total}")
        self.stdout.write(f"fallback_usage={fallback}/{total}")
        self.stdout.write(f"deterministic_latency_ms={elapsed_ms:.2f}")
        self.stdout.write(
            "provider_evaluation=not_configured"
            if not provider_enabled else
            "provider_evaluation=available_but_not_run_without_explicit_provider_suite"
        )
