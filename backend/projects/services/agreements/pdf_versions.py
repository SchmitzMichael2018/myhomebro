from __future__ import annotations

import hashlib
from django.core.files.base import ContentFile
from projects.models import Agreement, AgreementPDFVersion


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def record_pdf_version(
    ag: Agreement,
    pdf_bytes: bytes,
    *,
    version_number: int,
    kind: str = AgreementPDFVersion.KIND_FINAL,
) -> AgreementPDFVersion:
    """
    Persist a queryable PDF version record. Also stores sha256 + signature snapshot.
    """
    sha = _sha256_bytes(pdf_bytes)

    row = AgreementPDFVersion.objects.create(
        agreement=ag,
        version_number=int(version_number),
        kind=kind,
        sha256=sha,
        signed_by_contractor=bool(getattr(ag, "signed_by_contractor", False)),
        signed_by_homeowner=bool(getattr(ag, "signed_by_homeowner", False)),
        contractor_signature_name=(getattr(ag, "contractor_signature_name", "") or ""),
        homeowner_signature_name=(getattr(ag, "homeowner_signature_name", "") or ""),
        contractor_signed_at=getattr(ag, "signed_at_contractor", None),
        homeowner_signed_at=getattr(ag, "signed_at_homeowner", None),
    )

    fname = f"agreement_{ag.id}_v{version_number}.pdf"
    row.file.save(fname, ContentFile(pdf_bytes), save=True)
    return row