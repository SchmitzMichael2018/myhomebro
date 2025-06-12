import uuid
from django.db import transaction
from django.db.models import Min, Max
from django.utils.dateparse import parse_duration
from django.utils.timezone import timezone
from rest_framework import serializers

from .models import (
    Project,
    Agreement,
    Invoice,
    Contractor,
    Homeowner,
    Message,
    Milestone,
    Expense,
    MilestoneFile,
    MilestoneComment,
)


# ─── MilestoneFile & MilestoneComment ────────────────────────────────────────────

class MilestoneFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = MilestoneFile
        fields = ["id", "milestone", "uploaded_by", "file", "uploaded_at"]
        read_only_fields = ["id", "uploaded_by", "uploaded_at"]


class MilestoneCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.username", read_only=True)
    author_role = serializers.SerializerMethodField(read_only=True)
    created_at  = serializers.DateTimeField(read_only=True)

    class Meta:
        model = MilestoneComment
        fields = [
            "id",
            "milestone",
            "author",
            "author_name",
            "author_role",
            "content",
            "created_at",
        ]
        read_only_fields = fields

    def get_author_role(self, obj):
        if obj.author_id == obj.milestone.agreement.contractor_id:
            return "Contractor"
        return "Homeowner"


# ─── Agreement / Milestone creation inputs ──────────────────────────────────────

class MilestoneInputSerializer(serializers.Serializer):
    order           = serializers.IntegerField()
    title           = serializers.CharField()
    description     = serializers.CharField(allow_blank=True, required=False)
    amount          = serializers.DecimalField(max_digits=10, decimal_places=2)
    start_date      = serializers.DateField()
    completion_date = serializers.DateField()
    days            = serializers.IntegerField(min_value=0)
    hours           = serializers.IntegerField(min_value=0)
    minutes         = serializers.IntegerField(min_value=0)

    def validate(self, data):
        if data["completion_date"] < data["start_date"]:
            raise serializers.ValidationError(
                "Milestone completion_date must not be before start_date."
            )
        if data["days"] == 0 and data["hours"] == 0 and data["minutes"] == 0:
            raise serializers.ValidationError(
                "Each milestone must specify at least some time estimate (days/hours/minutes)."
            )
        return data


