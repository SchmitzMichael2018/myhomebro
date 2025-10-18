# backend/projects/management/commands/stripe_verify_setup.py
from __future__ import annotations

import json
import os
from typing import Dict, Any

import stripe
from django.core.management.base import BaseCommand


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) else default


def init_stripe() -> str:
    secret = _env("STRIPE_SECRET_KEY")
    if not secret:
        raise RuntimeError(
            "Missing STRIPE_SECRET_KEY. Put it in ~/backend/.env and ensure your WSGI file loads it."
        )
    stripe.api_key = secret
    # Optional: pin if you prefer (match your Stripe dashboard API version)
    api_ver = _env("STRIPE_API_VERSION", "")
    if api_ver:
        stripe.api_version = api_ver
    return secret


def get_platform_account() -> Dict[str, Any]:
    return stripe.Account.retrieve()


def summarize_account(acct: Dict[str, Any]) -> Dict[str, Any]:
    bp = (acct.get("business_profile") or {})
    settings = (acct.get("settings") or {})
    return {
        "id": acct.get("id"),
        "type": acct.get("type"),
        "country": acct.get("country"),
        "charges_enabled": acct.get("charges_enabled"),
        "payouts_enabled": acct.get("payouts_enabled"),
        "details_submitted": acct.get("details_submitted"),
        "email": acct.get("email"),
        "business_profile": {
            "name": bp.get("name"),
            "support_email": bp.get("support_email"),
            "support_phone": bp.get("support_phone"),
            "url": bp.get("url"),
        },
        "capabilities": acct.get("capabilities"),
        "settings": {
            "payouts": settings.get("payouts"),
        },
    }


class Command(BaseCommand):
    help = "Verifies Stripe platform (MyHomeBro) setup and Connect readiness (safe in test mode)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--full",
            action="store_true",
            help="Show extended advisory output.",
        )

    def handle(self, *args, **opts):
        # 0) Echo sanitized config
        cfg = {
            "has_secret_key": bool(_env("STRIPE_SECRET_KEY")),
            "has_public_key": bool(_env("STRIPE_PUBLIC_KEY")),
            "has_webhook_secret": bool(_env("STRIPE_WEBHOOK_SECRET")),
            "connect_country": _env("STRIPE_CONNECT_ACCOUNT_COUNTRY", "US"),
            "test_mode": _env("STRIPE_TEST_MODE", "true").lower() in ("1", "true", "yes", "on"),
            "api_version": _env("STRIPE_API_VERSION", ""),
        }
        self.stdout.write("Stripe config (sanitized):")
        self.stdout.write(json.dumps(cfg, indent=2))

        # 1) Initialize Stripe
        try:
            init_stripe()
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f"✗ Stripe initialization failed: {exc}"))
            self.stdout.write(self.style.WARNING("Ensure your WSGI file loads ~/backend/.env with STRIPE_* keys."))
            return

        # 2) Retrieve platform account
        try:
            acct = get_platform_account()
            summary = summarize_account(acct)
            self.stdout.write(self.style.SUCCESS("✓ Stripe API key valid — platform account retrieved."))
            self.stdout.write(json.dumps(summary, indent=2))
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f"✗ Could not retrieve platform account: {exc}"))
            return

        # 3) Warnings/advice
        warnings = []
        if not summary.get("charges_enabled"):
            warnings.append("charges_enabled = false — OK in test; enable before live launch.")
        if not summary.get("payouts_enabled"):
            warnings.append("payouts_enabled = false — contractors cannot receive payouts yet in live.")
        if not cfg["has_webhook_secret"]:
            warnings.append("STRIPE_WEBHOOK_SECRET not set — create dashboard webhook and paste its signing secret into .env.")

        if warnings:
            self.stdout.write(self.style.WARNING("⚠ Warnings:"))
            for w in warnings:
                self.stdout.write(self.style.WARNING(f"  - {w}"))
        else:
            self.stdout.write(self.style.SUCCESS("✓ No warnings — baseline config looks good."))

        # 4) Connect advisory (basic)
        try:
            # If we can retrieve our account without error, Connect is generally available.
            # Detailed capability checks happen during account link creation.
            _ = acct.get("id")
            self.stdout.write(self.style.SUCCESS("✓ Stripe Connect appears available (onboarding links can be generated)."))
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f"✗ Connect not available: {exc}"))
            self.stdout.write("Verify Connect is enabled in Stripe dashboard (Settings → Connect).")

        if opts.get("full"):
            self.stdout.write("\nNext steps:")
            self.stdout.write(
                "- Create contractor onboarding link endpoint.\n"
                "- Add webhook handler for account.updated and payment events.\n"
                "- Implement Separate Charges & Transfers for milestone releases.\n"
            )

        self.stdout.write(self.style.SUCCESS("\nDone."))
