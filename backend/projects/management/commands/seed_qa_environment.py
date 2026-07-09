from __future__ import annotations

from datetime import date, time, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from payments.models import ConnectedAccount, Payment
from projects.models import (
    Agreement,
    AgreementAssignment,
    AgreementAttachment,
    AgreementPDFVersion,
    AgreementPaymentMode,
    AgreementPaymentStructure,
    AgreementProjectClass,
    Contractor,
    ContractorDirectoryEntry,
    ContractorEstimateAvailabilityWindow,
    ContractorOpportunity,
    ContractorPublicProfile,
    ContractorSubAccount,
    CustomerCommunicationLog,
    EmployeeCapability,
    EmployeeProfile,
    Homeowner,
    Invoice,
    InvoiceStatus,
    Milestone,
    MilestoneAssignment,
    OpportunityEstimateAppointment,
    Project,
    ProjectIntake,
    ProjectStatus,
    Proposal,
    ProposalActivity,
    ProposalAttachment,
    ProposalLineItem,
    ProposalMeasurement,
    PropertyDocument,
    PropertyManagementCompany,
    PropertyManagementStaffMembership,
    PropertyOwnerContact,
    PropertyProfile,
    PropertyUnit,
    PropertyVendor,
    PropertyWorkOrder,
    PropertyWorkOrderActivity,
    Skill,
    SmartNotification,
    SmartNotificationEvent,
    SubcontractorInvitation,
    SubcontractorQuoteRequest,
    Tenant,
    TenantMaintenanceRequest,
    Tenancy,
)
from projects.models_expense_request import ExpenseRequest
from projects.models_subcontractor import SubcontractorInvitationStatus, SubcontractorQuoteRequestStatus


QA_PASSWORD = "MyHomeBroQA!2026"
QA_EMAILS = {
    "contractor": "info+contractor@myhomebro.com",
    "customer": "info+customer@myhomebro.com",
    "property_manager": "info+propertymanager@myhomebro.com",
    "employee": "info+employee@myhomebro.com",
    "subcontractor": "info+subcontractor@myhomebro.com",
}


