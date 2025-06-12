import os
import logging
import traceback
from io import BytesIO
from datetime import datetime

import stripe
import openai
from dotenv import load_dotenv

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, EmailMessage, send_mail
from django.template.loader import render_to_string
from django.shortcuts import render, redirect, get_object_or_404
from django.http import (
    FileResponse,
    Http404,
    HttpResponse,
    HttpResponseBadRequest,
    HttpResponseForbidden,
)
from django.urls import reverse
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django import forms
from django.db import models, transaction
from django.db.models import Min, Max
from django.utils.dateparse import parse_duration
from django.utils.timesince import timesince
from django.utils.timezone import localtime

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.exceptions import PermissionDenied

from django_filters.rest_framework import DjangoFilterBackend

# Load environment variables
load_dotenv()
stripe.api_key = settings.STRIPE_SECRET_KEY or os.getenv("STRIPE_SECRET_KEY", "")
openai.api_key = os.getenv("OPENAI_API_KEY", "")

# Models & serializers
from .models import (
    Project,
    Agreement,
    Invoice,
    Contractor,
    Homeowner,
    Message,
    Milestone,
    MilestoneComment,
    MilestoneFile,
    Expense,
)
from .serializers import (
    ProjectSerializer,
    AgreementSerializer,
    InvoiceSerializer,
    ContractorSerializer,
    HomeownerSerializer,
    MessageSerializer,
    MilestoneSerializer,
    MilestoneCommentSerializer,
    MilestoneFileSerializer,
    ExpenseSerializer,
    AgreementCalendarSerializer,  # <-- Added import
)
from .utils import generate_full_agreement_pdf, load_legal_text


# ─── Stripe Webhook ──────────────────────────────────────────────────────────────
@csrf_exempt
def stripe_webhook(request):
    payload         = request.body
    sig_header      = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    endpoint_secret = settings.STRIPE_WEBHOOK_SECRET

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        return HttpResponseBadRequest("Invalid payload")
    except stripe.error.SignatureVerificationError:
        return HttpResponseForbidden("Invalid signature")

    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        agr_id = intent.get("metadata", {}).get("agreement_id")
        if agr_id:
            try:
                agr = Agreement.objects.get(id=agr_id)
                agr.escrow_funded = True
                agr.save(update_fields=["escrow_funded"])
            except Agreement.DoesNotExist:
                pass

    return HttpResponse(status=200)


# ─── AI Chat Endpoint ────────────────────────────────────────────────────────────
class AIChatView(APIView):
    permission_classes = []  # public

    def post(self, request):
        message = request.data.get("message")
        section = request.data.get("section", "/")
        client  = openai.OpenAI(api_key=openai.api_key)
        response= client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are HomeBro, a helpful assistant for home renovation contractors and homeowners. "
                        f"You are currently on: {section}. Be concise and friendly."
                    )
                },
                {"role": "user", "content": message},
            ],
            max_tokens=400,
        )
        return Response({"reply": response.choices[0].message.content})


# ─── Contractor APIs ────────────────────────────────────────────────────────────
class ContractorViewSet(viewsets.ModelViewSet):
    serializer_class   = ContractorSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Contractor.objects.filter(user=self.request.user)


class ContractorOnboardingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ContractorSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        data    = serializer.validated_data
        now     = timezone.now()
        version = "v1.0"
        user    = request.user

        contractor, created = Contractor.objects.get_or_create(
            user=user,
            defaults={
                "business_name":     data.get("business_name"),
                "name":              data.get("name"),
                "email":             data.get("email"),
                "phone":             data.get("phone"),
                "address":           data.get("address"),
                "skills":            data.get("skills"),
                "license_number":    data.get("license_number"),
                "terms_accepted_at": now,
                "terms_version":     version,
            },
        )
        if not created:
            for attr, val in data.items():
                if attr != "terms_accepted":
                    setattr(contractor, attr, val)
            if not contractor.terms_accepted_at:
                contractor.terms_accepted_at = now
                contractor.terms_version     = version
            contractor.save()

        account_link = stripe.AccountLink.create(
            account=contractor.stripe_account_id,
            refresh_url="http://localhost:5173/stripe/refresh",
            return_url="http://localhost:5173/stripe/return",
            type="account_onboarding",
        )
        return Response({
            "onboarding_url":    account_link.url,
            "stripe_account_id": contractor.stripe_account_id,
            "onboarding_status": contractor.onboarding_status,
            "terms_accepted_at": contractor.terms_accepted_at,
            "terms_version":     contractor.terms_version,
        }, status=status.HTTP_201_CREATED)



