import os
import logging
import traceback
from io import BytesIO
from datetime import datetime

import stripe
import openai
from dotenv import load_dotenv

from django.conf import settings
from django.core.mail import send_mail, EmailMessage
from django.http import (
    FileResponse,
    Http404,
    HttpResponse,
    HttpResponseBadRequest,
    HttpResponseForbidden,
)
from django.shortcuts import render, redirect, get_object_or_404
from django.utils import timezone
from django.urls import reverse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django import forms
from django.db import models

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.parsers import MultiPartParser, FormParser

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
)
from .serializers import (
    ProjectSerializer,
    AgreementSerializer,
    InvoiceSerializer,
    ContractorSerializer,
    HomeownerSerializer,
    MessageSerializer,
    MilestoneSerializer,
    ExpenseSerializer,
    MilestoneFileSerializer,
    AgreementCalendarSerializer,
    MilestoneCalendarSerializer,
)
from .utils import generate_full_agreement_pdf, load_legal_text

# ── Load .env & configure clients ─────────────────────────────────────────────────
load_dotenv()
stripe.api_key = settings.STRIPE_SECRET_KEY or os.getenv("STRIPE_SECRET_KEY", "")
openai.api_key = os.getenv("OPENAI_API_KEY", "")

# ── Stripe Webhook Receiver ───────────────────────────────────────────────────────
@csrf_exempt
def stripe_webhook(request):
    payload        = request.body
    sig_header     = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    endpoint_secret= settings.STRIPE_WEBHOOK_SECRET

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

# ── AI Chat Endpoint ──────────────────────────────────────────────────────────────
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

# ── Contractor APIs ───────────────────────────────────────────────────────────────
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

# ── Agreement ViewSet ─────────────────────────────────────────────────────────────
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

        # Contractor signs:
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
            # email homeowner:
            if agr.project.homeowner and not agr.signed_by_homeowner:
                try:
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
                except Exception as e:
                    logging.error(f"Homeowner notify failed: {e}")

        # Homeowner signs:
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

        # if both signed → mark project signed
        if agr.signed_by_contractor and agr.signed_by_homeowner:
            agr.project.status = "signed"
            agr.project.save(update_fields=["status"])
            # (optional) email PDF to both parties here

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

        send_mail(
            subject=f"Please review & sign your agreement for “{agr.project.title}”",
            message=(
                f"Hi {homeowner.name},\n\n"
                f"Your contractor has prepared an agreement for “{agr.project.title}”.\n"
                f"Click here (no login):\n\n{url}\n\n"
                "Thank you,\nMyHomeBro Team"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[homeowner.email],
            fail_silently=False,
        )
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

# ── Homeowner HTML Sign Flow ─────────────────────────────────────────────────────
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
            "agreement":         agr,
            "stripe_public_key": settings.STRIPE_PUBLIC_KEY,
            "terms_text":        terms,
            "privacy_text":      privacy,
            "form":               AgreementSignForm(),
        })

    def post(self, request, token):
        agr  = get_object_or_404(Agreement, homeowner_access_token=token)
        form = AgreementSignForm(request.POST)
        if not form.is_valid():
            return render(request, self.template_name, {
                "agreement":         agr,
                "stripe_public_key": settings.STRIPE_PUBLIC_KEY,
                "terms_text":        load_legal_text("terms_of_service.txt"),
                "privacy_text":      load_legal_text("privacy_policy.txt"),
                "form":               form,
            })

        # mark homeowner signed
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

        # email signed PDF back to homeowner
        try:
            pdf_path = generate_full_agreement_pdf(agr)
            email = EmailMessage(
                subject=f"Your Signed Agreement #{agr.id}",
                body=(
                    f"Hi {agr.project.homeowner.name},\n\n"
                    "Thank you for signing. Your signed agreement is attached.\n\n"
                    "— MyHomeBro Team"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[agr.project.homeowner.email],
            )
            email.attach_file(pdf_path)
            email.send(fail_silently=False)
        except Exception as e:
            logging.error(f"Failed to email signed PDF for Agreement {agr.id}: {e}")

        # redirect to “all set” page
        return redirect("projects_api:agreement-sign-success", token=token)

class AgreementSignSuccessView(View):
    template_name = "projects/sign_success.html"

    def get(self, request, token):
        agr = get_object_or_404(Agreement, homeowner_access_token=token)
        return render(request, self.template_name, {
            "agreement":         agr,
            "stripe_public_key": settings.STRIPE_PUBLIC_KEY,
        })

# ── Public PDF download (magic‐link) ──────────────────────────────────────────────
class AgreementMagicPdfView(View):
    """
    GET  /api/agreements/access/<token>/pdf/
    → regenerate & stream the full agreement PDF.
    No auth required.
    """
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

# ── Public JSON & fund-escrow via magic‐link ──────────────────────────────────────
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
        agr.homeowner_signed_ip      = request.META.get("REMOTE_ADDR")
        agr.save(update_fields=[
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "homeowner_signed_ip",
        ])
        return Response(AgreementSerializer(agr, context={"request": request}).data)

class MagicFundEscrowView(APIView):
    """
    POST /api/agreements/access/<token>/fund_escrow/
    → returns { client_secret } for homeowner’s escrow payment.
    No auth—URL token is the only guard.
    """
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
                body=(
                    f"Hi {agr.project.homeowner.name},\n\n"
                    "We’ve received your payment method. Once it clears, we’ll release escrow.\n\n"
                    f"Total: ${agr.total_cost:.2f}\n\n"
                    "Thank you for using MyHomeBro!"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[agr.project.homeowner.email],
            )
            receipt.send(fail_silently=True)
        except Exception as e:
            logging.error(f"Escrow receipt email failed for Agreement {agr.id}: {e}")

        return Response({"client_secret": intent.client_secret})

# ── Other ViewSets & Utilities ──────────────────────────────────────────────────
class MilestoneFileViewSet(viewsets.ModelViewSet):
    queryset         = MilestoneFile.objects.all()
    serializer_class = MilestoneFileSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes     = [MultiPartParser, FormParser]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

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
        if request.user.email != inv.agreement.project.homeowner.email:
            return Response({"detail": "Only homeowner can approve."}, status=status.HTTP_403_FORBIDDEN)
        inv.status = "approved"
        inv.save(update_fields=["status"])
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["patch"])
    def dispute(self, request, pk=None):
        inv = self.get_object()
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