class Command(BaseCommand):
    help = "Seed deterministic local QA accounts and sample data for authenticated MyHomeBro testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Bypass the local safety check. Do not use against production data.",
        )

    def handle(self, *args, **options):
        if not options["force"] and not self._is_safe_local_database():
            raise CommandError(
                "Refusing to seed QA data outside a local/test environment. "
                "Use DEBUG=True, a repo-local SQLite database, or --force only for disposable QA databases."
            )

        self._ensure_local_schema_current()

        with (
            patch("projects.signals.task_generate_full_agreement_pdf.delay", return_value=None),
            patch("projects.signals.task_send_invoice_notification.delay", return_value=None),
            transaction.atomic(),
        ):
            seeded = self._seed()

        self.stdout.write(self.style.SUCCESS("QA environment seeded deterministically."))
        self.stdout.write(f"Password: {QA_PASSWORD}")
        for role, email in QA_EMAILS.items():
            self.stdout.write(f"{role}: {email}")
        self.stdout.write(
            "Seeded: "
            f"{seeded['users']} users, {seeded['customers']} customers, "
            f"{seeded['properties']} properties, {seeded['agreements']} agreements, "
            f"{seeded['milestones']} milestones, {seeded['opportunities']} opportunities."
        )

    def _is_safe_local_database(self) -> bool:
        if settings.DEBUG:
            return True

        engine = connection.settings_dict.get("ENGINE", "")
        db_name = str(connection.settings_dict.get("NAME") or "")
        if "sqlite" not in engine:
            return False

        try:
            db_path = Path(db_name).resolve()
            base_dir = Path(settings.BASE_DIR).resolve()
            repo_dir = base_dir.parent
            return (
                db_path == base_dir / "db.sqlite3"
                or db_path == repo_dir / "db.sqlite3"
                or base_dir in db_path.parents
                or repo_dir in db_path.parents
            )
        except Exception:
            return False

    def _ensure_local_schema_current(self) -> None:
        executor = MigrationExecutor(connection)
        targets = executor.loader.graph.leaf_nodes()
        plan = executor.migration_plan(targets)
        if not plan:
            return

        self.stdout.write("Applying pending local migrations before QA seed...")
        call_command("migrate", interactive=False, verbosity=0)

    def _seed(self) -> dict[str, int]:
        User = get_user_model()
        now = timezone.now()
        today = timezone.localdate()

        contractor_user = self._user(User, QA_EMAILS["contractor"], "QA", "Contractor", "555-0101")
        customer_user = self._user(User, QA_EMAILS["customer"], "QA", "Customer", "555-0102")
        pm_user = self._user(User, QA_EMAILS["property_manager"], "QA", "Property Manager", "555-0103")
        employee_user = self._user(User, QA_EMAILS["employee"], "QA", "Employee", "555-0104")
        subcontractor_user = self._user(User, QA_EMAILS["subcontractor"], "QA", "Subcontractor", "555-0105")

        contractor, _ = Contractor.objects.update_or_create(
            user=contractor_user,
            defaults={
                "business_name": "MyHomeBro QA Remodeling",
                "phone": "555-0101",
                "address": "410 Test Bench Trail",
                "city": "Austin",
                "state": "TX",
                "zip": "78701",
                "service_radius_miles": 25,
                "license_number": "QA-TX-GC-2026",
                "marketplace_verification_status": Contractor.MARKETPLACE_VERIFIED,
                "marketplace_verified_at": now,
                "charges_enabled": True,
                "payouts_enabled": True,
                "details_submitted": True,
                "stripe_onboarding_status": "complete",
                "stripe_account_id": "acct_qa_stub_myhomebro",
            },
        )
        ConnectedAccount.objects.update_or_create(
            user=contractor_user,
            defaults={
                "stripe_account_id": "acct_qa_stub_myhomebro",
                "charges_enabled": True,
                "payouts_enabled": True,
                "details_submitted": True,
            },
        )

        skills = {}
        for name, slug in [
            ("Carpentry", "qa-carpentry"),
            ("Tile", "qa-tile"),
            ("Electrical", "qa-electrical"),
            ("Plumbing", "qa-plumbing"),
            ("HVAC", "qa-hvac"),
            ("Project Supervision", "qa-project-supervision"),
        ]:
            skill, created = Skill.objects.get_or_create(name=name, defaults={"slug": slug})
            if created:
                skill.slug = slug
                skill.save(update_fields=["slug"])
            skills[name] = skill
        contractor.skills.set([skills["Carpentry"], skills["Tile"], skills["Project Supervision"]])

        profile, _ = ContractorPublicProfile.objects.update_or_create(
            contractor=contractor,
            defaults={
                "slug": "qa-remodeling",
                "business_name_public": "MyHomeBro QA Remodeling",
                "tagline": "Careful local remodeling seeded for QA only.",
                "bio": "A deterministic test contractor for local MyHomeBro workflow validation.",
                "city": "Austin",
                "state": "TX",
                "service_area_text": "Austin and nearby suburbs",
                "phone_public": "555-0101",
                "email_public": QA_EMAILS["contractor"],
                "show_phone_public": True,
                "show_email_public": True,
                "specialties": ["kitchen remodels", "bath updates", "rental turns"],
                "work_types": ["Remodel", "Repair", "Maintenance"],
                "is_public": True,
            },
        )

        employee, _ = ContractorSubAccount.objects.update_or_create(
            user=employee_user,
            defaults={
                "parent_contractor": contractor,
                "display_name": "Jamie QA Foreman",
                "role": ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
                "is_active": True,
                "notes": "Seeded QA employee with supervisor access.",
                "cost_basis": ContractorSubAccount.COST_BASIS_HOURLY,
                "hourly_cost": Decimal("42.50"),
                "standard_hours_per_week": Decimal("40.00"),
                "overtime_multiplier": Decimal("1.50"),
            },
        )
        EmployeeProfile.objects.update_or_create(
            subaccount=employee,
            defaults={
                "first_name": "Jamie",
                "last_name": "Foreman",
                "phone_number": "555-0104",
                "assigned_work_schedule": "Mon-Fri 8:00 AM - 4:30 PM",
            },
        )
        for skill, level in [
            (skills["Carpentry"], "lead"),
            (skills["Tile"], "skilled"),
            (skills["Project Supervision"], "expert"),
        ]:
            EmployeeCapability.objects.update_or_create(
                subaccount=employee,
                skill=skill,
                defaults={"skill_level": level},
            )

        self._availability(contractor)

        customer = self._homeowner(
            contractor,
            QA_EMAILS["customer"],
            "Casey QA Homeowner",
            "555-0102",
            "1204 Test Oak Lane",
            "Austin",
            "TX",
            "78702",
        )
        pm_customer = self._homeowner(
            contractor,
            QA_EMAILS["property_manager"],
            "Morgan QA Property Manager",
            "555-0103",
            "88 Portfolio Plaza",
            "Austin",
            "TX",
            "78703",
            account_type=Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY,
            company_name="QA Property Management Co",
        )

        pm_company, _ = PropertyManagementCompany.objects.update_or_create(
            homeowner=pm_customer,
            defaults={
                "name": "QA Property Management Co",
                "phone": "555-0103",
                "email": QA_EMAILS["property_manager"],
                "address_line1": "88 Portfolio Plaza",
                "city": "Austin",
                "state": "TX",
                "postal_code": "78703",
                "subscription_status": PropertyManagementCompany.SUBSCRIPTION_STATUS_TRIALING,
                "subscription_plan": "qa-local",
                "trial_started_at": now - timedelta(days=3),
                "trial_ends_at": now + timedelta(days=27),
            },
        )
        PropertyManagementStaffMembership.objects.update_or_create(
            company=pm_company,
            email=QA_EMAILS["property_manager"],
            defaults={
                "user": pm_user,
                "name": "Morgan QA Property Manager",
                "phone": "555-0103",
                "role": PropertyManagementStaffMembership.ROLE_ADMIN,
                "status": PropertyManagementStaffMembership.STATUS_ACTIVE,
            },
        )
        PropertyOwnerContact.objects.update_or_create(
            company=pm_company,
            email="owner.qa@example.test",
            defaults={"name": "Olivia QA Owner", "phone": "555-0110", "notes": "Seed owner contact."},
        )

        primary_property = self._property(
            customer,
            QA_EMAILS["customer"],
            "QA Home - Oak Lane",
            "1204 Test Oak Lane",
            "Austin",
            "TX",
            "78702",
            is_primary=True,
            is_rental=False,
        )
        rental_property = self._property(
            pm_customer,
            QA_EMAILS["property_manager"],
            "QA Duplex - Cedar",
            "2200 Cedar QA Court",
            "Austin",
            "TX",
            "78704",
            is_primary=True,
            is_rental=True,
            company=pm_company,
            property_type=PropertyProfile.PROPERTY_TYPE_MULTI_FAMILY,
        )
        unit_a, _ = PropertyUnit.objects.update_or_create(
            property_profile=rental_property,
            unit_label="Unit A",
            defaults={"unit_type": "unit", "status": "active", "access_notes": "Gate code 2468."},
        )
        PropertyUnit.objects.update_or_create(
            property_profile=rental_property,
            unit_label="Unit B",
            defaults={"unit_type": "unit", "status": "active", "access_notes": "Tenant requests 24-hour notice."},
        )
        tenant, _ = Tenant.objects.update_or_create(
            company=pm_company,
            email="tenant.qa@example.test",
            defaults={
                "first_name": "Taylor",
                "last_name": "Tenant",
                "phone": "555-0112",
                "status": Tenant.STATUS_ACTIVE,
                "maintenance_access_enabled": True,
                "portal_enabled": True,
            },
        )
        Tenancy.objects.update_or_create(
            tenant=tenant,
            property_profile=rental_property,
            unit=unit_a,
            defaults={"status": Tenancy.STATUS_ACTIVE, "move_in_date": date(today.year - 1, 9, 1)},
        )
        PropertyDocument.objects.update_or_create(
            property_profile=primary_property,
            title="QA Home Warranty Placeholder",
            defaults={
                "document_type": "warranty",
                "upload_source": PropertyDocument.UPLOAD_SOURCE_PORTAL_DESKTOP,
                "file": "qa/placeholders/home-warranty.pdf",
            },
        )

        tenant_request, _ = TenantMaintenanceRequest.objects.update_or_create(
            property_profile=rental_property,
            tenant=tenant,
            title="Kitchen sink leak under cabinet",
            defaults={
                "unit": unit_a,
                "submitted_by_name": tenant.display_name,
                "submitted_by_email": tenant.email,
                "submitted_by_phone": tenant.phone,
                "category": TenantMaintenanceRequest.CATEGORY_PLUMBING,
                "urgency": TenantMaintenanceRequest.URGENCY_URGENT,
                "description": "Water appears after running the sink for more than a minute.",
                "permission_to_enter": True,
                "preferred_access_times": "Weekdays after 10 AM",
                "status": TenantMaintenanceRequest.STATUS_APPROVED,
                "reviewed_by": QA_EMAILS["property_manager"],
                "reviewed_at": now - timedelta(days=1),
            },
        )
        vendor, _ = PropertyVendor.objects.update_or_create(
            property_management_company=pm_company,
            name="QA Preferred Plumbing Vendor",
            defaults={
                "trade_category": "plumbing",
                "email": "vendor.qa@example.test",
                "phone": "555-0113",
                "vendor_source": PropertyVendor.SOURCE_MANUAL,
                "status": PropertyVendor.STATUS_ACTIVE,
            },
        )
        work_order, _ = PropertyWorkOrder.objects.update_or_create(
            property_management_company=pm_company,
            source_tenant_request=tenant_request,
            defaults={
                "property_profile": rental_property,
                "unit": unit_a,
                "tenant": tenant,
                "title": "Repair kitchen sink leak",
                "description": tenant_request.description,
                "category": PropertyWorkOrder.CATEGORY_PLUMBING,
                "priority": PropertyWorkOrder.PRIORITY_URGENT,
                "status": PropertyWorkOrder.STATUS_SCHEDULED,
                "assigned_vendor": vendor,
                "assignment_type": PropertyWorkOrder.ASSIGNMENT_VENDOR,
                "marketplace_status": PropertyWorkOrder.MARKETPLACE_SENT,
                "marketplace_sent_at": now - timedelta(hours=18),
                "scheduled_for": now + timedelta(days=2),
                "created_by": QA_EMAILS["property_manager"],
            },
        )
        PropertyWorkOrderActivity.objects.update_or_create(
            work_order=work_order,
            activity_type=PropertyWorkOrderActivity.TYPE_SCHEDULED,
            message="QA seed scheduled this work order with the preferred vendor.",
            defaults={"actor": QA_EMAILS["property_manager"]},
        )

        directory_entry, _ = ContractorDirectoryEntry.objects.update_or_create(
            normalized_name="myhomebro qa remodeling",
            zip_code="78701",
            defaults={
                "business_name": "MyHomeBro QA Remodeling",
                "website": "https://qa.myhomebro.test",
                "website_domain": "qa.myhomebro.test",
                "phone": "555-0101",
                "normalized_phone": "5550101",
                "public_email": QA_EMAILS["contractor"],
                "has_public_email": True,
                "has_phone": True,
                "has_website": True,
                "address_line1": "410 Test Bench Trail",
                "city": "Austin",
                "state": "TX",
                "service_city": "Austin",
                "service_state": "TX",
                "service_zip": "78701",
                "primary_service": "remodeling",
                "normalized_services": ["remodeling", "tile", "carpentry"],
                "raw_services": ["Kitchen Remodeling", "Bathroom Remodeling"],
                "services": ["Kitchen Remodeling", "Bathroom Remodeling"],
                "source": ContractorDirectoryEntry.SOURCE_MANUAL,
                "claimed": True,
                "claimed_by_contractor": contractor,
                "profile_status": ContractorDirectoryEntry.PROFILE_REVIEWED,
                "contact_status": ContractorDirectoryEntry.CONTACT_STATUS_CLAIMED,
                "claim_readiness_status": ContractorDirectoryEntry.CLAIM_READY,
            },
        )

        intake = self._intake(contractor, profile, customer, "Kitchen refresh intake", "Replace backsplash, repaint cabinets, and upgrade lighting.")
        opportunity, _ = ContractorOpportunity.objects.update_or_create(
            directory_entry=directory_entry,
            intake_request=intake,
            defaults={
                "homeowner_name": customer.full_name,
                "homeowner_email": customer.email,
                "homeowner_phone": customer.phone_number,
                "project_address": primary_property.address_line1,
                "project_city": primary_property.city,
                "project_state": primary_property.state,
                "project_zip": primary_property.postal_code,
                "project_type": "Remodel",
                "project_subtype": "Kitchen",
                "project_title": "Kitchen refresh intake",
                "project_description": intake.accomplishment_text,
                "refined_description": "QA opportunity with measurements, photos, and estimate appointment.",
                "budget_min": Decimal("8500.00"),
                "budget_max": Decimal("14500.00"),
                "timeline": "Within 30 days",
                "measurements": [{"label": "Backsplash", "quantity": 32, "unit": "sq ft"}],
                "photos": [{"name": "qa-kitchen-before.jpg", "url": "/media/qa/placeholders/kitchen-before.jpg"}],
                "status": ContractorOpportunity.STATUS_ACCEPTED,
                "estimate_preference": ContractorOpportunity.ESTIMATE_PREFERENCE_SLOT,
                "estimate_preference_notes": "Customer prefers late morning.",
                "accepted_at": now - timedelta(days=2),
                "accepted_by_contractor": contractor,
                "converted_customer": customer,
            },
        )
        appointment, _ = OpportunityEstimateAppointment.objects.update_or_create(
            contractor=contractor,
            contractor_opportunity=opportunity,
            source_type=OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
            defaults={
                "opportunity_title": opportunity.project_title,
                "opportunity_reference": f"OPP-{opportunity.pk}",
                "customer_name": customer.full_name,
                "customer_email": customer.email,
                "customer_phone": customer.phone_number,
                "service_location": primary_property.address_line1,
                "appointment_type": OpportunityEstimateAppointment.TYPE_IN_PERSON,
                "scheduled_start": now + timedelta(days=1, hours=2),
                "duration_minutes": 90,
                "notes": "Walkthrough, measurements, photos, and checklist.",
                "status": OpportunityEstimateAppointment.STATUS_CONFIRMED,
                "requested_by": OpportunityEstimateAppointment.REQUESTED_BY_CUSTOMER,
                "confirmed_at": now - timedelta(days=1),
                "created_by": contractor_user,
            },
        )
        proposal = self._proposal(contractor, contractor_user, opportunity, appointment)

        agreements = [
            self._agreement(
                contractor,
                customer,
                "QA Draft Kitchen Refresh",
                "Draft agreement for estimate-to-agreement QA.",
                Decimal("11250.00"),
                ProjectStatus.DRAFT,
                today + timedelta(days=10),
                Decimal("750.00"),
            ),
            self._agreement(
                contractor,
                customer,
                "QA Sent Bathroom Update",
                "Sent agreement waiting for homeowner signature.",
                Decimal("6800.00"),
                ProjectStatus.DRAFT,
                today + timedelta(days=16),
                Decimal("350.00"),
                contractor_signed=True,
                reviewed=True,
            ),
            self._agreement(
                contractor,
                customer,
                "QA Signed Deck Repair",
                "Signed but not funded escrow project.",
                Decimal("4200.00"),
                ProjectStatus.SIGNED,
                today + timedelta(days=5),
                Decimal("200.00"),
                contractor_signed=True,
                homeowner_signed=True,
            ),
            self._agreement(
                contractor,
                pm_customer,
                "QA Funded Rental Turn",
                "Funded rental turn with assignments, reserve, expenses, and payments.",
                Decimal("9600.00"),
                ProjectStatus.FUNDED,
                today + timedelta(days=3),
                Decimal("900.00"),
                contractor_signed=True,
                homeowner_signed=True,
                escrow_funded_amount=Decimal("10500.00"),
                project_class=AgreementProjectClass.COMMERCIAL,
            ),
        ]
        converted_agreement = agreements[0]
        opportunity.converted_agreement = converted_agreement
        opportunity.conversion_notes = "QA seed links this opportunity to a draft agreement."
        opportunity.status = ContractorOpportunity.STATUS_CONVERTED
        opportunity.save(update_fields=["converted_agreement", "conversion_notes", "status", "updated_at"])
        intake.agreement = converted_agreement
        intake.status = "converted"
        intake.converted_at = now
        intake.save(update_fields=["agreement", "status", "converted_at", "updated_at"])
        proposal.status = Proposal.STATUS_CONVERTED
        proposal.save(update_fields=["status", "updated_at"])

        accepted_invitation, _ = SubcontractorInvitation.objects.update_or_create(
            contractor=contractor,
            agreement=agreements[-1],
            invite_email=QA_EMAILS["subcontractor"],
            defaults={
                "invite_name": "Sam QA Subcontractor",
                "status": SubcontractorInvitationStatus.ACCEPTED,
                "invited_message": "QA seed invitation for rental turn tile work.",
                "accepted_at": now - timedelta(days=1),
                "accepted_by_user": subcontractor_user,
                "expires_at": now + timedelta(days=30),
            },
        )
        first_funded_milestone = agreements[-1].milestones.order_by("order").first()
        if first_funded_milestone:
            first_funded_milestone.assigned_subcontractor_invitation = accepted_invitation
            first_funded_milestone.save(update_fields=["assigned_subcontractor_invitation"])
            SubcontractorQuoteRequest.objects.update_or_create(
                contractor=contractor,
                subcontractor_invitation=accepted_invitation,
                subcontractor=subcontractor_user,
                agreement=agreements[-1],
                milestone=first_funded_milestone,
                defaults={
                    "scope_snapshot": {"title": first_funded_milestone.title, "description": first_funded_milestone.description},
                    "contractor_message": "Please quote tile demo and replacement labor.",
                    "quoted_amount": Decimal("1850.00"),
                    "subcontractor_message": "Includes labor, disposal, and one return trip.",
                    "estimated_start_date": today + timedelta(days=4),
                    "estimated_completion_date": today + timedelta(days=7),
                    "status": SubcontractorQuoteRequestStatus.RESPONDED,
                    "created_by": contractor_user,
                    "responded_by": subcontractor_user,
                    "sent_at": now - timedelta(days=1),
                    "responded_at": now - timedelta(hours=12),
                },
            )

        for agreement in agreements:
            AgreementAssignment.objects.update_or_create(agreement=agreement, subaccount=employee)
            first = agreement.milestones.order_by("order").first()
            if first:
                MilestoneAssignment.objects.update_or_create(milestone=first, defaults={"subaccount": employee})
            self._money_and_docs(agreement, contractor_user)

        self._notifications(customer, pm_customer, contractor)

        return {
            "users": len(QA_EMAILS),
            "customers": 2,
            "properties": 2,
            "agreements": len(agreements),
            "milestones": sum(a.milestones.count() for a in agreements),
            "opportunities": 1,
        }

    def _user(self, User, email: str, first_name: str, last_name: str, phone: str):
        user, _ = User.objects.get_or_create(
            email=email,
            defaults={"first_name": first_name, "last_name": last_name, "phone_number": phone},
        )
        user.first_name = first_name
        user.last_name = last_name
        user.phone_number = phone
        user.is_active = True
        if hasattr(user, "is_verified"):
            user.is_verified = True
        user.set_password(QA_PASSWORD)
        user.save()
        return user

    def _homeowner(
        self,
        contractor,
        email: str,
        name: str,
        phone: str,
        street: str,
        city: str,
        state: str,
        zip_code: str,
        *,
        account_type=Homeowner.ACCOUNT_TYPE_INDIVIDUAL,
        company_name="",
    ):
        homeowner, _ = Homeowner.objects.update_or_create(
            created_by=contractor,
            email=email,
            defaults={
                "full_name": name,
                "phone_number": phone,
                "street_address": street,
                "city": city,
                "state": state,
                "zip_code": zip_code,
                "account_type": account_type,
                "company_name": company_name,
                "company_phone": phone if company_name else "",
                "company_email": email if company_name else "",
                "company_street": street if company_name else "",
                "company_city": city if company_name else "",
                "company_state": state if company_name else "",
                "company_zip": zip_code if company_name else "",
            },
        )
        CustomerCommunicationLog.objects.update_or_create(
            contractor=contractor,
            customer=homeowner,
            subject="QA seed relationship note",
            defaults={
                "communication_type": CustomerCommunicationLog.TYPE_INTERNAL_NOTE,
                "direction": CustomerCommunicationLog.DIRECTION_INTERNAL,
                "body": "Deterministic QA customer seeded for local authenticated walkthroughs.",
                "created_by": contractor.user,
            },
        )
        return homeowner

    def _property(
        self,
        homeowner,
        email,
        display_name,
        street,
        city,
        state,
        postal_code,
        *,
        is_primary,
        is_rental,
        company=None,
        property_type=PropertyProfile.PROPERTY_TYPE_SINGLE_FAMILY,
    ):
        prop, _ = PropertyProfile.objects.update_or_create(
            customer_email=email,
            address_line1=street,
            defaults={
                "homeowner": homeowner,
                "managed_by_company": company,
                "display_name": display_name,
                "property_type": property_type,
                "city": city,
                "state": state,
                "postal_code": postal_code,
                "year_built": 1998,
                "square_feet": 1840,
                "bedrooms": 3,
                "bathrooms": Decimal("2.0"),
                "notes": "Seeded QA property.",
                "is_primary": is_primary,
                "is_rental_property": is_rental,
            },
        )
        return prop

    def _availability(self, contractor):
        for weekday in [0, 1, 2, 3, 4]:
            ContractorEstimateAvailabilityWindow.objects.update_or_create(
                contractor=contractor,
                weekday=weekday,
                appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
                defaults={
                    "start_time": time(9, 0),
                    "end_time": time(15, 0),
                    "timezone": "America/Chicago",
                    "duration_minutes": 90,
                    "is_active": True,
                    "notes": "QA seed estimate availability.",
                },
            )

    def _intake(self, contractor, profile, customer, title, description):
        intake, _ = ProjectIntake.objects.update_or_create(
            contractor=contractor,
            customer_email=customer.email,
            ai_project_title=title,
            defaults={
                "public_profile": profile,
                "homeowner": customer,
                "initiated_by": "homeowner",
                "status": "analyzed",
                "lead_source": "website",
                "customer_name": customer.full_name,
                "customer_phone": customer.phone_number,
                "customer_address_line1": customer.street_address,
                "customer_city": customer.city,
                "customer_state": customer.state,
                "customer_postal_code": customer.zip_code,
                "contact_consent": True,
                "project_class": "residential",
                "project_mode": "full_service",
                "property_type": "single_family",
                "budget_range_text": "$8,000 - $15,000",
                "desired_timing_text": "Within 30 days",
                "payment_preference": "escrow",
                "project_address_line1": customer.street_address,
                "project_city": customer.city,
                "project_state": customer.state,
                "project_postal_code": customer.zip_code,
                "accomplishment_text": description,
                "ai_project_type": "Remodel",
                "ai_project_subtype": "Kitchen",
                "ai_description": description,
                "ai_project_timeline_days": 14,
                "ai_project_budget": Decimal("11250.00"),
                "measurement_handling": "provided",
                "ai_recommendation_confidence": "high",
                "ai_clarification_questions": [
                    "Are cabinets being replaced or refinished?",
                    "Is electrical work needed for lighting?",
                ],
                "ai_clarification_answers": {
                    "cabinets": "Refinish existing cabinets.",
                    "electrical": "Add under-cabinet lighting.",
                },
                "submitted_at": timezone.now() - timedelta(days=4),
                "analyzed_at": timezone.now() - timedelta(days=4, minutes=-10),
            },
        )
        intake.ensure_share_token()
        return intake

    def _proposal(self, contractor, user, opportunity, appointment):
        proposal, _ = Proposal.objects.update_or_create(
            contractor=contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=opportunity.pk,
            defaults={
                "contractor_opportunity": opportunity,
                "estimate_appointment": appointment,
                "status": Proposal.STATUS_READY,
                "project_title": opportunity.project_title,
                "project_summary": opportunity.project_description,
                "project_type": opportunity.project_type,
                "project_subtype": opportunity.project_subtype,
                "customer_name": opportunity.homeowner_name,
                "customer_email": opportunity.homeowner_email,
                "customer_phone": opportunity.homeowner_phone,
                "customer_preferred_contact": "email",
                "service_location": opportunity.project_address,
                "project_start_type": Proposal.PROJECT_START_FLEXIBLE,
                "project_completion_type": Proposal.PROJECT_COMPLETION_FLEXIBLE,
                "scheduling_priority": Proposal.SCHEDULING_PRIORITY_PREFERRED,
                "site_visit_notes": "Cabinets are sound; backsplash substrate needs patching.",
                "access_notes": "Customer can provide lockbox during work week.",
                "risk_notes": "Electrical scope should be verified before final send.",
                "customer_requests": "Keep kitchen usable overnight where possible.",
                "site_conditions": "Drywall patching expected behind old tile.",
                "quick_checklist": [
                    {"label": "Photos captured", "complete": True},
                    {"label": "Measurements captured", "complete": True},
                    {"label": "Electrical clarification", "complete": False},
                ],
                "included_work": "Backsplash demo, cabinet repaint, under-cabinet lighting, cleanup.",
                "excluded_work": "Appliance replacement and countertop replacement.",
                "assumptions": "Existing cabinets remain in place.",
                "allowances": "Tile allowance up to $12/sq ft.",
                "internal_notes": "QA estimate workspace seed.",
                "created_by": user,
            },
        )
        ProposalMeasurement.objects.update_or_create(
            proposal=proposal,
            label="Backsplash area",
            defaults={"location": "Kitchen", "quantity": Decimal("32.00"), "unit": "sq ft", "notes": "Seeded measurement."},
        )
        for category, description, qty, unit, price in [
            (ProposalLineItem.CATEGORY_LABOR, "Cabinet prep and paint labor", Decimal("32.00"), "hr", Decimal("68.00")),
            (ProposalLineItem.CATEGORY_MATERIALS, "Tile, grout, paint, and lighting materials", Decimal("1.00"), "allowance", Decimal("2850.00")),
            (ProposalLineItem.CATEGORY_INCIDENTALS_RESERVE, "Incidentals reserve", Decimal("1.00"), "reserve", Decimal("750.00")),
        ]:
            ProposalLineItem.objects.update_or_create(
                proposal=proposal,
                description=description,
                defaults={"category": category, "quantity": qty, "unit": unit, "unit_price": price},
            )
        ProposalAttachment.objects.update_or_create(
            proposal=proposal,
            original_name="qa-kitchen-before.jpg",
            defaults={
                "attachment_type": ProposalAttachment.TYPE_PHOTO,
                "category": ProposalAttachment.CATEGORY_BEFORE,
                "file": "qa/placeholders/qa-kitchen-before.jpg",
                "caption": "Seeded before photo placeholder.",
                "uploaded_by": user,
            },
        )
        ProposalActivity.objects.update_or_create(
            proposal=proposal,
            event_type=ProposalActivity.EVENT_CREATED,
            message="QA seed created estimate workspace.",
            defaults={"actor": user, "metadata": {"seed": "qa_environment"}},
        )
        return proposal

    def _agreement(
        self,
        contractor,
        homeowner,
        title,
        description,
        total,
        status,
        start_date,
        reserve,
        *,
        contractor_signed=False,
        homeowner_signed=False,
        reviewed=False,
        escrow_funded_amount=Decimal("0.00"),
        project_class=AgreementProjectClass.RESIDENTIAL,
    ):
        project, _ = Project.objects.update_or_create(
            contractor=contractor,
            homeowner=homeowner,
            title=title,
            defaults={
                "description": description,
                "project_street_address": homeowner.street_address,
                "project_city": homeowner.city,
                "project_state": homeowner.state,
                "project_zip_code": homeowner.zip_code,
                "status": status,
            },
        )
        signed_at = timezone.now() - timedelta(days=2)
        agreement, _ = Agreement.objects.update_or_create(
            project=project,
            defaults={
                "contractor": contractor,
                "homeowner": homeowner,
                "project_class": project_class,
                "payment_mode": AgreementPaymentMode.ESCROW,
                "payment_structure": AgreementPaymentStructure.PROGRESS
                if project_class == AgreementProjectClass.COMMERCIAL
                else AgreementPaymentStructure.SIMPLE,
                "description": description,
                "total_cost": total,
                "incidentals_reserve_amount": reserve,
                "milestone_count": 3,
                "start": start_date,
                "end": start_date + timedelta(days=14),
                "project_address_line1": homeowner.street_address,
                "project_address_city": homeowner.city,
                "project_address_state": homeowner.state,
                "project_postal_code": homeowner.zip_code,
                "status": status,
                "project_type": "Remodel" if project_class == AgreementProjectClass.RESIDENTIAL else "Maintenance",
                "project_subtype": "Kitchen" if "Kitchen" in title else "Rental Turn",
                "planning_assumptions": {
                    "crew_size": 2,
                    "work_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
                    "dependencies": ["customer selections", "material delivery"],
                },
                "planning_validation_status": "warning" if status == ProjectStatus.DRAFT else "ready",
                "planning_validation_checked_at": timezone.now(),
                "planning_validation_summary": {
                    "summary": "QA seed planning validation example.",
                    "warnings": ["Confirm material lead time before activation"] if status == ProjectStatus.DRAFT else [],
                },
                "planning_validation_acknowledged_at": timezone.now() if status != ProjectStatus.DRAFT else None,
                "planning_validation_acknowledged_by": contractor.user if status != ProjectStatus.DRAFT else None,
                "reviewed": reviewed,
                "reviewed_at": timezone.now() if reviewed else None,
                "reviewed_by": "contractor" if reviewed else "",
                "contractor_ack_reviewed": reviewed,
                "contractor_ack_tos": reviewed,
                "contractor_ack_esign": reviewed,
                "contractor_ack_at": timezone.now() if reviewed else None,
                "signed_by_contractor": contractor_signed,
                "signed_at_contractor": signed_at if contractor_signed else None,
                "signed_by_homeowner": homeowner_signed,
                "signed_at_homeowner": signed_at + timedelta(hours=2) if homeowner_signed else None,
                "contractor_signature_name": "QA Contractor" if contractor_signed else "",
                "homeowner_signature_name": homeowner.full_name if homeowner_signed else "",
                "escrow_funded_amount": escrow_funded_amount,
                "escrow_payment_intent_id": "pi_qa_stub_funded" if escrow_funded_amount else "",
            },
        )
        self._milestones(agreement)
        return agreement

    def _milestones(self, agreement):
        amount = (agreement.total_cost or Decimal("0.00")) / Decimal("3.00")
        rows = [
            ("Site prep and protection", "Protect work areas, confirm measurements, and stage materials."),
            ("Core work", "Complete primary scoped labor and customer-visible progress."),
            ("Final walkthrough and closeout", "Punch list, cleanup, documentation, and approval."),
        ]
        for idx, (title, description) in enumerate(rows, start=1):
            completed = agreement.status == ProjectStatus.FUNDED and idx == 1
            milestone, _ = Milestone.objects.update_or_create(
                agreement=agreement,
                order=idx,
                defaults={
                    "title": title,
                    "description": description,
                    "amount": amount.quantize(Decimal("0.01")),
                    "start_date": agreement.start + timedelta(days=(idx - 1) * 4) if agreement.start else None,
                    "completion_date": agreement.start + timedelta(days=idx * 4) if agreement.start else None,
                    "recommended_days_from_start": (idx - 1) * 4,
                    "recommended_duration_days": 4,
                    "materials_hint": "QA placeholder materials/photos attached in docs.",
                    "completed": completed,
                    "completed_at": timezone.now() - timedelta(hours=6) if completed else None,
                    "completion_notes": "QA seeded completed milestone." if completed else "",
                },
            )
            if completed:
                milestone.subcontractor_completion_status = "approved"
                milestone.save(update_fields=["subcontractor_completion_status"])

    def _money_and_docs(self, agreement, user):
        first = agreement.milestones.order_by("order").first()
        if first:
            invoice, _ = Invoice.objects.update_or_create(
                agreement=agreement,
                milestone_id_snapshot=first.pk,
                defaults={
                    "amount": first.amount,
                    "status": InvoiceStatus.PAID if agreement.status == ProjectStatus.FUNDED else InvoiceStatus.SENT,
                    "approved_at": timezone.now() - timedelta(hours=4) if agreement.status == ProjectStatus.FUNDED else None,
                    "milestone_title_snapshot": first.title,
                    "milestone_description_snapshot": first.description,
                    "milestone_completion_notes": first.completion_notes,
                    "direct_pay_checkout_url": "",
                    "direct_pay_payment_intent_id": "",
                    "stripe_payment_intent_id": "pi_qa_stub_invoice" if agreement.status == ProjectStatus.FUNDED else "",
                },
            )
            if first.completed:
                first.invoice = invoice
                first.is_invoiced = True
                first.save(update_fields=["invoice", "is_invoiced"])

        if agreement.escrow_funded_amount:
            Payment.objects.update_or_create(
                agreement=agreement,
                stripe_payment_intent_id="pi_qa_stub_funded",
                defaults={
                    "amount_cents": int(agreement.escrow_funded_amount * 100),
                    "currency": "usd",
                    "status": "succeeded",
                    "stripe_charge_id": "ch_qa_stub_funded",
                },
            )

        ExpenseRequest.objects.update_or_create(
            agreement=agreement,
            description="QA materials receipt placeholder",
            defaults={
                "milestone": first,
                "amount": Decimal("126.45"),
                "incurred_date": timezone.localdate() - timedelta(days=1),
                "request_kind": ExpenseRequest.RequestKind.ESCROW_REIMBURSEMENT,
                "funding_source": ExpenseRequest.FundingSource.INCIDENTALS_RESERVE,
                "category": ExpenseRequest.Category.MATERIALS,
                "notes_to_homeowner": "Seeded receipt placeholder. No payment processed.",
                "status": ExpenseRequest.Status.APPROVED
                if agreement.status == ProjectStatus.FUNDED
                else ExpenseRequest.Status.SENT_TO_HOMEOWNER,
                "created_by": user,
                "submitted_at": timezone.now() - timedelta(days=1),
                "approved_at": timezone.now() - timedelta(hours=8) if agreement.status == ProjectStatus.FUNDED else None,
                "available_escrow_at_approval": agreement.escrow_funded_amount or None,
            },
        )
        AgreementAttachment.objects.update_or_create(
            agreement=agreement,
            title="QA Scope Photo Placeholder",
            defaults={
                "category": AgreementAttachment.CATEGORY_EXHIBIT,
                "file": "qa/placeholders/scope-photo.jpg",
                "visible_to_homeowner": True,
                "ack_required": False,
                "uploaded_by": user,
            },
        )
        AgreementPDFVersion.objects.update_or_create(
            agreement=agreement,
            version_number=1,
            defaults={
                "kind": AgreementPDFVersion.KIND_EXECUTED
                if agreement.signed_by_contractor and agreement.signed_by_homeowner
                else AgreementPDFVersion.KIND_PREVIEW,
                "file": "qa/placeholders/agreement-preview.pdf",
                "sha256": f"qa-seed-{agreement.pk:08d}",
                "signed_by_contractor": agreement.signed_by_contractor,
                "signed_by_homeowner": agreement.signed_by_homeowner,
                "contractor_signature_name": agreement.contractor_signature_name,
                "homeowner_signature_name": agreement.homeowner_signature_name,
                "contractor_signed_at": agreement.signed_at_contractor,
                "homeowner_signed_at": agreement.signed_at_homeowner,
            },
        )

    def _notifications(self, customer, pm_customer, contractor):
        for recipient, event_type, title in [
            (customer.email, SmartNotificationEvent.AGREEMENT_NEEDS_SIGNATURE, "QA agreement needs signature"),
            (customer.email, SmartNotificationEvent.ESCROW_FUNDED, "QA escrow funded"),
            (pm_customer.email, SmartNotificationEvent.TENANT_MAINTENANCE_REQUEST_SUBMITTED, "QA tenant maintenance request"),
        ]:
            SmartNotification.objects.update_or_create(
                event_type=event_type,
                recipient_email=recipient,
                title=title,
                defaults={
                    "channel": "in_app",
                    "status": "unread",
                    "contractor": contractor,
                    "message": "Seeded local QA notification.",
                },
            )
