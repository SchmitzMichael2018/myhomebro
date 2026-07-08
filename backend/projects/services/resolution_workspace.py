from __future__ import annotations

import hashlib
from io import BytesIO

from django.core.files.base import ContentFile
from django.utils import timezone

from projects.models_dispute import (
    Dispute,
    DisputeAttachment,
    ResolutionAgreement,
    ResolutionAgreementSignature,
    ResolutionCaseAuditEvent,
    ResolutionCaseTimelineEvent,
    ResolutionDocument,
    ResolutionEvidenceIndex,
    ResolutionPartyStatement,
    ResolutionProposal,
)


def _actor_label(actor) -> str:
    return (getattr(actor, "email", "") or getattr(actor, "username", "") or "System").strip()


def record_timeline_event(
    dispute: Dispute,
    event_type: str,
    title: str,
    *,
    actor=None,
    description: str = "",
    related_object=None,
    visibility: str = ResolutionCaseTimelineEvent.VISIBILITY_ALL,
    metadata: dict | None = None,
) -> ResolutionCaseTimelineEvent:
    event = ResolutionCaseTimelineEvent.objects.create(
        dispute=dispute,
        event_type=event_type,
        title=title,
        description=description or "",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        related_object_type=related_object.__class__.__name__ if related_object is not None else "",
        related_object_id=getattr(related_object, "id", None),
        visibility=visibility,
        metadata=metadata or {},
    )
    ResolutionCaseAuditEvent.objects.create(
        dispute=dispute,
        action=event_type,
        actor=event.actor,
        summary=title,
        after={
            "description": description or "",
            "related_object_type": event.related_object_type,
            "related_object_id": event.related_object_id,
        },
        metadata=metadata or {},
    )
    return event


def ensure_case_created_event(dispute: Dispute, *, actor=None) -> None:
    if ResolutionCaseTimelineEvent.objects.filter(
        dispute=dispute,
        event_type=ResolutionCaseTimelineEvent.EVENT_CASE_CREATED,
    ).exists():
        return
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_CASE_CREATED,
        "Resolution case created",
        actor=actor or getattr(dispute, "created_by", None),
        description=getattr(dispute, "description", "") or getattr(dispute, "reason", ""),
        related_object=dispute,
        metadata={
            "source_type": getattr(dispute, "source_type", ""),
            "source_object_id": getattr(dispute, "source_object_id", None),
            "agreement_id": getattr(dispute, "agreement_id", None),
            "project_id": getattr(dispute, "project_id", None),
        },
    )


def infer_party_role(user, dispute: Dispute) -> str:
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return ResolutionPartyStatement.ROLE_ADMIN
    if getattr(dispute, "created_by_id", None) == getattr(user, "id", None):
        return ResolutionPartyStatement.ROLE_CONTRACTOR
    email = (getattr(user, "email", "") or "").strip().lower()
    agreement = getattr(dispute, "agreement", None)
    contractor = getattr(agreement, "contractor", None) if agreement else None
    contractor_email = (getattr(contractor, "email", "") or "").strip().lower()
    contractor_user_email = (getattr(getattr(contractor, "user", None), "email", "") or "").strip().lower()
    if email and email in {contractor_email, contractor_user_email}:
        return ResolutionPartyStatement.ROLE_CONTRACTOR
    return ResolutionPartyStatement.ROLE_CUSTOMER


