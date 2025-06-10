import datetime
from django.db import transaction
from django.db.models import Min, Max
from django.utils.dateparse import parse_duration
from rest_framework import serializers
from django.utils.timesince import timesince
from django.utils.timezone import localtime, timezone

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

class MilestoneFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = MilestoneFile
        fields = ["id", "milestone", "uploaded_by", "file", "uploaded_at"]
        read_only_fields = ["id", "uploaded_by", "uploaded_at"]

class MilestoneCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = MilestoneComment
        fields = ["id", "milestone", "author", "author_name", "content", "created_at"]
        read_only_fields = ["id", "author", "author_name", "created_at"]

class MilestoneInputSerializer(serializers.Serializer):
    order = serializers.IntegerField()
    title = serializers.CharField()
    description = serializers.CharField(allow_blank=True, required=False)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    start_date = serializers.DateField()
    completion_date = serializers.DateField()
    days = serializers.IntegerField(min_value=0)
    hours = serializers.IntegerField(min_value=0)
    minutes = serializers.IntegerField(min_value=0)

    def validate(self, data):
        if data["completion_date"] < data["start_date"]:
            raise serializers.ValidationError("Milestone completion_date must not be before start_date.")
        if data["days"] == 0 and data["hours"] == 0 and data["minutes"] == 0:
            raise serializers.ValidationError("Each milestone must specify at least some time estimate (days/hours/minutes).")
        return data

