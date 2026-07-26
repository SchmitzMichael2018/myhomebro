from projects.models import CaptureArtifact, WarrantyRequestEvidence
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class WarrantyEvidenceAdapter(CaptureDestinationAdapter):
    name = "warranty_evidence"

    def validate(self, context):
        if context.records.get("warranty_request") is None:
            raise CaptureAdapterError("Apply the warranty request before its evidence.")

    def preview(self, context):
        return {
            "action": "create", "record_type": "warranty_evidence",
            "label": f"{context.capture.artifacts.count()} evidence file(s)",
            "fields": {"count": context.capture.artifacts.count()}, "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        rows = []
        for artifact in context.capture.artifacts.all():
            evidence_type = (
                WarrantyRequestEvidence.TYPE_PHOTO
                if artifact.artifact_type == CaptureArtifact.TYPE_PHOTO
                else WarrantyRequestEvidence.TYPE_DOCUMENT
            )
            row, created = WarrantyRequestEvidence.objects.get_or_create(
                warranty_request=context.records["warranty_request"],
                original_filename=artifact.original_filename,
                defaults={
                    "file": artifact.file.name,
                    "evidence_type": evidence_type,
                    "description": "Evidence preserved from approved Capture.",
                    "content_type": artifact.mime_type,
                    "size_bytes": artifact.file_size,
                    "uploaded_by": context.actor,
                    "uploaded_by_email": getattr(context.actor, "email", ""),
                },
            )
            rows.append(row)
            if created:
                context.created_records.append({
                    "type": "warranty_evidence", "id": row.id,
                    "label": row.original_filename, "url": "/app/warranties",
                })
        return rows
