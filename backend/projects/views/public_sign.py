import logging

import stripe # type: ignore
from django.conf import settings
from django.shortcuts import get_object_or_404, render, redirect
from django.http import FileResponse, Http404
from django.utils import timezone
from django.views import View
from django import forms

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import status

from ..models import Agreement, ProjectStatus
from ..serializers import AgreementDetailSerializer
from ..tasks import process_agreement_signing
from ..utils import generate_full_agreement_pdf

# Initialize Stripe API key
stripe.api_key = settings.STRIPE_SECRET_KEY


class AgreementSignForm(forms.Form):
    typed_name = forms.CharField(
        label="Your Full Name",
        max_length=100,
        widget=forms.TextInput(attrs={"class": "form-control"})
    )


class AgreementSignView(View):
    template_name = "projects/sign_agreement.html"

    def get(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        form = AgreementSignForm()
        return render(request, self.template_name, {
            "agreement": agreement,
            "form": form
        })

    def post(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        form = AgreementSignForm(request.POST)
        if not form.is_valid():
            return render(request, self.template_name, {
                "agreement": agreement,
                "form": form
            })

        agreement.signed_by_homeowner = True
        agreement.signed_at_homeowner = timezone.now()
        agreement.homeowner_signature_name = form.cleaned_data["typed_name"]
        agreement.homeowner_signed_ip = request.META.get("REMOTE_ADDR")
        agreement.save(update_fields=[
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "homeowner_signed_ip"
        ])

        # Offload PDF generation and email to background
        process_agreement_signing.delay(agreement.id)

        return redirect("projects_api:agreement-sign-success", token=token)


class AgreementSignSuccessView(View):
    template_name = "projects/sign_success.html"

    def get(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        return render(request, self.template_name, {"agreement": agreement})


class AgreementMagicPdfView(View):
    def get(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        if agreement.pdf_file:
            return FileResponse(
                agreement.pdf_file,
                as_attachment=True,
                filename=agreement.pdf_file.name
            )
        try:
            generate_full_agreement_pdf(agreement)
            agreement.refresh_from_db()
            if agreement.pdf_file:
                return FileResponse(
                    agreement.pdf_file,
                    as_attachment=True,
                    filename=agreement.pdf_file.name
                )
        except Exception as e:
            logging.error(f"PDF generation error for Agreement {agreement.id}: {e}")
        raise Http404("Could not retrieve PDF.")


class MagicAccessView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        serializer = AgreementDetailSerializer(agreement, context={"request": request})
        return Response(serializer.data)

    def post(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        typed_name = request.data.get("typed_name", "").strip()
        if not typed_name:
            return Response(
                {"detail": "A typed name is required for signature."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if agreement.signed_by_homeowner:
            return Response(
                {"detail": "This agreement has already been signed by the homeowner."},
                status=status.HTTP_400_BAD_REQUEST
            )

        agreement.signed_by_homeowner = True
        agreement.signed_at_homeowner = timezone.now()
        agreement.homeowner_signature_name = typed_name
        agreement.homeowner_signed_ip = request.META.get("REMOTE_ADDR", "")
        agreement.save(update_fields=[
            "signed_by_homeowner",
            "signed_at_homeowner",
            "homeowner_signature_name",
            "homeowner_signed_ip"
        ])

        if agreement.is_fully_signed:
            agreement.project.status = ProjectStatus.SIGNED
            agreement.project.save(update_fields=["status"])

        process_agreement_signing.delay(agreement.id)

        serializer = AgreementDetailSerializer(agreement, context={"request": request})
        return Response(serializer.data)


class MagicFundEscrowView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token):
        agreement = get_object_or_404(Agreement, homeowner_access_token=token)
        if not agreement.is_fully_signed:
            return Response(
                {"detail": "Agreement must be fully signed before funding."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if agreement.escrow_funded:
            return Response(
                {"detail": "Escrow has already been funded for this agreement."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            intent = stripe.PaymentIntent.create(
                amount=int(agreement.total_cost * 100),
                currency="usd",
                metadata={"agreement_id": str(agreement.id)},
                receipt_email=agreement.homeowner.email,
            )
            agreement.escrow_payment_intent_id = intent.id
            agreement.save(update_fields=["escrow_payment_intent_id"])
            return Response({"client_secret": intent.client_secret})
        except stripe.error.StripeError as e:
            logging.error(f"Escrow funding error for Agreement {agreement.id}: {e}")
            return Response(
                {"detail": str(e)},
                status=status.HTTP_502_BAD_GATEWAY
            )