class AgreementSerializer(serializers.ModelSerializer):
    signed_status_label          = serializers.SerializerMethodField()
    signed_at_contractor_display = serializers.SerializerMethodField()
    signed_at_homeowner_display  = serializers.SerializerMethodField()

    # write-only inputs
    project_title       = serializers.CharField(write_only=True)
    project_description = serializers.CharField(write_only=True, allow_blank=True, required=False)
    project_type        = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    project_subtype     = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    total_cost          = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_time_estimate = serializers.CharField(write_only=True)
    homeowner_name      = serializers.CharField(write_only=True)
    homeowner_email     = serializers.EmailField(write_only=True)
    homeowner_phone     = serializers.CharField(write_only=True)
    homeowner_address   = serializers.CharField(write_only=True, allow_blank=True, required=False)
    milestones_input    = serializers.ListField(child=MilestoneInputSerializer(), write_only=True)

    # read-only / computed
    id                    = serializers.IntegerField(read_only=True)
    project_uid           = serializers.UUIDField(read_only=True, source="project.project_uid")
    project_title_display = serializers.CharField(read_only=True, source="project.title")
    homeowner             = serializers.SerializerMethodField(read_only=True)
    milestone_count       = serializers.IntegerField(read_only=True)
    milestones            = serializers.SerializerMethodField(read_only=True)
    milestone_invoices    = serializers.SerializerMethodField(read_only=True)
    misc_expenses         = serializers.SerializerMethodField(read_only=True)
    escrow_funded         = serializers.BooleanField(read_only=True)
    start_date            = serializers.SerializerMethodField(read_only=True)
    end_date              = serializers.SerializerMethodField(read_only=True)

    # signature / review
    reviewed                  = serializers.BooleanField(read_only=True)
    signed_by_contractor      = serializers.BooleanField(read_only=True)
    signed_at_contractor      = serializers.DateTimeField(read_only=True)
    contractor_signature_name = serializers.CharField(read_only=True)
    signed_by_homeowner       = serializers.BooleanField(read_only=True)
    signed_at_homeowner       = serializers.DateTimeField(read_only=True)
    homeowner_signature_name  = serializers.CharField(read_only=True)
    pdf_file                  = serializers.FileField(read_only=True)
    project_signed            = serializers.BooleanField(read_only=True)
    pdf_version               = serializers.IntegerField(read_only=True)
    pdf_archived              = serializers.BooleanField(read_only=True)
    signature_log             = serializers.CharField(read_only=True)

    class Meta:
        model = Agreement
        fields = [
            # core
            "id", "project_uid", "project_title_display",
            "project_type", "project_subtype", "total_cost",
            "total_time_estimate", "start_date", "end_date",
            "homeowner", "milestone_count", "milestones",
            "milestone_invoices", "misc_expenses", "escrow_funded",
            # review & signature
            "reviewed", "signed_by_contractor", "signed_at_contractor",
            "contractor_signature_name", "signed_by_homeowner",
            "signed_at_homeowner", "homeowner_signature_name",
            "pdf_file", "project_signed", "signed_status_label",
            "signed_at_contractor_display", "signed_at_homeowner_display",
            "pdf_version", "pdf_archived", "signature_log",
            # inputs
            "project_title", "project_description",
            "homeowner_name", "homeowner_email", "homeowner_phone",
            "homeowner_address", "milestones_input",
        ]
        read_only_fields = [
            "id", "project_uid", "project_title_display", "start_date", "end_date",
            "homeowner", "milestone_count", "milestones", "milestone_invoices",
            "misc_expenses", "escrow_funded", "reviewed", "signed_by_contractor",
            "signed_at_contractor", "contractor_signature_name",
            "signed_by_homeowner", "signed_at_homeowner",
            "homeowner_signature_name", "pdf_file", "project_signed",
            "signed_status_label", "signed_at_contractor_display",
            "signed_at_homeowner_display", "pdf_version", "pdf_archived",
            "signature_log",
        ]

    def get_homeowner(self, obj):
        hw = obj.project.homeowner
        return {
            "id": hw.id,
            "name": hw.name,
            "email": hw.email,
            "phone": hw.phone,
            "address": hw.address,
        }

    def get_start_date(self, obj):
        return obj.milestones.aggregate(Min("start_date"))["start_date__min"]

    def get_end_date(self, obj):
        return obj.milestones.aggregate(Max("completion_date"))["completion_date__max"]

    def get_signed_status_label(self, obj):
        if obj.signed_by_contractor and obj.signed_by_homeowner:
            return "✅ Fully Signed"
        if obj.signed_by_contractor:
            return "🕒 Waiting for Homeowner"
        if obj.signed_by_homeowner:
            return "🕒 Waiting for Contractor"
        return "❌ Not Signed"

    def get_signed_at_contractor_display(self, obj):
        if obj.signed_at_contractor:
            return localtime(obj.signed_at_contractor).strftime("%b %d, %Y at %I:%M %p")
        return None

    def get_signed_at_homeowner_display(self, obj):
        if obj.signed_at_homeowner:
            return localtime(obj.signed_at_homeowner).strftime("%b %d, %Y at %I:%M %p")
        return None

    def create(self, validated_data):
        # pull out homeowner & project inputs
        hw_name   = validated_data.pop("homeowner_name")
        hw_email  = validated_data.pop("homeowner_email")
        hw_phone  = validated_data.pop("homeowner_phone")
        hw_addr   = validated_data.pop("homeowner_address", "")
        proj_title      = validated_data.pop("project_title")
        proj_desc       = validated_data.pop("project_description", "")
        proj_type_val   = validated_data.pop("project_type", None)
        proj_subtype_val= validated_data.pop("project_subtype", None)
        milestones_data = validated_data.pop("milestones_input", [])
        total_cost_val  = validated_data.pop("total_cost")
        total_time_str  = validated_data.pop("total_time_estimate")

        with transaction.atomic():
            # create or update homeowner
            homeowner_obj, _ = Homeowner.objects.get_or_create(
                email=hw_email,
                defaults={"name": hw_name, "phone": hw_phone, "address": hw_addr},
            )
            homeowner_obj.name    = hw_name
            homeowner_obj.phone   = hw_phone
            homeowner_obj.address = hw_addr
            homeowner_obj.save()

            # create project
            project_obj = Project.objects.create(
                contractor=self.context["request"].user,
                homeowner=homeowner_obj,
                title=proj_title,
                description=proj_desc or "",
            )

            # parse time
            total_time_td = parse_duration(total_time_str)

            # create agreement + a new UUID token
            agreement_obj = Agreement.objects.create(
                contractor=self.context["request"].user,
                project=project_obj,
                total_cost=total_cost_val,
                total_time_estimate=total_time_td,
                project_type=proj_type_val or None,
                project_subtype=proj_subtype_val or None,
                homeowner_access_token=uuid.uuid4(),
                milestone_count=0,
            )

            # create milestones
            count = 0
            for m in milestones_data:
                Milestone.objects.create(
                    agreement=agreement_obj,
                    order=m["order"],
                    title=m["title"],
                    description=m.get("description", ""),
                    amount=m["amount"],
                    start_date=m["start_date"],
                    completion_date=m["completion_date"],
                )
                count += 1

            agreement_obj.milestone_count = count
            agreement_obj.save(update_fields=["milestone_count"])
            return agreement_obj


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Project
        fields = ["id", "title", "description", "homeowner", "contractor"]


