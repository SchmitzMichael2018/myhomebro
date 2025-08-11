import io
from pathlib import Path
from datetime import datetime

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

import logging
import stripe  # type: ignore
from django.db import transaction
from django.db.models import Q

# --- FIX: Ensure status and Response are imported ---
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from reportlab.pdfgen import canvas  # type: ignore
from reportlab.lib.pagesizes import letter  # type: ignore
from reportlab.lib.units import inch  # type: ignore
from pypdf import PdfReader, PdfWriter  # modern replacement

from ..models import Agreement, ProjectStatus, Contractor, Homeowner
from ..serializers import AgreementDetailSerializer, AgreementWriteSerializer
from ..utils import send_agreement_invite_email


def get_client_ip(request):
    x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded:
        return x_forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


class AgreementViewSet(viewsets.ModelViewSet):
    """
    Handles creation, retrieval, and actions for Agreements
    for the authenticated contractor.
    """
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return AgreementWriteSerializer
        return AgreementDetailSerializer

    def get_queryset(self):
        user = self.request.user
        return (
            Agreement.objects.filter(
                Q(contractor__user=user) | Q(project__contractor__user=user),
                is_archived=False
            )
            .distinct()
            .select_related('project', 'project__homeowner', 'contractor', 'contractor__user')
            .prefetch_related('milestones')
            .order_by('-created_at')
        )

    def get_serializer_context(self):
        return {'request': self.request}

    # --- THIS IS THE FIX ---
    # Override the default 'create' method to ensure the full, detailed
    # agreement object is returned in the response, including the new ID.
    def create(self, request, *args, **kwargs):
        write_serializer = self.get_serializer(data=request.data)
        write_serializer.is_valid(raise_exception=True)
        self.perform_create(write_serializer)

        # After creating, serialize with the DETAIL serializer for the response
        read_serializer = AgreementDetailSerializer(write_serializer.instance, context=self.get_serializer_context())

        headers = self.get_success_headers(read_serializer.data)
        return Response(read_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        try:
            contractor_profile = self.request.user.contractor_profile
            serializer.save(contractor=contractor_profile)
        except Contractor.DoesNotExist:
            raise PermissionDenied("You must have a contractor profile to create an agreement.")

    def perform_update(self, serializer):
        agreement = self.get_object()
        if agreement.is_fully_signed or agreement.signed_by_contractor:
            raise PermissionDenied("Cannot edit a signed agreement. Please create an amendment instead.")
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        if not (instance.contractor and self.request.user == instance.contractor.user):
            raise PermissionDenied("Cannot delete agreements you do not own.")
        instance.delete()

    @action(detail=True, methods=['post'])
    def amend(self, request, pk=None):
        original = self.get_object()
        if not original.is_fully_signed:
            raise ValidationError("Only fully signed agreements can be amended.")
        with transaction.atomic():
            original.is_archived = True
            original.save()
            new = original
            new.pk = None
            new.id = None
            new.amendment_number = original.amendment_number + 1
            new.is_archived = False
            new.signed_by_contractor = False
            new.signed_by_homeowner = False
            new.signed_at_contractor = None
            new.signed_at_homeowner = None
            new.contractor_signature_name = ""
            new.homeowner_signature_name = ""
            new.escrow_funded = False
            new.escrow_payment_intent_id = ""
            new.save()
            for m in original.milestones.all():
                m.pk = None
                m.id = None
                m.agreement = new
                m.completed = False
                m.is_invoiced = False
                m.save()
        serializer = self.get_serializer(new)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'])
    def archive(self, request, pk=None):
        ag = self.get_object()
        if not (ag.contractor and request.user == ag.contractor.user):
            raise PermissionDenied("Only the contractor can archive this agreement.")
        ag.is_archived = True
        ag.save(update_fields=['is_archived'])
        return Response({'status': 'archived'})

    @action(detail=True, methods=['patch'])
    def unarchive(self, request, pk=None):
        ag = self.get_object()
        if not (ag.contractor and request.user == ag.contractor.user):
            raise PermissionDenied("Only the contractor can unarchive this agreement.")
        ag.is_archived = False
        ag.save(update_fields=['is_archived'])
        return Response({'status': 'unarchived'})

    @action(detail=True, methods=['post'])
    def sign(self, request, pk=None):
        agreement = self.get_object()
        user = request.user
        name = request.data.get('signature_name', '').strip()
        role = request.data.get('role', 'contractor')
        if not name or role not in ('contractor', 'homeowner'):
            return Response({"error": "Name and valid role required."}, status=400)

        now = timezone.now()
        ip = get_client_ip(request)

        # Contractor signing
        if role == 'contractor':
            if not (agreement.contractor and user == agreement.contractor.user):
                raise PermissionDenied("Only the contractor may sign as contractor.")
            if agreement.signed_by_contractor:
                return Response({"detail": "Contractor already signed."}, status=400)
            agreement.contractor_signature_name = name
            agreement.signed_at_contractor = now
            agreement.contractor_signed_ip = ip
            agreement.signed_by_contractor = True

        # Homeowner signing via access token
        else:
            token = request.data.get('homeowner_access_token')
            if not token or token != str(agreement.homeowner_access_token):
                raise PermissionDenied("Invalid homeowner access token.")
            if agreement.signed_by_homeowner:
                return Response({"detail": "Homeowner already signed."}, status=400)
            agreement.homeowner_signature_name = name
            agreement.signed_at_homeowner = now
            agreement.homeowner_signed_ip = ip
            agreement.signed_by_homeowner = True

        agreement.save(update_fields=[
            f"signed_by_{role}",
            f"signed_at_{role}",
            f"{role}_signature_name",
            f"{role}_signed_ip"
        ])

        # If both signed, update project status
        if agreement.is_fully_signed:
            agreement.project.status = ProjectStatus.SIGNED
            agreement.project.save(update_fields=['status'])

        serializer = self.get_serializer(agreement)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='email-invite')
    def email_invite(self, request, pk=None):
        agreement = self.get_object()
        if not (agreement.contractor and request.user == agreement.contractor.user):
            raise PermissionDenied("Only the contractor can send an invite.")
        try:
            send_agreement_invite_email(agreement, request)
            return Response({"detail": "Invite sent successfully."})
        except Exception as e:
            logging.error(f"Failed to send invite for Agreement {agreement.id}: {e}")
            return Response({"detail": "Error sending invite."}, status=500)

    @action(detail=True, methods=['post'], url_path='fund-escrow')
    def fund_escrow(self, request, pk=None):
        agreement = self.get_object()
        if not agreement.is_fully_signed:
            return Response({"detail": "Must sign before funding."}, status=400)
        if agreement.escrow_funded:
            return Response({"detail": "Already funded."}, status=400)
        try:
            intent = stripe.PaymentIntent.create(
                amount=int(agreement.total_cost * 100),
                currency='usd',
                capture_method='manual',
                receipt_email=agreement.project.homeowner.email,
                metadata={'agreement_id': str(agreement.id)},
            )
            agreement.escrow_payment_intent_id = intent.id
            agreement.save(update_fields=['escrow_payment_intent_id'])
            return Response({'client_secret': intent.client_secret})
        except stripe.error.StripeError as e:
            logging.error(f"Fund escrow error for Agreement {agreement.id}: {e}")
            return Response({'detail': str(e)}, status=502)

    @action(detail=True, methods=['post'], url_path='upload-addendum')
    def upload_addendum(self, request, pk=None):
        agreement = self.get_object()
        if agreement.is_fully_signed:
            raise PermissionDenied("Cannot add an addendum to a signed agreement.")
        file_obj = request.data.get('addendum_file')
        if not file_obj:
            return Response({"detail": "No file provided."}, status=400)
        agreement.addendum_file = file_obj
        agreement.save(update_fields=['addendum_file'])
        return Response({"detail": "Addendum uploaded successfully.", "file_url": agreement.addendum_file.url})