class AgreementSerializer(serializers.ModelSerializer):
    signed_status_label = serializers.SerializerMethodField()
    signed_at_contractor_display = serializers.SerializerMethodField()
    signed_at_homeowner_display = serializers.SerializerMethodField()

    # Input-only fields
    project_title = serializers.CharField(write_only=True)
    project_description = serializers.CharField(write_only=True, allow_blank=True, required=False)
    project_type = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    project_subtype = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    total_cost = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_time_estimate = serializers.CharField(write_only=True)
    homeowner_name = serializers.CharField(write_only=True)
    homeowner_email = serializers.EmailField(write_only=True)
    homeowner_phone = serializers.CharField(write_only=True)
    homeowner_address = serializers.CharField(write_only=True, allow_blank=True, required=False)
    milestones_input = serializers.ListField(child=MilestoneInputSerializer(), write_only=True)

    # Read-only / computed fields
    id = serializers.IntegerField(read_only=True)
    project_uid = serializers.UUIDField(read_only=True, source="project.project_uid")
    project_title_display = serializers.CharField(read_only=True, source="project.title")
    homeowner = serializers.SerializerMethodField(read_only=True)
    milestone_count = serializers.IntegerField(read_only=True)
    milestones = serializers.SerializerMethodField(read_only=True)
    milestone_invoices = serializers.SerializerMethodField(read_only=True)
    misc_expenses = serializers.SerializerMethodField(read_only=True)
    escrow_funded = serializers.BooleanField(read_only=True)
    start_date = serializers.SerializerMethodField(read_only=True)
    end_date = serializers.SerializerMethodField(read_only=True)

    # New signature/review-related fields
    reviewed = serializers.BooleanField(read_only=True)
    signed_by_contractor = serializers.BooleanField(read_only=True)
    signed_at_contractor = serializers.DateTimeField(read_only=True)
    contractor_signature_name = serializers.CharField(read_only=True)
    signed_by_homeowner = serializers.BooleanField(read_only=True)
    signed_at_homeowner = serializers.DateTimeField(read_only=True)
    homeowner_signature_name = serializers.CharField(read_only=True)
    pdf_file = serializers.FileField(read_only=True)
    project_signed = serializers.BooleanField(read_only=True)
    pdf_version = serializers.IntegerField(read_only=True)
    pdf_archived = serializers.BooleanField(read_only=True)
    signature_log = serializers.CharField(read_only=True)

    class Meta:
        model = Agreement
        fields = [
            "id",
            "project_uid",
            "project_title_display",
            "project_type",
            "project_subtype",
            "total_cost",
            "total_time_estimate",
            "start_date",
            "end_date",
            "homeowner",
            "milestone_count",
            "milestones",
            "milestone_invoices",
            "misc_expenses",
            "escrow_funded",
            

            # Review & signature fields
            "reviewed",
            "signed_by_contractor",
            "signed_at_contractor",
            "contractor_signature_name",
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "pdf_file",
            "project_signed",
            "signed_status_label",
            "signed_at_contractor_display",
            "signed_at_homeowner_display",
            "pdf_version",
            "pdf_archived",
            "signature_log",

            # Input-only fields
            "project_title",
            "project_description",
            "homeowner_name",
            "homeowner_email",
            "homeowner_phone",
            "homeowner_address",
            "milestones_input",
        ]
        read_only_fields = [
            "id",
            "project_uid",
            "project_title_display",
            "start_date",
            "end_date",
            "homeowner",
            "milestone_count",
            "milestones",
            "milestone_invoices",
            "misc_expenses",
            "escrow_funded",

            # Review & signature read-only
            "reviewed",
            "signed_by_contractor",
            "signed_at_contractor",
            "contractor_signature_name",
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "pdf_file",
            "project_signed",
            "signed_status_label",
            "signed_at_contractor_display",
            "signed_at_homeowner_display",
            "pdf_version",
            "pdf_archived",
            "signature_log",
        ]

    def get_signed_status_label(self, obj):
        if obj.signed_by_contractor and obj.signed_by_homeowner:
            return "✅ Fully Signed"
        elif obj.signed_by_contractor:
            return "🕒 Waiting for Homeowner"
        elif obj.signed_by_homeowner:
            return "🕒 Waiting for Contractor"
        else:
            return "❌ Not Signed"

    def get_signed_at_contractor_display(self, obj):
        if obj.signed_at_contractor:
            return localtime(obj.signed_at_contractor).strftime("%b %d, %Y at %I:%M %p")
        return None

    def get_signed_at_homeowner_display(self, obj):
        if obj.signed_at_homeowner:
            return localtime(obj.signed_at_homeowner).strftime("%b %d, %Y at %I:%M %p")
        return None

    def get_homeowner(self, obj):
        hw = obj.project.homeowner
        return {
            "id": hw.id,
            "name": hw.name,
            "email": hw.email,
            "phone": hw.phone,
            "address": hw.address,
        }

    def get_milestones(self, obj):
        return [
            {
                "id": m.id,
                "order": m.order,
                "title": m.title,
                "amount": str(m.amount),
                "due_date": m.completion_date,
                "completed": m.completed,
                "is_late": m.is_late,
                "is_invoiced": m.is_invoiced,
            }
            for m in obj.milestones.all().order_by("order")
        ]

    def get_milestone_invoices(self, obj):
        return [
            {
                "id": inv.id,
                "amount": str(inv.amount),
                "amount_due": str(inv.amount_due) if inv.amount_due is not None else None,
                "due_date": inv.due_date,
                "status": inv.status,
                "project_title": inv.agreement.project.title,
            }
            for inv in obj.invoices.all().order_by("due_date")
        ]

    def get_misc_expenses(self, obj):
        return [
            {
                "id": e.id,
                "description": e.description,
                "amount": str(e.amount),
                "incurred_date": e.incurred_date,
                "status": e.status,
            }
            for e in obj.misc_expenses.all().order_by("-incurred_date")
        ]

    def get_start_date(self, obj):
        return obj.milestones.aggregate(Min("start_date"))["start_date__min"]

    def get_end_date(self, obj):
        return obj.milestones.aggregate(Max("completion_date"))["completion_date__max"]

    def validate_total_time_estimate(self, value):
        try:
            _ = parse_duration(value)
        except Exception:
            raise serializers.ValidationError(
                "total_time_estimate must be a valid duration string (e.g. '1 02:30:00')."
            )
        return value

    def create(self, validated_data):
        with transaction.atomic():
            hw_name = validated_data.pop("homeowner_name")
            hw_email = validated_data.pop("homeowner_email")
            hw_phone = validated_data.pop("homeowner_phone")
            hw_address = validated_data.pop("homeowner_address", "")

            homeowner_obj, _ = Homeowner.objects.get_or_create(
                email=hw_email,
                defaults={"name": hw_name, "phone": hw_phone, "address": hw_address},
            )
            homeowner_obj.name = hw_name
            homeowner_obj.phone = hw_phone
            homeowner_obj.address = hw_address
            homeowner_obj.save()

            proj_title = validated_data.pop("project_title")
            proj_desc = validated_data.pop("project_description", "")
            proj_type = validated_data.pop("project_type", "")
            proj_subtype = validated_data.pop("project_subtype", "")

            project_obj = Project.objects.create(
                contractor=self.context["request"].user,
                homeowner=homeowner_obj,
                title=proj_title,
                description=proj_desc or "",
            )

            total_cost_val = validated_data.pop("total_cost")
            total_time_est_str = validated_data.pop("total_time_estimate")
            total_time_td = parse_duration(total_time_est_str)

            agreement_obj = Agreement.objects.create(
                contractor=self.context["request"].user,
                project=project_obj,
                total_cost=total_cost_val,
                total_time_estimate=total_time_td,
                project_type=proj_type or None,
                project_subtype=proj_subtype or None,
                milestone_count=0,
            )

            milestones_data = validated_data.pop("milestones_input", [])
            created_count = 0

            for m_data in milestones_data:
                Milestone.objects.create(
                    agreement=agreement_obj,
                    order=m_data["order"],
                    title=m_data["title"],
                    description=m_data.get("description", ""),
                    amount=m_data["amount"],
                    start_date=m_data["start_date"],
                    completion_date=m_data["completion_date"],
                )
                created_count += 1

            agreement_obj.milestone_count = created_count
            agreement_obj.save(update_fields=["milestone_count"])
            return agreement_obj

