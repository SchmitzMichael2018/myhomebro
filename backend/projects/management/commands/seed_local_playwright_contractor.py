from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db.utils import OperationalError, ProgrammingError

from projects.models import Contractor
from projects.services.system_template_seed import seed_system_benchmark_foundation


DEFAULT_EMAIL = "playwright.contractor@myhomebro.local"
DEFAULT_PASSWORD = "Playwright123!"
DEFAULT_BUSINESS_NAME = "Playwright QA Contracting"


class Command(BaseCommand):
    help = (
        "Create or update a local contractor account for authenticated Playwright QA "
        "and ensure system templates are seeded."
    )

    def add_arguments(self, parser):
        parser.add_argument("--email", default=DEFAULT_EMAIL)
        parser.add_argument("--password", default=DEFAULT_PASSWORD)
        parser.add_argument("--business-name", default=DEFAULT_BUSINESS_NAME)
        parser.add_argument("--force", action="store_true", help="Allow the command outside DEBUG mode.")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "seed_local_playwright_contractor is intended for local QA only. "
                "Run with DEBUG=True or pass --force if you know what you're doing."
            )

        email = str(options["email"]).strip().lower()
        password = str(options["password"])
        business_name = str(options["business_name"]).strip() or DEFAULT_BUSINESS_NAME

        if not email:
            raise CommandError("Email is required.")
        if not password:
            raise CommandError("Password is required.")

        try:
            User = get_user_model()
            user, user_created = User.objects.get_or_create(
                email=email,
                defaults={
                    "first_name": "Playwright",
                    "last_name": "Contractor",
                    "is_active": True,
                    "is_verified": True,
                },
            )
            user.first_name = user.first_name or "Playwright"
            user.last_name = user.last_name or "Contractor"
            user.is_active = True
            if hasattr(user, "is_verified"):
                user.is_verified = True
            user.set_password(password)
            user.save()

            contractor, contractor_created = Contractor.objects.get_or_create(
                user=user,
                defaults={
                    "business_name": business_name,
                    "city": "Austin",
                    "state": "TX",
                    "zip": "78701",
                    "phone": "555-0100",
                    "address": "123 Playwright Way",
                },
            )
            contractor.business_name = business_name
            contractor.city = contractor.city or "Austin"
            contractor.state = contractor.state or "TX"
            contractor.zip = contractor.zip or "78701"
            contractor.phone = contractor.phone or "555-0100"
            contractor.address = contractor.address or "123 Playwright Way"
            contractor.save()

            seed_result = seed_system_benchmark_foundation()
        except (OperationalError, ProgrammingError) as exc:
            raise CommandError(
                "Local database schema is out of date. Run "
                "`python manage.py migrate` and then rerun "
                "`python manage.py seed_local_playwright_contractor`."
            ) from exc

        self.stdout.write(
            self.style.SUCCESS(
                "Local Playwright contractor ready "
                f"({ 'created' if user_created else 'updated' } user, "
                f"{ 'created' if contractor_created else 'updated' } contractor)."
            )
        )
        self.stdout.write(f"Email: {email}")
        self.stdout.write(f"Password: {password}")
        self.stdout.write(
            "Seeded system templates "
            f"(profiles: +{seed_result['created_profiles']} created / {seed_result['updated_profiles']} updated, "
            f"templates: +{seed_result['created_templates']} created / {seed_result['updated_templates']} updated)."
        )
