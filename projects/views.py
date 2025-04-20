from rest_framework import generics
from rest_framework.permissions import IsAuthenticated  
from .models import Project, Agreement, Invoice, Contractor
from .serializers import ProjectSerializer, AgreementSerializer, InvoiceSerializer, ContractorSerializer
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
import uuid 

# 🔨 Project Views
class ProjectListCreateView(generics.ListCreateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

# 🔖 Agreement Views
class AgreementListCreateView(generics.ListCreateAPIView):
    queryset = Agreement.objects.all()
    serializer_class = AgreementSerializer

# 💵 Invoice Views
class InvoiceListCreateView(generics.ListCreateAPIView):
    queryset = Invoice.objects.all()
    serializer_class = InvoiceSerializer
    
class ContractorViewSet(viewsets.ModelViewSet):
    queryset = Contractor.objects.all()
    serializer_class = ContractorSerializer

class AgreementViewSet(viewsets.ModelViewSet):  
    queryset = Agreement.objects.all()
    serializer_class = AgreementSerializer    

class InvoiceViewSet(viewsets.ModelViewSet):
    queryset = Invoice.objects.all()
    serializer_class = InvoiceSerializer

    def perform_create(self, serializer):
        # Generate a mock Stripe payment intent ID
        fake_intent = f"pi_mock_{uuid.uuid4().hex[:10]}"
        serializer.save(stripe_payment_intent=fake_intent, is_paid=False)

    @action(detail=True, methods=["patch"])
    def mark_paid(self, request, pk=None):
        try:
            invoice = self.get_object()
            invoice.is_paid = True
            invoice.save()
            return Response({"status": "marked as paid"}, status=status.HTTP_200_OK)
        except Invoice.DoesNotExist:
            return Response({"error": "Invoice not found"}, status=status.HTTP_404_NOT_FOUND)
    
    
    def get_queryset(self):
        user = self.request.user
        contractor = getattr(user, 'contractor', None)
        if contractor:
            return Invoice.objects.filter(agreement__contractor=contractor)
        return Invoice.objects.none()
    