# ─── Homeowner Lookup (flat endpoint) ──────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def lookup_homeowner(request):
    """
    GET /api/homeowners/lookup/?email=foo@bar.com
    """
    email = request.query_params.get('email')
    if not email:
        return Response({"detail": "email query parameter required"},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        hw = Homeowner.objects.get(email=email)
    except Homeowner.DoesNotExist:
        return Response({"detail": "Not found"},
                        status=status.HTTP_404_NOT_FOUND)

    serializer = HomeownerSerializer(hw)
    return Response(serializer.data)



# ─── Agreement ViewSet ─────────────────────────────────────────────────────────
class AgreementViewSet(viewsets.ModelViewSet):
    serializer_class   = AgreementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Agreement.objects
                .filter(
                    models.Q(contractor=user) |
                    models.Q(project__homeowner__email=user.email)
                )
                .distinct()
                .select_related(
                    "contractor",
                    "project__homeowner",
                    "project"
                )
                .prefetch_related(
                    "milestones",
                    "invoices",
                    "misc_expenses"
                )
        )

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        agr = self.get_object()
        if agr.reviewed:
            return Response({"detail": "Already reviewed."}, status=status.HTTP_400_BAD_REQUEST)
        agr.reviewed = True
        agr.save(update_fields=["reviewed"])
        return Response({"reviewed": True})

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        agr = self.get_object()
        try:
            pdf_path = generate_full_agreement_pdf(agr)
            if not os.path.exists(pdf_path):
                return Response(
                    {"detail": f"PDF generated but not found: {pdf_path}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            return FileResponse(
                open(pdf_path, "rb"),
                as_attachment=True,
                filename=f"agreement_{agr.id}.pdf"
            )
        except Exception as e:
            logging.getLogger(__name__).error(
                f"PDF gen error for Agreement {agr.id}: {traceback.format_exc()}"
            )
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["patch"])
    def sign(self, request, pk=None):
        agr   = self.get_object()
        if not agr.reviewed:
            return Response({"detail": "You must review before signing."}, status=status.HTTP_400_BAD_REQUEST)

        user  = request.user
        now   = timezone.now()
        ip    = request.META.get("REMOTE_ADDR")
        typed = request.data.get("typed_name") or request.data.get("signature_name")

        # Contractor signs
        if user == agr.contractor:
            if not typed:
                return Response({"detail": "Contractor must supply typed_name."}, status=status.HTTP_400_BAD_REQUEST)
            agr.signed_by_contractor      = True
            agr.signed_at_contractor      = now
            agr.contractor_signature_name = typed
            agr.contractor_signed_ip      = ip
            agr.save(update_fields=[
                "signed_by_contractor",
                "signed_at_contractor",
                "contractor_signature_name",
                "contractor_signed_ip",
            ])

            # notify homeowner
            if agr.project.homeowner and not agr.signed_by_homeowner:
                when = agr.signed_at_contractor.strftime("%B %d, %Y at %I:%M %p")
                send_mail(
                    subject="Action Required: Sign Agreement",
                    message=(
                        f"Hi {agr.project.homeowner.name},\n\n"
                        f"Your contractor signed on {when}. Please review & sign."
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[agr.project.homeowner.email],
                    fail_silently=True,
                )

        # Homeowner signs
        elif agr.project.homeowner and user.email == agr.project.homeowner.email:
            if not typed:
                return Response({"detail": "Homeowner must supply typed_name."}, status=status.HTTP_400_BAD_REQUEST)
            agr.signed_by_homeowner       = True
            agr.signed_at_homeowner       = now
            agr.homeowner_signature_name  = typed
            agr.homeowner_signed_ip       = ip
            agr.save(update_fields=[
                "signed_by_homeowner",
                "signed_at_homeowner",
                "homeowner_signature_name",
                "homeowner_signed_ip",
            ])
        else:
            return Response({"detail": "Unauthorized to sign."}, status=status.HTTP_403_FORBIDDEN)

        # Mark project signed if both have signed
        if agr.signed_by_contractor and agr.signed_by_homeowner:
            agr.project.status = "signed"
            agr.project.save(update_fields=["status"])

        return Response(self.get_serializer(agr).data)

    @action(detail=True, methods=["post"], url_path="email_invite", permission_classes=[IsAuthenticated])
    def email_invite(self, request, pk=None):
        agr       = self.get_object()
        homeowner = agr.project.homeowner
        if not homeowner or not homeowner.email:
            return Response({"detail": "No homeowner email."}, status=status.HTTP_400_BAD_REQUEST)

        token = agr.homeowner_access_token
        path  = reverse("projects_api:agreement-magic-access", kwargs={"token": token})
        url   = request.build_absolute_uri(path)

        render_ctx = {
            "homeowner_name": homeowner.name,
            "agreement":      agr,
            "link":           url,
            "site_name":      "MyHomeBro",
        }
        txt  = render_to_string("emails/agreement_invite.txt", render_ctx)
        html = render_to_string("emails/agreement_invite.html", render_ctx)

        msg = EmailMultiAlternatives(
            subject=f"Please review & sign Agreement #{agr.id}",
            body=txt,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[homeowner.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send(fail_silently=False)

        return Response({"detail": "Invite sent."})

    @action(detail=True, methods=["post"], url_path="fund_escrow", permission_classes=[IsAuthenticated])
    def fund_escrow(self, request, pk=None):
        agr = self.get_object()
        if not (agr.signed_by_contractor and agr.signed_by_homeowner):
            return Response({"detail": "Agreement not signed by both parties."}, status=status.HTTP_400_BAD_REQUEST)
        if agr.escrow_funded:
            return Response({"detail": "Escrow already funded."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            intent = stripe.PaymentIntent.create(
                amount=int(agr.total_cost * 100),
                currency="usd",
                metadata={"agreement_id": str(agr.id)},
            )
        except stripe.error.StripeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

        agr.escrow_payment_intent_id = intent.id
        agr.save(update_fields=["escrow_payment_intent_id"])
        return Response({"client_secret": intent.client_secret})



# ─── Public HTML Sign Flow ──────────────────────────────────────────────────────
class AgreementSignForm(forms.Form):
    typed_name = forms.CharField(
        label="Your Full Name",
        max_length=100,
        widget=forms.TextInput(attrs={"class": "form-control"})
    )

class AgreementSignView(View):
    template_name = "projects/sign_agreement.html"

    def get(self, request, token):
        agr     = get_object_or_404(Agreement, homeowner_access_token=token)
        terms   = load_legal_text("terms_of_service.txt")
        privacy = load_legal_text("privacy_policy.txt")
        return render(request, self.template_name, {
            "agreement": agr,
            "stripe_public_key": settings.STRIPE_PUBLIC_KEY,
            "terms_text": terms,
            "privacy_text": privacy,
            "form": AgreementSignForm(),
        })

    def post(self, request, token):
        agr  = get_object_or_404(Agreement, homeowner_access_token=token)
        form = AgreementSignForm(request.POST)
        if not form.is_valid():
            return render(request, self.template_name, {
                "agreement": agr,
                "stripe_public_key": settings.STRIPE_PUBLIC_KEY,
                "terms_text": load_legal_text("terms_of_service.txt"),
                "privacy_text": load_legal_text("privacy_policy.txt"),
                "form": form,
            })

        agr.signed_by_homeowner       = True
        agr.signed_at_homeowner       = timezone.now()
        agr.homeowner_signature_name  = form.cleaned_data["typed_name"]
        agr.homeowner_signed_ip       = request.META.get("REMOTE_ADDR")
        agr.save(update_fields=[
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "homeowner_signed_ip",
        ])

        # email signed PDF
        try:
            pdf_path = generate_full_agreement_pdf(agr)
            email = EmailMessage(
                subject=f"Your Signed Agreement #{agr.id}",
                body=(f"Hi {agr.project.homeowner.name},\n\n"
                      "Thank you for signing. Your signed agreement is attached."),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[agr.project.homeowner.email],
            )
            email.attach_file(pdf_path)
            email.send(fail_silently=False)
        except Exception as e:
            logging.error(f"Failed to email signed PDF for Agreement {agr.id}: {e}")

        return redirect("projects_api:agreement-sign-success", token=token)

class AgreementSignSuccessView(View):
    template_name = "projects/sign_success.html"
    def get(self, request, token):
        agr = get_object_or_404(Agreement, homeowner_access_token=token)
        return render(request, self.template_name, {"agreement": agr})



# ─── Public PDF Download ────────────────────────────────────────────────────────
class AgreementMagicPdfView(View):
    def get(self, request, token):
        agr = get_object_or_404(Agreement, homeowner_access_token=token)
        try:
            pdf_path = generate_full_agreement_pdf(agr)
        except Exception as e:
            raise Http404(f"Could not generate PDF: {e}")
        return FileResponse(
            open(pdf_path, "rb"),
            as_attachment=True,
            filename=f"agreement_{agr.id}.pdf"
        )



# ─── Public JSON Access & Escrow via Token ─────────────────────────────────────
class MagicAccessView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        agr = get_object_or_404(Agreement, homeowner_access_token=token)
        return Response(AgreementSerializer(agr, context={"request": request}).data)

    def post(self, request, token):
        agr = get_object_or_404(Agreement, homeowner_access_token=token)
        typed = request.data.get("typed_name", "").strip()
        if not typed:
            return Response({"detail": "typed_name is required"}, status=status.HTTP_400_BAD_REQUEST)

        agr.signed_by_homeowner      = True
        agr.signed_at_homeowner      = timezone.now()
        agr.homeowner_signature_name = typed
        agr.homeowner_signed_ip      = request.META.get("REMOTE_ADDR", "")
        agr.save(update_fields=[
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "homeowner_signed_ip",
        ])

        return Response(AgreementSerializer(agr, context={"request": request}).data)


class MagicFundEscrowView(APIView):
    authentication_classes = []
    permission_classes     = []

    def post(self, request, token):
        agr = get_object_or_404(Agreement, homeowner_access_token=token)
        if not (agr.signed_by_contractor and agr.signed_by_homeowner):
            return Response({"detail": "Must be signed by both parties."}, status=status.HTTP_400_BAD_REQUEST)
        if agr.escrow_funded:
            return Response({"detail": "Escrow already funded."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            intent = stripe.PaymentIntent.create(
                amount=int(agr.total_cost * 100),
                currency="usd",
                metadata={"agreement_id": str(agr.id)},
                receipt_email=agr.project.homeowner.email,
            )
        except stripe.error.StripeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

        agr.escrow_payment_intent_id = intent.id
        agr.save(update_fields=["escrow_payment_intent_id"])

        # optional immediate email receipt
        try:
            receipt = EmailMessage(
                subject=f"Your escrow payment is pending for Agreement #{agr.id}",
                body=(f"Hi {agr.project.homeowner.name},\n\n"
                      "We’ve received your payment. Once it clears, we’ll release escrow."),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[agr.project.homeowner.email],
            )
            receipt.send(fail_silently=True)
        except Exception as e:
            logging.error(f"Escrow receipt email failed for Agreement {agr.id}: {e}")

        return Response({"client_secret": intent.client_secret})



# ─── File & Comment ViewSets ───────────────────────────────────────────────────
class MilestoneFileViewSet(viewsets.ModelViewSet):
    queryset          = MilestoneFile.objects.all()
    serializer_class  = MilestoneFileSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes    = [MultiPartParser, FormParser]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class MilestoneCommentViewSet(viewsets.ModelViewSet):
    queryset         = MilestoneComment.objects.all().order_by('created_at')
    serializer_class = MilestoneCommentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends  = [DjangoFilterBackend]
    filterset_fields = ['milestone']
    parser_classes   = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        milestone_pk = self.kwargs.get('milestone_pk')
        qs = super().get_queryset()
        if milestone_pk:
            qs = qs.filter(milestone_id=milestone_pk)
        return qs

    def perform_create(self, serializer):
        milestone_pk = self.kwargs.get('milestone_pk')
        if not milestone_pk:
            raise PermissionDenied("Milestone context is required for creation.")
        ms = get_object_or_404(Milestone, pk=milestone_pk)
        if self.request.user != ms.agreement.contractor:
            raise PermissionDenied("Only the contractor may add comments.")
        serializer.save(author=self.request.user, milestone=ms)

# ─── Public JSON invoice view via magic-link ────────────────────────────────────
class MagicInvoiceView(APIView):
    authentication_classes = []  # no login
    permission_classes     = []

    def get(self, request, pk):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "Access token required."}, status=400)

        inv = get_object_or_404(Invoice, pk=pk)
        if str(inv.milestone.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid access token.")

        serializer = InvoiceSerializer(inv, context={"request": request})
        return Response(serializer.data)


class MagicInvoiceApproveView(APIView):
    authentication_classes = []
    permission_classes     = []

    def patch(self, request, pk):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "Access token required."}, status=400)

        inv = get_object_or_404(Invoice, pk=pk)
        agr = inv.milestone.agreement

        # verify homeowner token
        if agr.homeowner_access_token != token:
            raise PermissionDenied("Invalid access token.")

        if inv.status != "pending":
            return Response({"detail": "Only pending invoices can be approved."}, status=400)

        # 1) mark approved in DB
        inv.status = "approved"
        inv.save(update_fields=["status"])

        # 2) if we have an escrow PaymentIntent, capture it:
        pi_id = agr.escrow_payment_intent_id
        if pi_id:
            try:
                stripe.PaymentIntent.capture(pi_id)
            except stripe.error.StripeError as e:
                # rollback status if you like, or just inform homeowner
                return Response(
                    {"detail": "Payment capture failed: " + str(e)},
                    status=status.HTTP_502_BAD_GATEWAY
                )

        # 3) immediately mark paid
        inv.status = "paid"
        inv.save(update_fields=["status"])

        serializer = InvoiceSerializer(inv, context={"request": request})
        return Response(serializer.data)


class MagicInvoiceDisputeView(APIView):
    authentication_classes = []
    permission_classes     = []

    def patch(self, request, pk):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "Access token required."}, status=400)

        inv = get_object_or_404(Invoice, pk=pk)
        if str(inv.milestone.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid access token.")
        if inv.status != "pending":
            return Response({"detail": "Can only dispute pending invoices."}, status=400)

        inv.status = "disputed"
        inv.save(update_fields=["status"])
        serializer = InvoiceSerializer(inv, context={"request": request})
        return Response(serializer.data)

# ─── Invoice & Project ViewSets ───────────────────────────────────────────────
class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class   = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Invoice.objects
                .filter(
                    models.Q(agreement__contractor=user) |
                    models.Q(agreement__project__homeowner__email=user.email)
                )
                .distinct()
        )

    @action(detail=True, methods=["patch"])
    def approve(self, request, pk=None):
        inv = self.get_object()
        agr = inv.agreement

        # 1) Only the homeowner may approve
        if request.user.email != agr.project.homeowner.email:
            return Response(
                {"detail": "Only the homeowner can approve."},
                status=status.HTTP_403_FORBIDDEN
            )

        # 2) Must be pending
        if inv.status != "pending":
            return Response(
                {"detail": "Only pending invoices can be approved."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 3) Mark approved
        inv.status = "approved"
        inv.save(update_fields=["status"])

        # 4) Capture escrow if we have a PaymentIntent
        pi_id = agr.escrow_payment_intent_id
        if pi_id:
            try:
                stripe.PaymentIntent.capture(pi_id)
            except stripe.error.StripeError as e:
                # If capture fails, roll back or inform homeowner
                return Response(
                    {"detail": f"Payment capture failed: {str(e)}"},
                    status=status.HTTP_502_BAD_GATEWAY
                )

        # 5) Immediately mark paid
        inv.status = "paid"
        inv.save(update_fields=["status"])

        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["patch"])
    def dispute(self, request, pk=None):
        inv = self.get_object()
        if request.user.email != inv.agreement.project.homeowner.email:
            return Response({"detail": "Only homeowner can dispute."}, status=status.HTTP_403_FORBIDDEN)
        inv.status = "disputed"
        inv.save(update_fields=["status"])
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["patch"])
    def mark_paid(self, request, pk=None):
        inv = self.get_object()
        if request.user != inv.agreement.contractor:
            return Response({"detail": "Only contractor can mark as paid."}, status=status.HTTP_403_FORBIDDEN)
        inv.status = "paid"
        inv.save(update_fields=["status"])
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        inv = self.get_object()
        if request.user != inv.agreement.contractor:
            return Response({"detail": "Only contractor can resend invoice."}, status=status.HTTP_403_FORBIDDEN)

        homeowner = inv.agreement.project.homeowner
        frontend  = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        link      = f"{frontend}/invoices/{inv.pk}?token={inv.agreement.homeowner_access_token}"

        context = {
            "homeowner_name": homeowner.name,
            "invoice":        inv,
            "link":           link,
            "site_name":      "MyHomeBro",
        }
        text_body = render_to_string("emails/invoice_email.txt", context)
        html_body = render_to_string("emails/invoice_email.html", context)

        msg = EmailMultiAlternatives(
            subject=f"{context['site_name']} Invoice #{inv.pk}",
            body=text_body,
            from_email=f"{context['site_name']} <{settings.DEFAULT_FROM_EMAIL}>",
            to=[homeowner.email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send()

        return Response({"detail": "Invoice resent."}, status=status.HTTP_200_OK)



class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class   = ProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Project.objects
                .filter(
                    models.Q(contractor=user) |
                    models.Q(homeowner__email=user.email)
                )
                .distinct()
        )


class MilestoneViewSet(viewsets.ModelViewSet):
    queryset          = Milestone.objects.all().select_related("agreement__project__homeowner")
    serializer_class  = MilestoneSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=True, methods=["post"])
    def mark_complete(self, request, pk=None):
        milestone = self.get_object()
        if request.user != milestone.agreement.contractor:
            raise PermissionDenied("Only the contractor may mark complete.")
        if milestone.completed:
            return Response({"detail": "Already completed."}, status=status.HTTP_400_BAD_REQUEST)
        milestone.completed = True
        milestone.save(update_fields=["completed"])
        return Response(self.get_serializer(milestone).data)

    @action(detail=True, methods=["post"])
    def send_invoice(self, request, pk=None):
        milestone = self.get_object()
        if request.user != milestone.agreement.contractor:
            raise PermissionDenied("Only the contractor may send invoices.")

        if milestone.is_invoiced:
            invoice = milestone.invoices.order_by("-created_at").first()
        else:
            invoice = Invoice.objects.create(
                agreement=milestone.agreement,
                milestone=milestone,
                amount_due=milestone.amount,
                due_date=milestone.completion_date,
            )
            milestone.is_invoiced = True
            milestone.save(update_fields=["is_invoiced"])

        frontend = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        link     = f"{frontend}/invoices/{invoice.pk}?token={milestone.agreement.homeowner_access_token}"

        homeowner = milestone.agreement.project.homeowner
        context   = {
            "homeowner_name": homeowner.name,
            "milestone":      milestone,
            "invoice":        invoice,
            "link":           link,
            "site_name":      "MyHomeBro",
        }

        text_body = render_to_string("emails/invoice_email.txt", context)
        html_body = render_to_string("emails/invoice_email.html", context)

        msg = EmailMultiAlternatives(
            subject=f"{context['site_name']} Invoice #{invoice.pk}",
            body=text_body,
            from_email=f"{context['site_name']} <{settings.DEFAULT_FROM_EMAIL}>",
            to=[homeowner.email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send()

        serializer = InvoiceSerializer(invoice, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)



class ExpenseViewSet(viewsets.ModelViewSet):
    serializer_class   = ExpenseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        aid = self.kwargs.get("agreement_id")
        qs  = Expense.objects.filter(
            models.Q(agreement__contractor=self.request.user) |
            models.Q(agreement__project__homeowner__email=self.request.user.email)
        )
        if aid:
            qs = qs.filter(agreement_id=aid)
        return qs.distinct()

    def perform_create(self, serializer):
        aid = self.kwargs.get("agreement_id")
        if not (
            Agreement.objects.filter(pk=aid, contractor=self.request.user).exists()
            or Agreement.objects.filter(pk=aid, project__homeowner__email=self.request.user.email).exists()
        ):
            raise PermissionDenied("Unauthorized or invalid agreement.")
        serializer.save(created_by=self.request.user, agreement_id=aid)



class MilestoneCalendarView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = MilestoneCalendarSerializer(
            Milestone.objects.select_related("agreement__project").all(),
            many=True
        ).data
        return Response(data)



class AgreementCalendarView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = AgreementCalendarSerializer(
            Agreement.objects.select_related("project").all(),
            many=True
        ).data
        return Response(data)
