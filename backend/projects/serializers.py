from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import (
    Contractor,
    Homeowner,
    Project,
    Milestone,
    Agreement,
    Invoice,
    Message,
)

User = get_user_model()

class ContractorSerializer(serializers.ModelSerializer):
    stripe_account_id = serializers.CharField(read_only=True)
    onboarding_status = serializers.CharField(read_only=True)

    class Meta:
        model = Contractor
        fields = [
            'id',
            'user',
            'business_name',
            'name',
            'email',
            'phone',
            'skills',
            'stripe_account_id',
            'onboarding_status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id', 'user', 'stripe_account_id', 'onboarding_status', 'created_at', 'updated_at'
        ]


class HomeownerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Homeowner
        fields = [
            'id',
            'name',
            'email',
            'address',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ProjectSerializer(serializers.ModelSerializer):
    contractor = serializers.PrimaryKeyRelatedField(read_only=True)
    homeowner = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Project
        fields = [
            'id',
            'number',
            'contractor',
            'homeowner',
            'title',
            'description',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id', 'number', 'contractor', 'homeowner', 'status', 'created_at', 'updated_at'
        ]


class MilestoneSerializer(serializers.ModelSerializer):
    agreement = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Milestone
        fields = [
            'id',
            'agreement',
            'order',
            'title',
            'description',
            'amount',
            'start_date',
            'completion_date',
            'days',
            'hours',
            'minutes',
            'is_invoiced',
            'completed',
        ]
        read_only_fields = ['id', 'agreement']
        extra_kwargs = {
            'agreement': {'read_only': True, 'required': False},
        }


class InvoiceSerializer(serializers.ModelSerializer):
    project_title = serializers.CharField(
        source='agreement.project.title', read_only=True
    )
    homeowner_name = serializers.CharField(
        source='agreement.homeowner.name', read_only=True
    )
    homeowner_email = serializers.EmailField(
        source='agreement.homeowner.email', read_only=True
    )

    class Meta:
        model = Invoice
        fields = [
            'id',
            'agreement',
            'amount_due',
            'due_date',
            'status',
            'created_at',
            'updated_at',
            'project_title',
            'homeowner_name',
            'homeowner_email',
        ]
        read_only_fields = [
            'id',
            'created_at',
            'updated_at',
            'project_title',
            'homeowner_name',
            'homeowner_email',
        ]


class AgreementSerializer(serializers.ModelSerializer):
    # POST (write_only): what comes from the frontend
    project_title = serializers.CharField(write_only=True)
    project_description = serializers.CharField(write_only=True, allow_blank=True, required=False)
    homeowner = HomeownerSerializer(read_only=True)
    homeowner_email = serializers.EmailField(write_only=True)
    homeowner_name = serializers.CharField(write_only=True)
    homeowner_address = serializers.CharField(write_only=True, required=False, allow_blank=True)
    milestones_input = MilestoneSerializer(many=True, write_only=True, required=False)

    # GET (read_only): what you want to show in tables/views
    project_title_display = serializers.CharField(source='project.title', read_only=True)
    start_date = serializers.SerializerMethodField()
    end_date = serializers.SerializerMethodField()

    contractor_name = serializers.CharField(
        source='contractor.name', read_only=True
    )
    project_number = serializers.CharField(source="project.number", read_only=True)
    project_uid = serializers.UUIDField(source='project.project_uid', read_only=True)
    milestone_count = serializers.SerializerMethodField()
    milestones = MilestoneSerializer(many=True, read_only=True)
    milestone_invoices = InvoiceSerializer(
        source='invoices', many=True, read_only=True
    )
    pdf_file = serializers.FileField(read_only=True)

    def get_start_date(self, obj):
        qs = obj.milestones.filter(start_date__isnull=False).order_by('start_date')
        return qs.first().start_date if qs.exists() else None

    def get_end_date(self, obj):
        qs = obj.milestones.filter(completion_date__isnull=False).order_by('-completion_date')
        return qs.first().completion_date if qs.exists() else None

    class Meta:
        model = Agreement
        fields = [
            'id',
            'contractor',
            'contractor_name',
            'homeowner',
            'homeowner_email',
            'homeowner_name',
            'homeowner_address',
            'project_title',          # POST
            'project_description',    # POST
            'milestones_input',       # POST
            'project_title_display',  # GET
            'project_number',
            'project_uid',
            'description',
            'total_cost',
            'total_time_estimate',
            'escrow_funded',
            'pdf_file',
            'created_at',
            'updated_at',
            'milestone_count',
            'milestones',
            'milestone_invoices',
            'start_date',
            'end_date',
        ]
        read_only_fields = [
            'id',
            'contractor',
            'contractor_name',
            'project_title_display',
            'project_number',
            'project_uid',
            'escrow_funded',
            'pdf_file',
            'created_at',
            'updated_at',
            'milestone_count',
            'milestones',
            'milestone_invoices',
            'start_date',
            'end_date',
        ]

    def get_milestone_count(self, obj):
        return obj.milestones.count()

    def create(self, validated_data):
        project_title = validated_data.pop('project_title')
        project_description = validated_data.pop('project_description', '')
        homeowner_email = validated_data.pop('homeowner_email')
        homeowner_name = validated_data.pop('homeowner_name')
        homeowner_address = validated_data.pop('homeowner_address', '')
        milestones_data = validated_data.pop('milestones_input', [])

        # Get the logged-in user and Contractor
        request = self.context.get('request')
        user = request.user if request else None
        contractor = None
        if user and not user.is_anonymous:
            try:
                contractor = Contractor.objects.get(user=user)
            except Contractor.DoesNotExist:
                raise serializers.ValidationError('Contractor does not exist for this user.')
        else:
            raise serializers.ValidationError('You must be logged in as a contractor.')

        # Get or create Homeowner
        homeowner, _ = Homeowner.objects.get_or_create(
            email=homeowner_email,
            defaults={
                'name': homeowner_name,
                'address': homeowner_address
            }
        )

        # Create Project
        project = Project.objects.create(
            title=project_title,
            description=project_description,
            contractor=user,
            homeowner=homeowner
        )

        # Remove 'contractor' from validated_data if present
        validated_data.pop('contractor', None)

        # Create Agreement
        agreement = Agreement.objects.create(
            contractor=contractor,
            homeowner=homeowner,
            project=project,
            **validated_data
        )

        # Create milestones in the order provided
        for idx, mdata in enumerate(milestones_data):
            Milestone.objects.create(
                agreement=agreement,
                order=mdata.get('order', idx + 1),
                title=mdata['title'],
                description=mdata.get('description', ''),
                amount=mdata['amount'],
                start_date=mdata['start_date'],
                completion_date=mdata['completion_date'],
                days=mdata.get('days', 0),
                hours=mdata.get('hours', 0),
                minutes=mdata.get('minutes', 0),
            )

        return agreement


class MessageSerializer(serializers.ModelSerializer):
    sender = serializers.PrimaryKeyRelatedField(read_only=True)
    sender_name = serializers.CharField(
        source='sender.username', read_only=True
    )

    class Meta:
        model = Message
        fields = [
            'id',
            'agreement',
            'sender',
            'sender_name',
            'content',
            'created_at',
        ]
        read_only_fields = ['id', 'sender', 'sender_name', 'created_at']













