from rest_framework import serializers
from django.db import transaction
from django.utils.text import slugify
from .utils import categorize_project, load_legal_text
from datetime import timedelta
from .models import (
    Project,
    Agreement,
    Invoice,
    Contractor,
    Homeowner,
    Milestone,
    Expense,
    Skill,
    MilestoneFile,
    MilestoneComment
)

class HomeownerWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Homeowner
        fields = [
            "full_name", "email", "phone_number", "status",
            "street_address", "address_line_2", "city", "state", "zip_code"
        ]
        read_only_fields = ['created_by']

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
            "city", "state", "zip_code"
        ]
        read_only_fields = fields

class ContractorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contractor
        fields = "__all__"

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
            "logo", "license_file"
        ]
        read_only_fields = fields

class MilestoneSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    file_count = serializers.IntegerField(read_only=True)
    comment_count = serializers.IntegerField(read_only=True)
    invoice_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Milestone
        fields = [
            "id", "order", "title", "description",
            "amount", "start_date", "completion_date",
            "completed", "duration",
            "file_count", "comment_count", "invoice_id"
        ]
        read_only_fields = ["id", "completed", "file_count", "comment_count", "invoice_id"]

class InvoiceSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    project_title = serializers.CharField(source="agreement.project.title", read_only=True)
    homeowner_name = serializers.CharField(source="agreement.homeowner.full_name", read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id", "invoice_number", "amount",
            "status", "created_at",
            "project_title", "homeowner_name"
        ]
        read_only_fields = ["id", "invoice_number", "created_at"]

class ProjectDetailSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    contractor = ContractorDetailSerializer(read_only=True)
    homeowner = HomeownerSerializer(read_only=True)
    agreement = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Project
        fields = [
            "id", "number", "title", "status",
            "contractor", "homeowner",
            "agreement", "updated_at"
        ]
        read_only_fields = ["id", "updated_at"]

class AgreementDetailSerializer(serializers.ModelSerializer):
    project = ProjectDetailSerializer(read_only=True)
    milestones = MilestoneSerializer(many=True, read_only=True)

    class Meta:
        model = Agreement
        fields = [
            "id", "project", "total_cost", "is_fully_signed", "is_archived",
            "escrow_funded", "signed_by_homeowner", "signed_by_contractor",
            "milestones", "invoices", "addendum_file", "terms_text", "privacy_text"
        ]
        read_only_fields = fields

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
            days=data.pop('days', 0) or 0,
            hours=data.pop('hours', 0) or 0,
            minutes=data.pop('minutes', 0) or 0
        )
        if total_duration.total_seconds() > 0:
            data['duration'] = total_duration
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
            "milestones", "project_type", "project_subtype", "project_street_address",
            "project_address_line_2", "project_city", "project_state", "project_zip_code"
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

        contractor = self.context['request'].user.contractor_profile

        with transaction.atomic():
            homeowner = Homeowner.objects.get(pk=homeowner_id)
            project = Project.objects.create(
                contractor=contractor,
                homeowner=homeowner,
                title=project_title,
                description=description,
                **project_address_data
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
                privacy_text=privacy
            )
            for m_data in milestones_data:
                Milestone.objects.create(agreement=agreement, **m_data)
        return agreement

class ContractorWriteSerializer(serializers.ModelSerializer):
    skills = serializers.ListField(
        child=serializers.CharField(max_length=100),
        write_only=True,
        required=False
    )

    class Meta:
        model = Contractor
        fields = [
            "business_name", "phone", "address",
            "license_number", "license_expiration",
            "skills", "license_file"
        ]

    def update(self, instance, validated_data):
        skills_data = validated_data.pop("skills", None)
        instance = super().update(instance, validated_data)
        if skills_data is not None:
            instance.skills.clear()
            for skill_name in skills_data:
                slug, name = slugify(skill_name.strip()), skill_name.strip()
                skill, _ = Skill.objects.get_or_create(slug=slug, defaults={"name": name})
                instance.skills.add(skill)
        return instance

class MilestoneFileSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    class Meta:
        model = MilestoneFile
        fields = ["id", "milestone", "file", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]

class MilestoneCommentSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    author_name = serializers.CharField(source="author.get_full_name", read_only=True)
    class Meta:
        model = MilestoneComment
        fields = ["id", "milestone", "author_name", "content", "created_at"]
        read_only_fields = ["id", "author_name", "created_at"]

class ExpenseSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    class Meta:
        model = Expense
        fields = ["id", "description", "amount", "incurred_date", "status"]
        read_only_fields = ["id"]

class ProjectSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    class Meta:
        model = Project
        fields = "__all__"
        read_only_fields = ["id"]

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

class PublicContractorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contractor
        fields = [
            "id",
            "business_name",
            "skills",
            "license_number",
            "license_expiration",
            "logo",
            "license_file"
        ]