# --- Function-based view to generate and merge PDFs ---
def agreement_pdf(request, agreement_id):
    agreement = get_object_or_404(Agreement, pk=agreement_id)
    project = agreement.project
    homeowner = project.homeowner
    contractor = project.contractor

    buffer = io.BytesIO()
    p = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    # Page 1: Logo + Header
    logo_path = Path(settings.BASE_DIR) / 'static' / 'images' / 'logo.png'
    if logo_path.exists():
        p.drawImage(str(logo_path), x=1*inch, y=height-1.5*inch,
                    width=1.5*inch, height=1.5*inch, preserveAspectRatio=True, mask='auto')
    p.setFont('Helvetica-Bold', 18)
    p.drawRightString(width-1*inch, height-1*inch, f'Agreement #{agreement.id}')

    # Parties & Info
    p.setFont('Helvetica-Bold', 14)
    y = height - 2.0*inch
    p.drawString(1*inch, y, 'Parties to the Agreement')
    p.setFont('Helvetica', 12)
    y -= 0.3*inch
    p.drawString(1.1*inch, y, 'Homeowner:')
    p.drawString(2.5*inch, y, f"{homeowner.full_name} ({homeowner.email})")
    y -= 0.25*inch
    ho_addr = f"{homeowner.street_address}, {homeowner.city}, {homeowner.state} {homeowner.zip_code}"
    p.drawString(2.5*inch, y, ho_addr)
    y -= 0.4*inch
    p.drawString(1.1*inch, y, 'Contractor:')
    p.drawString(2.5*inch, y, f"{contractor.name} ({contractor.email})")
    y -= 0.25*inch
    p.drawString(2.5*inch, y, contractor.address or 'N/A')

    # Project Details
    p.setFont('Helvetica-Bold', 14)
    y -= 0.5*inch
    p.drawString(1*inch, y, 'Project Details')
    p.setFont('Helvetica', 12)
    y -= 0.3*inch
    p.drawString(1*inch, y, f'Project: {project.title}')
    y -= 0.3*inch
    desc = project.description or 'N/A'
    for line in desc.split('\n'):
        p.drawString(1.2*inch, y, line)
        y -= 0.25*inch
    addr1 = project.project_street_address or ''
    addr2 = project.project_address_line_2 and f', {project.project_address_line_2}' or ''
    city  = ', '.join(filter(None, [project.project_city, project.project_state, project.project_zip_code]))
    full_addr = f"{addr1}{addr2}{city and (', '+city)}" or 'N/A'
    p.drawString(1*inch, y, f'Address: {full_addr}')
    y -= 0.3*inch
    status = 'Funded' if agreement.escrow_funded else 'Signed' if agreement.is_fully_signed else 'Pending Signatures'
    p.drawString(1*inch, y, f'Status: {status}')
    y -= 0.3*inch
    starts = [m.start_date for m in agreement.milestones.all() if m.start_date]
    ends   = [m.completion_date for m in agreement.milestones.all() if m.completion_date]
    start_str = min(starts).strftime('%b %d, %Y') if starts else 'N/A'
    end_str   = max(ends).strftime('%b %d, %Y') if ends else 'N/A'
    p.drawString(1*inch, y, f'Dates: {start_str} – {end_str}')

    # Signatures on PDF
    y -= 0.5*inch
    p.setFont('Helvetica-Bold', 12)
    p.drawString(1*inch, y, 'Contractor Signature:')
    p.setFont('Helvetica-Oblique', 12)
    p.drawString(3*inch, y, agreement.contractor_signature_name or '(not signed)')
    y -= 0.3*inch
    p.setFont('Helvetica-Bold', 12)
    p.drawString(1*inch, y, 'Signed At:')
    p.setFont('Helvetica-Oblique', 12)
    p.drawString(2.5*inch, y, agreement.signed_at_contractor.isoformat() if agreement.signed_at_contractor else '(n/a)')
    y -= 0.3*inch
    p.setFont('Helvetica-Bold', 12)
    p.drawString(1*inch, y, 'IP Address:')
    p.setFont('Helvetica-Oblique', 12)
    p.drawString(2.5*inch, y, agreement.contractor_signed_ip or '(n/a)')

    # Homeowner signature
    y -= 0.5*inch
    p.setFont('Helvetica-Bold', 12)
    p.drawString(1*inch, y, 'Homeowner Signature:')
    p.setFont('Helvetica-Oblique', 12)
    p.drawString(3*inch, y, agreement.homeowner_signature_name or '(not signed)')
    y -= 0.3*inch
    p.setFont('Helvetica-Bold', 12)
    p.drawString(1*inch, y, 'Signed At:')
    p.setFont('Helvetica-Oblique', 12)
    p.drawString(2.5*inch, y, agreement.signed_at_homeowner.isoformat() if agreement.signed_at_homeowner else '(n/a)')
    y -= 0.3*inch
    p.setFont('Helvetica-Bold', 12)
    p.drawString(1*inch, y, 'IP Address:')
    p.setFont('Helvetica-Oblique', 12)
    p.drawString(2.5*inch, y, agreement.homeowner_signed_ip or '(n/a)')

    p.showPage()
    p.save()
    buffer.seek(0)

    # Merge static legal PDFs
    writer = PdfWriter()
    for page in PdfReader(buffer).pages:
        writer.add_page(page)
    legal_dir = Path(settings.BASE_DIR) / 'static' / 'legal'
    for fname in ('terms_of_service.pdf', 'privacy_policy.pdf'):
        fp = legal_dir / fname
        if fp.exists():
            for pg in PdfReader(str(fp)).pages:
                writer.add_page(pg)

    out = io.BytesIO()
    writer.write(out)
    out.seek(0)

    response = HttpResponse(out, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="agreement_{agreement.id}_full.pdf"'
    return response