from __future__ import annotations

import os
import re
import hashlib
from typing import Optional, Tuple, List, Dict

from django.core.management.base import BaseCommand
from django.conf import settings
from django.core.files.base import ContentFile

from projects.models import Agreement, AgreementPDFVersion


RE_V = re.compile(r"agreement_(?P<aid>\d+)_v(?P<vnum>\d+)(?:_[a-zA-Z]+)?\.pdf$", re.IGNORECASE)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_agreement_version(filename: str) -> Optional[Tuple[int, int]]:
    m = RE_V.search(os.path.basename(filename))
    if not m:
        return None
    return int(m.group("aid")), int(m.group("vnum"))


def candidate_dirs() -> List[str]:
    media = getattr(settings, "MEDIA_ROOT", "") or ""
    return [
        os.path.join(media, "agreements", "pdf"),
        os.path.join(media, "agreements", "tmp"),
        os.path.join(media, "agreements", "pdf_versions"),
    ]


def preference_score(path: str) -> int:
    """
    Prefer:
      0) agreements/pdf/
      1) agreements/pdf_versions/
      2) agreements/tmp/
    Lower is better.
    """
    p = path.replace("\\", "/")
    if "/agreements/pdf/" in p:
        return 0
    if "/agreements/pdf_versions/" in p:
        return 1
    if "/agreements/tmp/" in p:
        return 2
    return 9


class Command(BaseCommand):
    help = "Backfill AgreementPDFVersion rows from existing PDF files on disk."

    def add_arguments(self, parser):
        parser.add_argument("--agreement-id", type=int, default=None, help="Only backfill a specific Agreement ID")
        parser.add_argument("--dry-run", action="store_true", help="Print what would happen without writing DB/files")

    def handle(self, *args, **opts):
        agreement_id = opts.get("agreement_id")
        dry_run = bool(opts.get("dry_run"))

        dirs = [d for d in candidate_dirs() if d and os.path.isdir(d)]
        if not dirs:
            self.stdout.write(self.style.WARNING("No candidate directories exist under MEDIA_ROOT. Nothing to backfill."))
            return

        self.stdout.write("Scanning directories:\n- " + "\n- ".join(dirs))

        # Collect best path per (agreement, version)
        best: Dict[Tuple[int, int], str] = {}

        for d in dirs:
            for root, _subdirs, files in os.walk(d):
                for fn in files:
                    if not fn.lower().endswith(".pdf"):
                        continue
                    parsed = parse_agreement_version(fn)
                    if not parsed:
                        continue
                    aid, vnum = parsed
                    if agreement_id and aid != agreement_id:
                        continue

                    path = os.path.join(root, fn)
                    key = (aid, vnum)
                    if key not in best:
                        best[key] = path
                    else:
                        # choose preferred copy
                        cur = best[key]
                        if preference_score(path) < preference_score(cur):
                            best[key] = path

        if not best:
            self.stdout.write(self.style.WARNING("No versioned agreement PDFs found matching pattern agreement_<id>_v<version>.pdf"))
            return

        # Sort keys: agreement then version asc
        keys = sorted(best.keys(), key=lambda t: (t[0], t[1]))

        created_count = 0
        skipped_count = 0

        for aid, vnum in keys:
            path = best[(aid, vnum)]

            try:
                ag = Agreement.objects.get(pk=aid)
            except Agreement.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"Skip {path} (Agreement {aid} not found)"))
                skipped_count += 1
                continue

            if AgreementPDFVersion.objects.filter(agreement=ag, version_number=vnum).exists():
                self.stdout.write(f"Exists: Agreement {aid} v{vnum} -> skip")
                skipped_count += 1
                continue

            h = sha256_file(path)
            kind = AgreementPDFVersion.KIND_FINAL

            rel = os.path.relpath(path, getattr(settings, "MEDIA_ROOT", "") or "")
            msg = f"Create: Agreement {aid} v{vnum} ({kind}) sha={h[:12]}… from {rel}"

            if dry_run:
                self.stdout.write(self.style.NOTICE("[DRY RUN] " + msg))
                created_count += 1
                continue

            with open(path, "rb") as f:
                data = f.read()

            obj = AgreementPDFVersion.objects.create(
                agreement=ag,
                version_number=vnum,
                kind=kind,
                sha256=h,
                signed_by_contractor=bool(getattr(ag, "signed_by_contractor", False)),
                signed_by_homeowner=bool(getattr(ag, "signed_by_homeowner", False)),
                contractor_signature_name=getattr(ag, "contractor_signature_name", "") or "",
                homeowner_signature_name=getattr(ag, "homeowner_signature_name", "") or "",
                contractor_signed_at=getattr(ag, "signed_at_contractor", None),
                homeowner_signed_at=getattr(ag, "signed_at_homeowner", None),
            )

            # Store a consistent filename under agreements/pdf_versions/
            out_name = f"agreement_{aid}_v{vnum}.pdf"
            obj.file.save(out_name, ContentFile(data), save=True)

            self.stdout.write(self.style.SUCCESS(msg))
            created_count += 1

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Done. Created={created_count}, Skipped={skipped_count}"))