class InvoiceSerializer(serializers.ModelSerializer):
    # expose project & homeowner
    project_title  = serializers.CharField(source="agreement.project.title",           read_only=True)
    homeowner_name = serializers.CharField(source="agreement.project.homeowner.name", read_only=True)

    # nested
    milestone_comments = MilestoneCommentSerializer(
        source="milestone.comments", many=True, read_only=True
    )
    milestone_files = MilestoneFileSerializer(
        source="milestone.milestonefile_set", many=True, read_only=True
    )

    # flat title for your drilldown
    milestone_title = serializers.CharField(source="milestone.title", read_only=True)

    class Meta:
        model  = Invoice
        fields = [
            "id",
            "agreement",
            "milestone",
            "milestone_title",
            "amount_due",
            "due_date",
            "status",
            "created_at",
            "updated_at",
            "project_title",
            "homeowner_name",
            "milestone_comments",
            "milestone_files",
        ]
        read_only_fields = [
            "status",
            "created_at",
            "updated_at",
            "project_title",
            "homeowner_name",
            "milestone_comments",
            "milestone_files",
            "milestone_title",
        ]


class ContractorSerializer(serializers.ModelSerializer):
    terms_accepted    = serializers.BooleanField(write_only=True)
    terms_accepted_at = serializers.DateTimeField(read_only=True)
    terms_version     = serializers.CharField(read_only=True)

    class Meta:
        model = Contractor
        fields = [
            "id", "name", "email", "phone", "business_name", "address",
            "terms_accepted", "terms_accepted_at", "terms_version",
        ]
        extra_kwargs = {"email": {"required": True}, "phone": {"required": True}}

    def validate_terms_accepted(self, value):
        if not value:
            raise serializers.ValidationError("You must accept the Terms of Use.")
        return value

    def create(self, validated_data):
        validated_data.pop("terms_accepted", None)
        contractor = Contractor.objects.create(**validated_data)
        contractor.terms_accepted_at = timezone.now()
        contractor.terms_version     = "v1.0"
        contractor.save()
        return contractor


class HomeownerSerializer(serializers.ModelSerializer):
    terms_accepted_at = serializers.DateTimeField(required=False)
    terms_version     = serializers.CharField(required=False)

    class Meta:
        model  = Homeowner
        fields = [
            "id", "name", "email", "phone", "address", "project_address",
            "terms_accepted_at", "terms_version",
        ]


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Message
        fields = ["id", "agreement", "sender", "message", "timestamp"]


class MilestoneSerializer(serializers.ModelSerializer):
    agreement_title = serializers.CharField(source="agreement.project.title", read_only=True)

    class Meta:
        model  = Milestone
        fields = [
            "id", "order", "title", "description", "amount",
            "start_date", "completion_date", "days", "hours", "minutes",
            "is_invoiced", "completed", "agreement", "agreement_title",
        ]


class ExpenseSerializer(serializers.ModelSerializer):
    project_title = serializers.CharField(source="agreement.project.title", read_only=True)

    class Meta:
        model  = Expense
        fields = [
            "id", "agreement", "description", "amount",
            "incurred_date", "status", "project_title",
        ]


class MilestoneCalendarSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source="title")
    start = serializers.DateField(source="start_date")
    end   = serializers.DateField(source="completion_date")

    class Meta:
        model  = Milestone
        fields = ["id", "title", "start", "end"]


class AgreementCalendarSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    start = serializers.DateField(source="start_date")
    end   = serializers.DateField(source="end_date")

    class Meta:
        model  = Agreement
        fields = ["id", "title", "start", "end"]

    def get_title(self, obj):
        return f"Agreement: {obj.project.title}"