def create_party_statement(
    dispute: Dispute,
    *,
    author=None,
    text: str,
    party_role: str | None = None,
    statement_type: str | None = None,
    visibility: str = ResolutionCaseTimelineEvent.VISIBILITY_ALL,
    metadata: dict | None = None,
) -> ResolutionPartyStatement:
    role = party_role or infer_party_role(author, dispute)
    stype = statement_type
    if not stype:
        stype = {
            ResolutionPartyStatement.ROLE_CONTRACTOR: ResolutionPartyStatement.TYPE_CONTRACTOR,
            ResolutionPartyStatement.ROLE_ADMIN: ResolutionPartyStatement.TYPE_ADMIN,
        }.get(role, ResolutionPartyStatement.TYPE_CUSTOMER)

    latest = (
        ResolutionPartyStatement.objects.filter(dispute=dispute, party_role=role, is_current=True)
        .order_by("-version", "-id")
        .first()
    )
    version = (latest.version + 1) if latest else 1
    if latest:
        latest.is_current = False
        latest.save(update_fields=["is_current"])

    statement = ResolutionPartyStatement.objects.create(
        dispute=dispute,
        statement_type=stype,
        party_role=role,
        author=author if getattr(author, "is_authenticated", False) else None,
        text=text,
        version=version,
        supersedes=latest,
        visibility=visibility,
        metadata=metadata or {},
    )
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_STATEMENT_SUBMITTED,
        f"{role.title()} statement submitted",
        actor=author,
        description=text[:500],
        related_object=statement,
        visibility=visibility,
        metadata={"statement_id": statement.id, "version": version},
    )
    return statement


def _category_from_attachment_kind(kind: str) -> str:
    kind = str(kind or "").strip().lower()
    mapping = {
        "photo": ResolutionEvidenceIndex.CATEGORY_PHOTO,
        "receipt": ResolutionEvidenceIndex.CATEGORY_RECEIPT,
        "agreement": ResolutionEvidenceIndex.CATEGORY_AGREEMENT,
        "milestone": ResolutionEvidenceIndex.CATEGORY_DOCUMENT,
        "document": ResolutionEvidenceIndex.CATEGORY_DOCUMENT,
        "invoice": ResolutionEvidenceIndex.CATEGORY_INVOICE,
    }
    return mapping.get(kind, ResolutionEvidenceIndex.CATEGORY_OTHER)


def index_evidence(
    dispute: Dispute,
    attachment: DisputeAttachment,
    *,
    actor=None,
    description: str = "",
    category: str = "",
    related_party: str = "",
    metadata: dict | None = None,
) -> ResolutionEvidenceIndex:
    evidence, _created = ResolutionEvidenceIndex.objects.update_or_create(
        attachment=attachment,
        defaults={
            "dispute": dispute,
            "category": category or _category_from_attachment_kind(getattr(attachment, "kind", "")),
            "description": description or "",
            "uploaded_by": getattr(attachment, "uploaded_by", None) or (actor if getattr(actor, "is_authenticated", False) else None),
            "uploaded_at": getattr(attachment, "uploaded_at", None) or timezone.now(),
            "related_party": related_party or infer_party_role(actor, dispute),
            "related_source_type": getattr(dispute, "source_type", ""),
            "related_source_object_id": getattr(dispute, "source_object_id", None),
            "metadata": metadata or {},
        },
    )
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_EVIDENCE_UPLOADED,
        "Evidence uploaded",
        actor=actor,
        description=description or getattr(attachment, "file", ""),
        related_object=evidence,
        metadata={"evidence_id": evidence.id, "attachment_id": attachment.id, "category": evidence.category},
    )
    return evidence


def create_resolution_proposal(
    dispute: Dispute,
    *,
    proposed_by,
    problem_statement: str = "",
    proposed_solution: str,
    required_actions=None,
    deadlines=None,
    payment_impact=None,
    warranty_impact: str = "",
    evidence_relied_upon=None,
    status: str = ResolutionProposal.STATUS_PROPOSED,
    metadata: dict | None = None,
) -> ResolutionProposal:
    proposal = ResolutionProposal.objects.create(
        dispute=dispute,
        proposed_by=proposed_by if getattr(proposed_by, "is_authenticated", False) else None,
        problem_statement=problem_statement or getattr(dispute, "description", "") or getattr(dispute, "reason", ""),
        proposed_solution=proposed_solution,
        required_actions=required_actions or [],
        deadlines=deadlines or [],
        payment_impact=payment_impact or {},
        warranty_impact=warranty_impact or "",
        evidence_relied_upon=evidence_relied_upon or [],
        status=status,
        metadata=metadata or {},
    )
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_RESOLUTION_PROPOSED,
        "Resolution proposal submitted",
        actor=proposed_by,
        description=proposed_solution[:500],
        related_object=proposal,
        metadata={"proposal_id": proposal.id, "status": proposal.status},
    )
    return proposal


