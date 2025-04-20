from rest_framework import serializers
from .models import Project, Agreement, Invoice, Contractor
class ContractorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contractor
        fields = '__all__'

class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = '__all__'


class AgreementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Agreement
        fields = '__all__'


class InvoiceSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='agreement.project_name', read_only=True)
    homeowner_name = serializers.CharField(source='agreement.homeowner_name', read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id',
            'agreement',
            'project_name',
            'homeowner_name',
            'amount_due',
            'is_paid',
            'created_at',
            'stripe_payment_intent',
        ]