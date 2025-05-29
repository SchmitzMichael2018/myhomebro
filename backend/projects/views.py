import os
from io import BytesIO
from django.conf import settings
from django.core.mail import send_mail
from django.http import FileResponse
from django.utils import timezone
from django.db import models
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
import stripe
import openai
from dotenv import load_dotenv

# Load .env if present
load_dotenv()

from .models import Project, Agreement, Invoice, Contractor, Homeowner, Message, Milestone
from .serializers import (
    ProjectSerializer,
    AgreementSerializer,
    InvoiceSerializer,
    ContractorSerializer,
    HomeownerSerializer,
    MessageSerializer,
)
from .utils import generate_agreement_pdf

# Load Stripe and OpenAI keys from environment or Django settings
stripe.api_key = getattr(settings, 'STRIPE_SECRET_KEY', os.getenv("STRIPE_SECRET_KEY"))
openai.api_key = getattr(settings, 'OPENAI_API_KEY', os.getenv("OPENAI_API_KEY"))

# ---------- AI CHATBOT ENDPOINT ----------

class AIChatView(APIView):
    permission_classes = []  # Optional: make public for demo, or add auth

    def post(self, request):
        message = request.data.get("message")
        section = request.data.get("section", "/")
        client = openai.OpenAI(api_key=openai.api_key)
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": f"You are HomeBro, a helpful assistant for home renovation contractors and homeowners. You are currently on: {section}. Be concise and friendly."},
                {"role": "user", "content": message},
            ],
            max_tokens=400,
        )
        ai_text = response.choices[0].message.content
        return Response({"reply": ai_text})

# ---------- CONTRACTOR VIEWSET ----------

class ContractorViewSet(viewsets.ModelViewSet):
    serializer_class = ContractorSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Contractor.objects.filter(user=self.request.user)

# ---------- CONTRACTOR ONBOARDING API ----------

class ContractorOnboardingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ContractorSerializer(data=request.data)
        user = request.user

        if serializer.is_valid():
            contractor, created = Contractor.objects.get_or_create(
                user=user,
                defaults={
                    "business_name": serializer.validated_data.get("business_name"),
                    "name": serializer.validated_data.get("name"),
                    "email": serializer.validated_data.get("email"),
                    "phone": serializer.validated_data.get("phone"),
                    "skills": serializer.validated_data.get("skills"),
                }
            )
            # If already exists, update values
            if not created:
                for attr, value in serializer.validated_data.items():
                    setattr(contractor, attr, value)
                contractor.save()

            # Create Stripe Connect account if not exists
            if not contractor.stripe_account_id:
                try:
                    account = stripe.Account.create(
                        type="express",
                        country="US",
                        email=contractor.email,
                        business_type="individual",  # Or "company"
                        capabilities={
                            "transfers": {"requested": True},
                            "card_payments": {"requested": True},
                        },
                    )
                    contractor.stripe_account_id = account.id
                    contractor.onboarding_status = account.get('details_submitted', False) and "completed" or "incomplete"
                    contractor.save()
                except Exception as e:
                    return Response(
                        {"detail": f"Error creating Stripe account: {str(e)}"},
                        status=status.HTTP_502_BAD_GATEWAY
                    )
            else:
                try:
                    account = stripe.Account.retrieve(contractor.stripe_account_id)
                except Exception as e:
                    return Response(
                        {"detail": f"Error retrieving Stripe account: {str(e)}"},
                        status=status.HTTP_502_BAD_GATEWAY
                    )

            # Create a Stripe account onboarding link
            try:
                account_link = stripe.AccountLink.create(
                    account=contractor.stripe_account_id,
                    refresh_url="http://localhost:5173/stripe/refresh",
                    return_url="http://localhost:5173/stripe/return",
                    type="account_onboarding",
                )
            except Exception as e:
                return Response(
                    {"detail": f"Error creating onboarding link: {str(e)}"},
                    status=status.HTTP_502_BAD_GATEWAY
                )

            return Response({
                "onboarding_url": account_link.url,
                "stripe_account_id": contractor.stripe_account_id,
                "onboarding_status": contractor.onboarding_status,
            }, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# ---------- AGREEMENT VIEWSET ----------

class AgreementViewSet(viewsets.ModelViewSet):
    serializer_class = AgreementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Agreement.objects.filter(
            models.Q(contractor__user=user) |
            models.Q(homeowner__email=user.email)
        ).distinct()

    def perform_create(self, serializer):
        contractor = Contractor.objects.get(user=self.request.user)
        serializer.save(contractor=contractor)

    @action(detail=True, methods=['patch'])
    def sign(self, request, pk=None):
        agreement = self.get_object()
        now = timezone.now()
        user = request.user
        changed_fields = []

        if user == agreement.contractor.user:
            agreement.signed_by_contractor = True
            agreement.signed_at_contractor = now
            changed_fields += ['signed_by_contractor', 'signed_at_contractor']
        elif user.email == agreement.homeowner.email:
            agreement.signed_by_homeowner = True
            agreement.signed_at_homeowner = now
            changed_fields += ['signed_by_homeowner', 'signed_at_homeowner']
        else:
            return Response({'detail': 'Unauthorized to sign this agreement.'},
                            status=status.HTTP_403_FORBIDDEN)

        agreement.save(update_fields=changed_fields)
        project = agreement.project
        if agreement.signed_by_contractor and agreement.signed_by_homeowner:
            project.status = 'signed'
            project.save(update_fields=['status'])
        return Response(self.get_serializer(agreement).data)

    @action(detail=True, methods=['post'])
    def fund_escrow(self, request, pk=None):
        agreement = self.get_object()
        amount_cents = int(agreement.total_cost * 100)
        try:
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency="usd",
                metadata={"agreement_id": str(agreement.id)},
            )
        except stripe.error.StripeError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_502_BAD_GATEWAY
            )
        agreement.escrow_funded = False
        if hasattr(agreement, 'escrow_payment_intent_id'):
            agreement.escrow_payment_intent_id = intent.id
        agreement.save(update_fields=['escrow_funded'] + (
            ['escrow_payment_intent_id'] if hasattr(agreement, 'escrow_payment_intent_id') else []
        ))
        return Response(
            {"client_secret": intent.client_secret},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'])
    def pdf(self, request, pk=None):
        agreement = self.get_object()
        try:
            pdf_path = generate_agreement_pdf(agreement)
            return FileResponse(open(pdf_path, 'rb'), as_attachment=True, filename=f"agreement_{agreement.id}.pdf")
        except Exception as e:
            return Response({'detail': str(e)}, status=500)

# ---------- INVOICE VIEWSET ----------

class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Invoice.objects.filter(
            models.Q(agreement__contractor__user=user) |
            models.Q(agreement__homeowner__email=user.email)
        ).distinct()

    @action(detail=True, methods=['patch'])
    def approve(self, request, pk=None):
        invoice = self.get_object()
        if request.user.email != invoice.agreement.homeowner.email:
            return Response({'detail': 'Only homeowner can approve.'},
                            status=status.HTTP_403_FORBIDDEN)
        invoice.status = 'approved'
        invoice.save(update_fields=['status'])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=['patch'])
    def dispute(self, request, pk=None):
        invoice = self.get_object()
        invoice.status = 'disputed'
        invoice.save(update_fields=['status'])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=['patch'])
    def mark_paid(self, request, pk=None):
        invoice = self.get_object()
        if request.user != invoice.agreement.contractor.user:
            return Response({'detail': 'Only contractor can mark as paid.'},
                            status=status.HTTP_403_FORBIDDEN)
        invoice.status = 'paid'
        invoice.save(update_fields=['status'])
        return Response(self.get_serializer(invoice).data)

# ---------- PROJECT VIEWSET ----------

class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Project.objects.filter(
            models.Q(contractor=user) |
            models.Q(homeowner__email=user.email)
        ).distinct()

# ---------- MESSAGE VIEWSET ----------

class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Message.objects.order_by('created_at')
        agreement_id = self.request.query_params.get('agreement')
        if agreement_id:
            qs = qs.filter(agreement__id=agreement_id)
        return qs

    def perform_create(self, serializer):
        message = serializer.save(sender=self.request.user)
        homeowner_email = message.agreement.homeowner.email
        send_mail(
            subject=f"New message from {self.request.user.username}",
            message=message.content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[homeowner_email],
            fail_silently=True,
        )

# ---------- HOMEOWNER LOOKUP API ----------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([UserRateThrottle])
def lookup_homeowner(request):
    email = request.query_params.get('email')
    found = Homeowner.objects.filter(email=email).exists()
    return Response({'found': found})



