def create_resolution_agreement_from_proposal(
    proposal: ResolutionProposal,
    *,
    created_by,
    human_decision_summary: str = "",
) -> ResolutionAgreement:
    dispute = proposal.dispute
    agreement = ResolutionAgreement.objects.create(
        dispute=dispute,
        proposal=proposal,
        project=getattr(dispute, "project", None),
        agreement=dispute.agreement,
        source_type=getattr(dispute, "source_type", ""),
        source_object_id=getattr(dispute, "source_object_id", None),
        problem_statement=proposal.problem_statement,
        disputed_facts=[],
        undisputed_facts=[],
        agreed_solution=proposal.proposed_solution,
        required_actions=proposal.required_actions or [],
        deadlines=proposal.deadlines or [],
        payment_changes=proposal.payment_impact or {},
        warranty_impact=proposal.warranty_impact or "",
        future_obligations="",
        evidence_reviewed=proposal.evidence_relied_upon or [],
        human_decision_summary=human_decision_summary or "Human users approved this proposal for signature.",
        audit_summary="Created from a human-edited resolution proposal. AI analysis, if present, remains advisory only.",
        status=ResolutionAgreement.STATUS_READY_FOR_SIGNATURE,
        created_by=created_by if getattr(created_by, "is_authenticated", False) else None,
    )
    proposal.status = ResolutionProposal.STATUS_READY_FOR_SIGNATURE
    proposal.save(update_fields=["status", "updated_at"])
    record_timeline_event(
        dispute,
        ResolutionCaseTimelineEvent.EVENT_HUMAN_DECISION_RECORDED,
        "Resolution agreement prepared for signature",
        actor=created_by,
        description=agreement.human_decision_summary,
        related_object=agreement,
        metadata={"resolution_agreement_id": agreement.id, "proposal_id": proposal.id},
    )
    return agreement


def sign_resolution_agreement(
    resolution_agreement: ResolutionAgreement,
    *,
    signer,
    signer_role: str,
    signer_name: str,
    ip_address: str = "",
    user_agent: str = "",
    signature_text: str = "",
) -> ResolutionAgreementSignature:
    if resolution_agreement.status == ResolutionAgreement.STATUS_SIGNED:
        raise ValueError("Signed resolution agreements are locked.")

    signature, _created = ResolutionAgreementSignature.objects.update_or_create(
        resolution_agreement=resolution_agreement,
        signer_role=signer_role,
        defaults={
            "signer": signer if getattr(signer, "is_authenticated", False) else None,
            "signer_name": signer_name,
            "signed_at": timezone.now(),
            "ip_address": ip_address or None,
            "user_agent": user_agent or "",
            "signature_text": signature_text or signer_name,
        },
    )
    roles = set(resolution_agreement.signatures.values_list("signer_role", flat=True))
    required = {ResolutionAgreementSignature.ROLE_CUSTOMER, ResolutionAgreementSignature.ROLE_CONTRACTOR}
    if required.issubset(roles):
        resolution_agreement.status = ResolutionAgreement.STATUS_SIGNED
        resolution_agreement.locked_at = timezone.now()
        resolution_agreement.save(update_fields=["status", "locked_at", "updated_at"])
        proposal = resolution_agreement.proposal
        if proposal:
            proposal.status = ResolutionProposal.STATUS_SIGNED
            proposal.save(update_fields=["status", "updated_at"])
    else:
        resolution_agreement.status = ResolutionAgreement.STATUS_PARTIALLY_SIGNED
        resolution_agreement.save(update_fields=["status", "updated_at"])

    record_timeline_event(
        resolution_agreement.dispute,
        ResolutionCaseTimelineEvent.EVENT_AGREEMENT_SIGNED,
        f"Resolution agreement signed by {signer_role}",
        actor=signer,
        description=f"Signed by {signer_name}",
        related_object=signature,
        metadata={"resolution_agreement_id": resolution_agreement.id, "signer_role": signer_role},
    )
    return signature