# ─── OTHER SERIALIZERS ─────────────────────────────────────────────────────────────
class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "title", "description", "homeowner", "contractor"]

class InvoiceSerializer(serializers.ModelSerializer):
    agreement_title = serializers.CharField(source="agreement.project.title", read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "agreement",
            "amount",
            "amount_due",
            "due_date",
            "status",
            "project_title",
            "agreement_title",
        ]


class ContractorSerializer(serializers.ModelSerializer):
    # --- 1) New write-only boolean for the checkbox ---
    terms_accepted = serializers.BooleanField(
        write_only=True,
        help_text="Must be true to accept the Terms of Use at sign-up",
    )

    # --- 2) Make the existing fields read-only, since we populate them ourselves ---
    terms_accepted_at = serializers.DateTimeField(read_only=True)
    terms_version     = serializers.CharField(read_only=True)

    class Meta:
        model = Contractor
        # We include the new `terms_accepted` in fields, plus keep all your existing fields:
        fields = [
            "id",
            "name",
            "email",
            "phone",
            "business_name",
            "address",
            # new boolean that the client must send:
            "terms_accepted",
            # read-only fields that will be auto-populated:
            "terms_accepted_at",
            "terms_version",
        ]
        extra_kwargs = {
            "email": {"required": True},
            "phone": {"required": True},
            # you can set any other field to required/optional here
        }

    def validate_terms_accepted(self, value):
        """
        If the boolean is not True, reject.
        DRF will automatically raise a 400 if this returns a ValidationError.
        """
        if not value:
            raise serializers.ValidationError(
                "You must accept the Terms of Use to register as a contractor."
            )
        return value

    def create(self, validated_data):
        # Pop out the boolean so it isn't passed directly to the model
        validated_data.pop("terms_accepted", None)

        # Create the Contractor instance normally
        contractor = Contractor.objects.create(**validated_data)

        # Now stamp the timestamp & version:
        contractor.terms_accepted_at = timezone.now()
        # You can choose to store a version string in settings or hardcode for now:
        contractor.terms_version = "v1.0"
        contractor.save()

        return contractor

class HomeownerSerializer(serializers.ModelSerializer):
    terms_accepted_at = serializers.DateTimeField(required=False)
    terms_version = serializers.CharField(required=False)

    class Meta:
        model = Homeowner
        fields = [
            "id",
            "name",
            "email",
            "phone",
            "address",
            "project_address",
            "terms_accepted_at",
            "terms_version",
        ]


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "agreement", "sender", "message", "timestamp"]

class MilestoneSerializer(serializers.ModelSerializer):
    agreement_title = serializers.CharField(source="agreement.project.title", read_only=True)

    class Meta:
        model = Milestone
        fields = [
            "id",
            "order",
            "title",
            "description",
            "amount",
            "start_date",
            "completion_date",
            "days",
            "hours",
            "minutes",
            "is_invoiced",
            "completed",
            "agreement",
            "agreement_title",
        ]

class ExpenseSerializer(serializers.ModelSerializer):
    project_title = serializers.CharField(source="agreement.project.title", read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id",
            "agreement",
            "description",
            "amount",
            "incurred_date",
            "status",
            "project_title",
        ]
class MilestoneCalendarSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source="title")
    start = serializers.DateField(source="start_date")
    end = serializers.DateField(source="completion_date")

    class Meta:
        model = Milestone
        fields = ["id", "title", "start", "end"]

class AgreementCalendarSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    start = serializers.DateField(source="start_date")
    end = serializers.DateField(source="end_date")

    class Meta:
        model = Agreement
        fields = ["id", "title", "start", "end"]

    def get_title(self, obj):
        return f"Agreement: {obj.project.title}"


