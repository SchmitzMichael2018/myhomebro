from rest_framework import serializers
from .models import Project, Agreement, Invoice, Contractor, Homeowner


class ContractorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contractor
        fields = '__all__'
        read_only_fields = ['user', 'created_at']


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = '__all__'


class HomeownerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Homeowner
        fields = '__all__'


class InvoiceSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='agreement.project_name', read_only=True)
    homeowner_name = serializers.CharField(source='agreement.homeowner.name', read_only=True)
    homeowner_email = serializers.EmailField(source='agreement.homeowner.email', read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id',
            'agreement',
            'amount_due',
            'due_date',
            'is_paid',
            'is_complete',
            'is_approved',
            'pending_approval',
            'is_disputed',
            'created_at',
            'stripe_payment_intent',
            'project_name',
            'homeowner_name',
            'homeowner_email',
        ]


class AgreementSerializer(serializers.ModelSerializer):
    contractor_name = serializers.CharField(source='contractor.name', read_only=True)
    project_uid = serializers.CharField(source='project.id', read_only=True)

    # These are POSTed from the frontend and used in perform_create()
    homeowner_name = serializers.CharField(write_only=True)
    homeowner_email = serializers.EmailField(write_only=True)

    # Optional: for displaying homeowner info back to the frontend
    homeowner_display_name = serializers.CharField(source='homeowner.name', read_only=True)
    homeowner_display_email = serializers.EmailField(source='homeowner.email', read_only=True)

    total_cost = serializers.DecimalField(source='total_price', max_digits=10, decimal_places=2)
    milestone_count = serializers.IntegerField()

    milestone_invoices = InvoiceSerializer(source='invoices', many=True, read_only=True)
    milestone_invoice_count = serializers.SerializerMethodField()

    def get_milestone_invoice_count(self, obj):
        return obj.invoices.count()

    class Meta:
        model = Agreement
        fields = [
            'id', 'contractor', 'contractor_name', 'project', 'project_uid',
            'homeowner', 'homeowner_name', 'homeowner_email',
            'homeowner_display_name', 'homeowner_display_email',
            'project_name', 'description', 'start_date', 'end_date',
            'milestone_count', 'total_cost', 'is_signed', 'escrow_funded',
            'created_at', 'milestone_invoices', 'milestone_invoice_count'
        ]


    def create(self, validated_data):
        homeowner_data = validated_data.pop('homeowner')
        homeowner, _ = Homeowner.objects.get_or_create(
            email=homeowner_data['email'],
            defaults={
                'name': homeowner_data.get('name', ''),
                'address': homeowner_data.get('address', '')
            }
        )
        agreement = Agreement.objects.create(homeowner=homeowner, **validated_data)
        return agreement

    def update(self, instance, validated_data):
        homeowner_data = validated_data.pop('homeowner', None)
        if homeowner_data:
            homeowner, _ = Homeowner.objects.get_or_create(
                email=homeowner_data['email'],
                defaults={
                    'name': homeowner_data.get('name', ''),
                    'address': homeowner_data.get('address', '')
                }
            )
            instance.homeowner = homeowner

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


