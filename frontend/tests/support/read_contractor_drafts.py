"""Read the three locally migrated editorial drafts for browser preview QA.

This uses a read-only SQLite connection and emits only public editorial fields.
It must never be pointed at the production database.
"""

import json
import sqlite3
import sys
from pathlib import Path


SLUGS = (
    "contractor-payment-plan",
    "contractor-deposit-vs-milestones",
    "contractor-change-orders",
)
FIELDS = (
    "id", "public_slug", "public_category_slug", "public_title", "public_summary",
    "public_audience", "public_problem", "public_evidence", "public_evidence_source",
    "public_viewpoint", "public_practical_steps", "public_next_action",
    "public_publication_status", "public_reviewed_at", "seo_title", "seo_description",
    "public_video_url", "public_video_title", "public_video_description",
    "public_video_poster_url", "public_video_text_summary", "public_video_transcript_url",
)


def main():
    db_path = Path(sys.argv[1]).resolve()
    if not db_path.is_file() or db_path.name != "improvement-preview.sqlite3":
        raise SystemExit("Expected the dedicated local improvement-preview.sqlite3 database.")
    with sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        placeholders = ", ".join("?" for _ in SLUGS)
        rows = connection.execute(
            f"SELECT {', '.join(FIELDS)} FROM projects_projecttemplate "
            f"WHERE public_slug IN ({placeholders}) ORDER BY public_slug",
            SLUGS,
        ).fetchall()
    if len(rows) != len(SLUGS) or any(row["public_publication_status"] != "draft" for row in rows):
        raise SystemExit("Expected exactly three saved contractor drafts; no screenshot generated.")
    payloads = []
    for row in rows:
        slug = row["public_slug"]
        category = row["public_category_slug"]
        payloads.append({
            "id": row["id"],
            "slug": slug,
            "category_slug": category,
            "category_name": "Contractor Practice",
            "title": row["public_title"],
            "summary": row["public_summary"],
            "audience": row["public_audience"],
            "audience_label": "Contractors",
            "problem": row["public_problem"],
            "evidence": row["public_evidence"],
            "evidence_source": row["public_evidence_source"],
            "viewpoint": row["public_viewpoint"],
            "practical_steps": row["public_practical_steps"],
            "next_action": row["public_next_action"],
            "publication_status": row["public_publication_status"],
            "reviewed_at": row["public_reviewed_at"],
            "seo_title": row["seo_title"],
            "seo_description": row["seo_description"],
            "canonical_path": f"/improvements/{category}/{slug}/",
            "social_image": "/static/social/myhomebro-default-1200x630.png",
            "faqs": [],
            "milestones": [],
            "related": [],
            "video": None,
        })
    print(json.dumps(payloads))


if __name__ == "__main__":
    main()
