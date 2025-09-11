# backend/backend/projects/serializers.py
from datetime import timedelta
from django.db import transaction
from django.contrib.auth import get_user_model
from django.utils.text import slugify
from rest_framework import serializers

from .utils import categorize_project, load_legal_text
from .models import (
    Project,
    Agreement,
    AgreementAmendment,
    Invoice,
    Contractor,
    Homeowner,
    Milestone,
    MilestoneFile,
    MilestoneComment,
    Expense,
    Skill,
    ProjectStatus,
)

# ---------------- Homeowners ----------------

class HomeownerWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Homeowner
        fields = [
            "full_name", "email", "phone_number", "status",
            "street_address", "address_line_2", "city", "state", "zip_code",
        ]
        read_only_fields = ["created_by"]

    def validate_phone_number(self, value):
        if not value:
            return ""
        return "".join(filter(str.isdigit, value))


class HomeownerSerializer(serializers.ModelSerializer):
    active_projects_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Homeowner
        fields = [
            "id", "full_name", "email", "phone_number", "status", "created_at",
            "active_projects_count", "street_address", "address_line_2",
            "city", "state", "zip_code",
        ]
        read_only_fields = fields


# ---------------- Contractors & Skills ----------------

class SkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = Skill
        fields = ["id", "name", "slug"]
        read_only_fields = ["id", "name", "slug"]


class ContractorDetailSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(source="user.get_full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    skills = SkillSerializer(many=True, read_only=True)

    class Meta:
        model = Contractor
        fields = [
            "id", "business_name", "name", "email", "phone",
            "skills", "license_number", "license_expiration",
            "logo", "license_file", "address",
            "stripe_account_id", "onboarding_status",
        ]
        read_only_fields = fields


class ContractorWriteSerializer(serializers.ModelSerializer):
    """
    Write serializer for Contractor with flexible 'skills' and user updates.
    - Accepts skills as a list of ints (IDs) or strings (slugs/names).
    - Allows updating the linked User's full_name and email.
    """
    skills = serializers.ListField(
        child=serializers.CharField(),  # can be int or str; we coerce below
        required=False,
        help_text="List of Skill IDs, slugs, or names",
    )
    full_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Contractor
        fields = [
            "business_name",
            "phone",
            "address",
            "license_number",
            "license_expiration",
            "logo",
            "license_file",
            "stripe_account_id",
            "onboarding_status",
            "skills",
            # write-through to User
            "full_name",
            "email",
        ]

    # Normalize phone to digits
    def validate_phone(self, value):
        return "".join(filter(str.isdigit, value or ""))

    def _resolve_skills(self, items):
        """
        Return a queryset of Skill from a mixed list of ints or strings (slug/name).
        """
        if items is None:
            return None
        ids, names = [], []
        for it in items:
            if isinstance(it, int) or (isinstance(it, str) and it.isdigit()):
                ids.append(int(it))
            elif isinstance(it, str) and it.strip():
                names.append(it.strip())
        qs = Skill.objects.none()
        if ids:
            qs = qs | Skill.objects.filter(pk__in=ids)
        if names:
            slugs = [slugify(n) for n in names]
            qs = qs | Skill.objects.filter(slug__in=slugs) | Skill.objects.filter(name__in=names)
        return qs.distinct()

    def update(self, instance, validated_data):
        # Pull write-through fields for User
        full_name = validated_data.pop("full_name", None)
        new_email = validated_data.pop("email", None)

        # Skills (flexible)
        skill_items = validated_data.pop("skills", None)
        skills_qs = self._resolve_skills(skill_items) if skill_items is not None else None

        # Update contractor fields
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()

        # Apply skills (if provided)
        if skills_qs is not None:
            instance.skills.set(skills_qs)

        # Update linked user (name/email)
        user = instance.user
        changed = []
        if full_name:
            parts = full_name.strip().split(" ", 1)
            user.first_name = parts[0]
            user.last_name = parts[1] if len(parts) > 1 else ""
            changed += ["first_name", "last_name"]

        if new_email and new_email != user.email:
            User = get_user_model()
            if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
                raise serializers.ValidationError({"email": "This email is already in use."})
            user.email = new_email
            changed.append("email")

        if changed:
            user.save(update_fields=changed)

        return instance


class PublicContractorSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.get_full_name", read_only=True)
    skills = SkillSerializer(many=True, read_only=True)
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Contractor
        fields = ["id", "business_name", "name", "skills", "license_number", "license_expiration", "logo_url"]
        # IMPORTANT: make this explicit (don’t reference 'fields' from outside this Meta scope)
        read_only_fields = ["id", "business_name", "name", "skills", "license_number", "license_expiration", "logo_url"]

    def get_logo_url(self, obj):
        request = self.context.get("request")
        url = ""
        try:
            url = obj.logo.url if obj.logo else ""
        except Exception:
            pass
        return request.build_absolute_uri(url) if (request and url) else url


# ---------------- Milestones + Files + Comments ----------------

class MilestoneFileSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    file_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MilestoneFile
        fields = ["id", "file", "file_url", "uploaded_by", "uploaded_by_name", "uploaded_at"]
        read_only_fields = ["id", "file_url", "uploaded_by_name", "uploaded_at"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        url = ""
        try:
            url = obj.file.url
        except Exception:
            pass
        return request.build_absolute_uri(url) if (request and url) else url

    def get_uploaded_by_name(self, obj):
        u = getattr(obj, "uploaded_by", None)
        if not u:
            return ""
        name = getattr(u, "get_full_name", lambda: "")()
        return name or getattr(u, "email", "") or ""


class MilestoneCommentSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = MilestoneComment
        fields = ["id", "author", "author_name", "content", "created_at"]
        read_only_fields = ["id", "author_name", "created_at"]

    def get_author_name(self, obj):
        u = getattr(obj, "author", None)
        if not u:
            return "Deleted User"
        name = getattr(u, "get_full_name", lambda: "")()
        return name or getattr(u, "email", "") or "User"


class MilestoneSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    file_count = serializers.IntegerField(read_only=True)
    comment_count = serializers.IntegerField(read_only=True)
    invoice_id = serializers.IntegerField(read_only=True)
    files = MilestoneFileSerializer(many=True, read_only=True)
    comments = MilestoneCommentSerializer(many=True, read_only=True)

    class Meta:
        model = Milestone
        fields = [
            "id", "order", "title", "description",
            "amount", "start_date", "completion_date",
            "completed", "duration",
            "file_count", "comment_count", "invoice_id",
            "files", "comments",
        ]
        read_only_fields = ["id", "completed", "file_count", "comment_count", "invoice_id", "files", "comments"]


# ---------------- Invoices ----------------

class InvoiceSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    project_title = serializers.CharField(source="agreement.project.title", read_only=True)
    homeowner_name = serializers.CharField(source="agreement.homeowner.full_name", read_only=True)

    class Meta:
        model = Invoice
        fields = ["id", "invoice_number", "amount", "status", "created_at", "project_title", "homeowner_name"]
        read_only_fields = ["id", "invoice_number", "created_at"]


# ---------------- Expenses ----------------

class ExpenseSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Expense
        fields = ["id", "description", "amount", "incurred_date", "status", "category", "created_at"]
        read_only_fields = ["id", "created_at"]


# ---------------- Projects ----------------

class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = [
            "id", "number", "title", "status",
            "contractor", "homeowner",
            "project_street_address", "project_address_line_2",
            "project_city", "project_state", "project_zip_code",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "number", "created_at", "updated_at"]


class ProjectDetailSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    contractor = ContractorDetailSerializer(read_only=True)
    homeowner = HomeownerSerializer(read_only=True)
    agreement = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Project
        fields = ["id", "number", "title", "status", "contractor", "homeowner", "agreement", "updated_at"]
        read_only_fields = ["id", "updated_at"]


# ---------------- Helpers for amendment meta ----------------

def _amendment_meta(obj: Agreement):
    """
    Returns (parent_id, amendment_number) if obj is an amendment, else (None, 0).
    Uses AgreementAmendment link; falls back to obj.amendment_number.
    """
    try:
        link = getattr(obj, "as_amendment", None)
        if link:
            return link.parent_id, int(link.amendment_number or 0)
    except Exception:
        pass
    # Fallback: no link, but agreement.amendment_number is set
    return None, int(getattr(obj, "amendment_number", 0) or 0)


# ---------------- Agreement DETAIL ----------------

class AgreementDetailSerializer(serializers.ModelSerializer):
    project = ProjectDetailSerializer(read_only=True)
    milestones = MilestoneSerializer(many=True, read_only=True)
    invoices = InvoiceSerializer(many=True, read_only=True)
    parent_agreement_id = serializers.SerializerMethodField()
    amendment_number = serializers.SerializerMethodField()

    class Meta:
        model = Agreement
        fields = [
            "id", "project", "total_cost", "is_fully_signed", "is_archived",
            "escrow_funded", "signed_by_homeowner", "signed_by_contractor",
            "milestones", "invoices", "addendum_file", "terms_text", "privacy_text",
            # amendment meta
            "parent_agreement_id", "amendment_number",
        ]
        read_only_fields = fields

    def get_parent_agreement_id(self, obj):
        pid, _ = _amendment_meta(obj)
        return pid

    def get_amendment_number(self, obj):
        _, num = _amendment_meta(obj)
        return num


# ---------------- Agreement CREATE (wizard) ----------------

class MilestoneInputSerializer(serializers.Serializer):
    order = serializers.IntegerField()
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(allow_blank=True, required=False)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    start_date = serializers.DateField()
    completion_date = serializers.DateField()
    days = serializers.IntegerField(required=False, default=0)
    hours = serializers.IntegerField(required=False, default=0)
    minutes = serializers.IntegerField(required=False, default=0)
    duration = serializers.DurationField(required=False)

    def validate(self, data):
        if data.get("completion_date") < data.get("start_date"):
            raise serializers.ValidationError("Completion date cannot be before start date.")
        total_duration = timedelta(
            days=data.pop("days", 0) or 0,
            hours=data.pop("hours", 0) or 0,
            minutes=data.pop("minutes", 0) or 0,
        )
        if total_duration.total_seconds() > 0:
            data["duration"] = total_duration
        return data


class AgreementWriteSerializer(serializers.ModelSerializer):
    homeowner_id = serializers.IntegerField(write_only=True)
    project_title = serializers.CharField(write_only=True)
    description = serializers.CharField(write_only=True, required=False, allow_blank=True)
    project_type = serializers.CharField(write_only=True)
    project_subtype = serializers.CharField(write_only=True, required=False, allow_blank=True)
    total_cost = serializers.DecimalField(max_digits=10, decimal_places=2, write_only=True)
    milestones = MilestoneInputSerializer(many=True, write_only=True)

    project_street_address = serializers.CharField(required=False, allow_blank=True, write_only=True)
    project_address_line_2 = serializers.CharField(required=False, allow_blank=True, write_only=True)
    project_city = serializers.CharField(required=False, allow_blank=True, write_only=True)
    project_state = serializers.CharField(required=False, allow_blank=True, write_only=True)
    project_zip_code = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = Agreement
        fields = [
            "project_title", "description", "total_cost", "homeowner_id",
            "milestones", "project_type", "project_subtype",
            "project_street_address", "project_address_line_2",
            "project_city", "project_state", "project_zip_code",
        ]

    def create(self, validated_data):
        milestones_data = validated_data.pop("milestones")
        homeowner_id = validated_data.pop("homeowner_id")
        project_title = validated_data.pop("project_title")
        total_cost = validated_data.pop("total_cost")
        project_type = validated_data.pop("project_type")
        project_subtype = validated_data.pop("project_subtype", "")
        description = validated_data.pop("description", "")
        project_address_data = {
            "project_street_address": validated_data.pop("project_street_address", ""),
            "project_address_line_2": validated_data.pop("project_address_line_2", ""),
            "project_city": validated_data.pop("project_city", ""),
            "project_state": validated_data.pop("project_state", ""),
            "project_zip_code": validated_data.pop("project_zip_code", ""),
        }

        contractor = self.context["request"].user.contractor_profile

        with transaction.atomic():
            homeowner = Homeowner.objects.get(pk=homeowner_id)
            project = Project.objects.create(
                contractor=contractor,
                homeowner=homeowner,
                title=project_title,
                description=description,
                **project_address_data,
            )
            terms = load_legal_text("terms_of_service.txt")
            privacy = load_legal_text("privacy_policy.txt")
            agreement = Agreement.objects.create(
                project=project,
                contractor=contractor,
                total_cost=total_cost,
                project_type=project_type,
                project_subtype=project_subtype,
                standardized_category=categorize_project(project_type, project_subtype),
                terms_text=terms,
                privacy_text=privacy,
            )
            for m_data in milestones_data:
                Milestone.objects.create(agreement=agreement, **m_data)
        return agreement


# ---------------- Agreement UPDATE (edit) ----------------

class AgreementUpdateSerializer(serializers.ModelSerializer):
    project_title = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Agreement
        fields = ["project_title", "start", "end", "total_cost"]
        extra_kwargs = {"start": {"required": False, "allow_null": True},
                        "end": {"required": False, "allow_null": True},
                        "total_cost": {"required": False}}

    def update(self, instance, validated_data):
        proj_title = validated_data.pop("project_title", None)
        if proj_title is not None and instance.project_id:
            instance.project.title = proj_title
            instance.project.save(update_fields=["title"])
        for f in ("start", "end", "total_cost"):
            if f in validated_data:
                setattr(instance, f, validated_data[f])
        instance.save()
        return instance


# ---------------- Calendar ----------------

class MilestoneCalendarSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    title = serializers.CharField(read_only=True)
    start = serializers.DateField(source="start_date", read_only=True)
    end = serializers.DateField(source="completion_date", read_only=True)

    class Meta:
        model = Milestone
        fields = ["id", "title", "start", "end"]


class AgreementCalendarSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    start = serializers.DateField(read_only=True)
    end = serializers.DateField(read_only=True)

    class Meta:
        model = Agreement
        fields = ["id", "start", "end"]


# ---------------- Agreement LIST/DETAIL (UI payloads) ----------------

class AgreementListPublicSerializer(serializers.ModelSerializer):
    project_title = serializers.SerializerMethodField()
    homeowner_name = serializers.SerializerMethodField()
    invoices_count = serializers.SerializerMethodField()
    signed_by_contractor = serializers.BooleanField(read_only=True)
    signed_by_homeowner = serializers.BooleanField(read_only=True)
    # amendment info
    parent_agreement_id = serializers.SerializerMethodField()
    amendment_number = serializers.SerializerMethodField()

    class Meta:
        model = Agreement
        fields = [
            "id", "status", "total_cost", "escrow_funded",
            "start", "end",
            "project_title", "homeowner_name",
            "invoices_count",
            "signed_by_contractor", "signed_by_homeowner",
            "parent_agreement_id", "amendment_number",
        ]

    def get_project_title(self, obj):
        p = getattr(obj, "project", None)
        if p:
            return getattr(p, "title", None) or getattr(p, "name", None) or f"#{getattr(p, 'id', '')}".strip()
        return ""

    def get_homeowner_name(self, obj):
        h = getattr(obj, "homeowner", None) or getattr(obj.project, "homeowner", None)
        if h:
            for key in ("full_name", "name"):
                v = getattr(h, key, None)
                if v:
                    return v
            return getattr(h, "email", "") or f"#{getattr(h, 'id', '')}".strip()
        return ""

    def get_invoices_count(self, obj):
        invs = getattr(obj, "invoices", None)
        try:
            return invs.count()
        except Exception:
            return 0

    def get_parent_agreement_id(self, obj):
        pid, _ = _amendment_meta(obj)
        return pid

    def get_amendment_number(self, obj):
        _, num = _amendment_meta(obj)
        return num


class AgreementDetailPublicSerializer(AgreementListPublicSerializer):
    homeowner_access_token = serializers.UUIDField(read_only=True)

    class Meta(AgreementListPublicSerializer.Meta):
        fields = AgreementListPublicSerializer.Meta.fields + [
            "project", "homeowner",
            "is_fully_signed", "is_archived",
            "created_at", "updated_at",
            "homeowner_access_token",
        ]
