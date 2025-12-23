from rest_framework import serializers
from ..models import Invoice, MilestoneComment, MilestoneFile


class InvoiceSerializer(serializers.ModelSerializer):
    # Context helpers
    homeowner_name = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()
    project_title = serializers.SerializerMethodField()
    agreement_id = serializers.SerializerMethodField()

    # ✅ Required by your UI
    milestone_id = serializers.SerializerMethodField()
    milestone_title = serializers.SerializerMethodField()
    milestone_description = serializers.SerializerMethodField()

    # ✅ Extra: used for "wire up properly"
    milestone_completion_notes = serializers.SerializerMethodField()
    milestone_attachments = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "status",
            "amount",
            "created_at",
            "approved_at",

            # Relations
            "agreement",

            # Computed context
            "agreement_id",
            "homeowner_name",
            "homeowner_email",
            "project_title",

            # ✅ milestone snapshot/context
            "milestone_id",
            "milestone_title",
            "milestone_description",
            "milestone_completion_notes",
            "milestone_attachments",

            # Email tracking
            "email_sent_at",
            "email_message_id",
            "last_email_error",
        ]

    def get_agreement_id(self, obj):
        return getattr(obj.agreement, "id", None)

    def get_homeowner_name(self, obj):
        agreement = obj.agreement
        project = getattr(agreement, "project", None)
        homeowner = getattr(project, "homeowner", None) if project else None
        if homeowner:
            return getattr(homeowner, "full_name", None) or getattr(homeowner, "name", None) or "Homeowner"
        return None

    def get_homeowner_email(self, obj):
        agreement = obj.agreement
        project = getattr(agreement, "project", None)
        homeowner = getattr(project, "homeowner", None) if project else None
        if homeowner:
            return getattr(homeowner, "email", None)
        return None

    def get_project_title(self, obj):
        agreement = obj.agreement
        project = getattr(agreement, "project", None)
        return getattr(project, "title", None) if project else None

    # -----------------------------
    # ✅ Milestone wiring (snapshot-first)
    # -----------------------------

    def _source_milestone(self, obj):
        # reverse link from Milestone.invoice -> related_name="source_milestone"
        return getattr(obj, "source_milestone", None)

    def get_milestone_id(self, obj):
        snap = getattr(obj, "milestone_id_snapshot", None)
        if snap:
            return snap
        m = self._source_milestone(obj)
        return getattr(m, "id", None) if m else None

    def get_milestone_title(self, obj):
        snap = (getattr(obj, "milestone_title_snapshot", "") or "").strip()
        if snap:
            return snap
        m = self._source_milestone(obj)
        if not m:
            return None
        return getattr(m, "title", None) or getattr(m, "name", None)

    def get_milestone_description(self, obj):
        snap = (getattr(obj, "milestone_description_snapshot", "") or "").strip()
        if snap:
            return snap
        m = self._source_milestone(obj)
        return getattr(m, "description", None) if m else None

    def get_milestone_completion_notes(self, obj):
        snap = (getattr(obj, "milestone_completion_notes", "") or "").strip()
        if snap:
            return snap

        # fallback: build from comments (if linked)
        m = self._source_milestone(obj)
        if not m:
            return ""
        qs = MilestoneComment.objects.filter(milestone=m).order_by("created_at")
        lines = []
        for c in qs:
            content = (getattr(c, "content", "") or "").strip()
            if content:
                lines.append(f"- {content}")
        return "\n".join(lines).strip()

    def get_milestone_attachments(self, obj):
        snap = getattr(obj, "milestone_attachments_snapshot", None)
        if isinstance(snap, list) and snap:
            return snap

        # fallback: build from milestone files if linked
        m = self._source_milestone(obj)
        if not m:
            return []
        request = self.context.get("request")
        qs = MilestoneFile.objects.filter(milestone=m).order_by("-uploaded_at")
        out = []
        for f in qs:
            if not getattr(f, "file", None):
                continue
            try:
                url = request.build_absolute_uri(f.file.url) if request else f.file.url
            except Exception:
                url = f.file.url
            out.append({
                "id": f.id,
                "name": getattr(f.file, "name", "") or f"file_{f.id}",
                "url": url,
                "uploaded_at": getattr(f, "uploaded_at", None).isoformat() if getattr(f, "uploaded_at", None) else None,
            })
        return out
