"""Prepare homeowner guide drafts without recording review or publication."""
import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone


CATALOG = Path(__file__).resolve().parents[2] / "data" / "homeowner_guides_v1.json"


def draft_fields(guide):
    return {
        "name": guide["title"],
        "project_type": guide["project_type"],
        "public_title": guide["title"],
        "public_slug": guide["slug"],
        "public_category_slug": guide["category"],
        "public_summary": guide["summary"],
        "public_intro": guide["intro"],
        "description": guide["intro"],
        "default_scope": guide["scope"],
        "preparation": guide["preparation"],
        "safety_guidance": guide["safety"],
        "cost_guidance": guide["cost"],
        "tools_guidance": guide["tools"],
        "common_mistakes": guide["mistakes"],
        "diy_guidance": guide["diy"],
        "pro_guidance": guide["pro"],
        "difficulty": guide["difficulty"],
        "public_sections": [
            {"id": key, "title": title, "body": body}
            for key, title, body in guide["sections"]
        ] + [{
            "id": "guide-sources",
            "title": "Sources and local checks",
            "body": "\n".join(f"{label} | {url}" for label, url in guide["sources"]),
        }],
        "public_faqs": [{"question": q, "answer": a} for q, a in guide["faqs"]],
        "public_audience": "homeowner",
        "public_audiences": ["homeowner"],
        "public_audience_actions": {"homeowner": "create_project"},
        "public_next_action": "create_project",
        "public_editorial_brief": {
            "series": "san_antonio_homeowner_guides_v1",
            "source_check_date": "2026-11-16",
            "review_needed": "Owner review of accuracy, tone and DIY limits before publication.",
            "diy_plan_scope": guide["diy"],
        },
        "seo_title": {
            "bathroom-renovation-planning-guide": "Bathroom Renovation: DIY & Hiring Guide | MyHomeBro",
            "shed-planning-and-finishing-guide": "Backyard Shed: Planning & DIY Finishing Guide | MyHomeBro",
            "deck-planning-and-care-guide": "Deck Planning, Hiring & DIY Care Guide | MyHomeBro",
            "patio-planning-and-paver-guide": "Patio Planning, Hiring & DIY Paver Guide | MyHomeBro",
        }[guide["slug"]],
        "seo_description": guide["summary"][:170].rsplit(" ", 1)[0],
        "is_system": True,
        "is_published": False,
        "allow_discovery": False,
        "public_publication_status": "ready_for_review",
    }


class Command(BaseCommand):
    help = "Prepare bathroom, shed, deck and patio guide drafts. Default is a dry run. Never reviews or publishes."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Create missing guide drafts; existing articles are untouched.")

    @transaction.atomic
    def handle(self, *args, **options):
        guides = json.loads(CATALOG.read_text(encoding="utf-8"))
        for guide in guides:
            if ProjectTemplate.objects.filter(public_slug=guide["slug"]).exists():
                self.stdout.write(f"SKIP existing: {guide['slug']}")
                continue
            article = ProjectTemplate(**draft_fields(guide))
            article.full_clean()
            if not options["apply"]:
                self.stdout.write(f"DRY RUN valid draft: {guide['slug']}")
                continue
            article.save()
            for index, (key, title, body) in enumerate(guide["sections"], start=1):
                if key.startswith("diy-") and key[4:].isdigit():
                    ProjectTemplateMilestone.objects.create(
                        template=article, title=title, description=body, sort_order=index,
                    )
            self.stdout.write(f"READY FOR REVIEW: {article.pk} /app/admin/improvements/preview/{article.public_slug}")
        self.stdout.write("No review recorded. No articles published. Existing content was not overwritten.")