def _build_resolution_pdf_bytes(resolution_agreement: ResolutionAgreement) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    dispute = resolution_agreement.dispute
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    y = height - 54

    def line(text: str, size: int = 10, bold: bool = False):
        nonlocal y
        if y < 60:
            pdf.showPage()
            y = height - 54
        pdf.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        for chunk in str(text or "").splitlines() or [""]:
            pdf.drawString(54, y, chunk[:105])
            y -= size + 5

    line("MyHomeBro Resolution Agreement Package", 16, True)
    line(f"Resolution Case #{dispute.id}", 12, True)
    line(f"Original Agreement: #{getattr(dispute, 'agreement_id', '')}")
    line(f"Source: {resolution_agreement.source_type or getattr(dispute, 'source_type', '')} #{resolution_agreement.source_object_id or ''}")
    line("")
    line("Problem Statement", 12, True)
    line(resolution_agreement.problem_statement)
    line("Agreed Resolution", 12, True)
    line(resolution_agreement.agreed_solution)
    line("Payment Changes", 12, True)
    line(resolution_agreement.payment_changes)
    line("Warranty Impact", 12, True)
    line(resolution_agreement.warranty_impact or "No warranty impact recorded.")
    line("Human Decision Summary", 12, True)
    line(resolution_agreement.human_decision_summary)
    line("Advisory AI Notice", 12, True)
    line("AI analysis, if included in this case, is advisory only and did not decide the outcome or move funds.")
    line("Signature Records", 12, True)
    for sig in resolution_agreement.signatures.all():
        line(f"{sig.signer_role}: {sig.signer_name} at {sig.signed_at.isoformat()}")
    line("Timeline Summary", 12, True)
    for event in dispute.timeline_events.all()[:40]:
        line(f"{event.occurred_at.isoformat()} - {event.title}")

    pdf.save()
    return buffer.getvalue()


def generate_resolution_pdf_package(
    resolution_agreement: ResolutionAgreement,
    *,
    generated_by,
) -> ResolutionDocument:
    if resolution_agreement.status != ResolutionAgreement.STATUS_SIGNED:
        raise ValueError("Resolution PDF package requires all required signatures.")
    data = _build_resolution_pdf_bytes(resolution_agreement)
    digest = hashlib.sha256(data).hexdigest()
    document = ResolutionDocument.objects.create(
        dispute=resolution_agreement.dispute,
        resolution_agreement=resolution_agreement,
        document_type=ResolutionDocument.TYPE_PDF_PACKAGE,
        title=f"Resolution Case {resolution_agreement.dispute_id} Package",
        generated_by=generated_by if getattr(generated_by, "is_authenticated", False) else None,
        sha256=digest,
        metadata={"stored_in": ["resolution_case_documents"], "project_id": getattr(resolution_agreement, "project_id", None)},
    )
    document.file.save(
        f"resolution-case-{resolution_agreement.dispute_id}-agreement-{resolution_agreement.id}.pdf",
        ContentFile(data),
        save=True,
    )
    record_timeline_event(
        resolution_agreement.dispute,
        ResolutionCaseTimelineEvent.EVENT_PDF_GENERATED,
        "Resolution PDF package generated",
        actor=generated_by,
        description=document.title,
        related_object=document,
        metadata={"resolution_document_id": document.id, "sha256": digest},
    )
    return document