class MessageViewSet(viewsets.ModelViewSet):
    serializer_class   = MessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs    = Message.objects.order_by("created_at")
        agr_id= self.request.query_params.get("agreement")
        if agr_id:
            qs = qs.filter(agreement__id=agr_id)
        return qs

    def perform_create(self, serializer):
        msg       = serializer.save(sender=self.request.user)
        homeowner = msg.agreement.project.homeowner
        if homeowner:
            try:
                send_mail(
                    subject=f"New message from {self.request.user.username}",
                    message=msg.content,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[homeowner.email],
                    fail_silently=True,
                )
            except Exception as e:
                logging.error(f"Message email notify failed: {e}")

@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([UserRateThrottle])
def lookup_homeowner(request):
    email = request.query_params.get("email")
    found = Homeowner.objects.filter(email=email).exists()
    return Response({"found": found})

class MilestoneViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class   = MilestoneSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return (
            Milestone.objects
                .select_related("agreement__project")
                .filter(agreement__contractor=self.request.user)
                .distinct()
        )

    @action(detail=True, methods=["patch"])
    def mark_complete(self, request, pk=None):
        ms  = self.get_object()
        agr = ms.agreement

        # your existing checks
        if agr.contractor != request.user:
            return Response({"detail": "Unauthorized."}, status=403)
        if not (agr.signed_by_contractor and agr.signed_by_homeowner):
            return Response({"detail": "Agreement not fully signed."}, status=400)
        if not agr.escrow_funded:
            return Response({"detail": "Escrow not funded."}, status=400)

        # 1) mark milestone complete
        ms.completed = True
        ms.save(update_fields=["completed"])

        # 2) create an Invoice for this milestone
        invoice = Invoice.objects.create(
            agreement=agr,
            milestone=ms,
            amount=ms.amount,       # adjust field names as needed
            due_date=timezone.now(),  # or set your desired due date
        )

        # 3) send homeowner an approval email
        homeowner = agr.project.homeowner
        if homeowner and homeowner.email:
            try:
                approve_url = request.build_absolute_uri(
                    reverse("projects_api:invoice-approve", args=[invoice.id])
                )
                send_mail(
                    subject=f"Invoice #{invoice.id} Ready for Approval",
                    message=(
                        f"Hi {homeowner.name},\n\n"
                        f"Your milestone “{ms.title}” is complete. "
                        f"An invoice for ${invoice.amount:.2f} is now available.\n\n"
                        f"Click to review & approve:\n{approve_url}\n\n"
                        "Thank you,\nMyHomeBro Team"
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[homeowner.email],
                    fail_silently=True,
                )
            except Exception as e:
                logging.error(f"Invoice email failed for Invoice {invoice.id}: {e}")

        return Response({"status": "marked complete"})

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
            from rest_framework.exceptions import PermissionDenied
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
