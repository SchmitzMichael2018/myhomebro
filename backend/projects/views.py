from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Project, Agreement, Invoice, Contractor, Homeowner, Milestone
from .serializers import ProjectSerializer, AgreementSerializer, InvoiceSerializer, ContractorSerializer, HomeownerSerializer
from datetime import timedelta
from django.http import FileResponse
from .utils import generate_agreement_pdf, generate_digital_signature
from django.utils import timezone
import uuid
import os
from django.conf import settings
import stripe

stripe.api_key = settings.STRIPE_SECRET_KEY


# ✅ Agreement ViewSet with E-Signature and Digital Signature Options
class AgreementViewSet(viewsets.ModelViewSet):
    queryset = Agreement.objects.all()
    serializer_class = AgreementSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        contractor = Contractor.objects.get(user=self.request.user)
        homeowner_data = self.request.data
        homeowner, _ = Homeowner.objects.get_or_create(
            email=homeowner_data.get("homeowner_email"),
            defaults={"name": homeowner_data.get("homeowner_name")}
        )

        agreement = serializer.save(contractor=contractor, homeowner=homeowner)
        self.regenerate_pdf(agreement)

    @action(detail=True, methods=["post"])
    def sign_agreement(self, request, pk=None):
        agreement = self.get_object()
        user = request.user
        signature_type = request.data.get("signatureType")
        typed_name = request.data.get("typedName")
        drawn_signature = request.data.get("drawnSignature")

        if signature_type == "e-signature":
            if not typed_name:
                return Response({"error": "Typed name is required for E-Signature."}, status=status.HTTP_400_BAD_REQUEST)

            if user.contractor:
                agreement.contractor_signature = typed_name
                agreement.contractor_drawn_signature = drawn_signature
                agreement.contractor_signed_at = timezone.now()
            else:
                agreement.homeowner_signature = typed_name
                agreement.homeowner_drawn_signature = drawn_signature
                agreement.homeowner_signed_at = timezone.now()

        elif signature_type == "digital-signature":
            pdf_path = generate_agreement_pdf(agreement.id)
            digital_signature = generate_digital_signature(pdf_path)

            if user.contractor:
                agreement.contractor_signature = "Digital Signature"
                agreement.contractor_signed_at = timezone.now()
                agreement.contractor_digital_signature = digital_signature
            else:
                agreement.homeowner_signature = "Digital Signature"
                agreement.homeowner_signed_at = timezone.now()
                agreement.homeowner_digital_signature = digital_signature

        else:
            return Response({"error": "Invalid signature type."}, status=status.HTTP_400_BAD_REQUEST)

        agreement.is_signed = bool(agreement.contractor_signature and agreement.homeowner_signature)
        agreement.save()
        self.regenerate_pdf(agreement)

        return Response({"status": "Agreement signed", "pdf_url": agreement.pdf_url}, status=status.HTTP_200_OK)


# ✅ Invoice ViewSet with Stripe Payment Integration
class InvoiceViewSet(viewsets.ModelViewSet):
    queryset = Invoice.objects.all()
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        if settings.STRIPE_LIVE_MODE == "True":
            amount_due = int(serializer.validated_data.get("amount_due") * 100)
            payment_intent = stripe.PaymentIntent.create(
                amount=amount_due,
                currency="usd",
                description="MyHomeBro Invoice Payment",
                automatic_payment_methods={"enabled": True},
            )
            serializer.save(stripe_payment_intent=payment_intent['id'], is_paid=False)
        else:
            fake_intent = f"pi_mock_{uuid.uuid4().hex[:10]}"
            serializer.save(stripe_payment_intent=fake_intent, is_paid=False)

    @action(detail=True, methods=["post"])
    def initialize_payment(self, request, pk=None):
        invoice = self.get_object()

        if invoice.is_paid:
            return Response({"error": "Invoice is already paid."}, status=status.HTTP_400_BAD_REQUEST)

        if settings.STRIPE_LIVE_MODE == "True":
            try:
                payment_intent = stripe.PaymentIntent.retrieve(invoice.stripe_payment_intent)
                return Response({"client_secret": payment_intent.client_secret}, status=status.HTTP_200_OK)
            except stripe.error.InvalidRequestError:
                return Response({"error": "Invalid Payment Intent."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response({"client_secret": "mock_client_secret_12345"}, status=status.HTTP_200_OK)


# ✅ Project ViewSet
class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]


# ✅ Homeowner Lookup Endpoint for Email Auto-fill
@api_view(['GET'])
def lookup_homeowner(request):
    email = request.query_params.get('email')
    if not email:
        return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        homeowner = Homeowner.objects.get(email=email)
        serializer = HomeownerSerializer(homeowner)
        return Response(serializer.data)
    except Homeowner.DoesNotExist:
        return Response({'found': False}, status=status.HTTP_200_OK)






