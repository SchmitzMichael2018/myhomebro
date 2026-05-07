from __future__ import annotations
import base64
import json
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.admin.sites import AdminSite
from django.core import signing
from django.core.cache import cache
from django.core.management import call_command
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, RequestFactory, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from projects.api.ai_agreement_views import ai_suggest_milestones
from projects.ai.agreement_milestone_writer import (
    _shape_milestone_rows_for_clarifications,
    suggest_scope_and_milestones,
)
from projects.services.ai.project_classifier import build_project_taxonomy_snapshot, classify_project_from_scope
from projects.services.ai.project_drafter import classify_project_classification, classify_type_subtype
from projects.admin import ProjectTemplateAdmin
from projects.models import (
    Agreement,
    AgreementAIScope,
    AgreementMode,
    AgreementProjectClass,
    AgreementOutcomeMilestoneSnapshot,
    AgreementOutcomeSnapshot,
    AgreementProposalSnapshot,
    ProjectOutcomeSnapshot,
    Contractor,
    ContractorActivityEvent,
    ContractorActivationEvent,
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    ContractorSubAccount,
    ContractorInvite,
    ExpenseRequest,
    DrawRequest,
    DrawRequestStatus,
    ExternalPaymentRecord,
    ExternalPaymentStatus,
    Homeowner,
    Invoice,
    InvoiceStatus,
    AgreementFundingLink,
    Milestone,
    MilestoneAssignment,
    MilestoneComment,
    MilestoneFile,
    MilestonePayout,
    MilestonePayoutExecutionMode,
    MilestonePayoutStatus,
    MaintenanceStatus,
    MilestoneBenchmarkAggregate,
    ContractorBenchmarkAggregate,
    Notification,
    Project,
    ProjectBenchmarkAggregate,
    RegionalBenchmarkAggregate,
    ProjectEmailReportLog,
    ProjectSubtype,
    ProjectType,
    ProjectStatus,
    PublicContractorLead,
    RecurrencePattern,
    Skill,
    StateTradeLicenseRequirement,
    SubcontractorComplianceStatus,
    ContractorComplianceRecord,
    SubcontractorCompletionStatus,
)
from projects.models import AgreementWarranty
from projects.models_attachments import AgreementAttachment
from projects.models_templates import ProjectTemplate, SeedBenchmarkProfile
from projects.models_sms import DeferredSMSAutomation, SMSAutomationDecision, SMSConsent, SMSConsentStatus
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from receipts.models import Receipt
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
    SubcontractorMilestoneAgreement,
    SubcontractorMilestoneAgreementStatus,
    SubcontractorPaymentReleaseMode,
    SubcontractorQuoteRequest,
    SubcontractorQuoteRequestStatus,
)
from projects.models_dispute import Dispute
from projects.services.agreement_completion import recompute_and_apply_agreement_completion
from projects.services.project_learning import (
    capture_agreement_outcome_snapshot,
    rebuild_milestone_benchmarks,
    rebuild_project_benchmarks,
)
from projects.services.project_outcome import capture_project_outcome_snapshot
from projects.services.contractor_benchmarks import (
    get_blended_benchmark,
    rebuild_contractor_benchmark_aggregates,
)
from projects.services.contractor_insights import build_contractor_insights
from projects.services.contractor_profile_insights import get_contractor_profile_insights
from projects.services.regional_benchmarks import rebuild_regional_benchmark_aggregates
from projects.services.proposal_learning import (
    build_proposal_draft,
    capture_agreement_proposal_snapshot,
)
from projects.services.project_intelligence import (
    build_project_intelligence_context,
    build_project_setup_recommendation,
)
from projects.services.project_intelligence_orchestrator import build_project_intelligence
from projects.services.project_plan_suggestions import build_project_plan_suggestion
from projects.services.agreements.create import create_agreement_from_validated
from projects.services.agreements.public_sign import build_public_sign_url
from projects.services.agreement_fee_allocation import refresh_agreement_fee_allocations
from projects.services.benchmark_resolution import resolve_seed_benchmark_defaults
from projects.views.customer_portal import _portal_token
from projects.services.compliance import (
    contractor_has_required_license,
    get_agreement_compliance_warning,
    get_public_trust_indicators,
    get_trade_license_requirement,
    sync_legacy_contractor_compliance_records,
)
from projects.services.ai_orchestrator import orchestrate_user_request
from projects.services.activity_feed import (
    build_dashboard_activity_payload,
    create_activity_event,
    get_next_best_action,
)
from projects.services.direct_pay import (
    create_direct_pay_checkout_for_invoice,
    finalize_direct_pay_invoice_paid,
)
from projects.services.draw_requests import finalize_draw_paid, release_escrow_draw
from projects.services.estimation_engine import build_project_estimate, _clarification_signature_from_answers
from projects.services.intake_analysis import analyze_project_intake
from projects.services.intake_conversion import convert_intake_to_agreement
from projects.services.regions import build_normalized_region_key
from projects.services.template_apply import apply_template_to_agreement, save_agreement_as_template
from projects.services.template_discovery import discover_templates
from projects.services.milestone_payouts import sync_milestone_payout
from projects.services.subcontractor_milestone_agreements import (
    accept_subcontractor_milestone_agreement,
    upsert_subcontractor_milestone_agreement,
)
from projects.services.subcontractor_quotes import get_pricing_readiness_for_agreement
from projects.services.subcontractor_payout_orchestration import (
    evaluate_subcontractor_payout_eligibility,
    orchestrate_subcontractor_payout_for_milestone,
    release_subcontractor_payment,
    serialize_subcontractor_payout_orchestration,
)
from projects.services.project_email_reports import (
    build_project_email_report,
    send_project_email_report,
)
from projects.services.public_lead_pipeline import sync_public_lead_from_project_intake
from projects.services.recurring_maintenance import (
    build_recurring_preview,
    ensure_recurring_milestones,
    handle_milestone_recurring_state_change,
)
from projects.views.customer_portal import PORTAL_TOKEN_SALT
from projects.services.subcontractor_compliance import (
    apply_assignment_compliance_decision,
    evaluate_subcontractor_assignment_compliance,
)
from projects.services.sms_service import (
    get_sms_status_payload,
    handle_inbound_sms,
    handle_sms_status_callback,
    send_compliant_sms,
    set_sms_opt_in,
    set_sms_opt_out,
)
from payments.fees import compute_fee_summary, get_monthly_processed_volume_for_contractor
from projects.services.sms_automation import build_sms_automation_summary, evaluate_sms_automation
from payments.webhooks import (
    _handle_direct_pay_checkout_completed,
    _handle_draw_transfer_created,
    _handle_draw_transfer_failed,
    _handle_draw_direct_checkout_completed,
    _handle_payment_intent_failed,
    _handle_payment_intent_processing,
)
from payments.models import ConnectedAccount, Payment


class AgreementMilestoneAIRouteTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Test Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Homeowner Test",
            email="homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Agreement AI Test Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Test agreement",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_ai_suggest_milestones_route_and_contract(self):
        path = f"/api/projects/agreements/{self.agreement.id}/ai/suggest-milestones/"
        match = resolve(path)
        self.assertIs(getattr(match.func, "cls", None), getattr(ai_suggest_milestones, "cls", None))

        with override_settings(AI_ENABLED=True):
            with patch(
                "projects.api.ai_agreement_views.suggest_scope_and_milestones",
                return_value={
                    "scope_text": "Scope from AI",
                    "milestones": [{"title": "Milestone 1", "amount": "100.00"}],
                    "questions": [{"key": "permits_responsibility", "label": "Who handles permits?"}],
                    "_model": "test-model",
                },
            ) as mock_suggest:
                response = self.client.post(path, {"notes": "Please suggest milestones"}, format="json")

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["scope_text"], "Scope from AI")
        self.assertIsInstance(data["milestones"], list)
        self.assertIsInstance(data["questions"], list)
        self.assertEqual(data["ai_access"], "included")
        self.assertTrue(data["ai_enabled"])
        self.assertTrue(data["ai_unlimited"])

        mock_suggest.assert_called_once_with(agreement=self.agreement, notes="Please suggest milestones")

    def test_milestones_round_trip_through_api_persist_fields_and_order(self):
        create_url = "/api/projects/milestones/"

        first_payload = {
            "agreement": self.agreement.id,
            "title": "Site Prep",
            "description": "Protect the work area and prepare the site.",
            "amount": "1500.00",
            "start_date": "2026-04-01",
            "completion_date": "2026-04-02",
            "order": 1,
            "sort_order": 1,
        }
        second_payload = {
            "agreement": self.agreement.id,
            "title": "Build and Finish",
            "description": "Frame, finish, and close out the project.",
            "amount": "2500.00",
            "start_date": "2026-04-03",
            "completion_date": "2026-04-05",
            "order": 2,
            "sort_order": 2,
        }

        first_response = self.client.post(create_url, first_payload, format="json")
        second_response = self.client.post(create_url, second_payload, format="json")

        self.assertEqual(first_response.status_code, 201, first_response.json())
        self.assertEqual(second_response.status_code, 201, second_response.json())

        first_id = first_response.json()["id"]
        second_id = second_response.json()["id"]

        patch_response = self.client.patch(
            f"/api/projects/milestones/{first_id}/",
            {
                "title": "Site Prep and Foundation",
                "description": "Protect the work area and prepare the slab foundation.",
                "amount": "1750.00",
                "start_date": "2026-04-06",
                "completion_date": "2026-04-07",
                "sort_order": 3,
            },
            format="json",
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.json())

        self.agreement.refresh_from_db()

        list_response = self.client.get(f"/api/projects/milestones/?agreement={self.agreement.id}")
        self.assertEqual(list_response.status_code, 200, list_response.json())
        list_payload = list_response.json()
        rows = list_payload["results"] if isinstance(list_payload, dict) else list_payload

        self.assertEqual([row["id"] for row in rows], [second_id, first_id])
        self.assertEqual([row["order"] for row in rows], [2, 3])

        self.assertEqual(rows[0]["title"], "Build and Finish")
        self.assertEqual(rows[0]["description"], "Frame, finish, and close out the project.")
        self.assertEqual(rows[0]["amount"], "2500.00")
        self.assertEqual(rows[0]["start_date"], "2026-04-03")
        self.assertEqual(rows[0]["completion_date"], "2026-04-05")

        self.assertEqual(rows[1]["title"], "Site Prep and Foundation")
        self.assertEqual(rows[1]["description"], "Protect the work area and prepare the slab foundation.")
        self.assertEqual(rows[1]["amount"], "1750.00")
        self.assertEqual(rows[1]["start_date"], "2026-04-06")
        self.assertEqual(rows[1]["completion_date"], "2026-04-07")
        self.assertEqual(self.agreement.milestones.count(), 2)


class AgreementMilestoneSuggestionShapingTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="milestone-shaping@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Milestone Shaping Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Milestone Homeowner",
            email="milestone-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Milestone Shaping Project",
        )

    def _agreement(self, *, project_subtype="Kitchen Remodel", answers=None, description="Kitchen remodel scope"):
        agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description=description,
            project_type="Remodel",
            project_subtype=project_subtype,
            total_cost=Decimal("24000.00"),
            milestone_count=5,
        )
        AgreementAIScope.objects.create(agreement=agreement, answers=answers or {})
        return agreement

    def _ensure_taxonomy(self, type_name, subtype_names):
        project_type = (
            ProjectType.objects.filter(
                normalized_name=type_name.lower().replace(" ", "_"),
                contractor__isnull=True,
            )
            .order_by("id")
            .first()
        )
        if not project_type:
            project_type = ProjectType.objects.create(name=type_name, is_system=True, sort_order=15)
        for idx, subtype_name in enumerate(subtype_names, start=1):
            subtype = (
                ProjectSubtype.objects.filter(
                    project_type=project_type,
                    normalized_name=subtype_name.lower().replace(" ", "_"),
                    contractor__isnull=True,
                )
                .order_by("id")
                .first()
            )
            if subtype:
                continue
            ProjectSubtype.objects.create(
                project_type=project_type,
                name=subtype_name,
                is_system=True,
                sort_order=20 + idx,
            )
        return project_type

    def _mock_openai_response(self, milestones):
        payload = {
            "scope_text": "AI generated scope text",
            "milestones": milestones,
            "questions": [],
        }
        fake_client = SimpleNamespace(
            responses=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(output_text=json.dumps(payload))
            )
        )
        return fake_client

    def _shared_shaping_rules(self):
        rules_path = Path(__file__).resolve().parents[2] / "shared" / "milestone_shaping_rules.json"
        with rules_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def test_classify_type_subtype_prefers_basement_over_bathroom(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Finish basement",
            description="Finish the basement with framing, drywall, flooring, and trim.",
        )

        self.assertEqual(project_type, "Remodel")
        self.assertEqual(project_subtype, "Basement")
        self.assertIn("basement", reason.lower())

    def test_classify_type_subtype_prefers_siding_replacement(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Replace siding",
            description="Remove existing siding and install replacement siding with trim repairs.",
        )

        self.assertEqual(project_type, "Siding")
        self.assertEqual(project_subtype, "Siding Replacement")
        self.assertIn("siding", reason.lower())

    def test_classify_type_subtype_prefers_pool_house_over_plumbing(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Inground Pool and Pool House",
            description=(
                "Build an inground pool and pool house with excavation, plumbing, "
                "equipment pad, lighting, and finish details."
            ),
        )

        self.assertEqual(project_type, "Pool")
        self.assertEqual(project_subtype, "Inground Pool and Pool House")
        self.assertIn("pool", reason.lower())

    def test_classify_type_subtype_prefers_media_room_over_painting(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Movie entertainment room",
            description=(
                "Build a media room with projector wiring, speakers, framed AV wall, "
                "drywall, and lighting zones."
            ),
            requested_type="Painting",
            requested_subtype="Interior Painting",
        )

        self.assertEqual(project_type, "Remodel")
        self.assertEqual(project_subtype, "Home Theater / Media Room")
        self.assertIn("media room", reason.lower())

    def test_classify_type_subtype_prefers_junk_removal_over_repair(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Junk Removal",
            description="Remove old furniture, appliances, and debris from the garage.",
            scope_text="Remove and haul away the items from the garage.",
            requested_type="Repair",
            requested_subtype="Faucet Repair",
        )

        self.assertEqual(project_type, "Junk Removal")
        self.assertEqual(project_subtype, "Junk Removal")
        self.assertIn("junk", reason.lower())

    def test_classify_type_subtype_prefers_wet_bar_over_electrical_for_mixed_scope(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Wet bar buildout",
            description=(
                "Remove existing cabinetry and countertops, install wet bar cabinetry, "
                "countertop, sink, plumbing fixture, lighting, and painting."
            ),
        )

        self.assertEqual(project_type, "Remodel")
        self.assertEqual(project_subtype, "Wet Bar Installation")
        self.assertIn("wet bar", reason.lower())

    def test_classify_type_subtype_prefers_outdoor_kitchen_over_wet_bar(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Outdoor Kitchen",
            description=(
                "Build an outdoor kitchen with weather-resistant cabinets, countertop, sink, "
                "lighting, and patio electrical work."
            ),
            scope_text=(
                "Outdoor kitchen scope includes weather-resistant cabinetry, countertop, sink, "
                "and outdoor electrical/plumbing."
            ),
            requested_type="Remodel",
            requested_subtype="Wet Bar Installation",
        )

        self.assertEqual(project_type, "Outdoor Living")
        self.assertEqual(project_subtype, "Outdoor Kitchen")
        self.assertIn("outdoor-kitchen", reason.lower())

    def test_classify_type_subtype_prefers_patio_extension_over_wet_bar(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Patio extension",
            description="Extend the patio and add weather-resistant cabinets and an outdoor sink.",
            scope_text="Patio extension with weather-resistant cabinets and an outdoor sink.",
            requested_type="Remodel",
            requested_subtype="Wet Bar Installation",
        )

        self.assertEqual(project_type, "Outdoor Living")
        self.assertEqual(project_subtype, "Patio Extension")
        self.assertIn("outdoor", reason.lower())

    def test_classify_project_classification_labels_outdoor_kitchen(self):
        result = classify_project_classification(
            project_title="Outdoor Kitchen",
            description=(
                "Build an outdoor kitchen with weather-resistant cabinets, countertop, sink, "
                "lighting, and patio electrical work."
            ),
            scope_text=(
                "Outdoor kitchen scope includes weather-resistant cabinetry, countertop, sink, "
                "and outdoor electrical/plumbing."
            ),
            requested_type="Wet Bar Installation",
            requested_subtype="Wet Bar Installation",
        )

        self.assertEqual(result["project_type"], "Outdoor Living")
        self.assertEqual(result["project_subtype"], "Outdoor Kitchen")
        self.assertEqual(result["project_title"], "Outdoor Kitchen")
        self.assertIn("outdoor", result["classification_reason"].lower())

    def test_classify_project_from_scope_prefers_outdoor_kitchen_and_reports_confidence(self):
        self._ensure_taxonomy("Outdoor Living", ["Outdoor Kitchen", "Patio Extension", "Grill Island", "Pergola / Patio Cover"])
        taxonomy = build_project_taxonomy_snapshot(self.contractor)
        with patch(
            "projects.services.ai.project_classifier._call_openai_classifier",
            return_value={
                "project_type": "Outdoor Living",
                "project_subtype": "Outdoor Kitchen",
                "project_title": "Outdoor Kitchen",
                "confidence": "high",
                "reason": "The scope centers on outdoor cabinetry, countertop, sink, and grill work.",
                "recommended_custom_subtype": None,
                "alternatives": [
                    {
                        "project_type": "Remodel",
                        "project_subtype": "Wet Bar Installation",
                        "project_title": "Wet Bar Installation",
                    }
                ],
            },
        ):
            result = classify_project_from_scope(
                description="Outdoor kitchen with grill and sink.",
                scope="Outdoor kitchen with weather-resistant cabinets, an outdoor sink, and grill island.",
                taxonomy=taxonomy,
                current_values={
                    "project_type": "Remodel",
                    "project_subtype": "Wet Bar Installation",
                    "project_title": "Wet Bar Installation",
                },
                contractor=self.contractor,
            )

        self.assertEqual(result["project_type"], "Outdoor Living")
        self.assertEqual(result["project_subtype"], "Outdoor Kitchen")
        self.assertEqual(result["project_title"], "Outdoor Kitchen")
        self.assertEqual(result["confidence"], "high")
        self.assertIn("outdoor", result["reason"].lower())

    def test_classify_project_from_scope_rejects_invalid_pair_and_falls_back(self):
        self._ensure_taxonomy("Outdoor Living", ["Outdoor Kitchen", "Patio Extension", "Grill Island", "Pergola / Patio Cover"])
        taxonomy = build_project_taxonomy_snapshot(self.contractor)
        with patch(
            "projects.services.ai.project_classifier._call_openai_classifier",
            return_value={
                "project_type": "Electrical",
                "project_subtype": "Rewire",
                "project_title": "Electrical Rewire",
                "confidence": "high",
                "reason": "Incorrectly suggested electrical work.",
                "alternatives": [],
            },
        ):
            result = classify_project_from_scope(
                description="Outdoor kitchen with weather-resistant cabinetry and sink.",
                scope="Outdoor kitchen with weather-resistant cabinets, countertop, sink, and grill island.",
                taxonomy=taxonomy,
                current_values={},
                contractor=self.contractor,
            )

        self.assertEqual(result["project_type"], "Outdoor Living")
        self.assertIn(
            result["project_subtype"],
            {"Outdoor Kitchen", "Patio Extension", "Outdoor Bar", "Grill Island", "Pergola / Patio Cover", ""},
        )
        self.assertIn("outdoor", result["reason"].lower())
        self.assertIn(result["confidence"], {"medium", "low"})

    def test_classify_project_from_scope_prefers_media_room_over_painting(self):
        self._ensure_taxonomy("Remodel", ["Home Theater / Media Room", "Wet Bar Installation", "Basement"])
        taxonomy = build_project_taxonomy_snapshot(self.contractor)
        with patch(
            "projects.services.ai.project_classifier._call_openai_classifier",
            return_value={
                "project_type": "Painting",
                "project_subtype": "Interior",
                "project_title": "Painting Project",
                "confidence": "medium",
                "reason": "Scope mentions AV wiring, framing, drywall, and projector/speaker installation.",
                "alternatives": [],
            },
        ):
            result = classify_project_from_scope(
                description="Movie entertainment room buildout.",
                scope="Add AV wiring, projector mount, speaker system, framing, drywall, and lighting zones.",
                taxonomy=taxonomy,
                current_values={"project_type": "Painting", "project_subtype": "Interior", "project_title": "Painting Project"},
                contractor=self.contractor,
            )

        self.assertEqual(result["project_type"], "Remodel")
        self.assertEqual(result["project_subtype"], "Home Theater / Media Room")
        self.assertEqual(result["project_title"], "Home Theater Installation")

    def test_classify_project_from_scope_prefers_junk_removal_over_repair(self):
        self._ensure_taxonomy("Junk Removal", ["Junk Removal", "Debris Removal", "Appliance Removal", "Furniture Removal", "Construction Debris Removal"])
        taxonomy = build_project_taxonomy_snapshot(self.contractor)
        with patch(
            "projects.services.ai.project_classifier._call_openai_classifier",
            return_value={
                "project_type": "Repair",
                "project_subtype": "Faucet Repair",
                "project_title": "Faucet Repair",
                "confidence": "medium",
                "reason": "The scope is junk and debris removal.",
                "alternatives": [],
            },
        ):
            result = classify_project_from_scope(
                description="Junk Removal",
                scope="Remove old furniture, appliances, and construction debris from the garage.",
                taxonomy=taxonomy,
                current_values={"project_type": "Repair", "project_subtype": "Faucet Repair", "project_title": "Faucet Repair"},
                contractor=self.contractor,
            )

        self.assertEqual(result["project_type"], "Junk Removal")
        self.assertEqual(result["project_subtype"], "Junk Removal")
        self.assertEqual(result["project_title"], "Junk Removal")

    def test_classify_type_subtype_allows_electrical_when_dominant(self):
        project_type, project_subtype, reason = classify_type_subtype(
            project_title="Install recessed lights",
            description="Install recessed lights, add a new switch, and update wiring for the lighting circuit.",
        )

        self.assertEqual(project_type, "Electrical")
        self.assertEqual(project_subtype, "Lighting")
        self.assertIn("electrical", reason.lower())

    def test_service_shapes_kitchen_milestones_from_saved_clarifications(self):
        agreement = self._agreement(
            answers={
                "layout_changes": "yes",
                "cabinet_scope": "no",
                "finish_scope_notes": "backsplash and pendant lighting",
            }
        )
        base_milestones = [
            {
                "order": 1,
                "title": "Planning",
                "description": "Base planning milestone",
                "amount": 1000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 2,
                "title": "Demo",
                "description": "Base demo milestone",
                "amount": 2000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 3,
                "title": "Cabinets",
                "description": "Base cabinet milestone",
                "amount": 3000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 4,
                "title": "Finishes",
                "description": "Base finish milestone",
                "amount": 4000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 5,
                "title": "Walkthrough",
                "description": "Base closeout milestone",
                "amount": 5000,
                "start_date": "",
                "completion_date": "",
            },
        ]

        with patch(
            "projects.ai.agreement_milestone_writer._require_openai_client",
            return_value=self._mock_openai_response(base_milestones),
        ), patch(
            "projects.ai.agreement_milestone_writer._model_name",
            return_value="test-model",
        ):
            result = suggest_scope_and_milestones(agreement=agreement, notes="")

        titles = [row["title"] for row in result["milestones"]]
        self.assertEqual(
            titles,
            [
                "Planning & protection",
                "Layout review & utility changes",
                "Selective demolition & rough-in",
                "Countertops, surfaces & finishes",
                "Fixtures & appliances",
                "Punch list & walkthrough",
            ],
        )
        self.assertTrue(result["clarification_shaped"])
        self.assertEqual(result["milestones"][0]["amount"], 1000)
        self.assertEqual(result["milestones"][5]["amount"], 0.0)
        self.assertIn(
            "Included finish scope: backsplash and pendant lighting.",
            result["milestones"][4]["description"],
        )

    def test_service_shifts_past_ai_milestone_dates_forward_to_today(self):
        agreement = self._agreement()
        base_milestones = [
            {
                "order": 1,
                "title": "Planning",
                "description": "Base planning milestone",
                "amount": 1000,
                "start_date": "2026-04-01",
                "completion_date": "2026-04-02",
            },
            {
                "order": 2,
                "title": "Build",
                "description": "Base build milestone",
                "amount": 2000,
                "start_date": "2026-04-04",
                "completion_date": "2026-04-06",
            },
        ]

        with patch(
            "projects.ai.agreement_milestone_writer._require_openai_client",
            return_value=self._mock_openai_response(base_milestones),
        ), patch(
            "projects.ai.agreement_milestone_writer._model_name",
            return_value="test-model",
        ), patch(
            "projects.ai.agreement_milestone_writer.timezone.localdate",
            return_value=datetime(2026, 4, 29).date(),
        ):
            result = suggest_scope_and_milestones(agreement=agreement, notes="")

        shifted = result["milestones"]
        self.assertEqual(shifted[0]["start_date"], "2026-04-29")
        self.assertEqual(shifted[0]["completion_date"], "2026-04-30")
        self.assertEqual(shifted[1]["start_date"], "2026-05-02")
        self.assertEqual(shifted[1]["completion_date"], "2026-05-04")
        self.assertEqual(
            (
                datetime.strptime(shifted[1]["start_date"], "%Y-%m-%d")
                - datetime.strptime(shifted[0]["start_date"], "%Y-%m-%d")
            ).days,
            3,
        )

    def test_service_prompt_includes_scope_of_work_and_original_description(self):
        agreement = self._agreement(
            project_subtype="Siding Replacement",
            description="Replace siding on a single-story home with trim repairs and cleanup.",
            answers={
                "measurements_provided": "Yes",
                "measurement_exterior_square_footage": "1200",
                "measurement_notes": "Approximate measurements only.",
            },
        )
        captured = {}

        class FakeResponses:
            def create(self, **kwargs):
                captured.update(kwargs)
                payload = {
                    "scope_text": "AI generated scope text",
                    "milestones": [
                        {
                            "order": 1,
                            "title": "Site Prep",
                            "description": "Prep the site.",
                            "amount": 1200,
                            "start_date": "",
                            "completion_date": "",
                        }
                    ],
                    "questions": [],
                }
                return SimpleNamespace(output_text=json.dumps(payload))

        fake_client = SimpleNamespace(responses=FakeResponses())

        with patch(
            "projects.ai.agreement_milestone_writer._require_openai_client",
            return_value=fake_client,
        ), patch(
            "projects.ai.agreement_milestone_writer._model_name",
            return_value="test-model",
        ):
            result = suggest_scope_and_milestones(agreement=agreement, notes="")

        self.assertTrue(result["milestones"])
        user_message = next((item for item in captured.get("input", []) if item.get("role") == "user"), None)
        self.assertIsNotNone(user_message)
        user_json = json.loads(user_message["content"])
        self.assertEqual(
            user_json["scope_of_work"],
            "Replace siding on a single-story home with trim repairs and cleanup.",
        )
        self.assertEqual(
            user_json["original_description"],
            "Replace siding on a single-story home with trim repairs and cleanup.",
        )
        self.assertEqual(user_json["clarification_answers"]["measurements_provided"], "Yes")
        self.assertEqual(
            user_json["clarification_answers"]["measurement_exterior_square_footage"],
            "1200",
        )
        self.assertEqual(
            user_json["clarification_answers"]["measurement_notes"],
            "Approximate measurements only.",
        )
        self.assertEqual(user_json["project_type"], "Remodel")
        self.assertEqual(user_json["project_subtype"], "Siding Replacement")

    def test_service_falls_back_to_contractordriven_rows_for_siding_roofing_and_painting(self):
        def make_agreement(*, project_title, **agreement_kwargs):
            project = Project.objects.create(
                contractor=self.contractor,
                homeowner=self.homeowner,
                title=project_title,
            )
            agreement = Agreement.objects.create(
                project=project,
                contractor=self.contractor,
                homeowner=self.homeowner,
                description=agreement_kwargs.pop("description"),
                project_type=agreement_kwargs.pop("project_type", "Remodel"),
                project_subtype=agreement_kwargs.pop("project_subtype", ""),
                total_cost=Decimal("24000.00"),
                milestone_count=5,
            )
            AgreementAIScope.objects.create(agreement=agreement, answers=agreement_kwargs.pop("answers", {}) or {})
            return agreement

        class FakeResponses:
            def create(self, **kwargs):
                payload = {
                    "scope_text": "AI generated scope text",
                    "milestones": [
                        {
                            "order": 1,
                            "title": "Generic Work",
                            "description": "Generic work.",
                            "amount": 1200,
                            "start_date": "",
                            "completion_date": "",
                        }
                    ],
                    "questions": [],
                }
                return SimpleNamespace(output_text=json.dumps(payload))

        fake_client = SimpleNamespace(responses=FakeResponses())

        cases = [
            (
                make_agreement(
                    project_title="Siding Replacement",
                    project_subtype="Siding Replacement",
                    description="Replace siding on a single-story home with trim repairs and cleanup.",
                    answers={"measurements_provided": "Yes", "measurement_exterior_square_footage": "1200"},
                ),
                [
                    "Site Preparation and Material Staging",
                    "Remove Existing Siding",
                    "Install New Siding and Trim",
                    "Final Inspection and Cleanup",
                ],
                "replace siding",
            ),
            (
                make_agreement(
                    project_title="Roof Replacement",
                    project_subtype="Roof Replacement",
                    description="Replace roof with new shingles and cleanup.",
                    answers={"measurements_provided": "Yes", "measurement_cubic_yards": "3"},
                ),
                [
                    "Site Setup and Safety Prep",
                    "Remove Existing Roofing",
                    "Install New Roofing System",
                    "Final Inspection and Cleanup",
                ],
                "replace roof",
            ),
            (
                make_agreement(
                    project_title="Painting",
                    project_type="Painting",
                    project_subtype="Interior Painting",
                    description="Paint bedroom walls and trim.",
                    answers={"measurements_provided": "Yes", "measurement_room_count": "3"},
                ),
                [
                    "Prep Surfaces and Protect Areas",
                    "Prime and Paint",
                    "Touch-Ups and Cleanup",
                ],
                "paint bedroom",
            ),
        ]

        with patch(
            "projects.ai.agreement_milestone_writer._require_openai_client",
            return_value=fake_client,
        ), patch(
            "projects.ai.agreement_milestone_writer._model_name",
            return_value="test-model",
        ):
            for agreement, expected_titles, context_phrase in cases:
                result = suggest_scope_and_milestones(agreement=agreement, notes="")
                self.assertEqual([row["title"] for row in result["milestones"]], expected_titles)
                self.assertTrue(all("\n-" in row["description"] for row in result["milestones"]))
                self.assertTrue(all("kitchen" not in row["title"].lower() for row in result["milestones"]))
                self.assertTrue(all("generic" not in row["description"].lower() for row in result["milestones"]))
                self.assertIn(context_phrase.split()[0], agreement.description.lower())

    def test_service_removes_bathroom_tile_phase_when_scope_is_excluded(self):
        agreement = self._agreement(
            project_subtype="Bathroom Remodel",
            description="Bathroom remodel scope",
            answers={"wet_area_tile": "no"},
        )
        base_milestones = [
            {
                "order": 1,
                "title": "Protection",
                "description": "Base protection milestone",
                "amount": 1000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 2,
                "title": "Rough-in",
                "description": "Base rough-in milestone",
                "amount": 2000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 3,
                "title": "Tile",
                "description": "Base tile milestone",
                "amount": 3000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 4,
                "title": "Fixtures",
                "description": "Base fixtures milestone",
                "amount": 4000,
                "start_date": "",
                "completion_date": "",
            },
            {
                "order": 5,
                "title": "Closeout",
                "description": "Base closeout milestone",
                "amount": 5000,
                "start_date": "",
                "completion_date": "",
            },
        ]

        with patch(
            "projects.ai.agreement_milestone_writer._require_openai_client",
            return_value=self._mock_openai_response(base_milestones),
        ), patch(
            "projects.ai.agreement_milestone_writer._model_name",
            return_value="test-model",
        ):
            result = suggest_scope_and_milestones(agreement=agreement, notes="")

        titles = [row["title"] for row in result["milestones"]]
        self.assertEqual(
            titles,
            [
                "Protection & demolition",
                "Rough plumbing & electrical",
                "Vanity, fixtures & trim",
                "Final cleanup & walkthrough",
            ],
        )
        self.assertNotIn("Walls, waterproofing & tile", titles)
        self.assertNotIn("Tile & waterproofing finish", titles)
        self.assertIn(
            "Include wall touch-up and non-tile surface prep needed before the fixture phase.",
            result["milestones"][2]["description"],
        )

    def test_backend_shape_helper_matches_shared_regression_contract(self):
        rules = self._shared_shaping_rules()
        for case in rules.get("regressionCases", []):
            with self.subTest(case=case.get("id")):
                input_data = case.get("input", {})
                rows = _shape_milestone_rows_for_clarifications(
                    project_type=input_data.get("projectType", ""),
                    project_subtype=input_data.get("projectSubtype", ""),
                    description=input_data.get("description", ""),
                    clarification_answers=input_data.get("clarificationAnswers", {}),
                    total_budget=input_data.get("totalBudget", 0),
                    amount_mode=input_data.get("amountMode", "default"),
                    base_milestones=input_data.get("baseMilestones", []),
                )
                titles = [row["title"] for row in rows]

                if isinstance(case.get("expectedTitles"), list):
                    self.assertEqual(titles, case["expectedTitles"])

                for missing_title in case.get("expectedMissingTitles", []):
                    self.assertNotIn(missing_title, titles)

                for expectation in case.get("expectedDescriptionIncludes", []):
                    row = next(
                        (candidate for candidate in rows if candidate["title"] == expectation.get("title")),
                        None,
                    )
                    self.assertIsNotNone(row)
                    self.assertIn(expectation.get("text", ""), row["description"])

                if "expectedAllAmounts" in case:
                    self.assertTrue(all(row["amount"] == case["expectedAllAmounts"] for row in rows))


class SubcontractorHubApiTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="hub-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Hub Contractor",
        )
        self.other_contractor_user = user_model.objects.create_user(
            email="hub-other@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Other Contractor",
        )
        self.subcontractor_user = user_model.objects.create_user(
            email="hub-subcontractor@example.com",
            password="testpass123",
        )
        self.other_subcontractor_user = user_model.objects.create_user(
            email="hub-other-subcontractor@example.com",
            password="testpass123",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Hub Homeowner",
            email="hub-homeowner@example.com",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Kitchen Remodel",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement with subcontractor hub",
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Project",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other agreement",
        )
        self.accepted_invitation = SubcontractorInvitation.objects.create(
            agreement=self.agreement,
            contractor=self.contractor,
            invite_email="hub-subcontractor@example.com",
            invite_name="Taylor Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_at=timezone.now(),
            accepted_by_user=self.subcontractor_user,
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            agreement=self.other_agreement,
            contractor=self.other_contractor,
            invite_email="hub-other-subcontractor@example.com",
            invite_name="Other Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_at=timezone.now(),
            accepted_by_user=self.other_subcontractor_user,
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            amount=Decimal("2500.00"),
            start_date=timezone.localdate(),
            completion_date=timezone.localdate(),
        )
        self.other_milestone = Milestone.objects.create(
            agreement=self.other_agreement,
            order=1,
            title="Other Work",
            amount=Decimal("1800.00"),
            start_date=timezone.localdate(),
            completion_date=timezone.localdate(),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.contractor_user)

    @patch(
        "projects.views.subcontractor_hub.send_subcontractor_invitation_email",
        return_value={"attempted": True, "ok": True, "invite_url": "http://testserver/subcontractor-invitations/accept/test-token"},
    )
    def test_contractor_can_invite_subcontractor_from_hub_endpoint(self, _send_email):
        response = self.client.post(
            "/api/projects/subcontractors/invite/",
            {
                "agreement_id": self.agreement.id,
                "invite_email": "new-sub@example.com",
                "invite_name": "New Sub",
                "invited_message": "Please join this agreement.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["invite_email"], "new-sub@example.com")
        self.assertEqual(payload["agreement_title"], "Kitchen Remodel")

    @patch(
        "projects.views.subcontractor_hub.send_subcontractor_invitation_email",
        return_value={"attempted": True, "ok": True, "invite_url": "http://testserver/subcontractor-invitations/accept/test-token"},
    )
    def test_contractor_cannot_create_duplicate_pending_invite_for_same_email(self, _send_email):
        response_one = self.client.post(
            "/api/projects/subcontractors/invite/",
            {
                "agreement_id": self.agreement.id,
                "invite_email": "pending-sub@example.com",
                "invite_name": "Pending Sub",
            },
            format="json",
        )
        self.assertEqual(response_one.status_code, 201)

        second_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Second Kitchen Remodel",
        )
        second_agreement = Agreement.objects.create(
            project=second_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Second agreement",
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )

        response_two = self.client.post(
            "/api/projects/subcontractors/invite/",
            {
                "agreement_id": second_agreement.id,
                "invite_email": "pending-sub@example.com",
                "invite_name": "Pending Sub",
            },
            format="json",
        )

        self.assertEqual(response_two.status_code, 400)
        self.assertIn("pending invitation already exists", str(response_two.json()).lower())

    @patch(
        "projects.views.subcontractor_hub.send_subcontractor_invitation_email",
        return_value={"attempted": True, "ok": True, "invite_url": "http://testserver/subcontractor-invitations/accept/test-token"},
    )
    def test_contractor_cannot_reinvite_already_accepted_subcontractor(self, _send_email):
        second_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Addition Project",
        )
        second_agreement = Agreement.objects.create(
            project=second_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Addition agreement",
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )

        response = self.client.post(
            "/api/projects/subcontractors/invite/",
            {
                "agreement_id": second_agreement.id,
                "invite_email": "hub-subcontractor@example.com",
                "invite_name": "Taylor Sub",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("already active for your business", str(response.json()).lower())

    def test_directory_and_assignments_are_contractor_scoped(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])
        self.other_milestone.assigned_subcontractor_invitation = self.other_invitation
        self.other_milestone.save(update_fields=["assigned_subcontractor_invitation"])

        directory_response = self.client.get("/api/projects/subcontractors/")
        assignments_response = self.client.get("/api/projects/subcontractor-assignments/")

        self.assertEqual(directory_response.status_code, 200)
        self.assertEqual(assignments_response.status_code, 200)
        directory_rows = directory_response.json()["results"]
        assignment_rows = assignments_response.json()["results"]

        self.assertEqual(len(directory_rows), 1)
        self.assertEqual(directory_rows[0]["email"], "hub-subcontractor@example.com")
        self.assertEqual(len(assignment_rows), 1)
        self.assertEqual(assignment_rows[0]["agreement_id"], self.agreement.id)

    def test_contractor_can_assign_milestones_from_agreement_assignment_endpoint(self):
        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-assignments/",
            {
                "invitation_id": self.accepted_invitation.id,
                "milestone_ids": [self.milestone.id],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.assigned_subcontractor_invitation_id,
            self.accepted_invitation.id,
        )
        self.assertEqual(
            response.json()["assignment"]["assigned_milestones_count"],
            1,
        )

    def test_assignment_requires_compliance_decision_when_license_missing(self):
        self.agreement.project_type = "Electrical"
        self.agreement.project_address_state = "TX"
        self.agreement.save(update_fields=["project_type", "project_address_state"])
        StateTradeLicenseRequirement.objects.create(
            state_code="TX",
            state_name="Texas",
            trade_key="electrical",
            trade_label="Electrical",
            license_required=True,
            issuing_authority_name="Texas Department of Licensing and Regulation",
            official_lookup_url="https://www.tdlr.texas.gov/",
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-assignments/",
            {
                "invitation_id": self.accepted_invitation.id,
                "milestone_ids": [self.milestone.id],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertTrue(payload["compliance_decision_required"])
        self.assertEqual(payload["compliance_evaluation"]["compliance_status"], "missing_license")
        self.milestone.refresh_from_db()
        self.assertIsNone(self.milestone.assigned_subcontractor_invitation_id)

    def test_assignment_request_license_marks_pending_and_sends_notification_email(self):
        self.agreement.project_type = "Electrical"
        self.agreement.project_address_state = "TX"
        self.agreement.save(update_fields=["project_type", "project_address_state"])
        StateTradeLicenseRequirement.objects.create(
            state_code="TX",
            state_name="Texas",
            trade_key="electrical",
            trade_label="Electrical",
            license_required=True,
            issuing_authority_name="Texas Department of Licensing and Regulation",
            official_lookup_url="https://www.tdlr.texas.gov/",
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-assignments/",
            {
                "invitation_id": self.accepted_invitation.id,
                "milestone_ids": [self.milestone.id],
                "compliance_action": "request_license",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_compliance_status,
            SubcontractorComplianceStatus.PENDING_LICENSE,
        )
        self.assertTrue(self.milestone.subcontractor_license_required)
        self.assertEqual(self.milestone.subcontractor_required_trade_key, "electrical")
        self.assertIsNotNone(self.milestone.subcontractor_license_requested_at)
        self.assertEqual(self.milestone.subcontractor_license_requested_by_id, self.contractor_user.id)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("compliance", mail.outbox[0].subject.lower())

    def test_assignment_assign_anyway_persists_override_state(self):
        self.agreement.project_type = "Electrical"
        self.agreement.project_address_state = "TX"
        self.agreement.save(update_fields=["project_type", "project_address_state"])
        StateTradeLicenseRequirement.objects.create(
            state_code="TX",
            state_name="Texas",
            trade_key="electrical",
            trade_label="Electrical",
            license_required=True,
            issuing_authority_name="Texas Department of Licensing and Regulation",
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-assignments/",
            {
                "invitation_id": self.accepted_invitation.id,
                "milestone_ids": [self.milestone.id],
                "compliance_action": "assign_anyway",
                "override_reason": "Customer needs work started immediately.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_compliance_status,
            SubcontractorComplianceStatus.OVERRIDDEN,
        )
        self.assertTrue(self.milestone.subcontractor_compliance_override)
        self.assertIn("Customer needs work started immediately.", self.milestone.subcontractor_compliance_override_reason)
        self.assertEqual(response.json()["assignment"]["compliance_status"], "overridden")

    def test_assignment_choose_another_does_not_create_assignment(self):
        self.agreement.project_type = "Electrical"
        self.agreement.project_address_state = "TX"
        self.agreement.save(update_fields=["project_type", "project_address_state"])
        StateTradeLicenseRequirement.objects.create(
            state_code="TX",
            state_name="Texas",
            trade_key="electrical",
            trade_label="Electrical",
            license_required=True,
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-assignments/",
            {
                "invitation_id": self.accepted_invitation.id,
                "milestone_ids": [self.milestone.id],
                "compliance_action": "choose_another",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["assignment_created"])
        self.milestone.refresh_from_db()
        self.assertIsNone(self.milestone.assigned_subcontractor_invitation_id)

    def test_assignment_recognizes_matching_license_on_file(self):
        self.agreement.project_type = "Electrical"
        self.agreement.project_address_state = "TX"
        self.agreement.save(update_fields=["project_type", "project_address_state"])
        StateTradeLicenseRequirement.objects.create(
            state_code="TX",
            state_name="Texas",
            trade_key="electrical",
            trade_label="Electrical",
            license_required=True,
        )
        subcontractor_contractor = Contractor.objects.create(
            user=self.subcontractor_user,
            business_name="Accepted Sub Business",
        )
        ContractorComplianceRecord.objects.create(
            contractor=subcontractor_contractor,
            record_type=ContractorComplianceRecord.RecordType.LICENSE,
            trade_key="electrical",
            trade_label="Electrical",
            state_code="TX",
            status=ContractorComplianceRecord.Status.VERIFIED,
        )

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-assignments/",
            {
                "invitation_id": self.accepted_invitation.id,
                "milestone_ids": [self.milestone.id],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_compliance_status,
            SubcontractorComplianceStatus.COMPLIANT,
        )
        self.assertEqual(
            response.json()["assignment"]["compliance_status"],
            "compliant",
        )

    def test_contractor_can_review_submitted_work_from_hub_endpoint(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.subcontractor_user
        self.milestone.subcontractor_completion_note = "Ready for walkthrough."
        self.milestone.save(
            update_fields=[
                "assigned_subcontractor_invitation",
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_completion_note",
            ]
        )

        response = self.client.post(
            f"/api/projects/subcontractor-work-submissions/{self.milestone.id}/review/",
            {"action": "approve", "response_note": "Looks good."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.APPROVED,
        )
        self.assertEqual(self.milestone.subcontractor_review_response_note, "Looks good.")

    def test_other_contractor_is_blocked_from_reviewing_submission(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.subcontractor_user
        self.milestone.save(
            update_fields=[
                "assigned_subcontractor_invitation",
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        other_client = APIClient()
        other_client.force_authenticate(user=self.other_contractor_user)
        response = other_client.post(
            f"/api/projects/subcontractor-work-submissions/{self.milestone.id}/review/",
            {"action": "approve"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)


class ContractorPublicPresenceApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="public-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Bright Build Co",
            phone="555-111-2222",
            city="Austin",
            state="TX",
            license_number="LIC-100",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Public Homeowner",
            email="public-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Public Presence Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Public profile agreement",
        )
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Bright Build Co",
            tagline="Trusted renovations and repairs",
            bio="We help homeowners with clean, reliable project delivery.",
            city="Austin",
            state="TX",
            is_public=True,
            specialties=["Roofing", "Exterior"],
            work_types=["Repairs", "Remodels"],
        )
        ContractorGalleryItem.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            title="Kitchen Remodel",
            category="Remodel",
            image=SimpleUploadedFile("public.jpg", b"filecontent", content_type="image/jpeg"),
            is_public=True,
        )
        ContractorGalleryItem.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            title="Private Job",
            category="Private",
            image=SimpleUploadedFile("private.jpg", b"filecontent", content_type="image/jpeg"),
            is_public=False,
        )
        ContractorReview.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            agreement=self.agreement,
            customer_name="Taylor Homeowner",
            rating=5,
            title="Excellent work",
            review_text="Professional from start to finish.",
            is_verified=True,
            is_public=True,
        )
        ContractorReview.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            customer_name="Hidden Reviewer",
            rating=4,
            review_text="Hidden review.",
            is_public=False,
        )
        self.other_user = user_model.objects.create_user(
            email="other-public-owner@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Bright Build Co",
        )
        self.other_profile = ContractorPublicProfile.objects.create(
            contractor=self.other_contractor,
            business_name_public="Bright Build Co",
            is_public=False,
        )
        self.client = APIClient()

    def _create_completed_agreement(
        self,
        *,
        total_cost=Decimal("12000.00"),
        actual_total=None,
        status=ProjectStatus.COMPLETED,
        use_template=True,
    ):
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title=f"Public Presence Project {Agreement.objects.count() + 1}",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78701",
            status=status,
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template_name_snapshot="Kitchen Remodel Template Public Profile" if use_template else "",
            description="Public profile agreement",
            total_cost=total_cost,
        )
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Demo and Prep",
            description="Prepare the site.",
            amount=Decimal("4000.00"),
            start_date=timezone.localdate(),
        )
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Install and Finish",
            description="Complete the job.",
            amount=actual_total or Decimal("8000.00"),
            start_date=timezone.localdate() + timedelta(days=7),
        )
        Invoice.objects.create(
            agreement=agreement,
            amount=actual_total or Decimal("8000.00"),
            status=InvoiceStatus.PAID,
            direct_pay_paid_at=timezone.now() - timedelta(days=1),
        )
        return agreement

    def _seed_contractor_benchmark_snapshot(
        self,
        *,
        template_used: str,
        total_project_value: Decimal,
        actual_duration_days: int,
        milestone_count: int,
        dispute_flag: bool = False,
        amendment_count: int = 0,
    ):
        agreement = self._create_completed_agreement(
            total_cost=total_project_value,
            actual_total=total_project_value,
            status=ProjectStatus.COMPLETED,
            use_template=True,
        )
        snapshot = capture_project_outcome_snapshot(agreement)
        snapshot.project_family_key = "kitchen_remodel"
        snapshot.project_family_label = "Kitchen Remodel"
        snapshot.scope_mode = "install_removal"
        snapshot.template_used = template_used
        snapshot.total_project_value = total_project_value
        snapshot.actual_duration_days = actual_duration_days
        snapshot.milestone_count = milestone_count
        snapshot.dispute_flag = dispute_flag
        snapshot.amendment_count = amendment_count
        snapshot.completion_status = ProjectStatus.COMPLETED
        snapshot.estimated_value_range = {
            "low": str(total_project_value * Decimal("0.90")),
            "high": str(total_project_value * Decimal("1.10")),
        }
        snapshot.estimated_duration_range = {
            "low": str(max(actual_duration_days - 1, 1)),
            "high": str(actual_duration_days + 1),
        }
        snapshot.save(
            update_fields=[
                "project_family_key",
                "project_family_label",
                "scope_mode",
                "template_used",
                "total_project_value",
                "actual_duration_days",
                "milestone_count",
                "dispute_flag",
                "amendment_count",
                "completion_status",
                "estimated_value_range",
                "estimated_duration_range",
            ]
        )
        return snapshot

    def test_slug_generation_is_unique(self):
        self.assertTrue(self.profile.slug)
        self.assertTrue(self.other_profile.slug)
        self.assertNotEqual(self.profile.slug, self.other_profile.slug)

    def test_public_profile_requires_public_flag(self):
        response = self.client.get(f"/api/projects/public/contractors/{self.profile.slug}/")
        self.assertEqual(response.status_code, 200, response.content.decode())
        self.assertFalse(response.data["preview"])

        hidden_response = self.client.get(f"/api/projects/public/contractors/{self.other_profile.slug}/")
        self.assertEqual(hidden_response.status_code, 200)
        self.assertTrue(hidden_response.data["preview"])

    def test_public_rating_endpoint_returns_verified_review_summary(self):
        response = self.client.get(f"/api/contractors/{self.profile.slug}/rating/")
        self.assertEqual(response.status_code, 200, response.content.decode())
        self.assertFalse(response.data["new_on_myhomebro"])
        self.assertEqual(response.data["review_count"], 1)
        self.assertEqual(response.data["average_rating"], 5.0)

        hidden_response = self.client.get(f"/api/contractors/{self.other_profile.slug}/rating/")
        self.assertEqual(hidden_response.status_code, 200)
        self.assertTrue(hidden_response.data["new_on_myhomebro"])
        self.assertEqual(hidden_response.data["review_count"], 0)
        self.assertIsNone(hidden_response.data["average_rating"])

    def test_verified_review_creation_updates_contractor_rating(self):
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1500.00"),
            status=InvoiceStatus.APPROVED,
        )

        response_one = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/reviews/",
            {
                "customer_name": "Jordan Client",
                "rating": 5,
                "title": "Excellent work",
                "review_text": "Clean communication and polished work.",
                "linked_invoice": invoice.id,
            },
            format="json",
        )
        self.assertEqual(response_one.status_code, 201)

        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.review_count, 2)
        self.assertEqual(self.contractor.average_rating, 5.0)

        response_two = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/reviews/",
            {
                "customer_name": "Taylor Client",
                "rating": 3,
                "title": "Helpful team",
                "review_text": "Finished the job, but we had a couple of small delays.",
                "linked_invoice": invoice.id,
            },
            format="json",
        )
        self.assertEqual(response_two.status_code, 201)

        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.review_count, 3)
        self.assertEqual(self.contractor.average_rating, 4.33)

    def test_public_quote_request_creates_intake_and_queue_row(self):
        response = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/request-quote/",
            {
                "full_name": "Jordan Prospect",
                "email": "jordan@example.com",
                "phone": "555-202-3030",
                "contact_consent": True,
                "project_class": "residential",
                "project_type": "Kitchen Remodel",
                "project_subtype": "Cabinet Refresh",
                "raw_description": "Need a kitchen update with new cabinets and finishes.",
                "refined_description": "Need a kitchen update with new cabinets and finishes.",
                "desired_timing_text": "ASAP",
                "property_type": "Single-family home",
                "budget_range_text": "$15k - $30k",
                "preferred_contact_method": "email",
                "project_address_line1": "123 Main St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "ai_clarification_questions": json.dumps(
                    [
                        {"key": "scope_priority", "label": "What matters most right now?"},
                    ]
                ),
                "ai_clarification_answers": json.dumps({"scope_priority": "Cabinet refresh"}),
                "ai_analysis_payload": json.dumps({}),
                "files": SimpleUploadedFile("kitchen.jpg", b"filecontent", content_type="image/jpeg"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["request_path_label"], "Request a Quote")

        intake = ProjectIntake.objects.get(pk=response.data["intake_id"])
        lead = PublicContractorLead.objects.get(pk=response.data["lead_id"])

        self.assertEqual(intake.lead_source, PublicContractorLead.SOURCE_QUOTE_REQUEST)
        self.assertEqual(intake.desired_timing_text, "ASAP")
        self.assertEqual(intake.property_type, "Single-family home")
        self.assertEqual(intake.budget_range_text, "$15k - $30k")
        self.assertEqual(intake.preferred_contact_method, "email")
        self.assertTrue(intake.contact_consent)
        self.assertEqual(intake.clarification_photos.count(), 1)

        self.assertEqual(lead.source, PublicContractorLead.SOURCE_QUOTE_REQUEST)
        self.assertEqual(lead.preferred_timeline, "ASAP")
        self.assertEqual(lead.ai_analysis.get("request_path_label"), "Request a Quote")
        notification = Notification.objects.get(
            contractor=self.contractor,
            public_lead=lead,
            category=Notification.EVENT_QUOTE_REQUEST_RECEIVED,
        )
        self.assertEqual(notification.user_id, self.contractor_user.id)
        self.assertEqual(notification.link, "/app/bids")
        self.assertFalse(notification.is_read)
        consent = SMSConsent.objects.get(phone_number_e164="+15552023030")
        self.assertTrue(consent.can_send_sms)
        self.assertFalse(consent.opted_out)
        self.assertTrue(consent.consent_source_page.startswith("http"))
        self.assertIn(self.profile.slug, consent.consent_source_page)

        self.client.force_authenticate(user=self.contractor_user)
        bids_response = self.client.get("/api/projects/contractor/bids/")
        self.assertEqual(bids_response.status_code, 200)
        row = next((item for item in bids_response.data["results"] if item.get("source_id") == lead.id), None)
        self.assertIsNotNone(row)
        self.assertEqual(row["request_path_label"], "Request a Quote")
        self.assertEqual(row["desired_timing_text"], "ASAP")
        self.assertEqual(row["property_type"], "Single-family home")
        self.assertEqual(row["budget_range_text"], "$15k - $30k")
        self.assertEqual(row["preferred_contact_method"], "email")
        self.assertTrue(row["contact_consent"])

    def test_quote_request_conversion_persists_draft_edits_into_agreement(self):
        quote_response = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/request-quote/",
            {
                "full_name": "Jordan Prospect",
                "email": "jordan@example.com",
                "phone": "555-202-3030",
                "contact_consent": True,
                "project_class": "residential",
                "project_type": "Bathroom Remodel",
                "project_subtype": "Primary Bath",
                "raw_description": "Need a primary bath refresh with new tile and fixtures.",
                "refined_description": "Need a primary bath refresh with new tile and fixtures.",
                "desired_timing_text": "Within the next month",
                "property_type": "Single-family home",
                "budget_range_text": "$20,000 - $25,000",
                "preferred_contact_method": "text",
                "project_address_line1": "123 Main St",
                "project_address_line2": "Unit 4",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "ai_clarification_questions": json.dumps([]),
                "ai_clarification_answers": json.dumps({}),
                "ai_analysis_payload": json.dumps({}),
            },
            format="json",
        )
        self.assertEqual(quote_response.status_code, 201)

        lead = PublicContractorLead.objects.get(pk=quote_response.data["lead_id"])

        self.client.force_authenticate(user=self.contractor_user)
        promote_response = self.client.patch(
            f"/api/projects/contractor/public-leads/{lead.id}/",
            {"status": "ready_for_review"},
            format="json",
        )
        self.assertEqual(promote_response.status_code, 200)

        convert_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/create-agreement/",
            {
                "draft_payload": {
                    "project_title": "Primary Bath Refresh - Updated",
                    "project_description": "Updated agreement scope before sending.",
                    "project_type": "Bathroom Remodel",
                    "project_subtype": "Primary Bath",
                    "project_class": "residential",
                    "property_type": "Single-family home",
                    "budget_range_text": "$20,000 - $25,000",
                    "desired_timing_text": "Within the next month",
                    "preferred_contact_method": "text",
                    "contact_consent": True,
                    "project_address_line1": "123 Main St",
                    "project_address_line2": "Unit 4",
                    "project_city": "Austin",
                    "project_state": "TX",
                    "project_postal_code": "78701",
                    "payment_mode": "escrow",
                    "payment_structure": "simple",
                    "total_cost": "$24,500.00",
                    "milestones": [
                        {"title": "Demo", "description": "Remove existing finishes"},
                        {"title": "Tile", "description": "Install waterproofing and tile"},
                    ],
                }
            },
            format="json",
        )

        self.assertEqual(convert_response.status_code, 201)
        agreement = Agreement.objects.get(pk=convert_response.data["agreement_id"])
        self.assertEqual(agreement.project.title, "Primary Bath Refresh - Updated")
        self.assertEqual(agreement.project.description, "Updated agreement scope before sending.")
        self.assertEqual(agreement.description, "Updated agreement scope before sending.")
        self.assertEqual(agreement.project.project_street_address, "123 Main St")
        self.assertEqual(agreement.project.project_address_line_2, "Unit 4")
        self.assertEqual(agreement.project.project_city, "Austin")
        self.assertEqual(agreement.project.project_state, "TX")
        self.assertEqual(agreement.project.project_zip_code, "78701")
        self.assertEqual(agreement.payment_mode, "escrow")
        self.assertEqual(agreement.payment_structure, "simple")
        self.assertEqual(agreement.total_cost, Decimal("24500.00"))
        self.assertEqual(agreement.milestones.count(), 2)
        self.assertEqual(agreement.milestone_count, 2)
        self.assertEqual(agreement.milestones.first().title, "Demo")
        self.assertEqual(
            sum((milestone.amount for milestone in agreement.milestones.all()), Decimal("0.00")),
            Decimal("24500.00"),
        )

    def test_public_agreement_sign_preview_includes_review_fields(self):
        attachment = AgreementAttachment.objects.create(
            agreement=self.agreement,
            title="Scope Photo",
            category=AgreementAttachment.CATEGORY_EXHIBIT,
            file=SimpleUploadedFile("scope.jpg", b"filecontent", content_type="image/jpeg"),
            visible_to_homeowner=True,
        )
        AgreementFundingLink.create_for_agreement(
            self.agreement,
            amount=Decimal("1500.00"),
            currency="usd",
        )

        token = build_public_sign_url(self.agreement).rsplit("/", 1)[-1]
        response = self.client.get(f"/api/projects/agreements/public_sign/?token={token}")

        self.assertEqual(response.status_code, 200, response.content.decode())
        self.assertEqual(response.data["project_title"], self.agreement.project.title)
        self.assertEqual(response.data["contractor_name"], self.contractor.business_name)
        self.assertEqual(response.data["project_summary"], self.agreement.description)
        self.assertEqual(response.data["contractor_rating"]["review_count"], 1)
        self.assertEqual(response.data["contractor_rating"]["average_rating"], 5.0)
        self.assertEqual(response.data["attachments"][0]["id"], attachment.id)
        self.assertIn(f"/app/project/{self.project.id}", response.data["project_dashboard_url"])
        self.assertTrue(response.data["public_fund_url"].endswith(f"/public-fund/{response.data['funding_token']}"))

    def test_customer_project_dashboard_loads_sections_and_changes_next_action_by_state(self):
        token = _portal_token(self.homeowner.email)
        milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Demo and Prep",
            description="Remove existing finishes and prep the site.",
            amount=Decimal("2500.00"),
        )
        Attachment = AgreementAttachment
        Attachment.objects.create(
            agreement=self.agreement,
            title="Kitchen photo",
            category=Attachment.CATEGORY_EXHIBIT,
            file=SimpleUploadedFile("kitchen.jpg", b"filecontent", content_type="image/jpeg"),
            visible_to_homeowner=True,
        )
        MilestoneComment.objects.create(
            milestone=milestone,
            author=self.contractor_user,
            content="We are ready to start prep work.",
        )

        initial_response = self.client.get(
            f"/api/projects/customer-portal/project/{self.project.id}/",
            {"token": token},
        )
        self.assertEqual(initial_response.status_code, 200)
        self.assertEqual(initial_response.data["hero"]["project_title"], self.project.title)
        self.assertEqual(initial_response.data["next_action"]["label"], "Accept & Sign")
        self.assertEqual(len(initial_response.data["timeline"]), 1)
        self.assertEqual(len(initial_response.data["messages"]["items"]), 1)
        self.assertEqual(len(initial_response.data["photos"]), 1)
        self.assertFalse(initial_response.data["review"]["eligible"])

        self.agreement.signed_by_contractor = True
        self.agreement.signed_at_contractor = timezone.now()
        self.agreement.signed_by_homeowner = True
        self.agreement.signed_at_homeowner = timezone.now()
        self.agreement.status = ProjectStatus.SIGNED
        self.agreement.save(
            update_fields=[
                "signed_by_contractor",
                "signed_at_contractor",
                "signed_by_homeowner",
                "signed_at_homeowner",
                "status",
                "updated_at",
            ]
        )
        AgreementFundingLink.create_for_agreement(
            self.agreement,
            amount=Decimal("1500.00"),
            currency="usd",
        )

        funded_response = self.client.get(
            f"/api/projects/customer-portal/project/{self.project.id}/",
            {"token": token},
        )
        self.assertEqual(funded_response.status_code, 200)
        self.assertEqual(funded_response.data["next_action"]["label"], "Fund Deposit")

        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode", "updated_at"])
        Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1250.00"),
            status=InvoiceStatus.APPROVED,
        )

        payment_response = self.client.get(
            f"/api/projects/customer-portal/project/{self.project.id}/",
            {"token": token},
        )
        self.assertEqual(payment_response.status_code, 200)
        self.assertEqual(payment_response.data["next_action"]["label"], "Pay Invoice")
        self.assertGreaterEqual(len(payment_response.data["payments"]["invoice_rows"]), 1)

        upload_response = self.client.post(
            f"/api/projects/customer-portal/project/{self.project.id}/?token={token}",
            {"files": SimpleUploadedFile("exterior.jpg", b"filecontent", content_type="image/jpeg")},
            format="multipart",
        )
        self.assertEqual(upload_response.status_code, 201)
        self.assertGreaterEqual(len(upload_response.data["uploaded"]), 1)
        self.assertGreaterEqual(len(upload_response.data["photos"]), 2)

    def test_public_agreement_sign_updates_status_and_returns_funding_link(self):
        self.agreement.total_cost = Decimal("1500.00")
        self.agreement.save(update_fields=["total_cost", "updated_at"])
        self.agreement.signed_by_contractor = True
        self.agreement.signed_at_contractor = timezone.now()
        self.agreement.save(update_fields=["signed_by_contractor", "signed_at_contractor", "updated_at"])

        token = build_public_sign_url(self.agreement).rsplit("/", 1)[-1]
        response = self.client.post(
            "/api/projects/agreements/public_sign/",
            {
                "token": token,
                "typed_name": "Public Customer",
                "signature_data_url": "data:image/png;base64," + base64.b64encode(b"signature").decode(),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["funding_link_sent"])
        self.assertIn("public_fund_url", response.data)
        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.status, ProjectStatus.SIGNED)
        notification = Notification.objects.get(
            contractor=self.contractor,
            agreement=self.agreement,
            category=Notification.EVENT_AGREEMENT_SIGNED,
        )
        self.assertEqual(notification.user_id, self.contractor_user.id)
        self.assertEqual(notification.link, f"/app/agreements/{self.agreement.id}")

    def test_public_agreement_funding_token_can_create_payment_intent(self):
        self.agreement.total_cost = Decimal("1500.00")
        self.agreement.save(update_fields=["total_cost", "updated_at"])
        self.agreement.signed_by_contractor = True
        self.agreement.signed_at_contractor = timezone.now()
        self.agreement.save(update_fields=["signed_by_contractor", "signed_at_contractor", "updated_at"])

        token = build_public_sign_url(self.agreement).rsplit("/", 1)[-1]
        sign_response = self.client.post(
            "/api/projects/agreements/public_sign/",
            {
                "token": token,
                "typed_name": "Public Customer",
                "signature_data_url": "data:image/png;base64," + base64.b64encode(b"signature").decode(),
            },
            format="multipart",
        )
        self.assertEqual(sign_response.status_code, 200)
        funding_token = sign_response.data["funding_token"]

        with patch("projects.views.funding.stripe.api_key", "sk_test_fake"), patch(
            "projects.views.funding.stripe.PaymentIntent.create"
        ) as mock_create:
            mock_create.return_value = SimpleNamespace(
                id="pi_test_123",
                client_secret="pi_test_secret_123",
            )
            funding_response = self.client.post(
                "/api/projects/funding/create_payment_intent/",
                {"token": funding_token},
                format="json",
            )

        self.assertEqual(funding_response.status_code, 200)
        self.assertEqual(funding_response.data["client_secret"], "pi_test_secret_123")
        self.assertEqual(funding_response.data["payment_intent_id"], "pi_test_123")
        mock_create.assert_called_once()

    @patch("projects.views.public_presence.generate_contractor_public_profile")
    def test_generate_profile_endpoint_returns_all_fields(self, mock_generate):
        mock_generate.return_value = {
            "tagline": "Built for clean, calm remodels",
            "intro": "We help homeowners plan and complete projects with clear communication and premium craftsmanship.",
            "tone": "friendly",
            "work_types": ["Kitchen Remodels", "Bathroom Remodels", "Repairs"],
            "seo_title": "Bright Build Co | Austin Contractor",
            "seo_description": "Bright Build Co helps Austin homeowners with kitchen remodels, bathroom remodels, and repairs.",
        }
        self.client.force_authenticate(user=self.contractor_user)

        response = self.client.post(
            "/api/projects/contractors/generate-profile/",
            {"prompt": "Write a warm profile for a premium remodeling contractor."},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["tagline"], "Built for clean, calm remodels")
        self.assertEqual(response.data["intro"], "We help homeowners plan and complete projects with clear communication and premium craftsmanship.")
        self.assertEqual(response.data["tone"], "friendly")
        self.assertEqual(response.data["work_types"], ["Kitchen Remodels", "Bathroom Remodels", "Repairs"])
        self.assertEqual(response.data["seo_title"], "Bright Build Co | Austin Contractor")
        self.assertTrue(response.data["seo_description"].startswith("Bright Build Co helps Austin homeowners"))
        mock_generate.assert_called_once()

    def test_contractor_profile_insights_service_returns_short_positive_insights(self):
        for idx in range(5):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Public Profile",
                total_project_value=Decimal("12000.00") + Decimal(str(idx * 250)),
                actual_duration_days=6 + (idx % 2),
                milestone_count=4,
            )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])

        insights = get_contractor_profile_insights(self.contractor.id)

        self.assertGreaterEqual(len(insights), 3)
        self.assertLessEqual(len(insights), 6)
        self.assertTrue(any("kitchen remodel" in item.lower() for item in insights))
        self.assertTrue(any("pricing" in item.lower() for item in insights))
        self.assertTrue(any("timeline" in item.lower() or "timelines" in item.lower() for item in insights))
        self.assertFalse(any(any(char.isdigit() for char in item) for item in insights))

    def test_contractor_profile_insights_service_hides_low_sample_profiles(self):
        for idx in range(3):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Public Profile",
                total_project_value=Decimal("12000.00") + Decimal(str(idx * 250)),
                actual_duration_days=6 + (idx % 2),
                milestone_count=4,
            )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])

        insights = get_contractor_profile_insights(self.contractor.id)

        self.assertEqual(insights, [])

    def test_public_gallery_and_reviews_only_return_public_rows(self):
        gallery_response = self.client.get(f"/api/projects/public/contractors/{self.profile.slug}/gallery/")
        reviews_response = self.client.get(f"/api/projects/public/contractors/{self.profile.slug}/reviews/")

        self.assertEqual(gallery_response.status_code, 200)
        self.assertEqual(reviews_response.status_code, 200)
        self.assertEqual(len(gallery_response.json()["results"]), 1)
        self.assertEqual(gallery_response.json()["results"][0]["title"], "Kitchen Remodel")
        self.assertEqual(len(reviews_response.json()["results"]), 1)
        self.assertEqual(reviews_response.json()["results"][0]["customer_name"], "Taylor Homeowner")

    def test_public_profile_intake_creates_lead_for_correct_profile(self):
        response = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/intake/",
            {
                "source": "public_profile",
                "full_name": "Casey Prospect",
                "email": "casey@example.com",
                "phone": "555-444-3333",
                "project_type": "Kitchen Remodel",
                "project_description": "Need a remodel estimate.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        lead = PublicContractorLead.objects.get(full_name="Casey Prospect")
        self.assertEqual(lead.contractor_id, self.contractor.id)
        self.assertEqual(lead.public_profile_id, self.profile.id)
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_PUBLIC_PROFILE)

    def test_public_profile_persists_brand_voice_fields(self):
        self.client.force_authenticate(user=self.contractor_user)
        hero_image = SimpleUploadedFile(
            "hero.gif",
            base64.b64decode("R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs="),
            content_type="image/gif",
        )
        response = self.client.patch(
            "/api/projects/contractor/public-profile/",
            {
                "proposal_tone": "warm_and_consultative",
                "preferred_signoff": "Warmly, Bright Build Co",
                "brand_primary_color": "#1d4ed8",
                "brand_accent_color": "#f97316",
                "brand_font_theme": "editorial_serif",
                "profile_theme": "warm",
                "tagline": "Trusted renovations and repairs",
                "bio": "We help homeowners with clean, reliable project delivery.",
                "show_reviews": "false",
                "show_gallery": "false",
                "show_quote_cta": "false",
                "hero_image": hero_image,
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        self.assertEqual(response.json()["proposal_tone"], "warm_and_consultative")
        self.assertEqual(response.json()["preferred_signoff"], "Warmly, Bright Build Co")
        self.assertEqual(response.json()["brand_primary_color"], "#1d4ed8")
        self.assertEqual(response.json()["brand_accent_color"], "#f97316")
        self.assertEqual(response.json()["brand_font_theme"], "editorial_serif")
        self.assertEqual(response.json()["profile_theme"], "warm")
        self.assertFalse(response.json()["show_reviews"])
        self.assertFalse(response.json()["show_gallery"])
        self.assertFalse(response.json()["show_quote_cta"])
        self.assertTrue(response.json()["hero_image_url"].endswith(".gif"))

        profile = ContractorPublicProfile.objects.get(contractor=self.contractor)
        self.assertEqual(profile.proposal_tone, "warm_and_consultative")
        self.assertEqual(profile.preferred_signoff, "Warmly, Bright Build Co")
        self.assertEqual(profile.brand_primary_color, "#1d4ed8")
        self.assertEqual(profile.brand_accent_color, "#f97316")
        self.assertEqual(profile.brand_font_theme, "editorial_serif")
        self.assertEqual(profile.profile_theme, "warm")
        self.assertFalse(profile.show_reviews)
        self.assertFalse(profile.show_gallery)
        self.assertFalse(profile.show_quote_cta)
        self.assertTrue(bool(profile.hero_image))

        public_response = self.client.get(f"/api/projects/public/contractors/{self.profile.slug}/")
        self.assertEqual(public_response.status_code, 200)
        public_payload = public_response.json()
        self.assertEqual(public_payload["brand_primary_color"], "#1d4ed8")
        self.assertEqual(public_payload["brand_accent_color"], "#f97316")
        self.assertEqual(public_payload["brand_font_theme"], "editorial_serif")
        self.assertEqual(public_payload["profile_theme"], "warm")
        self.assertFalse(public_payload["show_reviews"])
        self.assertFalse(public_payload["show_gallery"])
        self.assertFalse(public_payload["show_quote_cta"])

    def test_qr_public_profile_intake_preserves_qr_source(self):
        response = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/intake/",
            {
                "source": "qr",
                "full_name": "QR Prospect",
                "email": "qr@example.com",
                "phone": "555-777-9999",
                "project_description": "Scanned the yard sign QR code.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        lead = PublicContractorLead.objects.get(email="qr@example.com")
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_QR)

    def test_landing_page_public_intake_creates_same_lead_structure_with_source_attribution(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Landing Prospect",
                "customer_email": "landing@example.com",
                "customer_phone": "555-333-2222",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        patch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "customer_name": "Landing Prospect",
                "customer_email": "landing@example.com",
                "customer_phone": "555-333-2222",
                "project_address_line1": "100 Landing Way",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "accomplishment_text": "Need a remodel estimate from the landing page.",
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200)
        lead = PublicContractorLead.objects.get(email="landing@example.com")
        self.assertEqual(lead.contractor_id, self.contractor.id)
        self.assertEqual(lead.public_profile_id, self.profile.id)
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_LANDING_PAGE)
        self.assertEqual(lead.full_name, "Landing Prospect")
        self.assertEqual(lead.project_address, "100 Landing Way")
        self.assertEqual(lead.project_description, "Need a remodel estimate from the landing page.")

    def test_public_intake_accepts_blank_optional_numeric_fields(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Blank Numeric Prospect",
                "customer_email": "blank-numeric@example.com",
                "customer_phone": "555-111-2222",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        patch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "customer_name": "Blank Numeric Prospect",
                "customer_email": "blank-numeric@example.com",
                "customer_phone": "555-111-2222",
                "project_address_line1": "200 Blank St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "accomplishment_text": "Need a project plan with blank optional numeric fields.",
                "ai_project_timeline_days": "",
                "ai_project_budget": "",
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200)
        intake = ProjectIntake.objects.get(share_token=token)
        self.assertIsNone(intake.ai_project_timeline_days)
        self.assertIsNone(intake.ai_project_budget)

    def test_public_intake_accepts_valid_optional_numeric_fields(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Valid Numeric Prospect",
                "customer_email": "valid-numeric@example.com",
                "customer_phone": "555-222-3333",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        patch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "customer_name": "Valid Numeric Prospect",
                "customer_email": "valid-numeric@example.com",
                "customer_phone": "555-222-3333",
                "project_address_line1": "201 Numeric St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "accomplishment_text": "Need a project plan with valid numeric fields.",
                "ai_project_timeline_days": "14",
                "ai_project_budget": "2500.00",
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200)
        intake = ProjectIntake.objects.get(share_token=token)
        self.assertEqual(intake.ai_project_timeline_days, 14)
        self.assertEqual(intake.ai_project_budget, Decimal("2500.00"))

    def test_public_intake_rejects_invalid_optional_numeric_fields(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Invalid Numeric Prospect",
                "customer_email": "invalid-numeric@example.com",
                "customer_phone": "555-333-4444",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        patch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "customer_name": "Invalid Numeric Prospect",
                "customer_email": "invalid-numeric@example.com",
                "customer_phone": "555-333-4444",
                "project_address_line1": "202 Invalid St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "accomplishment_text": "Need a project plan with invalid numeric fields.",
                "ai_project_timeline_days": "abc",
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 400)
        self.assertIn("ai_project_timeline_days", patch_response.json())

    def test_public_intake_improve_description_uses_ai_when_available(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Refine AI Prospect",
                "customer_email": "refine-ai@example.com",
                "customer_phone": "555-444-5555",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        with patch(
            "projects.views.public_intake.generate_or_improve_description",
            return_value={"description": "Clearer project description.", "_mode": "improve", "_model": "test-model"},
        ):
            response = self.client.post(
                f"/api/projects/public-intake/improve-description/?token={token}",
                {"current_description": "Need a clearer project plan."},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["description"], "Clearer project description.")
        self.assertEqual(payload["source"], "ai")

    def test_public_intake_improve_description_falls_back_without_ai(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Refine Fallback Prospect",
                "customer_email": "refine-fallback@example.com",
                "customer_phone": "555-666-7777",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        with patch(
            "projects.views.public_intake.generate_or_improve_description",
            side_effect=RuntimeError("OpenAI unavailable"),
        ):
            response = self.client.post(
                f"/api/projects/public-intake/improve-description/?token={token}",
                {"current_description": "need to replace kitchen cabinets"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["description"], "Replace kitchen cabinets.")
        self.assertEqual(payload["source"], "fallback")

    def test_landing_and_public_profile_intakes_appear_in_same_contractor_lead_flow(self):
        self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/intake/",
            {
                "source": "public_profile",
                "full_name": "Profile Prospect",
                "email": "profile@example.com",
                "phone": "555-000-1111",
                "project_type": "Kitchen Remodel",
                "project_description": "Profile intake request.",
            },
            format="json",
        )

        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Landing Flow Prospect",
                "customer_email": "landing-flow@example.com",
            },
            format="json",
        )
        token = start_response.json()["token"]
        self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "customer_name": "Landing Flow Prospect",
                "customer_email": "landing-flow@example.com",
                "project_address_line1": "88 Market St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78702",
                "accomplishment_text": "Landing flow project request.",
            },
            format="json",
        )

        self.client.force_authenticate(user=self.contractor_user)
        lead_list_response = self.client.get("/api/projects/contractor/public-leads/")
        self.assertEqual(lead_list_response.status_code, 200)
        rows = lead_list_response.json()["results"]
        sources = {row["email"]: row["source"] for row in rows}
        self.assertEqual(sources["profile@example.com"], PublicContractorLead.SOURCE_PUBLIC_PROFILE)
        self.assertEqual(sources["landing-flow@example.com"], PublicContractorLead.SOURCE_LANDING_PAGE)

    def test_accepted_landing_page_lead_can_follow_same_customer_and_agreement_flow(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Pipeline Prospect",
                "customer_email": "pipeline@example.com",
            },
            format="json",
        )
        token = start_response.json()["token"]
        self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "customer_name": "Pipeline Prospect",
                "customer_email": "pipeline@example.com",
                "project_address_line1": "99 Unified Ave",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78703",
                "accomplishment_text": "Need a unified intake agreement flow.",
            },
            format="json",
        )

        lead = PublicContractorLead.objects.get(email="pipeline@example.com")
        self.client.force_authenticate(user=self.contractor_user)
        accept_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)

        analyze_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/analyze/",
            {},
            format="json",
        )
        self.assertEqual(analyze_response.status_code, 200)

        create_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/create-agreement/",
            {},
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        lead.refresh_from_db()
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_LANDING_PAGE)
        self.assertIsNotNone(lead.converted_homeowner_id)
        self.assertIsNotNone(lead.converted_agreement_id)

    def test_landing_page_intake_branching_creates_linked_invites_without_duplicate_intake_records(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "source": "landing_page",
                "customer_name": "Branch Prospect",
                "customer_email": "branch@example.com",
                "customer_phone": "555-111-2222",
            },
            format="json",
        )
        self.assertEqual(start_response.status_code, 201)
        token = start_response.json()["token"]

        patch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "project_class": "commercial",
                "customer_name": "Branch Prospect",
                "customer_email": "branch@example.com",
                "customer_phone": "555-111-2222",
                "project_address_line1": "500 Bid Lane",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78701",
                "accomplishment_text": "Need a bid-ready commercial scope.",
            },
            format="json",
        )
        self.assertEqual(patch_response.status_code, 200)

        branch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "branch_flow": "multi_contractor",
                "contractors": [
                    {"name": "Alpha Build", "email": "alpha@example.com", "phone": "555-101-0001"},
                    {"name": "Beta Contracting", "email": "beta@example.com", "phone": "555-202-0002"},
                ],
            },
            format="json",
        )
        self.assertEqual(branch_response.status_code, 200)
        self.assertEqual(branch_response.json()["post_submit_flow"], "multi_contractor")
        self.assertEqual(len(branch_response.json()["branch_invites"]), 2)
        self.assertEqual(ProjectIntake.objects.filter(share_token=token).count(), 1)
        intake = ProjectIntake.objects.get(share_token=token)
        self.assertEqual(intake.project_class, "commercial")
        self.assertEqual(intake.post_submit_flow, "multi_contractor")
        self.assertEqual(ContractorInvite.objects.filter(source_intake=intake).count(), 2)

    def test_single_contractor_branch_claims_same_intake_for_contractor_workspace(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "source": "landing_page",
                "customer_name": "Single Branch Prospect",
                "customer_email": "single@example.com",
                "customer_phone": "555-333-4444",
            },
            format="json",
        )
        token = start_response.json()["token"]

        patch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "project_class": "residential",
                "customer_name": "Single Branch Prospect",
                "customer_email": "single@example.com",
                "customer_phone": "555-333-4444",
                "project_address_line1": "100 Direct Invite St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78702",
                "accomplishment_text": "Need a single-contractor direct invite.",
            },
            format="json",
        )
        self.assertEqual(patch_response.status_code, 200)
        branch_response = self.client.patch(
            f"/api/projects/public-intake/?token={token}",
            {
                "branch_flow": "single_contractor",
                "contractor_name": "Prime Builder",
                "contractor_email": "prime@example.com",
                "contractor_phone": "555-303-0003",
            },
            format="json",
        )
        self.assertEqual(branch_response.status_code, 200)
        intake = ProjectIntake.objects.get(share_token=token)
        invite = ContractorInvite.objects.get(source_intake=intake)
        self.assertEqual(invite.contractor_email, "prime@example.com")

        contractor_user = get_user_model().objects.create_user(
            email="prime@example.com",
            password="testpass123",
        )
        contractor = Contractor.objects.create(
            user=contractor_user,
            business_name="Prime Builder",
        )
        claim_client = APIClient()
        claim_client.force_authenticate(user=contractor_user)

        accept_response = claim_client.post(
            f"/api/projects/invites/{invite.token}/accept/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)
        intake.refresh_from_db()
        self.assertEqual(intake.contractor_id, contractor.id)
        self.assertEqual(accept_response.json()["source_intake_id"], intake.id)

        bids_response = claim_client.get("/api/projects/contractor/bids/")
        self.assertEqual(bids_response.status_code, 200)
        rows = bids_response.json()["results"]
        self.assertTrue(any(row["source_kind"] == "intake" and row["source_id"] == intake.id for row in rows))

    def test_structured_public_intake_fields_feed_agreement_conversion(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="analyzed",
            customer_name="Structure Prospect",
            customer_email="structure@example.com",
            customer_phone="555-444-0000",
            project_address_line1="123 Structure St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            accomplishment_text="Need a structured kitchen remodel.",
            ai_project_title="Kitchen Remodel",
            ai_project_type="Remodel",
            ai_project_subtype="Kitchen Remodel",
            ai_description="Structured kitchen remodel scope.",
            ai_project_timeline_days=21,
            ai_project_budget=Decimal("25000.00"),
            measurement_handling="site_visit_required",
            ai_clarification_questions=[
                {"key": "measurement_handling", "label": "How should measurements be handled before work starts?"},
            ],
            ai_clarification_answers={
                "measurement_handling": "site_visit_required",
                "materials_responsibility": "Contractor",
            },
            ai_milestones=[
                {"title": "Preparation", "description": "Prepare the kitchen for work."},
                {"title": "Build", "description": "Complete the remodel work."},
            ],
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/intakes/{intake.id}/convert-to-agreement/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        agreement = Agreement.objects.get(pk=response.json()["agreement_id"])
        self.assertEqual(agreement.total_cost, Decimal("25000.00"))
        self.assertEqual(agreement.total_time_estimate, timedelta(days=21))
        self.assertTrue(hasattr(agreement, "ai_scope"))
        self.assertEqual(agreement.ai_scope.answers.get("measurement_handling"), "site_visit_required")
        self.assertEqual(agreement.ai_scope.answers.get("materials_responsibility"), "Contractor")
        intake.refresh_from_db()
        self.assertEqual(intake.agreement_id, agreement.id)

    def test_public_intake_analysis_returns_clarification_questions_and_answers(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Clarify Prospect",
            accomplishment_text="Need help with my bathroom.",
            ai_clarification_answers={
                "scope_kind": "Full remodel",
                "area_count": "One bathroom",
                "layout_changes": "Some changes",
                "materials_ready": "Already selected",
            },
        )

        result = analyze_project_intake(intake=intake)
        keys = {row.get("key") for row in result.get("clarification_questions", [])}
        self.assertTrue({"scope_kind", "area_count", "layout_changes", "materials_ready"}.issubset(keys))
        self.assertLessEqual(len(keys), 4)
        self.assertNotIn("measurement_handling", keys)
        self.assertEqual(result.get("project_type"), "Remodel")
        self.assertEqual(result.get("project_subtype"), "Bathroom Remodel")
        self.assertIn("Bathroom remodel request", result.get("description", ""))
        self.assertIn("one bathroom", result.get("description", "").lower())
        self.assertIn("Layout changes are planned", result.get("description", ""))
        self.assertIn("Layout changes", " ".join(result.get("clarification_assumptions", [])))

    def test_public_intake_analysis_builds_kitchen_install_summary_from_answers(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Kitchen Install Prospect",
            accomplishment_text="Need kitchen cabinets installed.",
            ai_clarification_answers={
                "scope_kind": "New cabinets only",
                "demo_removal": "Remove old cabinets too",
                "materials_ready": "Already on site",
                "related_work": "Yes, backsplash also included",
            },
        )

        result = analyze_project_intake(intake=intake)
        self.assertEqual(result.get("project_type"), "Installation")
        self.assertEqual(result.get("project_subtype"), "Kitchen Cabinet Installation")
        self.assertEqual(result.get("project_family_key"), "kitchen_remodel")
        self.assertIn("Kitchen cabinet installation request", result.get("description", ""))
        self.assertIn("removal of existing cabinets", result.get("description", ""))
        self.assertIn("installation of new cabinets already on site", result.get("description", ""))
        self.assertIn("related backsplash work", result.get("description", ""))
        self.assertEqual(result.get("recommended_setup", {}).get("recommended_project_type"), "Kitchen Cabinet Installation")
        self.assertEqual(result.get("recommended_setup", {}).get("suggested_workflow"), "Install + removal")
        self.assertEqual(result.get("recommended_setup", {}).get("recommended_template_name"), "Kitchen Cabinet Install Template")

    def test_public_intake_analysis_builds_roof_repair_summary_from_answers(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Roof Repair Prospect",
            accomplishment_text="Need roof work.",
            ai_clarification_answers={
                "scope_kind": "Repair",
                "area_count": "one section",
                "damage_urgency": "No known interior damage yet",
                "inspection_before_pricing": "Yes",
            },
        )

        result = analyze_project_intake(intake=intake)
        self.assertEqual(result.get("project_type"), "Repair")
        self.assertEqual(result.get("project_subtype"), "Roof Repair")
        self.assertEqual(result.get("project_family_key"), "roofing")
        self.assertIn("Roof repair request", result.get("description", ""))
        self.assertIn("one section", result.get("description", "").lower())
        self.assertIn("no interior water damage reported yet", result.get("description", "").lower())
        self.assertIn("Contractor inspection requested before final pricing", result.get("description", ""))
        self.assertEqual(result.get("recommended_setup", {}).get("recommended_project_type"), "Roof Repair")
        self.assertEqual(result.get("recommended_setup", {}).get("suggested_workflow"), "Repair + inspection")
        self.assertEqual(result.get("recommended_setup", {}).get("recommended_template_name"), "Roof Repair Template")

    def test_public_intake_sync_carries_structured_analysis_into_public_lead(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Sync Prospect",
            accomplishment_text="Need kitchen cabinets installed.",
            ai_project_type="Installation",
            ai_project_subtype="Kitchen Cabinet Installation",
            ai_description="Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            ai_analysis_payload={
                "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
                "project_family_key": "kitchen_remodel",
                "project_family_label": "Kitchen remodel-focused review",
                "suggested_description": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            },
        )

        lead = sync_public_lead_from_project_intake(intake)
        self.assertIsNotNone(lead)
        lead.refresh_from_db()
        self.assertEqual(lead.ai_analysis.get("project_scope_summary"), "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.")
        self.assertEqual(lead.ai_analysis.get("project_family_key"), "kitchen_remodel")
        self.assertEqual(lead.ai_analysis.get("project_family_label"), "Kitchen remodel-focused review")

    def test_public_intake_analysis_skips_questions_for_already_clear_description(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Clear Prospect",
            accomplishment_text=(
                "Replace the existing kitchen cabinets with shaker cabinets, install quartz countertops, keep the current "
                "layout, and the cabinets are already on site."
            ),
        )

        result = analyze_project_intake(intake=intake)
        questions = result.get("clarification_questions", [])
        self.assertEqual(questions, [])

    def test_public_intake_analysis_uses_generic_fallback_for_vague_requests(self):
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Generic Prospect",
            accomplishment_text="Need help with my project.",
        )

        result = analyze_project_intake(intake=intake)
        questions = result.get("clarification_questions", [])
        keys = [row.get("key") for row in questions]
        self.assertGreaterEqual(len(questions), 2)
        self.assertLessEqual(len(questions), 4)
        self.assertIn("scope_kind", keys)
        self.assertIn("inspection_before_pricing", keys)
        self.assertEqual(result.get("project_type"), "Repair")
        self.assertEqual(result.get("project_subtype"), "General Repair")
        self.assertIn("General repair request", result.get("description", ""))
        self.assertEqual(result.get("recommended_setup", {}).get("recommended_project_type"), "General Repair")
        self.assertEqual(result.get("recommended_setup", {}).get("suggested_workflow"), "General repair workflow")

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_public_intake_photo_upload_creates_photo(self):
        start_response = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "contractor_slug": self.profile.slug,
                "source": "landing_page",
                "customer_name": "Photo Prospect",
                "customer_email": "photo@example.com",
            },
            format="json",
        )
        token = start_response.json()["token"]

        upload = self.client.post(
            f"/api/projects/public-intake/photos/?token={token}",
            {
                "photo": SimpleUploadedFile(
                    "clarification.png",
                    base64.b64decode(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXGkAAAAASUVORK5CYII="
                    ),
                    content_type="image/png",
                ),
                "caption": "Reference photo",
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 201)
        intake = ProjectIntake.objects.get(share_token=token)
        self.assertEqual(intake.clarification_photos.count(), 1)
        photo = intake.clarification_photos.first()
        self.assertEqual(photo.caption, "Reference photo")
        self.assertTrue(photo.image.name)

    @patch("projects.services.intake_public.send_postmark_template_email", return_value=None)
    def test_contractor_sent_intake_completes_into_unified_ready_for_review_lead(self, _send_email):
        self.client.force_authenticate(user=self.contractor_user)
        create_response = self.client.post(
            "/api/projects/intakes/",
            {
                "customer_name": "Pat Customer",
                "customer_email": "pat@example.com",
                "customer_phone": "555-222-3333",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        intake_id = create_response.json()["id"]

        send_response = self.client.post(
            f"/api/projects/intakes/{intake_id}/send-to-homeowner/",
            {},
            format="json",
        )
        self.assertEqual(send_response.status_code, 200)
        intake = ProjectIntake.objects.get(pk=intake_id)
        lead = PublicContractorLead.objects.get(pk=send_response.json()["lead_id"])
        self.assertEqual(intake.lead_source, PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM)
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM)
        self.assertEqual(lead.status, PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE)

        self.client.force_authenticate(user=None)
        complete_response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {
                "customer_name": "Pat Customer",
                "customer_email": "pat@example.com",
                "customer_phone": "555-222-3333",
                "project_address_line1": "200 Builder Ave",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78704",
                "accomplishment_text": "Need a contractor-sent intake completed for a kitchen remodel.",
            },
            format="json",
        )
        self.assertEqual(complete_response.status_code, 200)

        lead.refresh_from_db()
        self.assertEqual(complete_response.json()["lead_id"], lead.id)
        self.assertEqual(lead.status, PublicContractorLead.STATUS_READY_FOR_REVIEW)
        self.assertEqual(lead.project_address, "200 Builder Ave")
        self.assertEqual(
            lead.project_description,
            "Need a contractor-sent intake completed for a kitchen remodel.",
        )

        self.client.force_authenticate(user=self.contractor_user)
        lead_list_response = self.client.get("/api/projects/contractor/public-leads/")
        self.assertEqual(lead_list_response.status_code, 200)
        rows = lead_list_response.json()["results"]
        matching = next((row for row in rows if row["id"] == lead.id), None)
        self.assertIsNotNone(matching)
        self.assertEqual(matching["source"], PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM)
        self.assertEqual(matching["status"], PublicContractorLead.STATUS_READY_FOR_REVIEW)

    @patch("projects.services.intake_public.send_postmark_template_email", return_value=None)
    def test_contractor_sent_ready_for_review_lead_can_analyze_and_create_agreement_without_accept(self, _send_email):
        self.client.force_authenticate(user=self.contractor_user)
        create_response = self.client.post(
            "/api/projects/intakes/",
            {
                "customer_name": "Riley Customer",
                "customer_email": "riley@example.com",
                "customer_phone": "555-888-9999",
            },
            format="json",
        )
        intake_id = create_response.json()["id"]
        self.client.post(
            f"/api/projects/intakes/{intake_id}/send-to-homeowner/",
            {},
            format="json",
        )
        intake = ProjectIntake.objects.get(pk=intake_id)

        self.client.force_authenticate(user=None)
        self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {
                "customer_name": "Riley Customer",
                "customer_email": "riley@example.com",
                "project_address_line1": "300 Scope St",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78705",
                "accomplishment_text": "Complete a bathroom remodel with updated tile and fixtures.",
            },
            format="json",
        )

        lead = PublicContractorLead.objects.get(email="riley@example.com")
        self.assertEqual(lead.status, PublicContractorLead.STATUS_READY_FOR_REVIEW)

        self.client.force_authenticate(user=self.contractor_user)
        accept_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 400)

        analyze_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/analyze/",
            {},
            format="json",
        )
        self.assertEqual(analyze_response.status_code, 200)

        create_agreement_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/create-agreement/",
            {},
            format="json",
        )
        self.assertEqual(create_agreement_response.status_code, 201)
        lead.refresh_from_db()
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM)
        self.assertIsNotNone(lead.converted_homeowner_id)
        self.assertIsNotNone(lead.converted_agreement_id)

    @patch("projects.services.intake_public.send_postmark_template_email", return_value=None)
    def test_contractor_can_quick_add_manual_lead_and_enrich_same_lead_from_sent_intake(self, _send_email):
        self.client.force_authenticate(user=self.contractor_user)
        create_response = self.client.post(
            "/api/projects/contractor/public-leads/",
            {
                "full_name": "Walk Up Prospect",
                "email": "walkup@example.com",
                "phone": "555-666-0000",
                "project_address": "400 Field Visit Rd",
                "notes": "Met on site and discussed a garage conversion.",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        lead_id = create_response.json()["id"]

        lead = PublicContractorLead.objects.get(pk=lead_id)
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_MANUAL)
        self.assertEqual(lead.status, PublicContractorLead.STATUS_QUALIFIED)
        self.assertEqual(lead.project_description, "Met on site and discussed a garage conversion.")

        send_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/send-intake/",
            {},
            format="json",
        )
        self.assertEqual(send_response.status_code, 200)
        lead.refresh_from_db()
        intake = ProjectIntake.objects.get(pk=send_response.json()["intake_id"])
        self.assertEqual(intake.public_lead_id, lead.id)
        self.assertEqual(intake.lead_source, PublicContractorLead.SOURCE_MANUAL)
        self.assertEqual(lead.status, PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE)

        self.client.force_authenticate(user=None)
        complete_response = self.client.patch(
            f"/api/projects/public-intake/?token={intake.share_token}",
            {
                "customer_name": "Walk Up Prospect",
                "customer_email": "walkup@example.com",
                "customer_phone": "555-666-0000",
                "project_address_line1": "400 Field Visit Rd",
                "project_city": "Austin",
                "project_state": "TX",
                "project_postal_code": "78706",
                "accomplishment_text": "Convert the garage into a finished office and laundry room.",
            },
            format="json",
        )
        self.assertEqual(complete_response.status_code, 200)
        self.assertEqual(complete_response.json()["lead_id"], lead.id)

        lead.refresh_from_db()
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_MANUAL)
        self.assertEqual(lead.status, PublicContractorLead.STATUS_READY_FOR_REVIEW)
        self.assertEqual(
            lead.project_description,
            "Convert the garage into a finished office and laundry room.",
        )

    def test_public_review_submission_creates_non_public_unverified_review(self):
        response = self.client.post(
            f"/api/projects/public/contractors/{self.profile.slug}/reviews/",
            {
                "customer_name": "Jordan Client",
                "rating": 4,
                "title": "Solid communication",
                "review_text": "Project stayed on track.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        review = ContractorReview.objects.get(customer_name="Jordan Client")
        self.assertEqual(review.contractor_id, self.contractor.id)
        self.assertEqual(review.public_profile_id, self.profile.id)
        self.assertFalse(review.is_public)
        self.assertFalse(review.is_verified)

    def test_contractor_can_only_moderate_own_reviews(self):
        other_review = ContractorReview.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            customer_name="Other Review",
            rating=5,
            is_public=False,
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.patch(
            f"/api/projects/contractor/reviews/{other_review.id}/",
            {"is_public": True},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_contractor_can_update_lead_status_and_convert_to_homeowner(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Lead Convert",
            email="lead-convert@example.com",
            phone="555-000-1111",
            project_address="123 Lead St",
            city="Austin",
            state="TX",
            zip_code="78701",
        )
        self.client.force_authenticate(user=self.contractor_user)

        patch_response = self.client.patch(
            f"/api/projects/contractor/public-leads/{lead.id}/",
            {"status": "closed", "internal_notes": "Closed after estimate."},
            format="json",
        )
        self.assertEqual(patch_response.status_code, 200)
        lead.refresh_from_db()
        self.assertEqual(lead.status, PublicContractorLead.STATUS_CLOSED)

        convert_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/convert-homeowner/",
            {},
            format="json",
        )
        self.assertEqual(convert_response.status_code, 200)
        lead.refresh_from_db()
        self.assertIsNotNone(lead.converted_homeowner_id)
        self.assertEqual(lead.converted_homeowner.email, "lead-convert@example.com")

    def test_accept_lead_creates_or_reuses_homeowner(self):
        existing_homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Existing Customer",
            email="accepted@example.com",
        )
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Accepted Lead",
            email="accepted@example.com",
            phone="555-111-0000",
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        lead.refresh_from_db()
        self.assertEqual(lead.status, PublicContractorLead.STATUS_ACCEPTED)
        self.assertEqual(lead.converted_homeowner_id, existing_homeowner.id)
        self.assertIsNotNone(lead.accepted_at)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_accept_sends_email_when_customer_email_exists(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Email Accept Lead",
            email="accept-notify@example.com",
            project_type="Kitchen Remodel",
            project_description="Need a kitchen remodel estimate.",
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        lead.refresh_from_db()
        self.assertIsNotNone(lead.accepted_email_sent_at)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("accepted your MyHomeBro project request", mail.outbox[0].subject)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_reject_sends_email_when_customer_email_exists(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Email Reject Lead",
            email="reject-notify@example.com",
            project_type="Deck Build",
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/reject/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        lead.refresh_from_db()
        self.assertEqual(lead.status, PublicContractorLead.STATUS_REJECTED)
        self.assertIsNotNone(lead.rejected_email_sent_at)
        self.assertIsNotNone(lead.rejected_at)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("unable to take on your MyHomeBro request", mail.outbox[0].subject)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_no_notification_send_occurs_when_email_missing(self):
        rejectable_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="No Email Reject Lead",
            email="",
        )
        self.client.force_authenticate(user=self.contractor_user)
        reject_response = self.client.post(
            f"/api/projects/contractor/public-leads/{rejectable_lead.id}/reject/",
            {},
            format="json",
        )
        self.assertEqual(reject_response.status_code, 200)
        rejectable_lead.refresh_from_db()
        self.assertIsNone(rejectable_lead.rejected_email_sent_at)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_duplicate_notification_sends_are_prevented(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Duplicate Notify Lead",
            email="duplicate@example.com",
        )
        self.client.force_authenticate(user=self.contractor_user)
        first = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        second = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

        reject_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Duplicate Reject Lead",
            email="duplicate-reject@example.com",
        )
        self.client.post(
            f"/api/projects/contractor/public-leads/{reject_lead.id}/reject/",
            {},
            format="json",
        )
        self.client.post(
            f"/api/projects/contractor/public-leads/{reject_lead.id}/reject/",
            {},
            format="json",
        )
        self.assertEqual(len(mail.outbox), 2)

    def test_analyze_accepted_lead_requires_ownership_and_acceptance(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Analyze Lead",
            email="analyze@example.com",
            project_type="Kitchen Remodel",
            project_description="Remodel kitchen with new cabinets and counters.",
            status=PublicContractorLead.STATUS_ACCEPTED,
        )
        self.client.force_authenticate(user=self.contractor_user)
        ok_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/analyze/",
            {},
            format="json",
        )
        self.assertEqual(ok_response.status_code, 200)
        lead.refresh_from_db()
        self.assertIn("suggested_title", lead.ai_analysis)
        self.assertIn("recommended_templates", lead.ai_analysis)

        other_lead = PublicContractorLead.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            full_name="Other Analyze Lead",
            email="other-analyze@example.com",
            status=PublicContractorLead.STATUS_ACCEPTED,
        )
        forbidden_response = self.client.post(
            f"/api/projects/contractor/public-leads/{other_lead.id}/analyze/",
            {},
            format="json",
        )
        self.assertEqual(forbidden_response.status_code, 404)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_contractor_cannot_trigger_notifications_for_another_contractors_lead(self):
        other_lead = PublicContractorLead.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            full_name="Other Notify Lead",
            email="other-notify@example.com",
        )
        self.client.force_authenticate(user=self.contractor_user)
        accept_response = self.client.post(
            f"/api/projects/contractor/public-leads/{other_lead.id}/accept/",
            {},
            format="json",
        )
        reject_response = self.client.post(
            f"/api/projects/contractor/public-leads/{other_lead.id}/reject/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 404)
        self.assertEqual(reject_response.status_code, 404)
        self.assertEqual(len(mail.outbox), 0)

    def test_create_agreement_from_accepted_lead_prefills_safe_fields(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Agreement Lead",
            email="agreement-lead@example.com",
            project_address="789 Builder Ln",
            city="Austin",
            state="TX",
            zip_code="78702",
            project_type="Kitchen Remodel",
            project_description="Full kitchen remodel with island and cabinets.",
            status=PublicContractorLead.STATUS_ACCEPTED,
            ai_analysis={
                "project_type": "Remodel",
                "project_subtype": "Kitchen Remodel",
                "suggested_title": "Kitchen Remodel - Builder Ln",
                "suggested_description": "Draft kitchen remodel agreement from intake.",
                "template_id": None,
            },
        )
        self.client.force_authenticate(user=self.contractor_user)
        accept_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/accept/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)

        create_response = self.client.post(
            f"/api/projects/contractor/public-leads/{lead.id}/create-agreement/",
            {},
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        lead.refresh_from_db()
        agreement = lead.converted_agreement
        self.assertIsNotNone(agreement)
        self.assertEqual(agreement.homeowner_id, lead.converted_homeowner_id)
        self.assertEqual(agreement.source_lead_id, lead.id)
        self.assertEqual(agreement.project.title, "Kitchen Remodel - Builder Ln")
        self.assertEqual(agreement.project.project_city, "Austin")
        self.assertEqual(agreement.project_address_line1, "789 Builder Ln")
        self.assertEqual(agreement.project_type, "Remodel")
        self.assertEqual(agreement.project_subtype, "Kitchen Remodel")

    def test_contractor_cannot_update_another_contractors_lead(self):
        other_lead = PublicContractorLead.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            full_name="Other Lead",
            email="otherlead@example.com",
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.patch(
            f"/api/projects/contractor/public-leads/{other_lead.id}/",
            {"status": "contacted"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_contractor_cannot_edit_another_contractors_gallery_item(self):
        other_item = ContractorGalleryItem.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            title="Other Item",
            image=SimpleUploadedFile("other.jpg", b"filecontent", content_type="image/jpeg"),
            is_public=True,
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.patch(
            f"/api/projects/contractor/gallery/{other_item.id}/",
            {"title": "Hacked"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_public_profile_payload_does_not_expose_private_lead_fields(self):
        PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Private Lead",
            email="private@example.com",
            internal_notes="Do not show publicly.",
        )
        response = self.client.get(f"/api/projects/public/contractors/{self.profile.slug}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotIn("internal_notes", payload)
        self.assertNotIn("email", payload)

    def test_public_profile_payload_includes_contractor_profile_insights(self):
        for idx in range(5):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Public Profile",
                total_project_value=Decimal("12000.00") + Decimal(str(idx * 250)),
                actual_duration_days=6 + (idx % 2),
                milestone_count=4,
            )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])

        response = self.client.get(f"/api/projects/public/contractors/{self.profile.slug}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("contractor_profile_insights", payload)
        self.assertGreaterEqual(len(payload["contractor_profile_insights"]), 3)


class ContractorBidsWorkspaceTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="bids-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Bids Owner",
        )
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Bids Owner",
            allow_public_intake=True,
            allow_public_reviews=True,
        )

        self.other_user = user_model.objects.create_user(
            email="bids-other@example.com",
            password="testpass123",
        )
        self.other_plain_user = user_model.objects.create_user(
            email="plain-bids-other@example.com",
            password="testpass123",
        )

        self.draft_intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="contractor",
            status="draft",
            lead_source="manual",
            share_token="bids-draft-token",
            customer_name="Draft Customer",
            customer_email="draft@example.com",
            accomplishment_text="Replace attic insulation",
        )

        self.commercial_under_review = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            initiated_by="contractor",
            status="analyzed",
            lead_source="manual",
            share_token="bids-commercial-under-review-token",
            customer_name="Commercial Customer",
            customer_email="commercial@example.com",
            accomplishment_text="Tenant buildout for a retail storefront",
            ai_project_type="Commercial",
            ai_project_subtype="Tenant Improvement",
            ai_project_title="Retail Storefront Buildout",
            ai_description="Commercial tenant improvement with multiple phases.",
            ai_project_timeline_days=30,
            ai_project_budget=Decimal("27500.00"),
            measurement_handling="site_visit_required",
            ai_clarification_questions=[
                {"key": "materials", "label": "Materials", "question": "Who supplies the materials?"},
                {"key": "start_timing", "label": "Timing", "question": "When should the work start?"},
            ],
            ai_clarification_answers={
                "materials": "Customer",
                "start_timing": "Next month",
            },
            ai_milestones=[
                {"title": "Demo Phase"},
                {"title": "Buildout Phase"},
            ],
            ai_analysis_payload={
                "milestones": [
                    {"title": "Demo Phase"},
                    {"title": "Buildout Phase"},
                ],
                "estimate_preview": {"suggested_total_price": "27500.00"},
                "project_scope_summary": "Commercial tenant improvement with multiple phases.",
                "project_family_key": "commercial",
                "project_family_label": "Commercial / Tenant Improvement",
            },
        )
        ProjectIntakeClarificationPhoto.objects.create(
            project_intake=self.commercial_under_review,
            image=SimpleUploadedFile("photo.jpg", b"filecontent", content_type="image/jpeg"),
            original_name="front-room.jpg",
            caption="Front room view",
        )

        self.new_public_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="New Lead Customer",
            email="newlead@example.com",
            project_type="Bathroom Remodel",
            project_description="Replace shower tile and vanity.",
            city="Austin",
            state="TX",
            status=PublicContractorLead.STATUS_NEW,
            accepted_at=None,
        )
        self.new_public_intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            public_lead=self.new_public_lead,
            initiated_by="homeowner",
            status="submitted",
            lead_source="landing_page",
            share_token="bids-new-public-token",
            customer_name="New Lead Customer",
            customer_email="newlead@example.com",
            project_city="Austin",
            project_state="TX",
            accomplishment_text="Replace shower tile and vanity.",
            ai_project_title="Bathroom Remodel",
            ai_project_type="Bathroom Remodel",
            ai_project_subtype="Primary Bath",
            ai_description="Replace shower tile and vanity.",
            ai_project_timeline_days=21,
            ai_project_budget=Decimal("18500.00"),
            measurement_handling="provided",
            post_submit_flow="multi_contractor",
            ai_clarification_questions=[
                {"key": "materials", "label": "Materials", "question": "Who will supply the materials?"},
                {"key": "layout", "label": "Layout", "question": "Any layout changes?"},
            ],
            ai_clarification_answers={
                "materials": "Contractor",
                "layout": "No layout changes",
            },
            ai_milestones=[
                {"title": "Demolition"},
                {"title": "Tile and Fixtures"},
            ],
            ai_analysis_payload={
                "milestones": [
                    {"title": "Demolition"},
                    {"title": "Tile and Fixtures"},
                ],
                "estimate_preview": {"suggested_total_price": "18500.00"},
                "suggested_title": "Bathroom Remodel",
                "suggested_description": "Replace shower tile and vanity.",
                "project_scope_summary": "Bathroom remodel request for the primary bath with shower tile and vanity replacement.",
                "project_family_key": "bathroom_remodel",
                "project_family_label": "Bathroom remodel-focused review",
            },
        )
        ProjectIntakeClarificationPhoto.objects.create(
            project_intake=self.new_public_intake,
            image=SimpleUploadedFile("bathroom.jpg", b"filecontent", content_type="image/jpeg"),
            original_name="bathroom.jpg",
            caption="Shower area",
        )

        self.residential_awarded_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Awarded Lead",
            email="award@example.com",
            project_type="Kitchen Remodel",
            project_description="Need a kitchen remodel.",
            budget_text="$12,000.00",
            status=PublicContractorLead.STATUS_ACCEPTED,
            accepted_at=timezone.now() - timezone.timedelta(days=2),
        )

        self.commercial_declined_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Declined Lead",
            email="declined@example.com",
            project_type="Commercial",
            project_description="Office suite renovation.",
            status=PublicContractorLead.STATUS_REJECTED,
            rejected_at=timezone.now() - timezone.timedelta(days=1),
        )

        self.commercial_not_selected_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Not Selected Lead",
            email="notselected@example.com",
            project_type="Commercial",
            project_description="Warehouse office buildout.",
            status=PublicContractorLead.STATUS_CLOSED,
            converted_at=timezone.now() - timezone.timedelta(hours=12),
        )

        self.linked_commercial_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Linked Commercial Lead",
            email="linked@example.com",
            project_type="Tenant Buildout",
            project_description="Retail storefront buildout.",
            status=PublicContractorLead.STATUS_ACCEPTED,
            accepted_at=timezone.now() - timezone.timedelta(days=3),
        )
        self.linked_commercial_intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            public_lead=self.linked_commercial_lead,
            initiated_by="contractor",
            status="submitted",
            lead_source="contractor_sent_form",
            share_token="bids-linked-commercial-token",
            customer_name="Linked Commercial Lead",
            customer_email="linked@example.com",
            accomplishment_text="Retail storefront tenant improvement.",
            ai_project_type="Commercial",
            ai_project_subtype="Retail Buildout",
            ai_description="Commercial retail buildout.",
        )
        self.linked_agreement = convert_intake_to_agreement(intake=self.linked_commercial_intake)
        self.linked_agreement.total_cost = Decimal("48000.00")
        self.linked_agreement.save(update_fields=["total_cost"])

        self.client = APIClient()

    def test_contractor_sees_only_own_unified_bids_and_actions(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/contractor/bids/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        rows = payload["results"]

        self.assertEqual(len(rows), 7)
        summary = payload["summary"]
        self.assertEqual(summary["open_bids"], 2)
        self.assertEqual(summary["under_review_bids"], 1)
        self.assertEqual(summary["awarded_bids"], 2)
        self.assertEqual(summary["declined_expired_bids"], 2)
        self.assertEqual(summary["residential_count"], 3)
        self.assertEqual(summary["commercial_count"], 4)

        new_public_lead = next(
            row
            for row in rows
            if row["source_kind"] == "lead" and row["source_id"] == self.new_public_lead.id
        )
        residential_awarded = next(
            row
            for row in rows
            if row["source_kind"] == "lead" and row["source_id"] == self.residential_awarded_lead.id
        )
        commercial_under_review = next(
            row
            for row in rows
            if row["source_kind"] == "intake" and row["source_id"] == self.commercial_under_review.id
        )
        linked_awarded = next(
            row
            for row in rows
            if row["source_kind"] == "lead" and row["source_id"] == self.linked_commercial_lead.id
        )
        not_selected = next(
            row
            for row in rows
            if row["source_kind"] == "lead" and row["source_id"] == self.commercial_not_selected_lead.id
        )

        self.assertEqual(new_public_lead["workspace_stage"], "new_lead")
        self.assertEqual(new_public_lead["workspace_stage_label"], "New Lead")
        self.assertEqual(new_public_lead["request_path_label"], "Multi-quote request")
        self.assertEqual(new_public_lead["location"], "Austin, TX")
        self.assertEqual(new_public_lead["request_snapshot"]["photo_count"], 1)
        self.assertEqual(new_public_lead["request_snapshot"]["clarification_count"], 2)
        self.assertEqual(new_public_lead["request_snapshot"]["project_scope_summary"], "Bathroom remodel request for the primary bath with shower tile and vanity replacement.")
        self.assertEqual(new_public_lead["request_snapshot"]["project_family_label"], "Bathroom remodel-focused review")
        self.assertIn("Guided Intake", new_public_lead["request_signals"])
        self.assertIn("Photos", new_public_lead["request_signals"])
        self.assertIn("Multi-Quote Request", new_public_lead["request_signals"])

        self.assertEqual(residential_awarded["status"], "awarded")
        self.assertEqual(residential_awarded["next_action"]["key"], "convert_to_agreement")
        self.assertEqual(residential_awarded["project_class"], "residential")
        self.assertEqual(residential_awarded["bid_amount_label"], "$12,000.00")
        self.assertEqual(residential_awarded["workspace_stage"], "active_bid")

        self.assertEqual(commercial_under_review["status"], "under_review")
        self.assertEqual(commercial_under_review["project_class"], "commercial")
        self.assertEqual(commercial_under_review["bid_amount_label"], "$27,500.00")
        self.assertEqual(commercial_under_review["milestone_preview"], ["Demo Phase", "Buildout Phase"])
        self.assertEqual(commercial_under_review["request_snapshot"]["photo_count"], 1)
        self.assertEqual(commercial_under_review["request_snapshot"]["measurement_handling"], "Site visit required")
        self.assertIn("Budget Provided", commercial_under_review["request_signals"])

        self.assertEqual(linked_awarded["status"], "awarded")
        self.assertEqual(linked_awarded["next_action"]["key"], "open_agreement")
        self.assertEqual(linked_awarded["linked_agreement_id"], self.linked_agreement.id)
        self.assertEqual(linked_awarded["project_class"], "commercial")
        self.assertEqual(linked_awarded["workspace_stage"], "active_bid")
        self.assertEqual(not_selected["status"], "expired")
        self.assertEqual(not_selected["status_label"], "Not Selected")
        self.assertEqual(not_selected["status_note"], "Another contractor was selected for this project.")
        self.assertEqual(not_selected["workspace_stage"], "closed")

        other_client = APIClient()
        other_client.force_authenticate(user=self.other_plain_user)
        forbidden = other_client.get("/api/projects/contractor/bids/")
        self.assertEqual(forbidden.status_code, 404)

    def test_filters_apply_by_status_and_project_class(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(
            "/api/projects/contractor/bids/",
            {"status": "awarded", "project_class": "commercial"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        rows = payload["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source_kind"], "lead")
        self.assertEqual(rows[0]["source_id"], self.linked_commercial_lead.id)
        self.assertEqual(rows[0]["next_action"]["key"], "open_agreement")
        self.assertEqual(payload["summary"]["awarded_bids"], 1)

    def test_contractor_can_save_follow_up_lead_and_reopen_it(self):
        lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            full_name="Follow Up Lead",
            email="followup@example.com",
            project_type="Patio Repair",
            project_description="Flagstone patio needs a follow-up review.",
            status=PublicContractorLead.STATUS_NEW,
        )
        self.client.force_authenticate(user=self.contractor_user)

        save_response = self.client.patch(
            f"/api/projects/contractor/public-leads/{lead.id}/",
            {"status": PublicContractorLead.STATUS_FOLLOW_UP},
            format="json",
        )
        self.assertEqual(save_response.status_code, 200)
        lead.refresh_from_db()
        self.assertEqual(lead.status, PublicContractorLead.STATUS_FOLLOW_UP)

        follow_up_workspace = self.client.get("/api/projects/contractor/bids/")
        self.assertEqual(follow_up_workspace.status_code, 200)
        follow_up_payload = follow_up_workspace.json()
        follow_up_row = next(
            row
            for row in follow_up_payload["results"]
            if row["source_kind"] == "lead" and row["source_id"] == lead.id
        )
        self.assertEqual(follow_up_row["workspace_stage"], "follow_up")
        self.assertEqual(follow_up_row["workspace_stage_label"], "Follow-Up")
        self.assertEqual(follow_up_row["status_label"], "Follow-Up")
        self.assertEqual(follow_up_row["status_note"], "This lead is saved for later review.")
        self.assertEqual(follow_up_payload["summary"]["follow_up_leads"], 1)

        reopen_response = self.client.patch(
            f"/api/projects/contractor/public-leads/{lead.id}/",
            {"status": PublicContractorLead.STATUS_NEW},
            format="json",
        )
        self.assertEqual(reopen_response.status_code, 200)
        lead.refresh_from_db()
        self.assertEqual(lead.status, PublicContractorLead.STATUS_NEW)

        reopened_workspace = self.client.get("/api/projects/contractor/bids/")
        self.assertEqual(reopened_workspace.status_code, 200)
        reopened_payload = reopened_workspace.json()
        reopened_row = next(
            row
            for row in reopened_payload["results"]
            if row["source_kind"] == "lead" and row["source_id"] == lead.id
        )
        self.assertEqual(reopened_row["workspace_stage"], "new_lead")
        self.assertEqual(reopened_payload["summary"]["follow_up_leads"], 0)

    def test_agreement_linking_syncs_both_sides(self):
        self.linked_commercial_lead.refresh_from_db()
        self.linked_commercial_intake.refresh_from_db()

        self.assertEqual(self.linked_commercial_intake.agreement_id, self.linked_agreement.id)
        self.assertEqual(self.linked_commercial_lead.converted_agreement_id, self.linked_agreement.id)
        self.assertEqual(self.linked_commercial_intake.status, "converted")
        self.assertEqual(self.linked_agreement.project_class, AgreementProjectClass.COMMERCIAL)


class AgreementWarrantyApiTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="warranty@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Warranty Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Warranty Homeowner",
            email="homeowner-warranty@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Warranty Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Warranty agreement",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_can_create_and_filter_warranty_records_for_agreement(self):
        create_response = self.client.post(
            "/api/projects/warranties/",
            {
                "agreement": self.agreement.id,
                "title": "12-Month Workmanship",
                "coverage_details": "Covers workmanship defects for finish carpentry.",
                "exclusions": "Normal wear and misuse are excluded.",
                "start_date": "2026-03-01",
                "end_date": "2027-03-01",
                "status": "active",
                "applies_to": "workmanship",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        payload = create_response.json()
        self.assertEqual(payload["title"], "12-Month Workmanship")
        self.assertEqual(payload["contractor"], self.contractor.id)
        self.assertEqual(payload["agreement"], self.agreement.id)

        list_response = self.client.get(
            f"/api/projects/warranties/?agreement={self.agreement.id}"
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "12-Month Workmanship")

        warranty = AgreementWarranty.objects.get(pk=payload["id"])
        self.assertEqual(warranty.contractor_id, self.contractor.id)


class AIFreeAccessRegressionTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="ai-free@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="AI Included Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="AI Included Homeowner",
            email="ai-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="AI Included Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Included AI agreement",
        )
        self.dispute = Dispute.objects.create(
            agreement=self.agreement,
            initiator="contractor",
            reason="Scope disagreement",
            description="Need an advisory recommendation.",
            created_by=self.user,
            fee_paid=True,
            escrow_frozen=True,
            status="open",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_ai_entitlements_endpoint_returns_included_payload(self):
        response = self.client.get("/api/projects/ai/entitlements/me/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["is_contractor"])
        self.assertEqual(payload["ai_access"], "included")
        self.assertTrue(payload["ai_enabled"])
        self.assertTrue(payload["ai_unlimited"])

    def test_ai_agreement_description_works_without_entitlement_rows(self):
        with patch(
            "projects.api.ai_agreement_views.generate_or_improve_description",
            return_value={
                "description": "AI-generated scope",
                "_mode": "generate",
                "_model": "test-model",
            },
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/description/",
                {
                    "agreement_id": self.agreement.id,
                    "mode": "generate",
                    "project_title": "Kitchen Refresh",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["description"], "AI-generated scope")
        self.assertEqual(payload["ai_access"], "included")
        self.assertTrue(payload["ai_enabled"])
        self.assertTrue(payload["ai_unlimited"])
        self.assertIn("classification", payload)

    def test_ai_agreement_description_falls_back_when_ai_fails(self):
        with patch(
            "projects.api.ai_agreement_views.generate_or_improve_description",
            side_effect=RuntimeError("OpenAI unavailable"),
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/description/",
                {
                    "agreement_id": self.agreement.id,
                    "mode": "generate",
                    "current_description": "Replace Siding on the west side of the home.",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["recommendation_source"], "fallback")
        self.assertEqual(payload["project_type"], "Siding")
        self.assertEqual(payload["project_subtype"], "Siding Replacement")
        self.assertIn("Recommended from your description", payload["confidence_label"])
        self.assertTrue(payload["description"])
        self.assertIn("classification", payload)

    def test_ai_agreement_description_falls_back_to_basement_for_finish_basement(self):
        with patch(
            "projects.api.ai_agreement_views.generate_or_improve_description",
            side_effect=RuntimeError("OpenAI unavailable"),
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/description/",
                {
                    "agreement_id": self.agreement.id,
                    "mode": "generate",
                    "current_description": "Finish basement with framing, drywall, flooring, and trim.",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["recommendation_source"], "fallback")
        self.assertEqual(payload["project_type"], "Remodel")
        self.assertEqual(payload["project_subtype"], "Basement")
        self.assertEqual(payload["project_title"], "Basement Finishing")
        self.assertIn("basement", payload["description"].lower())

    def test_ai_agreement_description_falls_back_to_pool_for_pool_house(self):
        with patch(
            "projects.api.ai_agreement_views.generate_or_improve_description",
            side_effect=RuntimeError("OpenAI unavailable"),
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/description/",
                {
                    "agreement_id": self.agreement.id,
                    "mode": "generate",
                    "current_description": "Inground pool and pool house with excavation, decking, and equipment pad.",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["recommendation_source"], "fallback")
        self.assertEqual(payload["project_type"], "Pool")
        self.assertEqual(payload["project_subtype"], "Inground Pool and Pool House")
        self.assertEqual(payload["project_title"], "Inground Pool and Pool House")
        self.assertIn("pool", payload["description"].lower())

    def test_ai_classify_project_prefers_junk_removal_and_keeps_scope_untouched(self):
        response = self.client.post(
            "/api/projects/agreements/ai/classify/",
            {
                "agreement_id": self.agreement.id,
                "project_title": "Faucet Repair",
                "project_type": "Repair",
                "project_subtype": "Faucet Repair",
                "description": "Junk Removal",
                "scope_of_work": "Remove old furniture, appliances, and debris from the garage.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["project_type"], "Junk Removal")
        self.assertEqual(payload["project_title"], "Junk Removal")
        self.assertIn(
            payload["project_subtype"],
            {
                "Junk Removal",
                "Debris Removal",
                "Appliance Removal",
                "Furniture Removal",
                "Construction Debris Removal",
            },
        )
        self.assertEqual(payload["detail"], "OK")
        self.assertIn("classification", payload)
        self.assertEqual(payload["classification"]["project_type"], "Junk Removal")
        self.assertNotIn("scope_of_work", payload)

    def test_ai_agreement_description_accepts_unsaved_payload_without_agreement(self):
        with patch(
            "projects.api.ai_agreement_views.generate_or_improve_description",
            return_value={
                "description": "AI-generated scope",
                "project_title": "Replace Siding",
                "project_type": "Siding",
                "project_subtype": "Siding Replacement",
                "_mode": "generate",
                "_model": "test-model",
            },
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/description/",
                {
                    "agreement_id": None,
                    "mode": "generate",
                    "current_description": "Replace siding on a single-story home.",
                    "project_title": "Replace Siding",
                    "project_type": "Siding",
                    "project_subtype": "Siding Replacement",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["description"], "AI-generated scope")
        self.assertEqual(payload["project_type"], "Siding")
        self.assertEqual(payload["project_subtype"], "Siding Replacement")
        self.assertIn("classification", payload)
        self.assertEqual(payload["classification"]["project_type"], "Siding")

    def test_ai_agreement_description_requires_input(self):
        response = self.client.post(
            "/api/projects/agreements/ai/description/",
            {
                "mode": "generate",
                "current_description": "",
                "project_title": "",
                "project_type": "",
                "project_subtype": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("current_description", payload["errors"])
        self.assertIn("Add a description", payload["errors"]["current_description"][0])

    def test_ai_draft_project_works_without_agreement_id(self):
        with patch(
            "projects.api.ai_agreement_views.build_project_intelligence",
            return_value={
                "analysis": {
                    "project_type": "Siding",
                    "project_subtype": "Siding Replacement",
                    "project_title": "Replace Siding",
                },
                "suggested_plan": {},
                "estimate_preview": None,
                "confidence": "high",
                "confidence_reasoning": "Looks good.",
                "explanation_points": [],
                "recommended_setup": {},
                "quantity_context": {},
                "source_metadata": {},
            },
        ), patch(
            "projects.api.ai_agreement_views.draft_project_structure",
            return_value={
                "project_type": "Siding",
                "project_subtype": "Siding Replacement",
                "normalized_description": "Replace siding on the home.",
                "suggested_template": None,
                "template_confidence": "high",
                "template_score": 87,
                "template_reason": "Strong match.",
                "milestones": [],
                "clarifications": [],
                "pricing_summary": {},
                "estimated_days": 4,
                "can_save_template": True,
            },
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/draft/",
                {
                    "project_title": "Replace Siding",
                    "description": "Replace siding on a single-story home.",
                    "project_type": "Siding",
                    "project_subtype": "Siding Replacement",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["project_type"], "Siding")
        self.assertEqual(payload["project_subtype"], "Siding Replacement")
        self.assertTrue(payload["can_save_template"])

    def test_ai_draft_project_requires_input(self):
        response = self.client.post(
            "/api/projects/agreements/ai/draft/",
            {
                "project_title": "",
                "description": "",
                "project_type": "",
                "project_subtype": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("current_description", payload["errors"])

    def test_ai_agreement_description_forbidden_for_other_contractors(self):
        user_model = get_user_model()
        other_user = user_model.objects.create_user(
            email="other-contractor@example.com",
            password="testpass123",
        )
        other_contractor = Contractor.objects.create(
            user=other_user,
            business_name="Other Contractor",
        )
        other_homeowner = Homeowner.objects.create(
            created_by=other_contractor,
            full_name="Other Homeowner",
            email="other-homeowner@example.com",
        )
        other_project = Project.objects.create(
            contractor=other_contractor,
            homeowner=other_homeowner,
            title="Other Project",
        )
        other_agreement = Agreement.objects.create(
            project=other_project,
            contractor=other_contractor,
            homeowner=other_homeowner,
            description="Other agreement",
        )

        response = self.client.post(
            "/api/projects/agreements/ai/description/",
            {
                "agreement_id": other_agreement.id,
                "mode": "generate",
                "current_description": "Replace siding on a single-story home.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertEqual(payload["code"], "FORBIDDEN")

    def test_dispute_ai_recommendation_works_without_entitlement_rows(self):
        with patch(
            "projects.api.disputes_ai_views.build_dispute_evidence_context",
            return_value={"agreement": {"id": self.agreement.id}, "dispute": {"id": self.dispute.id}},
        ), patch(
            "projects.api.disputes_ai_views.generate_dispute_recommendation",
            return_value=SimpleNamespace(
                model="test-model",
                payload={
                    "overview": {"neutral_summary": "Test summary", "main_issues": [], "missing_info": [], "risk_flags": []},
                    "recommendation": {
                        "recommended_option_id": "balanced",
                        "why_this_option": "It is fair.",
                        "confidence": 0.91,
                        "notes_for_parties": "Review the proposal.",
                    },
                    "options": [],
                    "draft_resolution_agreement": {"title": "Draft"},
                },
            ),
        ):
            response = self.client.post(
                f"/api/projects/disputes/{self.dispute.id}/ai/recommendation/",
                {"force": True},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(payload["ai_access"], "included")
        self.assertTrue(payload["ai_enabled"])
        self.assertTrue(payload["ai_unlimited"])

    def test_legacy_ai_checkout_endpoint_is_removed(self):
        response = self.client.post(
            "/api/projects/ai/checkout/recommendation/",
            {"dispute_id": self.dispute.id},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_legacy_ai_void_credit_endpoint_is_removed(self):
        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/ai/void-credit/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 404)


class SubcontractorInvitationApiTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Owner Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Project Homeowner",
            email="homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Main Agreement",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement with subcontractor invites",
        )

        self.other_user = user_model.objects.create_user(
            email="other-owner@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Other Contractor",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Agreement",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other agreement",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="subcontractor@example.com",
            password="testpass123",
            first_name="Sub",
            last_name="Contractor",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.contractor_user)

    def _create_invitation(self, email="subcontractor@example.com"):
        with patch(
            "projects.views.subcontractor_invitations.send_subcontractor_invitation_email",
            return_value={
                "attempted": False,
                "ok": False,
                "message": "email skipped in test",
                "invite_url": "http://testserver/subcontractor-invitations/accept/test-token",
            },
        ):
            return self.client.post(
                f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/",
                {
                    "invite_email": email,
                    "invite_name": "Sub Contract",
                    "invited_message": "Join this agreement.",
                },
                format="json",
            )

    def test_contractor_can_create_invitation_on_own_agreement(self):
        response = self._create_invitation()
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["invite_email"], "subcontractor@example.com")
        self.assertEqual(payload["status"], "pending")
        self.assertIn("/subcontractor-invitations/accept/", payload["invite_url"])

        list_response = self.client.get(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/"
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()
        self.assertEqual(len(rows["pending_invitations"]), 1)
        self.assertEqual(rows["accepted_subcontractors"], [])

    def test_contractor_cannot_create_invitation_on_other_contractors_agreement(self):
        response = self.client.post(
            f"/api/projects/agreements/{self.other_agreement.id}/subcontractor-invitations/",
            {"invite_email": "subcontractor@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_duplicate_active_invite_is_rejected(self):
        first = self._create_invitation()
        self.assertEqual(first.status_code, 201)

        second = self._create_invitation()
        self.assertEqual(second.status_code, 400)
        self.assertIn("pending invitation", str(second.json()).lower())

    def test_valid_token_can_be_accepted(self):
        create_response = self._create_invitation()
        invitation_id = create_response.json()["id"]
        invitation = SubcontractorInvitation.objects.get(pk=invitation_id)

        public_client = APIClient()
        lookup = public_client.get(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/"
        )
        self.assertEqual(lookup.status_code, 200)
        self.assertEqual(lookup.json()["status"], "pending")

        public_client.force_authenticate(user=self.subcontractor_user)
        accept_response = public_client.post(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)

        invitation.refresh_from_db()
        self.assertEqual(invitation.status, SubcontractorInvitationStatus.ACCEPTED)
        self.assertEqual(invitation.accepted_by_user_id, self.subcontractor_user.id)

        list_response = self.client.get(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/"
        )
        self.assertEqual(len(list_response.json()["accepted_subcontractors"]), 1)

    def test_revoked_or_invalid_token_cannot_be_accepted(self):
        create_response = self._create_invitation()
        invitation_id = create_response.json()["id"]

        revoke_response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/{invitation_id}/revoke/",
            {},
            format="json",
        )
        self.assertEqual(revoke_response.status_code, 200)

        invitation = SubcontractorInvitation.objects.get(pk=invitation_id)
        public_client = APIClient()
        public_client.force_authenticate(user=self.subcontractor_user)

        revoked_accept = public_client.post(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/",
            {},
            format="json",
        )
        self.assertEqual(revoked_accept.status_code, 400)

        invalid_accept = public_client.post(
            "/api/projects/subcontractor-invitations/accept/not-a-real-token/",
            {},
            format="json",
        )
        self.assertEqual(invalid_accept.status_code, 404)

    def test_acceptance_requires_matching_invited_email(self):
        create_response = self._create_invitation(email="expected@example.com")
        invitation = SubcontractorInvitation.objects.get(pk=create_response.json()["id"])

        public_client = APIClient()
        public_client.force_authenticate(user=self.subcontractor_user)
        response = public_client.post(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("invited email", response.json()["detail"].lower())


class SMSWebhookTests(TestCase):
    def _post_sms(self, body, from_number="+12105551234", message_sid="SM123"):
        return self.client.post(
            "/api/sms/webhook/",
            {
                "From": from_number,
                "Body": body,
                "MessageSid": message_sid,
            },
        )

    def assertXmlResponseContains(self, response, expected_text):
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/xml", response["Content-Type"])
        self.assertIn(expected_text, response.content.decode("utf-8"))

    def test_stop_response(self):
        response = self._post_sms("STOP")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to opt back in.",
        )

    def test_stopall_response(self):
        response = self._post_sms(" STOPALL ")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to opt back in.",
        )

    def test_help_response(self):
        response = self._post_sms("HELP")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro alerts: project updates, payments, and customer-care messages only. Reply STOP to opt out or START to opt back in. Help: support@myhomebro.com",
        )

    def test_info_response(self):
        response = self._post_sms(" info ")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro alerts: project updates, payments, and customer-care messages only. Reply STOP to opt out or START to opt back in. Help: support@myhomebro.com",
        )

    def test_start_response(self):
        response = self._post_sms("START")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: SMS notifications are enabled again.",
        )

    def test_unstop_response(self):
        response = self._post_sms("UNSTOP")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: SMS notifications are enabled again.",
        )

    def test_default_response(self):
        response = self._post_sms("Can you send the next update?")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro alerts: project updates, payments, and customer-care messages only. Reply STOP to opt out or START to opt back in. Help: support@myhomebro.com",
        )

    def test_non_post_safe_response(self):
        response = self.client.get("/api/sms/webhook/")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: Message received. For help, reply HELP. Reply STOP to opt out.",
        )

    def test_exception_path_still_returns_valid_twiml(self):
        with patch(
            "projects.views.sms_webhook.upsert_sms_consent_status",
            side_effect=RuntimeError("boom"),
        ):
            response = self._post_sms("STOP", message_sid="SM-exception")

        self.assertXmlResponseContains(
            response,
            "MyHomeBro: Message received. For help, reply HELP. Reply STOP to opt out.",
        )

    def test_opt_out_persistence_updates_local_consent_state(self):
        response = self._post_sms("STOP", message_sid="SM-stop")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to opt back in.",
        )

        consent = SMSConsentStatus.objects.get(phone_number="+12105551234")
        self.assertFalse(consent.is_subscribed)
        self.assertEqual(consent.last_inbound_message_sid, "SM-stop")
        self.assertEqual(consent.last_keyword_type, SMSConsentStatus.KEYWORD_OPT_OUT)
        self.assertEqual(consent.last_inbound_body, "STOP")
        self.assertIsNotNone(consent.opted_out_at)

        durable = SMSConsent.objects.get(phone_number_e164="+12105551234")
        self.assertTrue(durable.opted_out)
        self.assertFalse(durable.can_send_sms)

    def test_opt_in_persistence_updates_local_consent_state(self):
        SMSConsentStatus.objects.create(
            phone_number="+12105551234",
            is_subscribed=False,
            last_keyword_type=SMSConsentStatus.KEYWORD_OPT_OUT,
        )

        response = self._post_sms("START", message_sid="SM-start")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: SMS notifications are enabled again.",
        )

        consent = SMSConsentStatus.objects.get(phone_number="+12105551234")
        self.assertTrue(consent.is_subscribed)
        self.assertEqual(consent.last_inbound_message_sid, "SM-start")
        self.assertEqual(consent.last_keyword_type, SMSConsentStatus.KEYWORD_OPT_IN)
        self.assertEqual(consent.last_inbound_body, "START")
        self.assertIsNotNone(consent.opted_in_at)

        durable = SMSConsent.objects.get(phone_number_e164="+12105551234")
        self.assertTrue(durable.can_send_sms)
        self.assertFalse(durable.opted_out)


class SMSComplianceTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="sms-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="SMS Contractor",
            phone="+12105550001",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="SMS Homeowner",
            email="sms-homeowner@example.com",
            phone_number="+12105550002",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="SMS Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="SMS agreement test",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="HVAC Tune Up",
            amount="250.00",
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount="250.00",
            status=InvoiceStatus.PENDING,
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_opt_in_api_creates_consent_and_activity_event(self):
        response = self.client.post(
            "/api/projects/sms/opt-in/",
            {
                "agreement_id": self.agreement.id,
                "source": "agreement",
                "consent_text_snapshot": "I agree to receive project SMS updates.",
                "consent_source_page": "/app/agreements/1",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["sms_enabled"])

        consent = SMSConsent.objects.get(phone_number_e164="+12105550002")
        self.assertTrue(consent.can_send_sms)
        self.assertFalse(consent.opted_out)
        self.assertEqual(consent.opted_in_source, SMSConsent.OPT_IN_SOURCE_AGREEMENT)
        self.assertEqual(consent.homeowner_id, self.homeowner.id)
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_opt_in",
                metadata__phone="+12105550002",
            ).exists()
        )

    def test_send_wrapper_blocks_without_consent_and_logs_activity(self):
        result = send_compliant_sms(
            self.homeowner.phone_number,
            "Your agreement is ready.",
            related_object=self.agreement,
        )

        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertEqual(result["status"], "blocked")
        blocked_event = ContractorActivityEvent.objects.filter(
            contractor=self.contractor,
            event_type="sms_blocked",
            metadata__phone="+12105550002",
        ).order_by("-id").first()
        self.assertIsNotNone(blocked_event)
        self.assertIn("No SMS consent", blocked_event.summary)

    def test_stop_keyword_blocks_sending_and_logs_opt_out(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )

        payload = handle_inbound_sms(
            from_phone=self.homeowner.phone_number,
            body="STOP",
            message_sid="SMSTOP1",
        )

        self.assertIn("unsubscribed", payload["message"].lower())

        consent = SMSConsent.objects.get(phone_number_e164="+12105550002")
        self.assertTrue(consent.opted_out)
        self.assertFalse(consent.can_send_sms)

        result = send_compliant_sms(
            self.homeowner.phone_number,
            "Payment released.",
            related_object=self.agreement,
        )
        self.assertTrue(result["blocked"])
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_opt_out",
                metadata__phone="+12105550002",
            ).exists()
        )
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_blocked",
                metadata__phone="+12105550002",
            ).exists()
        )

    def test_twilio_error_updates_consent_and_logs_failure(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )

        class FakeTwilioRestException(Exception):
            def __init__(self, message, code):
                super().__init__(message)
                self.code = code

        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=lambda **kwargs: (_ for _ in ()).throw(
                    FakeTwilioRestException("opted out by carrier", "21610")
                )
            )
        )

        with patch("projects.services.sms_service.TwilioRestException", FakeTwilioRestException), patch(
            "projects.services.sms_service._twilio_ready",
            return_value=True,
        ), patch("projects.services.sms_service._twilio_client", return_value=fake_client):
            result = send_compliant_sms(
                self.homeowner.phone_number,
                "Agreement update.",
                related_object=self.agreement,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "failed")
        consent = SMSConsent.objects.get(phone_number_e164="+12105550002")
        self.assertTrue(consent.opted_out)
        self.assertEqual(consent.opted_out_source, SMSConsent.OPT_OUT_SOURCE_TWILIO_ERROR)
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_failed",
                metadata__phone="+12105550002",
            ).exists()
        )

    def test_activity_event_trigger_sends_sms_and_logs_sent_event(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        fake_message = SimpleNamespace(sid="SM12345", status="queued")
        fake_now = timezone.make_aware(datetime(2026, 3, 27, 10, 0))
        fake_create = patch(
            "projects.services.sms_service._twilio_client",
            return_value=SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: fake_message)),
        )
        with patch("projects.services.sms_automation.timezone.localtime", return_value=fake_now), patch("projects.services.sms_service._twilio_ready", return_value=True), fake_create:
            create_activity_event(
                contractor=self.contractor,
                agreement=self.agreement,
                event_type="payment_released",
                title="Payment released",
                summary="Escrow release completed.",
                dedupe_key="payment_released:test",
            )

        sent_event = ContractorActivityEvent.objects.filter(
            contractor=self.contractor,
            event_type="sms_sent",
            metadata__twilio_sid="SM12345",
        ).first()
        self.assertIsNotNone(sent_event)
        self.assertEqual(sent_event.agreement_id, self.agreement.id)
        self.assertEqual(sent_event.metadata.get("phone"), "+12105550001")

    def test_status_callback_marks_failure_and_updates_consent(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        create_activity_event(
            contractor=self.contractor,
            agreement=self.agreement,
            event_type="sms_sent",
            title="SMS sent",
            summary="Queued",
            metadata={
                "phone": "+12105550002",
                "twilio_sid": "SM-CALLBACK",
                "message_preview": "Queued",
            },
            dedupe_key="sms_sent:SM-CALLBACK",
        )

        response = self.client.post(
            "/api/projects/twilio/status/",
            {
                "MessageSid": "SM-CALLBACK",
                "MessageStatus": "failed",
                "To": "+12105550002",
                "ErrorCode": "21610",
            },
        )

        self.assertEqual(response.status_code, 200)
        consent = SMSConsent.objects.get(phone_number_e164="+12105550002")
        self.assertTrue(consent.opted_out)
        failed_event = ContractorActivityEvent.objects.filter(
            contractor=self.contractor,
            event_type="sms_failed",
            metadata__twilio_sid="SM-CALLBACK",
        ).first()
        self.assertIsNotNone(failed_event)

    def test_inbound_webhook_and_status_api_return_current_sms_state(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )

        webhook_response = self.client.post(
            "/api/projects/twilio/inbound-sms/",
            {
                "From": "+12105550002",
                "Body": "HELP",
                "MessageSid": "SMHELP1",
            },
        )
        self.assertEqual(webhook_response.status_code, 200)
        self.assertIn("text/xml", webhook_response["Content-Type"])
        self.assertIn("Reply STOP to opt out", webhook_response.content.decode("utf-8"))

        status_response = self.client.get(
            f"/api/projects/sms/status/?agreement_id={self.agreement.id}"
        )
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.json()["phone_number_e164"], "+12105550002")
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_help_requested",
                metadata__phone="+12105550002",
            ).exists()
        )


class SMSAutomationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="sms-automation@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Automation Contractor",
            phone="+12105550101",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Automation Homeowner",
            email="automation-homeowner@example.com",
            phone_number="+12105550102",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Automation Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Automation agreement",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Inspection",
            amount="150.00",
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount="150.00",
            status=InvoiceStatus.APPROVED,
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_payment_released_sends_immediately_when_consent_exists(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        with patch("projects.services.sms_automation.send_compliant_sms", return_value={"ok": True, "twilio_sid": "SM-PAY", "status": "sent"}):
            decision = evaluate_sms_automation(
                "payment_released",
                contractor=self.contractor,
                agreement=self.agreement,
                invoice=self.invoice,
            )

        self.assertTrue(decision["should_send"])
        self.assertTrue(decision["sent"])
        self.assertEqual(decision["reason_code"], "sent_immediately")
        self.assertEqual(
            SMSAutomationDecision.objects.latest("id").template_key,
            "payment_released_contractor",
        )

    def test_direct_pay_link_ready_emits_sms_for_opted_in_homeowner(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        fake_message = SimpleNamespace(sid="SM-DIRECT", status="queued")
        fake_client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: fake_message))

        with patch("projects.services.sms_service._twilio_ready", return_value=True), patch(
            "projects.services.sms_service._twilio_client",
            return_value=fake_client,
        ):
            create_activity_event(
                contractor=self.contractor,
                agreement=self.agreement,
                event_type="direct_pay_link_ready",
                title="Direct pay link ready",
                summary="Direct pay link created.",
                dedupe_key="direct_pay_link_ready:test",
            )

        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_sent",
                metadata__twilio_sid="SM-DIRECT",
            ).exists()
        )
        self.assertEqual(
            SMSAutomationDecision.objects.latest("id").template_key,
            "direct_pay_link_ready_homeowner",
        )

    def test_agreement_fully_signed_emits_sms_for_opted_in_contractor(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        fake_message = SimpleNamespace(sid="SM-SIGNED", status="queued")
        fake_client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: fake_message))

        with patch("projects.services.sms_service._twilio_ready", return_value=True), patch(
            "projects.services.sms_service._twilio_client",
            return_value=fake_client,
        ):
            create_activity_event(
                contractor=self.contractor,
                agreement=self.agreement,
                event_type="agreement_fully_signed",
                title="Agreement fully signed",
                summary="Both parties signed the agreement.",
                dedupe_key="agreement_fully_signed:test",
            )

        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_sent",
                metadata__twilio_sid="SM-SIGNED",
            ).exists()
        )
        self.assertEqual(
            SMSAutomationDecision.objects.latest("id").template_key,
            "agreement_fully_signed_contractor",
        )

    def test_missing_consent_suppresses_sms(self):
        decision = evaluate_sms_automation(
            "payment_released",
            contractor=self.contractor,
            agreement=self.agreement,
            invoice=self.invoice,
        )

        self.assertFalse(decision["sent"])
        self.assertEqual(decision["reason_code"], "no_consent")
        self.assertEqual(decision["channel"], "suppressed")

    def test_opted_out_suppresses_sms(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        set_sms_opt_out(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_OUT_SOURCE_API,
        )

        decision = evaluate_sms_automation(
            "agreement_sent",
            contractor=self.contractor,
            homeowner=self.homeowner,
            agreement=self.agreement,
        )

        self.assertEqual(decision["reason_code"], "opted_out")
        self.assertEqual(decision["channel"], "suppressed")

    def test_agreement_sent_sends_sms_when_consent_exists(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_AGREEMENT,
        )
        with patch(
            "projects.services.sms_automation.send_compliant_sms",
            return_value={"ok": True, "twilio_sid": "SM-AGREEMENT", "status": "sent"},
        ):
            decision = evaluate_sms_automation(
                "agreement_sent",
                contractor=self.contractor,
                homeowner=self.homeowner,
                agreement=self.agreement,
            )

        self.assertTrue(decision["sent"])
        self.assertEqual(decision["reason_code"], "sent_immediately")
        self.assertEqual(
            SMSAutomationDecision.objects.latest("id").template_key,
            "agreement_sent_homeowner",
        )

    def test_agreement_sent_blocks_without_consent(self):
        decision = evaluate_sms_automation(
            "agreement_sent",
            contractor=self.contractor,
            homeowner=self.homeowner,
            agreement=self.agreement,
        )

        self.assertFalse(decision["sent"])
        self.assertEqual(decision["reason_code"], "no_consent")
        self.assertEqual(decision["channel"], "suppressed")

    def test_duplicate_event_within_cooldown_suppresses_sms(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        SMSAutomationDecision.objects.create(
            event_type="payment_released",
            phone_number_e164="+12105550101",
            contractor=self.contractor,
            agreement=self.agreement,
            invoice=self.invoice,
            should_send=True,
            channel_decision="sms",
            reason_code="sent_immediately",
            priority="high",
            template_key="payment_released_contractor",
            message_preview="Payment released.",
            sent=True,
        )

        decision = evaluate_sms_automation(
            "payment_released",
            contractor=self.contractor,
            agreement=self.agreement,
            invoice=self.invoice,
        )

        self.assertEqual(decision["reason_code"], "duplicate_recent")
        self.assertTrue(decision["cooldown_applied"])

    def test_higher_value_event_suppresses_lower_value_one(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        SMSAutomationDecision.objects.create(
            event_type="payment_released",
            phone_number_e164="+12105550101",
            contractor=self.contractor,
            agreement=self.agreement,
            invoice=self.invoice,
            should_send=True,
            channel_decision="sms",
            reason_code="sent_immediately",
            priority="high",
            template_key="payment_released_contractor",
            message_preview="Payment released.",
            sent=True,
        )

        decision = evaluate_sms_automation(
            "invoice_approved",
            contractor=self.contractor,
            agreement=self.agreement,
            invoice=self.invoice,
        )

        self.assertEqual(decision["reason_code"], "higher_value_event_already_sent")

    def test_quiet_hours_defer_medium_priority_send(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        fake_now = timezone.make_aware(datetime(2026, 3, 27, 22, 30))
        with patch("projects.services.sms_automation.timezone.localtime", return_value=fake_now):
            decision = evaluate_sms_automation(
                "milestone_pending_approval",
                contractor=self.contractor,
                homeowner=self.homeowner,
                agreement=self.agreement,
                milestone=self.milestone,
            )

        self.assertEqual(decision["reason_code"], "quiet_hours_deferred")
        self.assertTrue(decision["deferred"])
        self.assertEqual(DeferredSMSAutomation.objects.count(), 1)

    def test_urgent_event_can_bypass_quiet_hours(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        fake_now = timezone.make_aware(datetime(2026, 3, 27, 22, 30))
        with patch("projects.services.sms_automation.timezone.localtime", return_value=fake_now), patch(
            "projects.services.sms_automation.send_compliant_sms",
            return_value={"ok": True, "twilio_sid": "SM-URGENT", "status": "sent"},
        ):
            decision = evaluate_sms_automation(
                "payment_released",
                contractor=self.contractor,
                agreement=self.agreement,
                invoice=self.invoice,
            )

        self.assertTrue(decision["sent"])
        self.assertFalse(decision["deferred"])

    def test_activity_triggered_automation_logs_decision_and_activity_event(self):
        set_sms_opt_in(
            phone_number=self.homeowner.phone_number,
            homeowner=self.homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        fake_message = SimpleNamespace(sid="SM-ACTIVITY", status="queued")
        fake_now = timezone.make_aware(datetime(2026, 3, 27, 10, 0))
        with patch("projects.services.sms_automation.timezone.localtime", return_value=fake_now), patch(
            "projects.services.sms_service._twilio_ready",
            return_value=True,
        ), patch(
            "projects.services.sms_service._twilio_client",
            return_value=SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: fake_message)),
        ):
            create_activity_event(
                contractor=self.contractor,
                agreement=self.agreement,
                milestone=self.milestone,
                event_type="milestone_pending_approval",
                title="Milestone submitted",
                summary="Ready for homeowner review.",
                dedupe_key="milestone_pending_approval:automation-test",
            )

        self.assertTrue(SMSAutomationDecision.objects.filter(event_type="milestone_pending_approval").exists())
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="sms_sent",
            ).exists()
        )

    def test_dashboard_payload_and_agreement_detail_include_automation_summaries(self):
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        SMSAutomationDecision.objects.create(
            event_type="payment_released",
            phone_number_e164="+12105550101",
            contractor=self.contractor,
            agreement=self.agreement,
            invoice=self.invoice,
            should_send=True,
            channel_decision="sms",
            reason_code="sent_immediately",
            priority="high",
            template_key="payment_released_contractor",
            message_preview="Payment released.",
            sent=True,
        )

        me_response = self.client.get("/api/projects/contractors/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["sent_sms_count_7d"], 1)
        self.assertIn("last_sms_automation_decision", me_response.json())

        agreement_response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/")
        self.assertEqual(agreement_response.status_code, 200)
        self.assertEqual(
            agreement_response.json()["last_sms_automation_decision"]["reason_code"],
            "sent_immediately",
        )
        self.assertEqual(len(agreement_response.json()["recent_sms_automation_decisions"]), 1)

    def test_preview_endpoint_returns_deterministic_output_without_sending(self):
        self.user.is_staff = True
        self.user.save(update_fields=["is_staff"])
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        with patch("projects.services.sms_automation.send_compliant_sms") as mock_send:
            response = self.client.get(
                f"/api/projects/sms/automation/preview/?event_type=payment_released&agreement_id={self.agreement.id}"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reason_code"], "preview_ready")
        mock_send.assert_not_called()


class SubcontractorMilestoneAssignmentTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="assign-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Assign Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Assign Homeowner",
            email="assign-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Assignment Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for milestone assignment",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            description="Install all cabinets",
            amount="2500.00",
        )

        self.accepted_user = user_model.objects.create_user(
            email="accepted-sub@example.com",
            password="testpass123",
            first_name="Accepted",
            last_name="Sub",
        )
        self.accepted_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="accepted-sub@example.com",
            invite_name="Accepted Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.accepted_user,
            accepted_at=timezone.now(),
        )

        self.pending_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="pending-sub@example.com",
            invite_name="Pending Sub",
            status=SubcontractorInvitationStatus.PENDING,
        )

        self.other_user = user_model.objects.create_user(
            email="other-sub@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=user_model.objects.create_user(
                email="other-owner-assign@example.com",
                password="testpass123",
            ),
            business_name="Other Assign Owner",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-assign-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Assignment Project",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other agreement",
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.other_contractor,
            agreement=self.other_agreement,
            invite_email="other-sub@example.com",
            invite_name="Other Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.contractor_user)

    def test_contractor_can_assign_accepted_subcontractor_to_milestone(self):
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.accepted_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.assigned_subcontractor_invitation_id,
            self.accepted_invitation.id,
        )

    def test_contractor_can_unassign_subcontractor(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])

        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": None},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertIsNone(self.milestone.assigned_subcontractor_invitation_id)

    def test_cannot_assign_pending_invitation(self):
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.pending_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("accepted subcontractors", str(response.json()).lower())

    def test_cannot_assign_subcontractor_from_another_agreement(self):
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.other_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("same agreement", str(response.json()).lower())

    def test_serializer_returns_assignment_info_correctly(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])

        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            payload["assigned_subcontractor_invitation"],
            self.accepted_invitation.id,
        )
        self.assertEqual(
            payload["assigned_subcontractor"]["email"],
            "accepted-sub@example.com",
        )
        self.assertEqual(
            payload["assigned_subcontractor_display"],
            "Accepted Sub",
        )

    def test_contractor_can_create_milestone_agreement_terms_with_manual_release_default(self):
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "1750.00",
                "payment_release_mode": "manual_release",
                "send_agreement": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.subcontractor_payout_amount_cents, 175000)
        agreement = SubcontractorMilestoneAgreement.objects.get(
            milestone=self.milestone,
            subcontractor_invitation=self.accepted_invitation,
        )
        self.assertEqual(agreement.agreed_pay, Decimal("1750.00"))
        self.assertEqual(agreement.payment_release_mode, SubcontractorPaymentReleaseMode.MANUAL_RELEASE)
        self.assertEqual(agreement.agreement_acceptance_status, SubcontractorMilestoneAgreementStatus.PENDING)
        payload = response.json()["milestone"]
        self.assertEqual(payload["subcontractor_milestone_agreement"]["agreed_pay"], "1750.00")
        self.assertEqual(
            payload["subcontractor_milestone_agreement"]["payment_release_mode"],
            "manual_release",
        )

    def test_over_allocation_requires_override_reason(self):
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "2750.00",
                "payment_release_mode": "manual_release",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("override", str(response.json()).lower())

        allowed = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "2750.00",
                "payment_release_mode": "auto_after_customer_approval",
                "override_reason": "Customer approved an expanded scope after the bid was accepted.",
                "send_agreement": True,
            },
            format="json",
        )

        self.assertEqual(allowed.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.subcontractor_payout_amount_cents, 275000)

    def test_subcontractor_must_accept_before_work_submission(self):
        self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "1400.00",
                "payment_release_mode": "manual_release",
                "send_agreement": True,
            },
            format="json",
        )

        self.client.force_authenticate(user=self.accepted_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/submit-work/",
            {"note": "Ready for review"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertIn("not found", str(response.json()).lower())

        accept_response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/agreement/accept/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)

        submit_response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/submit-work/",
            {"note": "Ready for review"},
            format="json",
        )
        self.assertEqual(submit_response.status_code, 200)

    def test_changing_pay_after_acceptance_creates_new_version(self):
        self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "1500.00",
                "payment_release_mode": "manual_release",
                "send_agreement": True,
            },
            format="json",
        )
        self.client.force_authenticate(user=self.accepted_user)
        self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/agreement/accept/",
            {},
            format="json",
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/subcontractor-agreement/",
            {
                "agreed_pay": "1600.00",
                "payment_release_mode": "auto_after_customer_approval",
                "send_agreement": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            SubcontractorMilestoneAgreement.objects.filter(
                milestone=self.milestone,
                subcontractor_invitation=self.accepted_invitation,
            ).count(),
            2,
        )
        latest = SubcontractorMilestoneAgreement.objects.filter(
            milestone=self.milestone,
            subcontractor_invitation=self.accepted_invitation,
        ).order_by("-agreement_version", "-id").first()
        self.assertEqual(latest.agreement_acceptance_status, SubcontractorMilestoneAgreementStatus.PENDING)
        self.assertEqual(latest.agreement_version, 2)

    def test_subcontractor_safe_view_hides_customer_total(self):
        self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "1450.00",
                "payment_release_mode": "manual_release",
                "send_agreement": True,
            },
            format="json",
        )

        self.client.force_authenticate(user=self.accepted_user)
        response = self.client.get(f"/api/projects/subcontractor/milestones/{self.milestone.id}/agreement/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["agreement"]
        self.assertEqual(payload["agreed_pay"], "1450.00")
        self.assertEqual(payload["payment_release_mode"], "manual_release")
        self.assertNotIn("customer_agreement_total", payload)
        self.assertNotIn("customer_milestone_amount", payload)

    def test_auto_release_mode_still_waits_for_customer_approval(self):
        self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/assign-subcontractor/",
            {
                "invitation_id": self.accepted_invitation.id,
                "agreed_pay": "1450.00",
                "payment_release_mode": "auto_after_customer_approval",
                "send_agreement": True,
            },
            format="json",
        )
        self.client.force_authenticate(user=self.accepted_user)
        self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/agreement/accept/",
            {},
            format="json",
        )
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.accepted_user
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.completed = True
        self.milestone.completed_at = timezone.now()
        self.milestone.is_invoiced = True
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
                "completed",
                "completed_at",
                "is_invoiced",
            ]
        )
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=self.milestone.amount,
            status=InvoiceStatus.PENDING,
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.milestone.invoice = invoice
        self.milestone.save(update_fields=["invoice"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.NOT_ELIGIBLE)
        invoice.status = InvoiceStatus.APPROVED
        invoice.approved_at = timezone.now()
        invoice.save(update_fields=["status", "approved_at"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertIn(payout.status, {MilestonePayoutStatus.ELIGIBLE, MilestonePayoutStatus.READY_FOR_PAYOUT})

    def test_delegated_reviewer_assignment_accepts_internal_team_member(self):
        user_model = get_user_model()
        reviewer_user = user_model.objects.create_user(
            email="reviewer-team@example.com",
            password="testpass123",
        )
        reviewer_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=reviewer_user,
            display_name="Reviewer Team",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )

        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"delegated_reviewer_subaccount": reviewer_subaccount.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.delegated_reviewer_subaccount_id, reviewer_subaccount.id)

    def test_delegated_reviewer_assignment_rejects_invalid_internal_member(self):
        user_model = get_user_model()
        readonly_user = user_model.objects.create_user(
            email="readonly-reviewer@example.com",
            password="testpass123",
        )
        readonly_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=readonly_user,
            display_name="Readonly Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
        )

        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"delegated_reviewer_subaccount": readonly_subaccount.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("eligible internal team member", str(response.json()).lower())


class SubcontractorAssignedWorkTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="assigned-work-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Assigned Work Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Assigned Work Homeowner",
            email="assigned-work-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Assigned Work Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for assigned work",
        )

        self.user_one = user_model.objects.create_user(
            email="sub-one@example.com",
            password="testpass123",
            first_name="Sub",
            last_name="One",
        )
        self.user_two = user_model.objects.create_user(
            email="sub-two@example.com",
            password="testpass123",
            first_name="Sub",
            last_name="Two",
        )

        self.invitation_one = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="sub-one@example.com",
            invite_name="Sub One",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.user_one,
            accepted_at=timezone.now(),
        )
        self.invitation_two = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="sub-two@example.com",
            invite_name="Sub Two",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.user_two,
            accepted_at=timezone.now(),
        )

        self.milestone_one = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Framing",
            description="Frame the room",
            amount="1200.00",
            assigned_subcontractor_invitation=self.invitation_one,
        )
        self.milestone_two = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Drywall",
            description="Install drywall",
            amount="800.00",
            assigned_subcontractor_invitation=self.invitation_two,
        )

        self.client = APIClient()

    def test_subcontractor_can_fetch_only_their_assigned_milestones(self):
        self.client.force_authenticate(user=self.user_one)
        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(len(payload["milestones"]), 1)
        self.assertEqual(payload["milestones"][0]["id"], self.milestone_one.id)

    def test_subcontractor_cannot_see_milestones_assigned_to_someone_else(self):
        self.client.force_authenticate(user=self.user_one)
        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")

        self.assertEqual(response.status_code, 200)
        milestone_ids = [row["id"] for row in response.json()["milestones"]]
        self.assertNotIn(self.milestone_two.id, milestone_ids)

    def test_grouped_project_linked_response_includes_expected_fields(self):
        self.client.force_authenticate(user=self.user_one)
        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["groups"]), 1)
        group = payload["groups"][0]
        self.assertEqual(group["agreement_id"], self.agreement.id)
        self.assertEqual(group["project_title"], "Assigned Work Project")
        milestone = group["milestones"][0]
        self.assertEqual(milestone["agreement_id"], self.agreement.id)
        self.assertEqual(milestone["agreement_title"], "Assigned Work Project")
        self.assertEqual(milestone["assigned_subcontractor"]["email"], "sub-one@example.com")
        self.assertNotIn("payout_status", milestone)
        self.assertNotIn("payment_structure", milestone)
        self.assertNotIn("retainage_percent", milestone)
        self.assertNotIn("is_invoiced", milestone)

    def test_empty_state_works_when_no_assignments_exist(self):
        user_model = get_user_model()
        unassigned_user = user_model.objects.create_user(
            email="no-work@example.com",
            password="testpass123",
        )
        self.client.force_authenticate(user=unassigned_user)

        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["groups"], [])
        self.assertEqual(payload["milestones"], [])


class SubcontractorCollaborationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="collab-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Collab Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Collab Homeowner",
            email="collab-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Collaboration Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor collaboration",
        )

        self.assigned_user = user_model.objects.create_user(
            email="assigned-collab@example.com",
            password="testpass123",
            first_name="Assigned",
            last_name="Collaborator",
        )
        self.other_user = user_model.objects.create_user(
            email="other-collab@example.com",
            password="testpass123",
            first_name="Other",
            last_name="Collaborator",
        )
        self.unassigned_user = user_model.objects.create_user(
            email="unassigned-collab@example.com",
            password="testpass123",
        )

        self.assigned_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-collab@example.com",
            invite_name="Assigned Collaborator",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.assigned_user,
            accepted_at=timezone.now(),
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-collab@example.com",
            invite_name="Other Collaborator",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Paint Prep",
            description="Prep all walls for paint",
            amount="900.00",
            assigned_subcontractor_invitation=self.assigned_invitation,
        )

        self.comment = MilestoneComment.objects.create(
            milestone=self.milestone,
            author=self.contractor_user,
            content="Initial contractor note",
        )
        self.file = MilestoneFile.objects.create(
            milestone=self.milestone,
            uploaded_by=self.contractor_user,
            file=SimpleUploadedFile("scope.txt", b"scope details", content_type="text/plain"),
        )

        self.client = APIClient()

    def test_assigned_subcontractor_can_list_milestone_comments_and_files(self):
        self.client.force_authenticate(user=self.assigned_user)
        detail = self.client.get(f"/api/projects/subcontractor/milestones/{self.milestone.id}/")
        self.assertEqual(detail.status_code, 200)
        payload = detail.json()
        self.assertEqual(len(payload["comments"]), 1)
        self.assertEqual(len(payload["files"]), 1)

        comments = self.client.get(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/"
        )
        files = self.client.get(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/files/"
        )
        self.assertEqual(comments.status_code, 200)
        self.assertEqual(files.status_code, 200)

    def test_assigned_subcontractor_can_create_comment(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/",
            {"content": "Need trim dimensions."},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            MilestoneComment.objects.filter(
                milestone=self.milestone,
                author=self.assigned_user,
                content="Need trim dimensions.",
            ).exists()
        )

    def test_assigned_subcontractor_can_upload_file(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/files/",
            {"file": SimpleUploadedFile("photo.txt", b"photo", content_type="text/plain")},
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            MilestoneFile.objects.filter(
                milestone=self.milestone,
                uploaded_by=self.assigned_user,
            ).exists()
        )

    def test_unassigned_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.unassigned_user)
        response = self.client.get(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/"
        )
        self.assertEqual(response.status_code, 404)

    def test_different_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/",
            {"content": "I should not be able to post here."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_contractor_access_continues_to_work(self):
        self.client.force_authenticate(user=self.contractor_user)
        comments = self.client.get(f"/api/projects/milestones/{self.milestone.id}/comments/")
        files = self.client.get(f"/api/projects/milestones/{self.milestone.id}/files/")
        self.assertEqual(comments.status_code, 200)
        self.assertEqual(files.status_code, 200)


class SubcontractorReviewRequestTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="review-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Review Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Review Homeowner",
            email="review-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Review Request Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor review requests",
        )

        self.assigned_user = user_model.objects.create_user(
            email="assigned-review@example.com",
            password="testpass123",
            first_name="Assigned",
            last_name="Reviewer",
        )
        self.other_user = user_model.objects.create_user(
            email="other-review@example.com",
            password="testpass123",
        )
        self.unassigned_user = user_model.objects.create_user(
            email="unassigned-review@example.com",
            password="testpass123",
        )

        self.assigned_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-review@example.com",
            invite_name="Assigned Reviewer",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.assigned_user,
            accepted_at=timezone.now(),
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-review@example.com",
            invite_name="Other Reviewer",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Tile Install",
            description="Install floor tile",
            amount="1800.00",
            assigned_subcontractor_invitation=self.assigned_invitation,
        )
        self.client = APIClient()

    def test_assigned_subcontractor_can_request_review(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.subcontractor_review_requested_by_id, self.assigned_user.id)
        self.assertIsNotNone(self.milestone.subcontractor_review_requested_at)

    def test_assigned_subcontractor_can_include_optional_note(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Tile layout is ready for inspection."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_review_note,
            "Tile layout is ready for inspection.",
        )

    def test_unassigned_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.unassigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_different_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Not my milestone."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_contractor_sees_review_request_state_in_serializer(self):
        self.milestone.subcontractor_review_requested_at = timezone.now()
        self.milestone.subcontractor_review_requested_by = self.assigned_user
        self.milestone.subcontractor_review_note = "Ready for walkthrough."
        self.milestone.save(
            update_fields=[
                "subcontractor_review_requested_at",
                "subcontractor_review_requested_by",
                "subcontractor_review_note",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["subcontractor_review_requested"])
        self.assertEqual(payload["subcontractor_review_note"], "Ready for walkthrough.")
        self.assertEqual(payload["subcontractor_review_requested_by_display"], "Assigned Reviewer")

    def test_request_review_does_not_complete_or_invoice_milestone(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Please review."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertFalse(self.milestone.completed)
        self.assertFalse(self.milestone.is_invoiced)
        self.assertIsNone(self.milestone.invoice_id)


class ContractorNotificationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="notify-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Notify Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Notify Homeowner",
            email="notify-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Notification Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for notifications",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="notify-sub@example.com",
            password="testpass123",
            first_name="Taylor",
            last_name="Sub",
        )
        self.invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="notify-sub@example.com",
            invite_name="Taylor Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.subcontractor_user,
            accepted_at=timezone.now(),
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Countertop Install",
            description="Install countertops",
            amount="1500.00",
            assigned_subcontractor_invitation=self.invitation,
        )

        self.other_contractor_user = user_model.objects.create_user(
            email="other-notify-owner@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Other Notify Owner",
        )

        self.client = APIClient()

    def test_contractor_receives_notification_for_subcontractor_comment(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/",
            {"content": "Cabinets are staged."},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get()
        self.assertEqual(notification.contractor_id, self.contractor.id)
        self.assertEqual(notification.event_type, Notification.EVENT_SUBCONTRACTOR_COMMENT)
        self.assertEqual(notification.milestone_id, self.milestone.id)

    def test_contractor_receives_notification_for_subcontractor_file_upload(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/files/",
            {"file": SimpleUploadedFile("progress.txt", b"progress", content_type="text/plain")},
        )

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get()
        self.assertEqual(notification.event_type, Notification.EVENT_SUBCONTRACTOR_FILE)

    def test_contractor_receives_notification_for_review_request(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Ready for final walkthrough."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        notification = Notification.objects.get()
        self.assertEqual(notification.event_type, Notification.EVENT_SUBCONTRACTOR_REVIEW)
        self.assertIn("ready for review", notification.message.lower())

    def test_other_contractors_do_not_see_notifications(self):
        Notification.objects.create(
            contractor=self.contractor,
            user=self.contractor_user,
            category=Notification.EVENT_SUBCONTRACTOR_COMMENT,
            event_type=Notification.EVENT_SUBCONTRACTOR_COMMENT,
            agreement=self.agreement,
            milestone=self.milestone,
            actor_user=self.subcontractor_user,
            actor_display_name="Taylor Sub",
            actor_email="notify-sub@example.com",
            title="Subcontractor added a comment",
            message="Taylor Sub added a comment on Countertop Install.",
        )

        self.client.force_authenticate(user=self.other_contractor_user)
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_notification_center_unread_count_and_mark_read(self):
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1250.00"),
            status=InvoiceStatus.APPROVED,
        )
        unread = Notification.objects.create(
            contractor=self.contractor,
            user=self.contractor_user,
            category=Notification.EVENT_AGREEMENT_SIGNED,
            event_type=Notification.EVENT_AGREEMENT_SIGNED,
            agreement=self.agreement,
            title="Agreement signed",
            message="Your customer signed the agreement.",
            link=f"/app/agreements/{self.agreement.id}",
        )
        Notification.objects.create(
            contractor=self.contractor,
            user=self.contractor_user,
            category=Notification.EVENT_PAYMENT_RELEASED,
            event_type=Notification.EVENT_PAYMENT_RELEASED,
            agreement=self.agreement,
            invoice=invoice,
            title="Payment released",
            message="Funds were released for invoice INV-1.",
            link=f"/app/invoices/{invoice.id}",
            is_read=True,
        )

        notify_client = APIClient()
        notify_client.force_authenticate(user=self.contractor_user)

        response = notify_client.get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]["title"], "Payment released")
        self.assertEqual(response.data[1]["title"], "Agreement signed")

        unread_response = notify_client.get("/api/notifications/unread-count/")
        self.assertEqual(unread_response.status_code, 200)
        self.assertEqual(unread_response.data["count"], 1)

        mark_read_response = notify_client.post(f"/api/notifications/{unread.id}/read/")
        self.assertEqual(mark_read_response.status_code, 200)
        self.assertTrue(mark_read_response.data["is_read"])

        unread_after_response = notify_client.get("/api/notifications/unread-count/")
        self.assertEqual(unread_after_response.status_code, 200)
        self.assertEqual(unread_after_response.data["count"], 0)

        mark_all_response = notify_client.post("/api/notifications/mark-all-read/")
        self.assertEqual(mark_all_response.status_code, 200)
        self.assertGreaterEqual(mark_all_response.data["updated"], 0)


class SubcontractorCompletionReviewTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="completion-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Completion Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Completion Homeowner",
            email="completion-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Completion Review Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor completion review",
        )

        self.assigned_user = user_model.objects.create_user(
            email="assigned-complete@example.com",
            password="testpass123",
            first_name="Assigned",
            last_name="Complete",
        )
        self.other_user = user_model.objects.create_user(
            email="other-complete@example.com",
            password="testpass123",
        )
        self.unassigned_user = user_model.objects.create_user(
            email="unassigned-complete@example.com",
            password="testpass123",
        )

        self.assigned_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-complete@example.com",
            invite_name="Assigned Complete",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.assigned_user,
            accepted_at=timezone.now(),
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-complete@example.com",
            invite_name="Other Complete",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Finish Carpentry",
            description="Install trim and casing",
            amount="2200.00",
            assigned_subcontractor_invitation=self.assigned_invitation,
        )
        self.reviewer_user = user_model.objects.create_user(
            email="reviewer-complete@example.com",
            password="testpass123",
        )
        self.reviewer_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.reviewer_user,
            display_name="Delegated Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        self.worker_user = user_model.objects.create_user(
            email="internal-worker@example.com",
            password="testpass123",
        )
        self.worker_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.worker_user,
            display_name="Internal Worker",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.client = APIClient()

    def test_assigned_subcontractor_can_submit_completion_for_review(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        self.assertEqual(self.milestone.subcontractor_marked_complete_by_id, self.assigned_user.id)

    def test_internal_team_member_can_submit_work_when_assigned(self):
        self.milestone.assigned_subcontractor_invitation = None
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])
        MilestoneAssignment.objects.create(
            milestone=self.milestone,
            subaccount=self.worker_subaccount,
        )

        self.client.force_authenticate(user=self.worker_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/submit-work/",
            {"note": "Internal team work is ready."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        self.assertEqual(self.milestone.subcontractor_marked_complete_by_id, self.worker_user.id)

    def test_optional_subcontractor_note_is_stored(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {"note": "Trim is installed and caulked."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.subcontractor_completion_note, "Trim is installed and caulked.")

    def test_unassigned_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.unassigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_different_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {"note": "Not my work."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_subcontractor_cannot_be_reviewer(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-work/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_contractor_can_approve_submitted_completion(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-subcontractor-completion/",
            {"response_note": "Looks good."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.APPROVED,
        )
        self.assertEqual(self.milestone.subcontractor_review_response_note, "Looks good.")

    def test_delegated_reviewer_can_review_if_assigned(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.delegated_reviewer_subaccount = self.reviewer_subaccount
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "delegated_reviewer_subaccount",
            ]
        )

        self.client.force_authenticate(user=self.reviewer_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-work/",
            {"response_note": "Approved by delegated reviewer."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.APPROVED,
        )
        self.assertEqual(self.milestone.subcontractor_reviewed_by_id, self.reviewer_user.id)

    def test_contractor_can_reject_submitted_completion(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/reject-subcontractor-completion/",
            {"response_note": "Please tighten the outside corners."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.NEEDS_CHANGES,
        )
        self.assertEqual(
            self.milestone.subcontractor_review_response_note,
            "Please tighten the outside corners.",
        )

    def test_review_actions_do_not_mark_milestone_complete_or_invoiced(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-subcontractor-completion/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertFalse(self.milestone.completed)
        self.assertFalse(self.milestone.is_invoiced)
        self.assertIsNone(self.milestone.invoice_id)

    def test_serializer_exposes_subcontractor_completion_review_state(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.NEEDS_CHANGES
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.subcontractor_completion_note = "Trim installed."
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.subcontractor_review_response_note = "Please fix the hallway seam."
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_completion_note",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
                "subcontractor_review_response_note",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["subcontractor_completion_status"], "needs_changes")
        self.assertEqual(payload["subcontractor_completion_note"], "Trim installed.")
        self.assertEqual(payload["subcontractor_review_response_note"], "Please fix the hallway seam.")
        self.assertEqual(payload["assigned_worker"]["kind"], "subcontractor")
        self.assertEqual(payload["reviewer"]["kind"], "contractor_owner")
        self.assertTrue(payload["can_current_user_review_work"])


class MilestonePayoutFoundationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="payout-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Payout Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Payout Homeowner",
            email="payout-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Payout Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for milestone payout tests",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="payout-sub@example.com",
            password="testpass123",
        )
        self.subcontractor_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="payout-sub@example.com",
            invite_name="Payout Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.subcontractor_user,
            accepted_at=timezone.now(),
        )

        self.internal_user = user_model.objects.create_user(
            email="payout-internal@example.com",
            password="testpass123",
        )
        self.internal_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.internal_user,
            display_name="Internal Worker",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Rough-In",
            description="Complete rough-in stage",
            amount="1800.00",
        )
        self.client = APIClient()

    def test_subcontractor_assignment_creates_payout_record(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.subcontractor_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payout = MilestonePayout.objects.get(milestone=self.milestone)
        self.assertEqual(payout.subcontractor_user_id, self.subcontractor_user.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.NOT_ELIGIBLE)
        self.assertEqual(payout.amount_cents, 180000)

    def test_internal_team_assignment_does_not_create_payout_record(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/assignments/milestones/{self.milestone.id}/assign/",
            {"subaccount_id": self.internal_subaccount.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(MilestonePayout.objects.filter(milestone=self.milestone).exists())

    def test_payout_does_not_trigger_prematurely(self):
        self.milestone.assigned_subcontractor_invitation = self.subcontractor_invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertIsNotNone(payout)
        self.assertEqual(payout.status, MilestonePayoutStatus.NOT_ELIGIBLE)

        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.subcontractor_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.NOT_ELIGIBLE)

        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
            ]
        )

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.NOT_ELIGIBLE)
        self.assertIsNone(payout.eligible_at)

    def test_payout_becomes_eligible_only_after_customer_condition(self):
        self.milestone.assigned_subcontractor_invitation = self.subcontractor_invitation
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.subcontractor_user
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.save(
            update_fields=[
                "assigned_subcontractor_invitation",
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
            ]
        )

        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=self.milestone.amount,
            status=InvoiceStatus.PENDING,
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.milestone.completed = True
        self.milestone.completed_at = timezone.now()
        self.milestone.is_invoiced = True
        self.milestone.invoice = invoice
        self.milestone.save(update_fields=["completed", "completed_at", "is_invoiced", "invoice"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.NOT_ELIGIBLE)

        invoice.status = InvoiceStatus.APPROVED
        invoice.approved_at = timezone.now()
        invoice.save(update_fields=["status", "approved_at"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.ELIGIBLE)
        self.assertIsNotNone(payout.eligible_at)
        self.assertIsNone(payout.ready_for_payout_at)

    def test_payout_status_transitions_to_ready_for_payout_after_payment(self):
        self.milestone.assigned_subcontractor_invitation = self.subcontractor_invitation
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.subcontractor_user
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.subcontractor_payout_amount_cents = 125000
        self.milestone.save(
            update_fields=[
                "assigned_subcontractor_invitation",
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
                "subcontractor_payout_amount_cents",
            ]
        )

        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=self.milestone.amount,
            status=InvoiceStatus.APPROVED,
            approved_at=timezone.now(),
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.milestone.completed = True
        self.milestone.completed_at = timezone.now()
        self.milestone.is_invoiced = True
        self.milestone.invoice = invoice
        self.milestone.save(update_fields=["completed", "completed_at", "is_invoiced", "invoice"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.ELIGIBLE)
        self.assertEqual(payout.amount_cents, 125000)

        invoice.status = InvoiceStatus.PAID
        invoice.escrow_released = True
        invoice.escrow_released_at = timezone.now()
        invoice.save(update_fields=["status", "escrow_released", "escrow_released_at"])

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.READY_FOR_PAYOUT)
        self.assertTrue(payout.ready_for_payout_at is not None)

    def test_contractor_serializer_exposes_payout_foundation_fields(self):
        self.milestone.assigned_subcontractor_invitation = self.subcontractor_invitation
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.subcontractor_user
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.save(
            update_fields=[
                "assigned_subcontractor_invitation",
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
            ]
        )
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=self.milestone.amount,
            status=InvoiceStatus.APPROVED,
            approved_at=timezone.now(),
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.milestone.completed = True
        self.milestone.completed_at = timezone.now()
        self.milestone.is_invoiced = True
        self.milestone.invoice = invoice
        self.milestone.save(update_fields=["completed", "completed_at", "is_invoiced", "invoice"])
        sync_milestone_payout(self.milestone.id)

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["payout_amount"], "1800.00")
        self.assertEqual(payload["payout_status"], "eligible")
        self.assertTrue(payload["payout_eligible"])
        self.assertFalse(payload["payout_ready"])
        self.assertIsNotNone(payload["payout_eligible_at"])
        self.assertIsNone(payload["payout_ready_for_payout_at"])
        self.assertIsNone(payload["payout_failed_at"])
        self.assertEqual(payload["payout_stripe_transfer_id"], "")


@override_settings(
    STRIPE_ENABLED=True,
    STRIPE_SECRET_KEY="sk_test_subcontractor",
    FRONTEND_URL="http://localhost:4173",
)
class SubcontractorStripePayoutExecutionTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="stripe-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Stripe Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Stripe Homeowner",
            email="stripe-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Stripe Subcontractor Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor payouts",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="stripe-sub@example.com",
            password="testpass123",
        )
        self.subcontractor_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="stripe-sub@example.com",
            invite_name="Stripe Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.subcontractor_user,
            accepted_at=timezone.now(),
        )

        self.internal_user = user_model.objects.create_user(
            email="stripe-internal@example.com",
            password="testpass123",
        )
        self.internal_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.internal_user,
            display_name="Internal Milestone Worker",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Finish Work",
            description="Complete final subcontractor work",
            amount="2400.00",
            completed=True,
            completed_at=timezone.now(),
            assigned_subcontractor_invitation=self.subcontractor_invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.subcontractor_user,
            subcontractor_reviewed_at=timezone.now(),
            subcontractor_reviewed_by=self.contractor_user,
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=self.milestone.amount,
            status=InvoiceStatus.PAID,
            approved_at=timezone.now(),
            escrow_released=True,
            escrow_released_at=timezone.now(),
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.milestone.is_invoiced = True
        self.milestone.invoice = self.invoice
        self.milestone.save(update_fields=["is_invoiced", "invoice"])
        self.payout = sync_milestone_payout(self.milestone.id)
        self.client = APIClient()

    def test_subcontractor_can_start_stripe_onboarding(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        with patch(
            "projects.services.subcontractor_payout_accounts.stripe.Account.create",
            return_value={
                "id": "acct_sub_123",
                "charges_enabled": False,
                "payouts_enabled": False,
                "details_submitted": False,
            },
        ), patch(
            "projects.services.subcontractor_payout_accounts.stripe.AccountLink.create",
            return_value={"url": "https://connect.stripe.test/onboarding/sub"},
        ):
            response = self.client.post("/api/projects/subcontractor/payout-account/start/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["url"], "https://connect.stripe.test/onboarding/sub")
        connected = ConnectedAccount.objects.get(user=self.subcontractor_user)
        self.assertEqual(connected.stripe_account_id, "acct_sub_123")

    def test_internal_team_member_cannot_onboard_for_milestone_payout(self):
        self.client.force_authenticate(user=self.internal_user)
        response = self.client.post("/api/projects/subcontractor/payout-account/start/", {}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_payout_execution_succeeds_only_for_ready_subcontractor_payouts(self):
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.client.force_authenticate(user=self.contractor_user)
        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_sub_123"},
        ):
            response = self.client.post(
                f"/api/projects/milestones/{self.milestone.id}/execute-subcontractor-payout/",
                {},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, MilestonePayoutStatus.PAID)
        self.assertEqual(self.payout.stripe_transfer_id, "tr_sub_123")
        self.assertIsNotNone(self.payout.paid_at)
        self.assertEqual(self.payout.execution_mode, "manual")

    def test_auto_payout_does_not_run_when_setting_is_off(self):
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.payout.status = MilestonePayoutStatus.ELIGIBLE
        self.payout.ready_for_payout_at = None
        self.payout.save(update_fields=["status", "ready_for_payout_at"])

        with patch("projects.services.milestone_payout_execution.stripe.Transfer.create") as transfer_create:
            payout = sync_milestone_payout(self.milestone.id)

        self.assertEqual(payout.status, MilestonePayoutStatus.READY_FOR_PAYOUT)
        self.assertFalse(transfer_create.called)

    def test_auto_payout_runs_when_setting_is_on_and_payout_becomes_ready(self):
        self.contractor.auto_subcontractor_payouts_enabled = True
        self.contractor.save(update_fields=["auto_subcontractor_payouts_enabled"])
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.payout.status = MilestonePayoutStatus.ELIGIBLE
        self.payout.ready_for_payout_at = None
        self.payout.save(update_fields=["status", "ready_for_payout_at"])

        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_auto_123"},
        ):
            payout = sync_milestone_payout(self.milestone.id)

        self.assertEqual(payout.status, MilestonePayoutStatus.PAID)
        self.assertEqual(payout.stripe_transfer_id, "tr_auto_123")
        self.assertEqual(payout.execution_mode, "automatic")

    def test_auto_payout_is_blocked_when_subcontractor_account_is_not_ready(self):
        self.contractor.auto_subcontractor_payouts_enabled = True
        self.contractor.save(update_fields=["auto_subcontractor_payouts_enabled"])
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_not_ready",
            payouts_enabled=False,
            details_submitted=False,
        )
        self.payout.status = MilestonePayoutStatus.ELIGIBLE
        self.payout.ready_for_payout_at = None
        self.payout.save(update_fields=["status", "ready_for_payout_at"])

        with patch("projects.services.milestone_payout_execution.stripe.Transfer.create") as transfer_create:
            payout = sync_milestone_payout(self.milestone.id)

        self.assertEqual(payout.status, MilestonePayoutStatus.READY_FOR_PAYOUT)
        self.assertFalse(transfer_create.called)

    def test_auto_payout_failure_persists_failed_state_and_reason(self):
        self.contractor.auto_subcontractor_payouts_enabled = True
        self.contractor.save(update_fields=["auto_subcontractor_payouts_enabled"])
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.payout.status = MilestonePayoutStatus.ELIGIBLE
        self.payout.ready_for_payout_at = None
        self.payout.save(update_fields=["status", "ready_for_payout_at"])

        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            side_effect=Exception("auto transfer failed"),
        ):
            payout = sync_milestone_payout(self.milestone.id)

        self.assertEqual(payout.status, MilestonePayoutStatus.FAILED)
        self.assertIn("auto transfer failed", payout.failure_reason)
        self.assertEqual(payout.execution_mode, "automatic")

    def test_payout_execution_is_denied_for_internal_workers(self):
        internal_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Internal Assignment",
            description="Internal team should never pay out",
            amount="900.00",
            completed=True,
            completed_at=timezone.now(),
            subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.internal_user,
            subcontractor_reviewed_at=timezone.now(),
            subcontractor_reviewed_by=self.contractor_user,
        )
        MilestoneAssignment.objects.create(
            milestone=internal_milestone,
            subaccount=self.internal_subaccount,
        )
        internal_invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=internal_milestone.amount,
            status=InvoiceStatus.PAID,
            approved_at=timezone.now(),
            escrow_released=True,
            escrow_released_at=timezone.now(),
            milestone_id_snapshot=internal_milestone.id,
            milestone_title_snapshot=internal_milestone.title,
        )
        internal_milestone.is_invoiced = True
        internal_milestone.invoice = internal_invoice
        internal_milestone.save(update_fields=["is_invoiced", "invoice"])
        bogus_payout = MilestonePayout.objects.create(
            milestone=internal_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=90000,
            status=MilestonePayoutStatus.READY_FOR_PAYOUT,
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{internal_milestone.id}/execute-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        bogus_payout.refresh_from_db()
        self.assertEqual(bogus_payout.status, MilestonePayoutStatus.READY_FOR_PAYOUT)

    def test_auto_payout_is_blocked_for_internal_workers(self):
        self.contractor.auto_subcontractor_payouts_enabled = True
        self.contractor.save(update_fields=["auto_subcontractor_payouts_enabled"])
        internal_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=4,
            title="Internal Auto Assignment",
            description="Internal team should never pay out",
            amount="950.00",
            completed=True,
            completed_at=timezone.now(),
            subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.internal_user,
            subcontractor_reviewed_at=timezone.now(),
            subcontractor_reviewed_by=self.contractor_user,
        )
        MilestoneAssignment.objects.create(
            milestone=internal_milestone,
            subaccount=self.internal_subaccount,
        )
        internal_invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=internal_milestone.amount,
            status=InvoiceStatus.PAID,
            approved_at=timezone.now(),
            escrow_released=True,
            escrow_released_at=timezone.now(),
            milestone_id_snapshot=internal_milestone.id,
            milestone_title_snapshot=internal_milestone.title,
        )
        internal_milestone.is_invoiced = True
        internal_milestone.invoice = internal_invoice
        internal_milestone.save(update_fields=["is_invoiced", "invoice"])

        with patch("projects.services.milestone_payout_execution.stripe.Transfer.create") as transfer_create:
            payout = sync_milestone_payout(internal_milestone.id)

        self.assertIsNone(payout)
        self.assertFalse(transfer_create.called)

    def test_payout_execution_is_denied_for_non_ready_payouts(self):
        self.payout.status = MilestonePayoutStatus.ELIGIBLE
        self.payout.ready_for_payout_at = None
        self.payout.save(update_fields=["status", "ready_for_payout_at"])

        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/execute-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, MilestonePayoutStatus.ELIGIBLE)

    def test_duplicate_payout_execution_is_prevented(self):
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.client.force_authenticate(user=self.contractor_user)
        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_sub_once"},
        ):
            first = self.client.post(
                f"/api/projects/milestones/{self.milestone.id}/execute-subcontractor-payout/",
                {},
                format="json",
            )

        second = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/execute-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)

    def test_duplicate_payment_is_prevented_when_auto_and_manual_flows_interact(self):
        self.contractor.auto_subcontractor_payouts_enabled = True
        self.contractor.save(update_fields=["auto_subcontractor_payouts_enabled"])
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.payout.status = MilestonePayoutStatus.ELIGIBLE
        self.payout.ready_for_payout_at = None
        self.payout.save(update_fields=["status", "ready_for_payout_at"])

        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_auto_once"},
        ):
            payout = sync_milestone_payout(self.milestone.id)

        self.assertEqual(payout.status, MilestonePayoutStatus.PAID)
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/execute-subcontractor-payout/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_payout_failure_persists_failed_status_and_reason(self):
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.client.force_authenticate(user=self.contractor_user)
        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            side_effect=Exception("transfer failed"),
        ):
            response = self.client.post(
                f"/api/projects/milestones/{self.milestone.id}/execute-subcontractor-payout/",
                {},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, MilestonePayoutStatus.FAILED)
        self.assertIn("transfer failed", self.payout.failure_reason)
        self.assertIsNotNone(self.payout.failed_at)

    def test_failed_payout_can_be_retried_successfully(self):
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.payout.status = MilestonePayoutStatus.FAILED
        self.payout.failed_at = timezone.now()
        self.payout.failure_reason = "temporary stripe issue"
        self.payout.save(update_fields=["status", "failed_at", "failure_reason"])

        self.client.force_authenticate(user=self.contractor_user)
        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_retry_123"},
        ):
            response = self.client.post(
                f"/api/projects/milestones/{self.milestone.id}/retry-subcontractor-payout/",
                {},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, MilestonePayoutStatus.PAID)
        self.assertEqual(self.payout.stripe_transfer_id, "tr_retry_123")
        self.assertEqual(self.payout.failure_reason, "")
        self.assertIsNotNone(self.payout.paid_at)

    def test_retry_failure_persists_failed_status_and_reason(self):
        ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_sub_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.payout.status = MilestonePayoutStatus.FAILED
        self.payout.failed_at = timezone.now()
        self.payout.failure_reason = "temporary stripe issue"
        self.payout.save(update_fields=["status", "failed_at", "failure_reason"])

        self.client.force_authenticate(user=self.contractor_user)
        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            side_effect=Exception("retry transfer failed"),
        ):
            response = self.client.post(
                f"/api/projects/milestones/{self.milestone.id}/retry-subcontractor-payout/",
                {},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, MilestonePayoutStatus.FAILED)
        self.assertIn("retry transfer failed", self.payout.failure_reason)
        self.assertIsNotNone(self.payout.failed_at)

    def test_cannot_retry_paid_payout(self):
        self.payout.status = MilestonePayoutStatus.PAID
        self.payout.paid_at = timezone.now()
        self.payout.stripe_transfer_id = "tr_paid_existing"
        self.payout.save(update_fields=["status", "paid_at", "stripe_transfer_id"])

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/retry-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_cannot_retry_non_failed_payout(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/retry-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_retry_is_denied_for_internal_worker_payouts(self):
        internal_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Internal Retry Assignment",
            description="Internal team should never pay out",
            amount="700.00",
            completed=True,
            completed_at=timezone.now(),
            subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.internal_user,
            subcontractor_reviewed_at=timezone.now(),
            subcontractor_reviewed_by=self.contractor_user,
        )
        MilestoneAssignment.objects.create(
            milestone=internal_milestone,
            subaccount=self.internal_subaccount,
        )
        bogus_payout = MilestonePayout.objects.create(
            milestone=internal_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=70000,
            status=MilestonePayoutStatus.FAILED,
            failed_at=timezone.now(),
            failure_reason="bad worker type",
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{internal_milestone.id}/retry-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        bogus_payout.refresh_from_db()
        self.assertEqual(bogus_payout.status, MilestonePayoutStatus.FAILED)

    def test_failed_payout_can_be_reset_to_ready(self):
        self.payout.status = MilestonePayoutStatus.FAILED
        self.payout.failed_at = timezone.now()
        self.payout.failure_reason = "bank account issue"
        self.payout.save(update_fields=["status", "failed_at", "failure_reason"])

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/reset-subcontractor-payout/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, MilestonePayoutStatus.READY_FOR_PAYOUT)
        self.assertEqual(self.payout.failure_reason, "")
        self.assertIsNone(self.payout.failed_at)
        self.assertIsNotNone(self.payout.ready_for_payout_at)


class SubcontractorQuoteRequestTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="quote-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Quote Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Quote Homeowner",
            email="quote-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Quote Workflow Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor quote tests",
            pricing_strategy="requires_sub_quote",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            description="Install cabinets and finish trim.",
            amount="2000.00",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="quote-sub@example.com",
            password="testpass123",
            first_name="Quote",
            last_name="Sub",
        )
        self.other_subcontractor_user = user_model.objects.create_user(
            email="other-quote-sub@example.com",
            password="testpass123",
        )
        self.accepted_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="quote-sub@example.com",
            invite_name="Quote Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.subcontractor_user,
            accepted_at=timezone.now(),
        )
        SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-quote-sub@example.com",
            invite_name="Other Quote Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_subcontractor_user,
            accepted_at=timezone.now(),
        )
        self.client = APIClient()

    def _create_quote(self, *, contractor_message="Please quote this milestone."):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            "/api/projects/subcontractor-quotes/",
            {
                "agreement_id": self.agreement.id,
                "milestone_id": self.milestone.id,
                "subcontractor_invitation_id": self.accepted_invitation.id,
                "contractor_message": contractor_message,
                "scope_snapshot": {
                    "milestone_title": self.milestone.title,
                    "milestone_description": self.milestone.description,
                    "agreement_title": getattr(self.agreement, "title", "") or self.agreement.description,
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        return SubcontractorQuoteRequest.objects.get(pk=response.json()["id"])

    def _respond_to_quote(self, quote, *, amount="1850.00"):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/respond/",
            {
                "quoted_amount": amount,
                "subcontractor_message": "Happy to do it.",
                "estimated_start_date": "2026-04-10",
                "estimated_completion_date": "2026-04-14",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        quote.refresh_from_db()
        return quote

    def test_contractor_can_create_quote_request(self):
        quote = self._create_quote()

        self.assertEqual(quote.status, SubcontractorQuoteRequestStatus.SENT)
        self.assertEqual(quote.contractor_message, "Please quote this milestone.")
        self.assertEqual(quote.scope_snapshot["milestone_title"], "Cabinet Install")
        self.assertEqual(quote.subcontractor_invitation_id, self.accepted_invitation.id)

        readiness = get_pricing_readiness_for_agreement(self.agreement)
        self.assertTrue(readiness["blocked"])
        self.assertEqual(readiness["pending_quote_count"], 1)
        self.assertEqual(readiness["safe_summary"], "This agreement requires subcontractor pricing before it can be sent.")
        self.assertEqual(readiness["requires_sub_quote_unresolved_count"], 1)
        self.assertEqual(readiness["requires_sub_quote_accepted_count"], 0)

    def test_unrelated_subcontractor_cannot_view_or_respond(self):
        quote = self._create_quote()

        self.client.force_authenticate(user=self.other_subcontractor_user)
        assigned = self.client.get("/api/projects/subcontractor-quotes/assigned/")
        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.json()["results"], [])

        response = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/respond/",
            {"quoted_amount": "1800.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_subcontractor_can_respond_and_contractor_can_accept_quote(self):
        quote = self._create_quote()
        quote = self._respond_to_quote(quote)

        self.client.force_authenticate(user=self.subcontractor_user)
        subcontractor_view = self.client.get("/api/projects/subcontractor-quotes/assigned/")
        self.assertEqual(subcontractor_view.status_code, 200)
        row = subcontractor_view.json()["results"][0]
        self.assertEqual(row["status"], SubcontractorQuoteRequestStatus.RESPONDED)
        self.assertNotIn("customer_agreement_total", row)
        self.assertNotIn("customer_milestone_amount", row)

        self.client.force_authenticate(user=self.contractor_user)
        accept_response = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/accept/",
            {"payment_release_mode": "manual_release"},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)
        quote.refresh_from_db()
        self.assertEqual(quote.status, SubcontractorQuoteRequestStatus.ACCEPTED)
        self.assertIsNotNone(quote.linked_subcontractor_milestone_agreement_id)
        agreement = quote.linked_subcontractor_milestone_agreement
        self.assertEqual(agreement.agreed_pay, Decimal("1850.00"))
        self.assertEqual(agreement.payment_release_mode, SubcontractorPaymentReleaseMode.MANUAL_RELEASE)
        self.assertIsNone(getattr(self.milestone, "payout_record", None))

        readiness = get_pricing_readiness_for_agreement(self.agreement)
        self.assertFalse(readiness["blocked"])
        self.assertEqual(readiness["pending_quote_count"], 0)
        self.assertEqual(readiness["safe_summary"], "All required subcontractor pricing is ready.")
        self.assertEqual(readiness["requires_sub_quote_unresolved_count"], 0)
        self.assertEqual(readiness["requires_sub_quote_accepted_count"], 1)

    def test_quote_over_milestone_amount_requires_override_reason(self):
        quote = self._create_quote()
        quote = self._respond_to_quote(quote, amount="2600.00")

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/accept/",
            {"payment_release_mode": "manual_release"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("customer price", str(response.json()).lower())

        allowed = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/accept/",
            {
                "payment_release_mode": "auto_after_customer_approval",
                "override_reason": "Scope expanded after customer approval.",
            },
            format="json",
        )
        self.assertEqual(allowed.status_code, 200)
        quote.refresh_from_db()
        self.assertEqual(quote.status, SubcontractorQuoteRequestStatus.ACCEPTED)
        self.assertEqual(
            quote.linked_subcontractor_milestone_agreement.payment_release_mode,
            SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL,
        )

    def test_public_sign_blocks_until_required_subcontractor_quote_is_accepted(self):
        token = build_public_sign_url(self.agreement).rsplit("/", 1)[-1]
        blocked_response = self.client.post(
            "/api/projects/agreements/public_sign/",
            {
                "token": token,
                "typed_name": "Quote Customer",
                "signature_data_url": "data:image/png;base64," + base64.b64encode(b"signature").decode(),
            },
            format="multipart",
        )
        self.assertEqual(blocked_response.status_code, 400)
        self.assertIn("subcontractor pricing", str(blocked_response.json()).lower())

        quote = self._create_quote()
        quote = self._respond_to_quote(quote)

        self.client.force_authenticate(user=self.contractor_user)
        accept_response = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/accept/",
            {"payment_release_mode": "manual_release"},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)

        self.client.force_authenticate(user=self.contractor_user)
        allowed_response = self.client.post(
            "/api/projects/agreements/public_sign/",
            {
                "token": token,
                "typed_name": "Quote Customer",
                "signature_data_url": "data:image/png;base64," + base64.b64encode(b"signature").decode(),
            },
            format="multipart",
        )
        self.assertEqual(allowed_response.status_code, 200)

    def test_revision_decline_and_cancel_states_work(self):
        quote = self._create_quote()
        quote = self._respond_to_quote(quote)

        self.client.force_authenticate(user=self.contractor_user)
        revision = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/request-revision/",
            {"revision_note": "Please trim the labor scope."},
            format="json",
        )
        self.assertEqual(revision.status_code, 200)
        quote.refresh_from_db()
        self.assertEqual(quote.status, SubcontractorQuoteRequestStatus.REVISION_REQUESTED)

        decline = self.client.post(
            f"/api/projects/subcontractor-quotes/{quote.id}/decline/",
            {},
            format="json",
        )
        self.assertEqual(decline.status_code, 200)
        quote.refresh_from_db()
        self.assertEqual(quote.status, SubcontractorQuoteRequestStatus.DECLINED)

        next_quote = self._create_quote(contractor_message="Second quote request.")
        cancel = self.client.post(f"/api/projects/subcontractor-quotes/{next_quote.id}/cancel/", {}, format="json")
        self.assertEqual(cancel.status_code, 200)
        next_quote.refresh_from_db()
        self.assertEqual(next_quote.status, SubcontractorQuoteRequestStatus.CANCELLED)


@override_settings(
    STRIPE_ENABLED=True,
    STRIPE_SECRET_KEY="sk_test_subcontractor_orchestration",
    FRONTEND_URL="http://localhost:4173",
)
class SubcontractorPayoutOrchestrationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="orch-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Orchestration Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Jordan Demo",
            email="jordan@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Orchestration Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            total_cost=Decimal("8000.00"),
            payment_mode="escrow",
            status=ProjectStatus.SIGNED,
            signed_by_contractor=True,
            signed_by_homeowner=True,
            reviewed=True,
            reviewed_at=timezone.now(),
        )
        self.subcontractor_user = user_model.objects.create_user(
            email="orch-sub@example.com",
            password="testpass123",
        )
        self.connected_account = ConnectedAccount.objects.create(
            user=self.subcontractor_user,
            stripe_account_id="acct_orch_ready",
            payouts_enabled=True,
            details_submitted=True,
        )
        self.accepted_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="orch-sub@example.com",
            invite_name="Orch Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.subcontractor_user,
            accepted_at=timezone.now(),
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            description="Install cabinets and finish trim.",
            amount="2000.00",
            completed=True,
            completed_at=timezone.now(),
            assigned_subcontractor_invitation=self.accepted_invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.subcontractor_user,
            subcontractor_reviewed_at=timezone.now(),
            subcontractor_reviewed_by=self.contractor_user,
            is_invoiced=True,
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=self.milestone.amount,
            status=InvoiceStatus.PENDING,
            milestone_id_snapshot=self.milestone.id,
            milestone_title_snapshot=self.milestone.title,
        )
        self.milestone.invoice = self.invoice
        self.milestone.save(update_fields=["invoice"])
        self.client = APIClient()

    def _create_terms(self, *, payment_release_mode="manual_release", agreed_pay="1750.00", accepted=False):
        agreement = upsert_subcontractor_milestone_agreement(
            contractor=self.contractor,
            agreement=self.agreement,
            milestone=self.milestone,
            invitation=self.accepted_invitation,
            agreed_pay=agreed_pay,
            payment_release_mode=payment_release_mode,
            send_agreement=True,
        )
        if accepted:
            agreement = accept_subcontractor_milestone_agreement(
                agreement_obj=agreement,
                user=self.subcontractor_user,
            )
        self.milestone.refresh_from_db()
        return agreement

    def _mark_customer_paid(self, *, paid_at=None):
        paid_at = paid_at or timezone.now()
        self.invoice.status = InvoiceStatus.PAID
        self.invoice.approved_at = self.invoice.approved_at or paid_at
        self.invoice.escrow_released = True
        self.invoice.escrow_released_at = paid_at
        self.invoice.save(
            update_fields=["status", "approved_at", "escrow_released", "escrow_released_at"]
        )
        self.milestone.is_invoiced = True
        self.milestone.completed = True
        self.milestone.completed_at = self.milestone.completed_at or paid_at
        self.milestone.save(update_fields=["is_invoiced", "completed", "completed_at"])

    def test_manual_release_default_creates_not_due_status(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)
        self.milestone.refresh_from_db()

        eligibility = evaluate_subcontractor_payout_eligibility(agreement)
        self.assertEqual(eligibility["next_status"], "not_due")
        self.assertFalse(eligibility["can_manual_release"])
        self.assertIn("customer_not_approved_or_paid", eligibility["blocking_reasons"])

    def test_manual_release_becomes_ready_after_customer_payment(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)
        self._mark_customer_paid()

        payout = sync_milestone_payout(self.milestone.id)
        self.assertEqual(payout.status, MilestonePayoutStatus.READY_FOR_PAYOUT)

        eligibility = evaluate_subcontractor_payout_eligibility(agreement)
        self.assertEqual(eligibility["next_status"], "ready")
        self.assertTrue(eligibility["can_manual_release"])

    def test_manual_release_endpoint_uses_existing_payout_execution(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)
        self._mark_customer_paid()
        sync_milestone_payout(self.milestone.id)

        self.client.force_authenticate(user=self.contractor_user)
        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_manual_release_123"},
        ):
            response = self.client.post(
                f"/api/projects/subcontractor-agreements/{agreement.id}/release-payment/",
                {},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        payout = self.milestone.payout_record
        self.assertEqual(payout.status, MilestonePayoutStatus.PAID)
        self.assertEqual(payout.stripe_transfer_id, "tr_manual_release_123")
        self.assertEqual(payout.execution_mode, MilestonePayoutExecutionMode.MANUAL)

    def test_auto_release_mode_does_not_pay_before_customer_payment(self):
        agreement = self._create_terms(payment_release_mode="auto_after_customer_approval", accepted=True)
        eligibility = evaluate_subcontractor_payout_eligibility(agreement)
        self.assertEqual(eligibility["next_status"], "not_due")
        self.assertFalse(eligibility["can_auto_release"])

        with patch("projects.services.milestone_payout_execution.stripe.Transfer.create") as transfer_create:
            payout = orchestrate_subcontractor_payout_for_milestone(
                self.milestone.id,
                trigger="customer_payment_released",
                actor_user=self.contractor_user,
            )

        self.assertFalse(transfer_create.called)
        self.assertIn(payout["next_status"], {"not_due", "blocked"})

    def test_auto_release_after_customer_payment_executes_once(self):
        agreement = self._create_terms(payment_release_mode="auto_after_customer_approval", accepted=True)
        self._mark_customer_paid()

        with patch(
            "projects.services.milestone_payout_execution.stripe.Transfer.create",
            return_value={"id": "tr_auto_release_123"},
        ) as transfer_create:
            payload = orchestrate_subcontractor_payout_for_milestone(
                self.milestone.id,
                trigger="customer_payment_released",
                actor_user=self.contractor_user,
            )
            second = orchestrate_subcontractor_payout_for_milestone(
                self.milestone.id,
                trigger="customer_payment_released",
                actor_user=self.contractor_user,
            )

        self.assertEqual(transfer_create.call_count, 1)
        self.assertEqual(payload["payout_state"], "paid")
        self.assertEqual(second["payout_state"], "paid")
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.payout_record.stripe_transfer_id, "tr_auto_release_123")

    def test_dispute_blocks_payout(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)
        self._mark_customer_paid()
        Dispute.objects.create(
            agreement=self.agreement,
            milestone=self.milestone,
            status="open",
            created_by=self.contractor_user,
            initiator="contractor",
            reason="Payment dispute",
            description="Customer approved the milestone, but subcontractor payment is under dispute.",
        )

        payload = orchestrate_subcontractor_payout_for_milestone(
            self.milestone.id,
            trigger="customer_payment_released",
            actor_user=self.contractor_user,
        )

        self.assertEqual(payload["next_status"], "cancelled")
        self.assertIn("active_dispute", payload["blocking_reasons"])
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.payout_record.status, MilestonePayoutStatus.NOT_ELIGIBLE)
        self.assertFalse((self.milestone.payout_record.stripe_transfer_id or "").strip())

    def test_subcontractor_cannot_release_own_payment(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)
        self._mark_customer_paid()
        sync_milestone_payout(self.milestone.id)

        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor-agreements/{agreement.id}/release-payment/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_unrelated_contractor_cannot_release_payment(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)
        self._mark_customer_paid()
        sync_milestone_payout(self.milestone.id)
        other_user = get_user_model().objects.create_user(
            email="other-owner@example.com",
            password="testpass123",
        )
        other_contractor = Contractor.objects.create(
            user=other_user,
            business_name="Other Contractor",
        )

        self.client.force_authenticate(user=other_user)
        response = self.client.post(
            f"/api/projects/subcontractor-agreements/{agreement.id}/release-payment/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(other_contractor.business_name, "Other Contractor")

    def test_subcontractor_safe_serializer_hides_customer_totals(self):
        agreement = self._create_terms(payment_release_mode="manual_release", accepted=True)

        contractor_payload = serialize_subcontractor_payout_orchestration(agreement, contractor_view=True)
        subcontractor_payload = serialize_subcontractor_payout_orchestration(agreement, subcontractor_view=True)

        self.assertIn("customer_milestone_amount", contractor_payload)
        self.assertIn("customer_agreement_total", contractor_payload)
        self.assertNotIn("customer_milestone_amount", subcontractor_payload)
        self.assertNotIn("customer_agreement_total", subcontractor_payload)


class ReviewerQueueTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="queue-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Queue Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Queue Homeowner",
            email="queue-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Reviewer Queue Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for reviewer queue tests",
            project_class=AgreementProjectClass.COMMERCIAL,
        )

        self.worker_user = user_model.objects.create_user(
            email="queue-worker@example.com",
            password="testpass123",
            first_name="Queue",
            last_name="Worker",
        )
        self.subcontractor_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="queue-worker@example.com",
            invite_name="Queue Worker",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.worker_user,
            accepted_at=timezone.now(),
        )

        self.delegated_user = user_model.objects.create_user(
            email="queue-reviewer@example.com",
            password="testpass123",
        )
        self.delegated_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.delegated_user,
            display_name="Delegated Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )

        self.non_reviewer_user = user_model.objects.create_user(
            email="queue-readonly@example.com",
            password="testpass123",
        )
        self.non_reviewer_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.non_reviewer_user,
            display_name="Readonly Team Member",
            role=ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
        )

        self.default_review_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Demo Cabinets",
            description="Default contractor review item",
            amount="1200.00",
            assigned_subcontractor_invitation=self.subcontractor_invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.worker_user,
            subcontractor_completion_note="Cabinets are installed and aligned.",
        )
        self.delegated_review_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Tile Backsplash",
            description="Delegated reviewer item",
            amount="900.00",
            assigned_subcontractor_invitation=self.subcontractor_invitation,
            delegated_reviewer_subaccount=self.delegated_subaccount,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.worker_user,
            subcontractor_completion_note="Tile is set and grouted.",
        )
        self.approved_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Punch List",
            description="Already approved item",
            amount="200.00",
            assigned_subcontractor_invitation=self.subcontractor_invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.worker_user,
        )

        self.client = APIClient()

    def test_contractor_owner_sees_only_default_reviewer_items(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/milestones/reviewer-queue/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(len(payload["groups"]), 1)
        self.assertEqual(payload["groups"][0]["project_class"], AgreementProjectClass.COMMERCIAL)
        self.assertEqual(payload["groups"][0]["project_class_label"], "Commercial")
        item = payload["groups"][0]["milestones"][0]
        self.assertEqual(item["id"], self.default_review_milestone.id)
        self.assertEqual(item["assigned_worker_display"], "Queue Worker")
        self.assertEqual(item["reviewer"]["kind"], "contractor_owner")
        self.assertEqual(item["project_class"], AgreementProjectClass.COMMERCIAL)
        self.assertEqual(item["project_class_label"], "Commercial")
        self.assertEqual(
            item["work_submission_note"],
            "Cabinets are installed and aligned.",
        )

    def test_delegated_reviewer_sees_only_items_assigned_to_them(self):
        self.client.force_authenticate(user=self.delegated_user)
        response = self.client.get("/api/projects/milestones/reviewer-queue/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        item = payload["milestones"][0]
        self.assertEqual(item["id"], self.delegated_review_milestone.id)
        self.assertEqual(item["reviewer_display"], "Delegated Reviewer")

    def test_subcontractor_does_not_see_reviewer_queue(self):
        self.client.force_authenticate(user=self.worker_user)
        response = self.client.get("/api/projects/milestones/reviewer-queue/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)

    def test_non_reviewer_internal_user_does_not_see_unrelated_review_items(self):
        self.client.force_authenticate(user=self.non_reviewer_user)
        response = self.client.get("/api/projects/milestones/reviewer-queue/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)

    def test_empty_state_returns_no_groups_when_nothing_is_pending_review(self):
        Milestone.objects.filter(
            id__in=[self.default_review_milestone.id, self.delegated_review_milestone.id]
        ).update(subcontractor_completion_status=SubcontractorCompletionStatus.APPROVED)

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/milestones/reviewer-queue/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "groups": [],
                "milestones": [],
                "count": 0,
            },
        )


class ContractorWhoAmIReviewQueueCountTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="whoami-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="WhoAmI Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="WhoAmI Homeowner",
            email="whoami-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="WhoAmI Review Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for whoami review count tests",
            project_class=AgreementProjectClass.RESIDENTIAL,
        )
        self.worker_user = user_model.objects.create_user(
            email="whoami-worker@example.com",
            password="testpass123",
        )
        self.invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="whoami-worker@example.com",
            invite_name="WhoAmI Worker",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.worker_user,
            accepted_at=timezone.now(),
        )
        self.review_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Countertop Review",
            description="Review item for whoami count",
            amount="450.00",
            assigned_subcontractor_invitation=self.invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.worker_user,
            subcontractor_completion_note="Countertops are ready.",
        )
        self.client = APIClient()

    def test_whoami_includes_pending_review_queue_count(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/whoami/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["type"], "contractor")
        self.assertEqual(payload["review_queue_count"], 1)

    def test_whoami_includes_team_attention_counts(self):
        self.client.force_authenticate(user=self.contractor_user)

        SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="pending-invite@example.com",
            invite_name="Pending Invite",
            status=SubcontractorInvitationStatus.PENDING,
        )

        Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Unassigned Interior",
            description="Needs an owner",
            amount="120.00",
            completion_date=timezone.localdate() - timedelta(days=3),
            subcontractor_completion_status=SubcontractorCompletionStatus.NOT_SUBMITTED,
        )

        response = self.client.get("/api/projects/whoami/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        attention = payload["attention_counts"]
        self.assertEqual(attention["awaiting_review_count"], 1)
        self.assertEqual(attention["unassigned_assignment_count"], 1)
        self.assertEqual(attention["assigned_action_count"], 1)
        self.assertEqual(attention["overdue_milestone_count"], 1)
        self.assertEqual(attention["pending_invites_count"], 1)
        self.assertGreaterEqual(attention["total_attention_count"], 4)


class ContractorTeamSummaryTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="team-summary-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Team Summary Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Team Summary Homeowner",
            email="team-summary-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Team Summary Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for team summary tests",
            project_class=AgreementProjectClass.RESIDENTIAL,
        )
        self.worker_user = user_model.objects.create_user(
            email="team-summary-worker@example.com",
            password="testpass123",
        )
        self.subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.worker_user,
            display_name="Taylor Crew",
            role="employee_supervisor",
            is_active=True,
        )
        self.invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="team-summary-worker@example.com",
            invite_name="Team Summary Worker",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.worker_user,
            accepted_at=timezone.now(),
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Team Summary Milestone",
            description="Pending review for team summary",
            amount="250.00",
            assigned_subcontractor_invitation=self.invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.worker_user,
            subcontractor_completion_note="Ready for review.",
        )
        MilestoneAssignment.objects.create(
            milestone=self.milestone,
            subaccount=self.subaccount,
        )
        self.client = APIClient()

    def test_subaccount_directory_includes_work_summary_fields(self):
        self.client.force_authenticate(user=self.contractor_user)

        response = self.client.get("/api/projects/subaccounts/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get("results", [])
        self.assertEqual(len(rows), 1)

        row = rows[0]
        self.assertEqual(row["assignment_count"], 1)
        self.assertEqual(row["active_assignment_count"], 1)
        self.assertEqual(row["pending_review_count"], 1)
        self.assertIn("last_activity_at", row)


class ContractorOperationsDashboardTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="ops-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Ops Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Ops Homeowner",
            email="ops-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Ops Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for operations dashboard",
        )
        self.worker_user = user_model.objects.create_user(
            email="ops-worker@example.com",
            password="testpass123",
            first_name="Taylor",
            last_name="Worker",
        )
        self.invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="ops-worker@example.com",
            invite_name="Taylor Worker",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.worker_user,
            accepted_at=timezone.now(),
        )

        today = timezone.localdate()
        self.review_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            description="Awaiting review today",
            amount="1500.00",
            assigned_subcontractor_invitation=self.invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
            subcontractor_marked_complete_at=timezone.now(),
            subcontractor_marked_complete_by=self.worker_user,
            subcontractor_completion_note="Ready for your walkthrough.",
        )
        self.due_today_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Paint Prep",
            description="Due today",
            amount="600.00",
            assigned_subcontractor_invitation=self.invitation,
            start_date=today,
            completion_date=today,
        )
        self.start_tomorrow_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Tile Layout",
            description="Starts tomorrow",
            amount="700.00",
            assigned_subcontractor_invitation=self.invitation,
            start_date=today + timedelta(days=1),
            completion_date=today + timedelta(days=2),
        )
        self.week_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=4,
            title="Trim Install",
            description="Due later this week",
            amount="800.00",
            assigned_subcontractor_invitation=self.invitation,
            start_date=today + timedelta(days=3),
            completion_date=today + timedelta(days=5),
        )
        self.sent_back_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=5,
            title="Countertop Scribing",
            description="Needs changes",
            amount="400.00",
            assigned_subcontractor_invitation=self.invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.NEEDS_CHANGES,
            subcontractor_reviewed_at=timezone.now(),
            subcontractor_reviewed_by=self.contractor_user,
            subcontractor_review_response_note="Please tighten the seam.",
        )
        Notification.objects.create(
            contractor=self.contractor,
            event_type=Notification.EVENT_SUBCONTRACTOR_COMMENT,
            agreement=self.agreement,
            milestone=self.due_today_milestone,
            actor_user=self.worker_user,
            actor_display_name="Taylor Worker",
            actor_email="ops-worker@example.com",
            title="Subcontractor added a comment",
            message="Taylor Worker added a comment on Paint Prep.",
        )
        MilestoneComment.objects.create(
            milestone=self.due_today_milestone,
            author=self.worker_user,
            content="Prep is ready for paint.",
        )

        other_contractor_user = user_model.objects.create_user(
            email="other-ops-owner@example.com",
            password="testpass123",
        )
        other_contractor = Contractor.objects.create(
            user=other_contractor_user,
            business_name="Other Ops Owner",
        )
        other_homeowner = Homeowner.objects.create(
            created_by=other_contractor,
            full_name="Other Homeowner",
            email="other-ops-homeowner@example.com",
        )
        other_project = Project.objects.create(
            contractor=other_contractor,
            homeowner=other_homeowner,
            title="Other Ops Project",
        )
        other_agreement = Agreement.objects.create(
            project=other_project,
            contractor=other_contractor,
            homeowner=other_homeowner,
            description="Other agreement",
        )
        Milestone.objects.create(
            agreement=other_agreement,
            order=1,
            title="Other Review",
            description="Should not leak",
            amount="100.00",
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )

        self.client = APIClient()

    def test_dashboard_endpoint_returns_all_sections(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/dashboard/operations/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["identity_type"], "contractor_owner")
        self.assertIn("today", payload)
        self.assertIn("tomorrow", payload)
        self.assertIn("this_week", payload)
        self.assertIn("recent_activity", payload)
        self.assertIn("empty_states", payload)

    def test_today_bucket_includes_review_and_actionable_items(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/dashboard/operations/")
        payload = response.json()

        item_types = {item["item_type"] for item in payload["today"]}
        self.assertIn("review_submission", item_types)
        self.assertIn("due_today", item_types)
        self.assertIn("start_today", item_types)
        self.assertIn("needs_changes", item_types)

        review_item = next(
            item for item in payload["today"] if item["item_type"] == "review_submission"
        )
        self.assertEqual(review_item["milestone_id"], self.review_milestone.id)
        self.assertEqual(review_item["assigned_worker_display"], "Taylor Worker")
        self.assertEqual(review_item["actions"][0]["label"], "Review")

    def test_tomorrow_and_this_week_buckets_include_scheduled_items(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/dashboard/operations/")
        payload = response.json()

        tomorrow_ids = {item["milestone_id"] for item in payload["tomorrow"]}
        self.assertIn(self.start_tomorrow_milestone.id, tomorrow_ids)

        week_ids = {item["milestone_id"] for item in payload["this_week"]}
        self.assertIn(self.week_milestone.id, week_ids)

    def test_contractor_only_sees_their_own_items(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/dashboard/operations/")
        payload = response.json()

        titles = {
            item["milestone_title"]
            for bucket in ("today", "tomorrow", "this_week")
            for item in payload[bucket]
        }
        self.assertNotIn("Other Review", titles)

    def test_recent_activity_includes_comment_and_review_outcome(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/dashboard/operations/")
        payload = response.json()

        activity_types = {item["item_type"] for item in payload["recent_activity"]}
        self.assertIn("subcontractor_comment", activity_types)
        self.assertIn("work_sent_back", activity_types)

    def test_empty_state_returns_empty_sections(self):
        Milestone.objects.filter(agreement=self.agreement).delete()
        Notification.objects.filter(contractor=self.contractor).delete()

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/dashboard/operations/")

        self.assertEqual(
            response.json(),
            {
                "identity_type": "contractor_owner",
                "today": [],
                "tomorrow": [],
                "this_week": [],
                "recent_activity": [],
                "empty_states": {
                    "today": "No contractor actions need attention today.",
                    "tomorrow": "Nothing is scheduled for tomorrow yet.",
                    "this_week": "Nothing else is stacked up for later this week.",
                    "recent_activity": "No recent worker activity yet.",
                },
            },
        )

    def test_internal_team_member_dashboard_contents_are_role_aware(self):
        reviewer_user = get_user_model().objects.create_user(
            email="ops-reviewer@example.com",
            password="testpass123",
        )
        reviewer_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=reviewer_user,
            display_name="Ops Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        self.review_milestone.delegated_reviewer_subaccount = reviewer_subaccount
        self.review_milestone.save(update_fields=["delegated_reviewer_subaccount"])

        self.client.force_authenticate(user=reviewer_user)
        response = self.client.get("/api/projects/dashboard/operations/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["identity_type"], "internal_team_member")
        today_types = {item["item_type"] for item in payload["today"]}
        self.assertIn("review_submission", today_types)
        review_item = next(item for item in payload["today"] if item["item_type"] == "review_submission")
        self.assertEqual(review_item["actions"][0]["label"], "Review")
        recent_types = {item["item_type"] for item in payload["recent_activity"]}
        self.assertIn("work_submitted", recent_types)

    def test_subcontractor_dashboard_contents_are_role_aware(self):
        self.client.force_authenticate(user=self.worker_user)
        response = self.client.get("/api/projects/dashboard/operations/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["identity_type"], "subcontractor")
        today_types = {item["item_type"] for item in payload["today"]}
        self.assertIn("submitted_waiting", today_types)
        self.assertIn("needs_changes", today_types)
        waiting_item = next(item for item in payload["today"] if item["item_type"] == "submitted_waiting")
        self.assertEqual(waiting_item["actions"][0]["label"], "Open Assigned Work")

    def test_unaffiliated_user_gets_homeowner_style_empty_payload(self):
        unrelated_user = get_user_model().objects.create_user(
            email="ops-homeowner-view@example.com",
            password="testpass123",
        )
        self.client.force_authenticate(user=unrelated_user)
        response = self.client.get("/api/projects/dashboard/operations/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["identity_type"], "homeowner")
        self.assertEqual(payload["today"], [])
        self.assertEqual(payload["tomorrow"], [])
        self.assertEqual(payload["this_week"], [])
        self.assertEqual(payload["recent_activity"], [])


class ContractorPayoutHistoryTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="payout-history-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Payout History Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="History Homeowner",
            email="history-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="History Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="History agreement",
        )

        self.other_contractor_user = user_model.objects.create_user(
            email="other-payout-owner@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Other Owner",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Project",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other history agreement",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="history-subcontractor@example.com",
            password="testpass123",
            first_name="Taylor",
            last_name="Sub",
        )

        self.paid_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Paid Milestone",
            amount="1000.00",
        )
        self.ready_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Ready Milestone",
            amount="800.00",
        )
        self.failed_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Failed Milestone",
            amount="600.00",
        )
        self.pending_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=4,
            title="Pending Milestone",
            amount="400.00",
        )
        self.other_milestone = Milestone.objects.create(
            agreement=self.other_agreement,
            order=1,
            title="Other Contractor Milestone",
            amount="700.00",
        )

        now = timezone.now()
        self.paid_payout = MilestonePayout.objects.create(
            milestone=self.paid_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=100000,
            status=MilestonePayoutStatus.PAID,
            eligible_at=now - timezone.timedelta(days=7),
            ready_for_payout_at=now - timezone.timedelta(days=6),
            paid_at=now - timezone.timedelta(days=2),
            stripe_transfer_id="tr_paid_hist",
            execution_mode="manual",
        )
        self.ready_payout = MilestonePayout.objects.create(
            milestone=self.ready_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=80000,
            status=MilestonePayoutStatus.READY_FOR_PAYOUT,
            eligible_at=now - timezone.timedelta(days=4),
            ready_for_payout_at=now - timezone.timedelta(days=1),
            execution_mode="automatic",
        )
        self.failed_payout = MilestonePayout.objects.create(
            milestone=self.failed_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=60000,
            status=MilestonePayoutStatus.FAILED,
            failed_at=now - timezone.timedelta(days=3),
            failure_reason="Bank rejected transfer",
            execution_mode="automatic",
        )
        self.pending_payout = MilestonePayout.objects.create(
            milestone=self.pending_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=40000,
            status=MilestonePayoutStatus.NOT_ELIGIBLE,
        )
        self.other_payout = MilestonePayout.objects.create(
            milestone=self.other_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=70000,
            status=MilestonePayoutStatus.PAID,
            paid_at=now - timezone.timedelta(days=1),
            stripe_transfer_id="tr_other_hist",
        )
        self.client = APIClient()

    def test_contractor_sees_only_their_own_payout_history(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/payouts/history/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        ids = {row["id"] for row in payload["results"]}
        self.assertIn(self.paid_payout.id, ids)
        self.assertIn(self.ready_payout.id, ids)
        self.assertIn(self.failed_payout.id, ids)
        self.assertIn(self.pending_payout.id, ids)
        self.assertNotIn(self.other_payout.id, ids)

    def test_filters_work_by_status_and_date_range(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(
            "/api/projects/payouts/history/",
            {"status": "paid", "date_from": (timezone.now() - timezone.timedelta(days=3)).date().isoformat()},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(payload["results"][0]["id"], self.paid_payout.id)

    def test_summary_totals_are_correct(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/payouts/history/")

        self.assertEqual(response.status_code, 200)
        summary = response.json()["summary"]
        self.assertEqual(summary["total_paid_amount"], "1000.00")
        self.assertEqual(summary["total_ready_amount"], "800.00")
        self.assertEqual(summary["total_failed_amount"], "600.00")
        self.assertEqual(summary["total_pending_amount"], "400.00")
        self.assertEqual(summary["record_count"], 4)

    def test_csv_export_returns_headers_and_contractor_rows_only(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/payouts/history/export/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        body = response.content.decode("utf-8")
        self.assertIn("agreement,milestone,subcontractor,amount,status,execution_mode,paid_at,failed_at,transfer_id,failure_reason", body)
        self.assertIn("History Project", body)
        self.assertNotIn("Other Project", body)

    def test_payout_detail_returns_paid_ready_and_failed_context(self):
        self.client.force_authenticate(user=self.contractor_user)

        paid_response = self.client.get(f"/api/projects/payouts/history/{self.paid_payout.id}/")
        self.assertEqual(paid_response.status_code, 200)
        paid_payload = paid_response.json()
        self.assertEqual(paid_payload["payout_id"], self.paid_payout.id)
        self.assertEqual(paid_payload["payout_status"], "paid")
        self.assertEqual(paid_payload["stripe_transfer_id"], "tr_paid_hist")
        self.assertEqual(paid_payload["effective_at"], paid_payload["paid_at"])

        ready_response = self.client.get(f"/api/projects/payouts/history/{self.ready_payout.id}/")
        self.assertEqual(ready_response.status_code, 200)
        ready_payload = ready_response.json()
        self.assertEqual(ready_payload["payout_status"], "ready_for_payout")
        self.assertEqual(ready_payload["effective_at"], ready_payload["ready_for_payout_at"])

        failed_response = self.client.get(f"/api/projects/payouts/history/{self.failed_payout.id}/")
        self.assertEqual(failed_response.status_code, 200)
        failed_payload = failed_response.json()
        self.assertEqual(failed_payload["payout_status"], "failed")
        self.assertEqual(failed_payload["failure_reason"], "Bank rejected transfer")
        self.assertEqual(failed_payload["effective_at"], failed_payload["failed_at"])

    def test_payout_detail_is_contractor_scoped_and_missing_is_404(self):
        self.client.force_authenticate(user=self.contractor_user)

        other_response = self.client.get(f"/api/projects/payouts/history/{self.other_payout.id}/")
        self.assertEqual(other_response.status_code, 404)

        missing_response = self.client.get("/api/projects/payouts/history/999999/")
        self.assertEqual(missing_response.status_code, 404)


class ContractorCompletedPayoutHistoryTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="completed-payout-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Completed Payout Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Completed Homeowner",
            email="completed-homeowner@example.com",
        )
        self.res_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Residential Finish",
        )
        self.com_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Commercial Finish",
        )
        self.res_agreement = Agreement.objects.create(
            project=self.res_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Residential payout agreement",
            project_class=AgreementProjectClass.RESIDENTIAL,
        )
        self.com_agreement = Agreement.objects.create(
            project=self.com_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Commercial payout agreement",
            project_class=AgreementProjectClass.COMMERCIAL,
        )

        self.non_contractor_user = user_model.objects.create_user(
            email="non-contractor-payout@example.com",
            password="testpass123",
        )

        now = timezone.now()
        self.invoice = Invoice.objects.create(
            agreement=self.res_agreement,
            amount="1200.00",
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=now - timezone.timedelta(days=2),
            stripe_transfer_id="tr_invoice_completed",
            platform_fee_cents=6000,
            payout_cents=114000,
        )
        self.draw = DrawRequest.objects.create(
            agreement=self.com_agreement,
            draw_number=1,
            status=DrawRequestStatus.RELEASED,
            title="Commercial Draw",
            gross_amount="1800.00",
            retainage_amount="90.00",
            net_amount="1710.00",
            previous_payments_amount="0.00",
            current_requested_amount="1800.00",
            platform_fee_cents=9000,
            payout_cents=171000,
            released_at=now - timezone.timedelta(days=1),
            transfer_created_at=now - timezone.timedelta(days=1),
            stripe_transfer_id="tr_draw_completed",
        )
        self.client = APIClient()

    def _create_completed_agreement(
        self,
        *,
        total_cost=Decimal("12000.00"),
        actual_total=None,
        status=ProjectStatus.COMPLETED,
        use_template=True,
    ):
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title=f"Public Presence Project {Agreement.objects.count() + 1}",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78701",
            status=ProjectStatus.IN_PROGRESS,
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template_name_snapshot="Kitchen Remodel Template Public Profile" if use_template else "",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            payment_mode="direct",
            signature_policy="both_required",
            total_cost=total_cost,
            start_date=timezone.localdate() - timedelta(days=14),
            completed_date=timezone.localdate() - timedelta(days=1),
            status=status,
        )
        Milestone.objects.create(
            agreement=agreement,
            title="Demo and Prep",
            description="Prepare the site.",
            amount=Decimal("4000.00"),
            due_date=timezone.localdate() + timedelta(days=7),
        )
        Milestone.objects.create(
            agreement=agreement,
            title="Install and Finish",
            description="Complete the job.",
            amount=actual_total or Decimal("8000.00"),
            due_date=timezone.localdate() + timedelta(days=14),
        )
        Invoice.objects.create(
            agreement=agreement,
            amount=actual_total or Decimal("8000.00"),
            status=InvoiceStatus.PAID,
            direct_pay_paid_at=timezone.now() - timedelta(days=1),
        )
        return agreement

    def _seed_contractor_benchmark_snapshot(
        self,
        *,
        template_used: str,
        total_project_value: Decimal,
        actual_duration_days: int,
        milestone_count: int,
        dispute_flag: bool = False,
        amendment_count: int = 0,
    ):
        agreement = self._create_completed_agreement(
            total_cost=total_project_value,
            actual_total=total_project_value,
            status=ProjectStatus.COMPLETED,
            use_template=True,
        )
        snapshot = capture_project_outcome_snapshot(agreement)
        snapshot.project_family_key = "kitchen_remodel"
        snapshot.project_family_label = "Kitchen Remodel"
        snapshot.scope_mode = "install_removal"
        snapshot.template_used = template_used
        snapshot.total_project_value = total_project_value
        snapshot.actual_duration_days = actual_duration_days
        snapshot.milestone_count = milestone_count
        snapshot.dispute_flag = dispute_flag
        snapshot.amendment_count = amendment_count
        snapshot.completion_status = ProjectStatus.COMPLETED
        snapshot.estimated_value_range = {
            "low": str(total_project_value * Decimal("0.90")),
            "high": str(total_project_value * Decimal("1.10")),
        }
        snapshot.estimated_duration_range = {
            "low": str(max(actual_duration_days - 1, 1)),
            "high": str(actual_duration_days + 1),
        }
        snapshot.save(
            update_fields=[
                "project_family_key",
                "project_family_label",
                "scope_mode",
                "template_used",
                "total_project_value",
                "actual_duration_days",
                "milestone_count",
                "dispute_flag",
                "amendment_count",
                "completion_status",
                "estimated_value_range",
                "estimated_duration_range",
            ]
        )
        return snapshot

    def test_contractor_sees_completed_invoice_and_draw_payouts(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/contractor/payout-history/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        rows = payload["results"]
        self.assertEqual(len(rows), 2)

        invoice_row = next(row for row in rows if row["record_type"] == "invoice")
        draw_row = next(row for row in rows if row["record_type"] == "draw_request")

        self.assertEqual(invoice_row["project_class_label"], "Residential")
        self.assertEqual(invoice_row["transfer_ref"], "tr_invoice_completed")
        self.assertEqual(invoice_row["status_label"], "Paid")
        self.assertEqual(draw_row["project_class_label"], "Commercial")
        self.assertEqual(draw_row["transfer_ref"], "tr_draw_completed")
        self.assertEqual(draw_row["status_label"], "Paid")

        summary = payload["summary"]
        self.assertEqual(summary["total_paid_out"], "2850.00")
        self.assertEqual(summary["total_platform_fees_retained"], "150.00")
        self.assertEqual(summary["total_gross_released"], "3000.00")
        self.assertEqual(summary["payout_count"], 2)
        self.assertEqual(summary["invoice_count"], 1)
        self.assertEqual(summary["draw_count"], 1)

    def test_filters_apply_by_project_class_and_access_stays_contractor_scoped(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(
            "/api/projects/contractor/payout-history/",
            {"project_class": "commercial"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(payload["results"][0]["record_type"], "draw_request")
        self.assertEqual(payload["summary"]["total_paid_out"], "1710.00")
        self.assertEqual(payload["summary"]["payout_count"], 1)

        other_client = APIClient()
        other_client.force_authenticate(user=self.non_contractor_user)
        forbidden = other_client.get("/api/projects/contractor/payout-history/")
        self.assertEqual(forbidden.status_code, 403)


class BusinessDashboardExportTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="reports-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Reports Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Reports Homeowner",
            email="reports-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Reports Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Reports agreement",
            project_type="Remodel",
            project_subtype="Kitchen",
            start=timezone.now().date() - timezone.timedelta(days=20),
            end=timezone.now().date() - timezone.timedelta(days=5),
            status=ProjectStatus.COMPLETED,
            total_cost="5200.00",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            amount="2500.00",
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount="2500.00",
            status="paid",
            escrow_released=True,
            escrow_released_at=timezone.now() - timezone.timedelta(days=2),
            platform_fee_cents=12500,
            milestone_title_snapshot="Cabinet Install",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="reports-sub@example.com",
            password="testpass123",
            first_name="Taylor",
            last_name="Sub",
        )
        self.payout = MilestonePayout.objects.create(
            milestone=self.milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=90000,
            status=MilestonePayoutStatus.PAID,
            paid_at=timezone.now() - timezone.timedelta(days=1),
            stripe_transfer_id="tr_reports_123",
            execution_mode="manual",
        )

        self.other_contractor_user = user_model.objects.create_user(
            email="reports-other@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Other Reports Owner",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-reports-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Reports Project",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other reports agreement",
            project_type="Roofing",
            status=ProjectStatus.COMPLETED,
            total_cost="3300.00",
        )
        self.other_invoice = Invoice.objects.create(
            agreement=self.other_agreement,
            amount="3300.00",
            status="paid",
            escrow_released=True,
            escrow_released_at=timezone.now() - timezone.timedelta(days=1),
            platform_fee_cents=9900,
            milestone_title_snapshot="Other Milestone",
        )

        self.client = APIClient()

    def test_revenue_export_is_contractor_scoped_and_has_headers(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business-dashboard/export/revenue/?range=30")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        body = response.content.decode("utf-8")
        self.assertIn("agreement,invoice,milestone,project_type,payment_mode,paid_at,gross_amount", body)
        self.assertIn("Reports Project", body)
        self.assertNotIn("Other Reports Project", body)

    def test_fee_export_respects_date_range(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business-dashboard/export/fees/?range=30")

        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8")
        self.assertIn("agreement,invoice,project_type,paid_at,gross_amount,platform_fee_amount", body)
        self.assertIn("125.00", body)

        self.invoice.escrow_released_at = timezone.now() - timezone.timedelta(days=120)
        self.invoice.save(update_fields=["escrow_released_at"])

        response = self.client.get("/api/projects/business-dashboard/export/fees/?range=30")
        body = response.content.decode("utf-8")
        self.assertNotIn("Reports Project", body)

    def test_payout_export_is_contractor_scoped(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business-dashboard/export/payouts/")

        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8")
        self.assertIn("agreement,milestone,subcontractor,amount,status,execution_mode,paid_at,failed_at,transfer_id,failure_reason", body)
        self.assertIn("Reports Project", body)
        self.assertNotIn("Other Reports Project", body)

    def test_completed_jobs_export_returns_completed_jobs_rows(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business-dashboard/export/jobs/?range=30")

        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8")
        self.assertIn("agreement,customer,project_type,project_subtype,status,start_date,end_date,completion_days,total_cost", body)
        self.assertIn("Reports Project", body)
        self.assertIn("Reports Homeowner", body)


class BusinessDashboardInsightsTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="insights-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Insight Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Insight Homeowner",
            email="insight-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Insight Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Insight agreement",
        )
        self.review_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Awaiting Review",
            amount="1200.00",
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        self.overdue_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Overdue Work",
            amount="900.00",
            completion_date=timezone.localdate() - timezone.timedelta(days=2),
            completed=False,
        )
        self.failed_payout_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Failed Payout Milestone",
            amount="700.00",
        )
        self.subcontractor_user = user_model.objects.create_user(
            email="insights-sub@example.com",
            password="testpass123",
        )
        MilestonePayout.objects.create(
            milestone=self.failed_payout_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=70000,
            status=MilestonePayoutStatus.FAILED,
            failed_at=timezone.now() - timezone.timedelta(days=1),
            failure_reason="transfer failed",
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount="2200.00",
            status="approved",
            escrow_released=False,
        )
        self.client = APIClient()

    def _create_project_outcome_snapshot(
        self,
        *,
        family_key: str,
        family_label: str,
        title_suffix: str,
        total_project_value: str = "10000.00",
        scope_mode: str = "remodel",
    ) -> ProjectOutcomeSnapshot:
        email_token = f"{family_key}-{title_suffix}".lower().replace(" ", "-").replace("/", "-")
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name=f"{family_label} Homeowner {title_suffix}",
            email=f"{email_token}@example.com",
        )
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=homeowner,
            title=f"{family_label} Project {title_suffix}",
        )
        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=homeowner,
            description=f"{family_label} agreement {title_suffix}",
        )
        return ProjectOutcomeSnapshot.objects.create(
            agreement=agreement,
            contractor=self.contractor,
            project_family_key=family_key,
            project_family_label=family_label,
            scope_mode=scope_mode,
            template_used="",
            region_key="US-TX-AUSTIN",
            region_label="Austin, TX",
            region_granularity="city",
            original_intelligence_payload={
                "analysis": {
                    "project_scope_summary": f"{family_label} scope {title_suffix}",
                }
            },
            original_suggested_plan={
                "project_family_key": family_key,
                "project_family_label": family_label,
            },
            final_project_state={
                "project_scope_summary": f"{family_label} scope {title_suffix}",
            },
            final_milestones=[
                {"title": "Milestone 1", "amount": "2500.00"},
            ],
            total_project_value=Decimal(total_project_value),
            estimated_value_range={"low": "9000.00", "high": "11000.00"},
            actual_duration_days=5,
            estimated_duration_range={"low": 4, "high": 6},
            milestone_count=4,
            dispute_flag=False,
            amendment_count=0,
            completion_status="completed",
        )

    def test_business_dashboard_returns_grounded_insights(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        insights = response.json()["insights"]
        self.assertTrue(any(item["category"] == "payout_attention" for item in insights))
        self.assertTrue(any(item["category"] == "review_bottleneck" for item in insights))
        self.assertTrue(any(item["category"] == "schedule_risk" for item in insights))
        self.assertFalse(any(item["explanation"].strip() == "Your business is doing well." for item in insights))

    def test_failed_payout_generates_payout_attention_insight(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        insight = next(
            item for item in response.json()["insights"] if item["category"] == "payout_attention"
        )
        self.assertIn("failed payout", insight["explanation"].lower())
        self.assertEqual(insight["action_href"], "/app/payouts/history")

    def test_empty_healthy_dashboard_returns_no_junk_insights(self):
        user_model = get_user_model()
        healthy_user = user_model.objects.create_user(
            email="healthy-insights@example.com",
            password="testpass123",
        )
        healthy_contractor = Contractor.objects.create(
            user=healthy_user,
            business_name="Healthy Contractor",
        )
        healthy_homeowner = Homeowner.objects.create(
            created_by=healthy_contractor,
            full_name="Healthy Homeowner",
            email="healthy-homeowner@example.com",
        )
        healthy_project = Project.objects.create(
            contractor=healthy_contractor,
            homeowner=healthy_homeowner,
            title="Healthy Project",
        )
        Agreement.objects.create(
            project=healthy_project,
            contractor=healthy_contractor,
            homeowner=healthy_homeowner,
            description="Healthy agreement",
        )

        self.client.force_authenticate(user=healthy_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["insights"], [])

    def test_business_dashboard_includes_contractor_insights_panel(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        contractor_insights = response.json()["contractor_insights"]
        self.assertIn("summary_cards", contractor_insights)
        self.assertEqual(len(contractor_insights["summary_cards"]), 4)
        self.assertIn("comparison_rows", contractor_insights)
        self.assertTrue(contractor_insights["recommendations"])
        self.assertIn("source_label", contractor_insights)

    def test_business_dashboard_family_filter_returns_family_specific_insights(self):
        self._create_project_outcome_snapshot(
            family_key="kitchen_remodel",
            family_label="Kitchen Remodel",
            title_suffix="A",
            total_project_value="12000.00",
            scope_mode="remodel",
        )
        self._create_project_outcome_snapshot(
            family_key="kitchen_remodel",
            family_label="Kitchen Remodel",
            title_suffix="B",
            total_project_value="12500.00",
            scope_mode="remodel",
        )
        self._create_project_outcome_snapshot(
            family_key="kitchen_remodel",
            family_label="Kitchen Remodel",
            title_suffix="C",
            total_project_value="13000.00",
            scope_mode="remodel",
        )
        self._create_project_outcome_snapshot(
            family_key="roofing",
            family_label="Roofing",
            title_suffix="A",
            total_project_value="8000.00",
            scope_mode="repair",
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(
            "/api/projects/business/contractor/summary/?range=30&project_family_key=kitchen_remodel"
        )

        self.assertEqual(response.status_code, 200)
        contractor_insights = response.json()["contractor_insights"]
        self.assertEqual(contractor_insights["selected_family_key"], "kitchen_remodel")
        self.assertEqual(contractor_insights["effective_family_key"], "kitchen_remodel")
        self.assertEqual(contractor_insights["scope_mode"], "family")
        self.assertTrue(any(option["key"] == "roofing" for option in contractor_insights["available_families"]))
        self.assertEqual(contractor_insights["available_families"][0]["key"], "all")

    def test_business_dashboard_sparse_family_filter_falls_back_to_broader_scope(self):
        self._create_project_outcome_snapshot(
            family_key="kitchen_remodel",
            family_label="Kitchen Remodel",
            title_suffix="A",
            total_project_value="12000.00",
            scope_mode="remodel",
        )
        self._create_project_outcome_snapshot(
            family_key="kitchen_remodel",
            family_label="Kitchen Remodel",
            title_suffix="B",
            total_project_value="12500.00",
            scope_mode="remodel",
        )
        self._create_project_outcome_snapshot(
            family_key="roofing",
            family_label="Roofing",
            title_suffix="A",
            total_project_value="8000.00",
            scope_mode="repair",
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(
            "/api/projects/business/contractor/summary/?range=30&project_family_key=roofing"
        )

        self.assertEqual(response.status_code, 200)
        contractor_insights = response.json()["contractor_insights"]
        self.assertEqual(contractor_insights["selected_family_key"], "roofing")
        self.assertEqual(contractor_insights["scope_mode"], "fallback_all")
        self.assertIn("broader view", contractor_insights["scope_notice"].lower())


class BusinessDashboardPerformanceTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        now = timezone.now()

        self.contractor_user = user_model.objects.create_user(
            email="performance-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Performance Owner",
        )
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Performance Owner Public",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Performance Homeowner",
            email="performance-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Performance Project",
        )
        self.intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            homeowner=self.homeowner,
            initiated_by="homeowner",
            status="submitted",
            lead_source="landing_page",
            customer_name="Performance Customer",
            customer_email="performance-customer@example.com",
            customer_phone="555-101-2020",
            project_class="commercial",
            project_address_line1="100 Market St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            accomplishment_text="Need a performance project.",
            submitted_at=now - timezone.timedelta(days=5),
            share_token="performance-share-token-1",
        )
        self.lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Performance Customer",
            email="performance-customer@example.com",
            phone="555-101-2020",
            project_address="100 Market St",
            city="Austin",
            state="TX",
            zip_code="78701",
            project_type="Commercial Remodel",
            project_description="Performance lead.",
            preferred_timeline="Soon",
            budget_text="$12,000",
            status=PublicContractorLead.STATUS_ACCEPTED,
            accepted_at=now - timezone.timedelta(days=4),
            converted_at=now - timezone.timedelta(days=4),
        )
        self.intake.public_lead = self.lead
        self.intake.save(update_fields=["public_lead", "updated_at"])
        self.lead.converted_homeowner = self.homeowner
        self.lead.save(update_fields=["converted_homeowner", "converted_agreement", "updated_at"])
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Performance agreement",
            total_cost=Decimal("12000.00"),
            status=ProjectStatus.IN_PROGRESS,
            source_lead=self.lead,
        )
        self.lead.converted_agreement = self.agreement
        self.lead.save(update_fields=["converted_agreement", "updated_at"])
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("8000.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=now - timezone.timedelta(days=3),
            platform_fee_cents=40000,
            payout_cents=760000,
        )
        self.draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            title="Progress draw",
            status=DrawRequestStatus.PAID,
            gross_amount=Decimal("2000.00"),
            net_amount=Decimal("1900.00"),
            paid_at=now - timezone.timedelta(days=2),
            released_at=now - timezone.timedelta(days=2),
            platform_fee_cents=10000,
            payout_cents=190000,
        )

        self.other_user = user_model.objects.create_user(
            email="performance-other@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Performance Other",
        )
        self.other_profile = ContractorPublicProfile.objects.create(
            contractor=self.other_contractor,
            business_name_public="Performance Other Public",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Performance Homeowner",
            email="other-performance@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Performance Project",
        )
        other_intake = ProjectIntake.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            homeowner=self.other_homeowner,
            initiated_by="homeowner",
            status="submitted",
            lead_source="landing_page",
            customer_name="Other Customer",
            customer_email="other-performance@example.com",
            customer_phone="555-303-4040",
            project_class="residential",
            project_address_line1="200 Other St",
            project_city="Dallas",
            project_state="TX",
            project_postal_code="75201",
            accomplishment_text="Other request.",
            submitted_at=now - timezone.timedelta(days=4),
            share_token="performance-share-token-2",
        )
        other_lead = PublicContractorLead.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Other Customer",
            email="other-performance@example.com",
            phone="555-303-4040",
            project_address="200 Other St",
            city="Dallas",
            state="TX",
            zip_code="75201",
            project_type="Residential Remodel",
            project_description="Other lead.",
            preferred_timeline="Soon",
            budget_text="$4,000",
            status=PublicContractorLead.STATUS_ACCEPTED,
            accepted_at=now - timezone.timedelta(days=3),
            converted_at=now - timezone.timedelta(days=3),
        )
        other_intake.public_lead = other_lead
        other_intake.save(update_fields=["public_lead", "updated_at"])
        other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other performance agreement",
            total_cost=Decimal("4000.00"),
            status=ProjectStatus.IN_PROGRESS,
            source_lead=other_lead,
        )
        other_lead.converted_agreement = other_agreement
        other_lead.save(update_fields=["converted_agreement", "updated_at"])
        Invoice.objects.create(
            agreement=other_agreement,
            amount=Decimal("4000.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=now - timezone.timedelta(days=1),
            platform_fee_cents=20000,
            payout_cents=380000,
        )
        self.client = APIClient()

    def test_business_dashboard_returns_business_performance_metrics(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        performance = response.json()["business_performance"]

        self.assertEqual(performance["funnel"]["requests_received"], 1)
        self.assertEqual(performance["funnel"]["bids_submitted"], 1)
        self.assertEqual(performance["funnel"]["bids_awarded"], 1)
        self.assertEqual(performance["funnel"]["agreements_created"], 1)
        self.assertEqual(performance["funnel"]["paid_projects"], 1)
        self.assertEqual(performance["conversion_rates"]["request_to_bid_rate"], "100.00")
        self.assertEqual(performance["conversion_rates"]["bid_to_award_rate"], "100.00")
        self.assertEqual(performance["conversion_rates"]["award_to_paid_rate"], "100.00")
        self.assertEqual(performance["revenue"]["total_paid"], "10000.00")
        self.assertEqual(performance["revenue"]["total_pipeline_value"], "12000.00")
        self.assertEqual(performance["revenue"]["average_project_value"], "12000.00")

    def test_business_dashboard_performance_is_contractor_scoped(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        performance = response.json()["business_performance"]
        self.assertEqual(performance["funnel"]["requests_received"], 1)
        self.assertEqual(performance["funnel"]["paid_projects"], 1)

    def test_business_dashboard_performance_empty_state_supports_zero_activity(self):
        user_model = get_user_model()
        empty_user = user_model.objects.create_user(
            email="performance-empty@example.com",
            password="testpass123",
        )
        empty_contractor = Contractor.objects.create(
            user=empty_user,
            business_name="Empty Performance Contractor",
        )

        self.client.force_authenticate(user=empty_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        performance = response.json()["business_performance"]
        self.assertEqual(performance["funnel"]["requests_received"], 0)
        self.assertEqual(performance["funnel"]["bids_submitted"], 0)
        self.assertEqual(performance["funnel"]["bids_awarded"], 0)
        self.assertEqual(performance["funnel"]["agreements_created"], 0)
        self.assertEqual(performance["funnel"]["paid_projects"], 0)
        self.assertEqual(performance["revenue"]["total_paid"], "0.00")
        self.assertEqual(performance["revenue"]["total_pipeline_value"], "0.00")
        self.assertEqual(performance["revenue"]["average_project_value"], "0.00")

    def test_business_dashboard_includes_fee_project_rows(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        fee_projects = response.json()["fee_projects"]
        self.assertTrue(fee_projects)

        row = next(item for item in fee_projects if item["agreement_id"] == self.agreement.id)
        self.assertEqual(row["agreement_title"], self.project.title)
        self.assertEqual(row["contract_value"], "12000.00")
        self.assertEqual(row["fees_collected_so_far"], "500.00")
        self.assertEqual(row["fee_cap"], "750.00")
        self.assertEqual(row["remaining_cap"], "250.00")
        self.assertIn("In Progress", row["payment_status"])

    def test_business_dashboard_includes_financial_dashboard_payload(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        payload = response.json()

        summary = payload["financial_summary"]
        self.assertEqual(summary["gross_revenue_total"], "10000.00")
        self.assertEqual(summary["platform_fees_total"], "500.00")
        self.assertEqual(summary["net_paid_total"], "9500.00")
        self.assertEqual(summary["pending_release_total"], "0.00")
        self.assertEqual(summary["on_hold_total"], "0.00")
        self.assertEqual(summary["paid_events_count"], 2)

        series = payload["financial_series"]
        self.assertTrue(series)
        self.assertIn("gross_revenue", series[0])
        self.assertIn("platform_fees", series[0])
        self.assertIn("net_paid", series[0])

        project_rows = payload["project_financials"]
        self.assertTrue(project_rows)
        project_row = next(item for item in project_rows if item["agreement_id"] == self.agreement.id)
        self.assertEqual(project_row["agreement_title"], self.project.title)
        self.assertEqual(project_row["contract_value"], "12000.00")
        self.assertEqual(project_row["gross_collected"], "10000.00")
        self.assertEqual(project_row["platform_fees"], "500.00")
        self.assertEqual(project_row["net_paid"], "9500.00")
        self.assertEqual(project_row["fee_cap"], "750.00")
        self.assertEqual(project_row["remaining_cap"], "250.00")
        self.assertEqual(project_row["payment_status"], "Paid")

        insights = payload["financial_insights"]
        self.assertTrue(insights)

        recent_events = payload["recent_financial_events"]
        self.assertTrue(recent_events)
        self.assertIn("activity_at", recent_events[0])

    def test_business_dashboard_handles_expense_request_statuses_without_enum_crash(self):
        ExpenseRequest.objects.create(
            agreement=self.agreement,
            description="Approved expense",
            amount=Decimal("125.00"),
            status=ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
            platform_fee_cents=0,
            payout_cents=12500,
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["financial_summary"]["pending_release_count"], 1)
        self.assertEqual(payload["financial_summary"]["pending_release_total"], "125.00")


class BusinessDashboardChartTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="chart-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Chart Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Chart Homeowner",
            email="chart-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Chart Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Chart agreement",
            status=ProjectStatus.IN_PROGRESS,
            total_cost="4500.00",
        )
        self.client = APIClient()

        now = timezone.now()
        self.revenue_invoice_recent = Invoice.objects.create(
            agreement=self.agreement,
            amount="1000.00",
            status="paid",
            escrow_released=True,
            escrow_released_at=now - timezone.timedelta(days=3),
            platform_fee_cents=10000,
            payout_cents=85000,
        )
        self.revenue_invoice_older = Invoice.objects.create(
            agreement=self.agreement,
            amount="500.00",
            status="paid",
            escrow_released=True,
            escrow_released_at=now - timezone.timedelta(days=40),
            platform_fee_cents=5000,
            payout_cents=43000,
        )

        self.ready_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Ready Payout Milestone",
            amount="800.00",
            completion_date=timezone.localdate() - timezone.timedelta(days=4),
            completed=True,
        )
        self.failed_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Failed Payout Milestone",
            amount="650.00",
            completion_date=timezone.localdate() - timezone.timedelta(days=18),
            completed=True,
        )
        self.overdue_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Overdue Milestone",
            amount="400.00",
            completion_date=timezone.localdate() - timezone.timedelta(days=9),
            completed=False,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="chart-sub@example.com",
            password="testpass123",
        )
        MilestonePayout.objects.create(
            milestone=self.ready_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=80000,
            status=MilestonePayoutStatus.READY_FOR_PAYOUT,
            ready_for_payout_at=now - timezone.timedelta(days=4),
        )
        MilestonePayout.objects.create(
            milestone=self.failed_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=65000,
            status=MilestonePayoutStatus.FAILED,
            failed_at=now - timezone.timedelta(days=18),
        )

        self.other_user = user_model.objects.create_user(
            email="chart-other@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Other Chart Owner",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Chart Homeowner",
            email="other-chart-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Chart Project",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other chart agreement",
            status=ProjectStatus.IN_PROGRESS,
            total_cost="3200.00",
        )
        other_milestone = Milestone.objects.create(
            agreement=self.other_agreement,
            order=1,
            title="Other Overdue",
            amount="300.00",
            completion_date=timezone.localdate() - timezone.timedelta(days=6),
            completed=False,
        )
        Invoice.objects.create(
            agreement=self.other_agreement,
            amount="999.00",
            status="paid",
            escrow_released=True,
            escrow_released_at=now - timezone.timedelta(days=2),
            platform_fee_cents=9900,
            payout_cents=85000,
        )
        MilestonePayout.objects.create(
            milestone=other_milestone,
            subcontractor_user=self.subcontractor_user,
            amount_cents=30000,
            status=MilestonePayoutStatus.FAILED,
            failed_at=now - timezone.timedelta(days=2),
        )

    def test_chart_series_are_contractor_scoped(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get("/api/projects/business/contractor/summary/?range=30")

        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertEqual(payload["bucket"], "day")
        self.assertEqual(payload["fee_summary"]["platform_fee_total"], "100.00")
        self.assertEqual(payload["fee_summary"]["estimated_processing_fee_total"], "50.00")

        revenue_total = sum(Decimal(row["revenue"]) for row in payload["revenue_series"])
        payout_failed_total = sum(Decimal(row["failed_amount"]) for row in payload["payout_series"])
        payout_ready_total = sum(Decimal(row["ready_amount"]) for row in payload["payout_series"])
        overdue_total = sum(int(row["overdue_milestones"]) for row in payload["workflow_series"])

        self.assertEqual(revenue_total, Decimal("1000.00"))
        self.assertEqual(payout_failed_total, Decimal("650.00"))
        self.assertEqual(payout_ready_total, Decimal("800.00"))
        self.assertEqual(overdue_total, 1)

    def test_chart_bucketing_changes_with_selected_range(self):
        self.client.force_authenticate(user=self.contractor_user)

        short_range = self.client.get("/api/projects/business/contractor/summary/?range=30")
        self.assertEqual(short_range.status_code, 200)
        self.assertEqual(short_range.json()["bucket"], "day")

        long_range = self.client.get("/api/projects/business/contractor/summary/?range=90")
        self.assertEqual(long_range.status_code, 200)
        payload = long_range.json()

        self.assertEqual(payload["bucket"], "week")
        revenue_total = sum(Decimal(row["revenue"]) for row in payload["revenue_series"])
        self.assertEqual(revenue_total, Decimal("1500.00"))
        self.assertTrue(any("-" in row["bucket_label"] for row in payload["revenue_series"]))

    def test_drilldown_is_contractor_scoped_and_bucket_filtered(self):
        self.client.force_authenticate(user=self.contractor_user)
        summary = self.client.get("/api/projects/business/contractor/summary/?range=30")
        self.assertEqual(summary.status_code, 200)

        revenue_bucket = next(
            row["bucket_start"]
            for row in summary.json()["revenue_series"]
            if Decimal(row["revenue"]) == Decimal("1000.00")
        )
        revenue_response = self.client.get(
            f"/api/projects/business/contractor/drilldown/?range=30&chart_type=revenue&bucket_start={revenue_bucket}"
        )
        self.assertEqual(revenue_response.status_code, 200)
        revenue_payload = revenue_response.json()
        self.assertEqual(revenue_payload["chart_type"], "revenue")
        self.assertEqual(revenue_payload["record_count"], 1)
        self.assertEqual(revenue_payload["records"][0]["agreement_title"], "Chart Project")
        self.assertNotEqual(revenue_payload["records"][0]["agreement_title"], "Other Chart Project")
        self.assertEqual(revenue_payload["records"][0]["invoice_id"], self.revenue_invoice_recent.id)
        self.assertEqual(revenue_payload["records"][0]["agreement_id"], self.agreement.id)

        workflow_bucket = next(
            row["bucket_start"]
            for row in summary.json()["workflow_series"]
            if int(row["overdue_milestones"]) == 1
        )
        workflow_response = self.client.get(
            f"/api/projects/business/contractor/drilldown/?range=30&chart_type=workflow&bucket_start={workflow_bucket}"
        )
        self.assertEqual(workflow_response.status_code, 200)
        workflow_payload = workflow_response.json()
        self.assertEqual(workflow_payload["record_count"], 1)
        self.assertEqual(workflow_payload["records"][0]["agreement_title"], "Chart Project")
        self.assertEqual(workflow_payload["records"][0]["milestone_title"], "Overdue Milestone")
        self.assertEqual(workflow_payload["records"][0]["milestone_id"], self.overdue_milestone.id)
        self.assertEqual(workflow_payload["records"][0]["agreement_id"], self.agreement.id)

    def test_drilldown_returns_empty_for_bucket_without_records(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(
            "/api/projects/business/contractor/drilldown/?range=30&chart_type=workflow&bucket_start=2026-01-01"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["chart_type"], "workflow")
        self.assertEqual(payload["record_count"], 0)
        self.assertEqual(payload["records"], [])


class ProgressPaymentWorkflowTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="progress-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Progress Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Progress Homeowner",
            email="progress-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Progress Agreement",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Progress agreement",
            payment_structure="progress",
            retainage_percent=Decimal("10.00"),
            total_cost=Decimal("10000.00"),
        )
        self.milestone_one = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Mobilization",
            amount=Decimal("4000.00"),
        )
        self.milestone_two = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Finish",
            amount=Decimal("6000.00"),
        )
        self.template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Progress Template",
            payment_structure="progress",
            retainage_percent=Decimal("7.50"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.contractor_user)

    def test_agreement_patch_accepts_payment_structure_fields(self):
        response = self.client.patch(
            f"/api/projects/agreements/{self.agreement.id}/",
            {
                "payment_structure": "progress",
                "retainage_percent": "12.50",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.payment_structure, "progress")
        self.assertEqual(self.agreement.retainage_percent, Decimal("12.50"))
        self.assertEqual(self.agreement.project_class, "commercial")

    def test_residential_agreement_rejects_commercial_payment_features(self):
        residential_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Residential Agreement Project",
        )
        residential_agreement = Agreement.objects.create(
            project=residential_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Residential agreement",
            payment_structure="simple",
            total_cost=Decimal("4500.00"),
            project_class="residential",
        )

        response = self.client.patch(
            f"/api/projects/agreements/{residential_agreement.id}/",
            {
                "project_class": "residential",
                "payment_structure": "progress",
                "retainage_percent": "10.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("payment_structure", response.json())

    def test_commercial_project_class_can_be_set_on_create(self):
        response = self.client.post(
            "/api/projects/agreements/",
            {
                "homeowner": self.homeowner.id,
                "project_title": "Commercial Buildout",
                "title": "Commercial Buildout",
                "project_class": "commercial",
                "project_type": "Remodel",
                "project_subtype": "Commercial Interior",
                "payment_mode": "escrow",
                "payment_structure": "progress",
                "retainage_percent": "5.00",
                "description": "Tenant improvement scope.",
                "milestones": [
                    {
                        "title": "Draw Schedule Setup",
                        "amount": "5000.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        agreement = Agreement.objects.get(pk=response.json()["id"])
        self.assertEqual(agreement.project_class, "commercial")
        self.assertEqual(agreement.payment_structure, "progress")
        self.assertEqual(agreement.retainage_percent, Decimal("5.00"))

    def test_progress_draw_endpoints_create_transition_and_record_payment(self):
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner"])

        create_response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/draws/",
            {
                "title": "First Draw",
                "notes": "Initial mobilization billing",
                "line_items": [
                    {
                        "milestone_id": self.milestone_one.id,
                        "scheduled_value": "4000.00",
                        "percent_complete": "50.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        payload = create_response.json()
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(payload["gross_amount"], "2000.00")
        self.assertEqual(payload["retainage_amount"], "200.00")
        self.assertEqual(payload["net_amount"], "1800.00")

        draw_id = payload["id"]

        submit_response = self.client.post(f"/api/projects/draws/{draw_id}/submit/", {}, format="json")
        self.assertEqual(submit_response.status_code, 200)
        self.assertEqual(submit_response.json()["status"], "submitted")
        self.assertTrue(submit_response.json()["public_review_url"])
        self.assertEqual(mail.outbox[-1].to, [self.homeowner.email])

        approve_response = self.client.post(f"/api/projects/draws/{draw_id}/approve/", {}, format="json")
        self.assertEqual(approve_response.status_code, 200)
        self.assertEqual(approve_response.json()["status"], "approved")

        payment_response = self.client.post(
            f"/api/projects/draws/{draw_id}/record_external_payment/",
            {
                "gross_amount": "2000.00",
                "retainage_withheld_amount": "200.00",
                "net_amount": "1800.00",
                "payment_method": "ach",
                "payment_date": "2026-03-25",
                "reference_number": "ACH-100",
                "notes": "Paid outside the app",
            },
            format="json",
        )
        self.assertEqual(payment_response.status_code, 201)
        self.assertEqual(payment_response.json()["draw_request_id"], draw_id)
        self.assertEqual(payment_response.json()["net_amount"], "1800.00")

        draw = DrawRequest.objects.get(pk=draw_id)
        self.assertEqual(draw.status, DrawRequestStatus.PAID)
        self.assertIsNotNone(draw.paid_at)
        self.assertEqual(draw.paid_via, "ach")
        self.assertTrue(
            ExternalPaymentRecord.objects.filter(draw_request=draw, agreement=self.agreement).exists()
        )

    def test_progress_draw_creation_requires_signed_agreement(self):
        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/draws/",
            {
                "title": "Unsigned Draw",
                "line_items": [
                    {
                        "milestone_id": self.milestone_one.id,
                        "scheduled_value": "9999.00",
                        "percent_complete": "50.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("after the agreement is signed", str(response.json()).lower())

    def test_external_payment_requires_exact_draw_amounts_and_prevents_duplicates(self):
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner"])

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            status=DrawRequestStatus.APPROVED,
            title="Approved Draw",
            gross_amount=Decimal("2500.00"),
            retainage_amount=Decimal("250.00"),
            net_amount=Decimal("2250.00"),
            current_requested_amount=Decimal("2500.00"),
        )

        mismatch = self.client.post(
            f"/api/projects/draws/{draw.id}/record_external_payment/",
            {
                "gross_amount": "2250.00",
                "retainage_withheld_amount": "0.00",
                "net_amount": "2250.00",
                "payment_method": "ach",
                "payment_date": "2026-03-25",
            },
            format="json",
        )
        self.assertEqual(mismatch.status_code, 400)
        self.assertIn("gross_amount", mismatch.json())

        payment = self.client.post(
            f"/api/projects/draws/{draw.id}/record_external_payment/",
            {
                "gross_amount": "2500.00",
                "retainage_withheld_amount": "250.00",
                "net_amount": "2250.00",
                "payment_method": "ach",
                "payment_date": "2026-03-25",
            },
            format="json",
        )
        self.assertEqual(payment.status_code, 201)

        duplicate = self.client.post(
            f"/api/projects/draws/{draw.id}/record_external_payment/",
            {
                "gross_amount": "2500.00",
                "retainage_withheld_amount": "250.00",
                "net_amount": "2250.00",
                "payment_method": "ach",
                "payment_date": "2026-03-25",
            },
            format="json",
        )
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("approved draws", str(duplicate.json()).lower())

    def test_payment_structure_switching_is_blocked_after_downstream_activity(self):
        simple_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Simple Agreement Project",
        )
        simple_agreement = Agreement.objects.create(
            project=simple_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Simple agreement",
            payment_structure="simple",
            total_cost=Decimal("5000.00"),
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )
        Invoice.objects.create(
            agreement=simple_agreement,
            amount=Decimal("500.00"),
            status="draft",
        )

        simple_to_progress = self.client.patch(
            f"/api/projects/agreements/{simple_agreement.id}/",
            {"payment_structure": "progress", "retainage_percent": "10.00"},
            format="json",
        )
        self.assertEqual(simple_to_progress.status_code, 400)
        self.assertIn("payment_structure", str(simple_to_progress.json()).lower())

        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner"])
        DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            status=DrawRequestStatus.DRAFT,
            title="Existing Draw",
        )

        progress_to_simple = self.client.patch(
            f"/api/projects/agreements/{self.agreement.id}/",
            {"payment_structure": "simple"},
            format="json",
        )
        self.assertEqual(progress_to_simple.status_code, 400)
        self.assertIn("payment_structure", str(progress_to_simple.json()).lower())

    def test_template_apply_preserves_existing_payment_settings(self):
        template_agreement_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Template Preserve Project",
        )
        template_agreement = Agreement.objects.create(
            project=template_agreement_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Template preserve agreement",
            payment_structure="progress",
            retainage_percent=Decimal("12.50"),
            total_cost=Decimal("8000.00"),
        )
        self.template.milestones.create(
            title="Template Milestone",
            description="Template milestone",
            sort_order=1,
        )
        result = apply_template_to_agreement(
            agreement=template_agreement,
            template=self.template,
            overwrite_existing=True,
            copy_text_fields=True,
        )

        self.assertEqual(result["template_id"], self.template.id)
        template_agreement.refresh_from_db()
        self.assertEqual(template_agreement.payment_structure, "progress")
        self.assertEqual(template_agreement.retainage_percent, Decimal("12.50"))

    def test_amendment_fee_delta_allocates_additional_fee_below_cap(self):
        refresh_agreement_fee_allocations(self.agreement)
        self.agreement.refresh_from_db()
        original_total_fee = self.agreement.agreement_fee_total_cents
        original_allocated_fee = self.agreement.agreement_fee_allocated_cents
        self.assertEqual(original_total_fee, original_allocated_fee)

        self.agreement.amendment_number = 1
        self.agreement.save(update_fields=["amendment_number"])
        amendment_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Amendment Scope",
            amount=Decimal("2000.00"),
            amendment_number_snapshot=1,
        )

        summary = refresh_agreement_fee_allocations(self.agreement)
        self.agreement.refresh_from_db()
        amendment_milestone.refresh_from_db()

        self.assertGreater(self.agreement.agreement_fee_total_cents, original_total_fee)
        self.assertEqual(summary["amendment_fee_delta_cents"], self.agreement.agreement_fee_total_cents - original_allocated_fee)
        self.assertEqual(amendment_milestone.agreement_fee_allocation_cents, summary["amendment_fee_delta_cents"])
        self.assertEqual(self.agreement.agreement_fee_allocated_cents, self.agreement.agreement_fee_total_cents)

    def test_amendment_fee_delta_caps_at_750(self):
        self.milestone_one.amount = Decimal("10000.00")
        self.milestone_one.save(update_fields=["amount"])
        self.milestone_two.amount = Decimal("10000.00")
        self.milestone_two.save(update_fields=["amount"])
        refresh_agreement_fee_allocations(self.agreement)
        self.agreement.refresh_from_db()
        base_allocated_fee = self.agreement.agreement_fee_allocated_cents

        self.agreement.amendment_number = 1
        self.agreement.save(update_fields=["amendment_number"])
        amendment_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Cap Reaching Amendment",
            amount=Decimal("10000.00"),
            amendment_number_snapshot=1,
        )

        summary = refresh_agreement_fee_allocations(self.agreement)
        self.agreement.refresh_from_db()
        amendment_milestone.refresh_from_db()

        self.assertEqual(self.agreement.agreement_fee_total_cents, 75000)
        self.assertEqual(summary["amendment_fee_delta_cents"], 75000 - base_allocated_fee)
        self.assertEqual(amendment_milestone.agreement_fee_allocation_cents, 75000 - base_allocated_fee)
        self.assertEqual(self.agreement.agreement_fee_allocated_cents, 75000)

    def test_amendment_fee_delta_is_zero_after_cap_already_reached(self):
        self.milestone_one.amount = Decimal("15000.00")
        self.milestone_one.save(update_fields=["amount"])
        self.milestone_two.amount = Decimal("15000.00")
        self.milestone_two.save(update_fields=["amount"])
        refresh_agreement_fee_allocations(self.agreement)
        self.agreement.refresh_from_db()
        self.assertEqual(self.agreement.agreement_fee_total_cents, 75000)

        self.agreement.amendment_number = 1
        self.agreement.save(update_fields=["amendment_number"])
        amendment_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=3,
            title="Post Cap Amendment",
            amount=Decimal("5000.00"),
            amendment_number_snapshot=1,
        )

        summary = refresh_agreement_fee_allocations(self.agreement)
        self.agreement.refresh_from_db()
        amendment_milestone.refresh_from_db()

        self.assertEqual(summary["amendment_fee_delta_cents"], 0)
        self.assertEqual(amendment_milestone.agreement_fee_allocation_cents, 0)
        self.assertEqual(self.agreement.agreement_fee_total_cents, 75000)
        self.assertEqual(self.agreement.agreement_fee_allocated_cents, 75000)

    def test_simple_agreement_rejects_draw_creation(self):
        self.agreement.payment_structure = "simple"
        self.agreement.save(update_fields=["payment_structure"])

        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/draws/",
            {
                "title": "Should Fail",
                "line_items": [
                    {
                        "milestone_id": self.milestone_one.id,
                        "scheduled_value": "4000.00",
                        "percent_complete": "50.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("progress-payment agreements", str(response.json()).lower())

    @override_settings(FRONTEND_URL="https://app.myhomebro.test")
    def test_magic_draw_review_flow_starts_direct_checkout_after_owner_approval(self):
        self.agreement.payment_mode = "direct"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])

        create_response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/draws/",
            {
                "title": "First Draw",
                "notes": "Initial direct-pay draw",
                "line_items": [
                    {
                        "milestone_id": self.milestone_one.id,
                        "scheduled_value": "4000.00",
                        "percent_complete": "50.00",
                    }
                ],
            },
            format="json",
        )
        draw_id = create_response.json()["id"]
        draw = DrawRequest.objects.get(pk=draw_id)

        submit_response = self.client.post(f"/api/projects/draws/{draw_id}/submit/", {}, format="json")
        self.assertEqual(submit_response.status_code, 200)

        view_response = self.client.get(f"/api/projects/draws/magic/{draw.public_token}/")
        self.assertEqual(view_response.status_code, 200)
        self.assertEqual(view_response.json()["status"], "submitted")

        with patch(
            "projects.views.magic_draw_request.create_direct_checkout_for_draw",
            return_value="https://checkout.stripe.test/draw-123",
        ):
            approve_response = self.client.patch(
                f"/api/projects/draws/magic/{draw.public_token}/approve/",
                {},
                format="json",
            )

        self.assertEqual(approve_response.status_code, 200)
        self.assertEqual(approve_response.json()["mode"], "direct_checkout")
        self.assertEqual(approve_response.json()["checkout_url"], "https://checkout.stripe.test/draw-123")
        self.assertEqual(approve_response.json()["workflow_status"], "payment_pending")

        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.APPROVED)
        self.assertIsNotNone(draw.homeowner_acted_at)
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="draw_payment_pending",
                dedupe_key=f"draw_payment_pending:{draw.id}",
            ).exists()
        )
        notification = Notification.objects.filter(
            contractor=self.contractor,
            event_type=Notification.EVENT_DRAW_APPROVED,
            draw_request=draw,
            agreement=self.agreement,
        ).first()
        self.assertIsNotNone(notification)

    def test_magic_draw_review_flow_moves_escrow_draw_to_awaiting_release(self):
        self.agreement.payment_mode = "escrow"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=9,
            status=DrawRequestStatus.SUBMITTED,
            title="Escrow Draw",
            gross_amount=Decimal("2500.00"),
            retainage_amount=Decimal("250.00"),
            net_amount=Decimal("2250.00"),
            current_requested_amount=Decimal("2500.00"),
        )

        approve_response = self.client.patch(
            f"/api/projects/draws/magic/{draw.public_token}/approve/",
            {},
            format="json",
        )

        self.assertEqual(approve_response.status_code, 200)
        self.assertEqual(approve_response.json()["mode"], "escrow_review")
        self.assertEqual(approve_response.json()["workflow_status"], "payment_pending")
        self.assertTrue(approve_response.json()["is_awaiting_release"])

        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.AWAITING_RELEASE)
        self.assertIsNotNone(draw.homeowner_acted_at)

    def test_contractor_can_release_approved_escrow_draw(self):
        self.agreement.payment_mode = "escrow"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.contractor.stripe_account_id = "acct_ready_release"
        self.contractor.payouts_enabled = True
        self.agreement.escrow_funded_amount = Decimal("5000.00")
        self.contractor.save(update_fields=["stripe_account_id", "payouts_enabled"])
        self.agreement.save(
            update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner", "escrow_funded_amount"]
        )
        Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_escrow_fund_1",
            stripe_charge_id="ch_escrow_fund_1",
            amount_cents=500000,
            currency="usd",
            status="succeeded",
        )

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=10,
            status=DrawRequestStatus.AWAITING_RELEASE,
            title="Awaiting Release Draw",
            gross_amount=Decimal("2600.00"),
            retainage_amount=Decimal("260.00"),
            net_amount=Decimal("2340.00"),
            current_requested_amount=Decimal("2600.00"),
        )

        with patch("projects.services.draw_requests.stripe.Transfer.create", return_value={"id": "tr_draw_release_123"}) as transfer_create:
            release_response = self.client.post(f"/api/projects/draws/{draw.id}/release/", {}, format="json")

        self.assertEqual(release_response.status_code, 200)
        self.assertEqual(release_response.json()["workflow_status"], "paid")
        transfer_create.assert_called_once()

        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.RELEASED)
        self.assertIsNotNone(draw.released_at)
        self.assertEqual(draw.stripe_transfer_id, "tr_draw_release_123")
        self.assertIsNotNone(draw.transfer_created_at)
        self.assertGreaterEqual(draw.platform_fee_cents, 0)
        self.assertEqual(draw.payout_cents, 234000 - draw.platform_fee_cents)
        self.assertEqual(draw.escrow_source_payment_intent_id, "pi_escrow_fund_1")
        self.assertEqual(draw.escrow_source_charge_id, "ch_escrow_fund_1")
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="draw_released",
                dedupe_key=f"draw_released:{draw.id}",
            ).exists()
        )
        notification = Notification.objects.filter(
            contractor=self.contractor,
            event_type=Notification.EVENT_DRAW_RELEASED,
            draw_request=draw,
            agreement=self.agreement,
        ).first()
        self.assertIsNotNone(notification)

    def test_release_escrow_draw_prevents_duplicate_transfer_when_already_released(self):
        self.agreement.payment_mode = "escrow"
        self.agreement.escrow_funded_amount = Decimal("4000.00")
        self.agreement.save(update_fields=["payment_mode", "escrow_funded_amount"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=15,
            status=DrawRequestStatus.RELEASED,
            title="Already Released Draw",
            gross_amount=Decimal("1000.00"),
            retainage_amount=Decimal("100.00"),
            net_amount=Decimal("900.00"),
            current_requested_amount=Decimal("1000.00"),
            stripe_transfer_id="tr_existing_123",
            released_at=timezone.now(),
        )

        with patch("projects.services.draw_requests.stripe.Transfer.create") as transfer_create:
            released = release_escrow_draw(draw_request_id=draw.id)

        self.assertEqual(released.id, draw.id)
        transfer_create.assert_not_called()

    def test_release_escrow_draw_handles_transfer_failure_gracefully(self):
        self.agreement.payment_mode = "escrow"
        self.contractor.stripe_account_id = "acct_ready_release"
        self.contractor.payouts_enabled = True
        self.agreement.escrow_funded_amount = Decimal("5000.00")
        self.contractor.save(update_fields=["stripe_account_id", "payouts_enabled"])
        self.agreement.save(update_fields=["payment_mode", "escrow_funded_amount"])
        Payment.objects.create(
            agreement=self.agreement,
            stripe_payment_intent_id="pi_escrow_fund_2",
            stripe_charge_id="ch_escrow_fund_2",
            amount_cents=500000,
            currency="usd",
            status="succeeded",
        )
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=16,
            status=DrawRequestStatus.AWAITING_RELEASE,
            title="Transfer Failure Draw",
            gross_amount=Decimal("1200.00"),
            retainage_amount=Decimal("120.00"),
            net_amount=Decimal("1080.00"),
            current_requested_amount=Decimal("1200.00"),
        )

        with self.assertRaisesMessage(ValueError, "Escrow release transfer failed"):
            with patch("projects.services.draw_requests.stripe.Transfer.create", side_effect=Exception("transfer failed")):
                release_escrow_draw(draw_request_id=draw.id)

        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.AWAITING_RELEASE)
        self.assertEqual(draw.transfer_failure_reason, "transfer failed")

    def test_transfer_created_and_failed_webhooks_update_draw_tracking(self):
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=17,
            status=DrawRequestStatus.RELEASED,
            title="Webhook Tracked Draw",
            gross_amount=Decimal("1000.00"),
            retainage_amount=Decimal("100.00"),
            net_amount=Decimal("900.00"),
            current_requested_amount=Decimal("1000.00"),
        )

        _handle_draw_transfer_created(
            {
                "id": "tr_hook_123",
                "metadata": {
                    "kind": "escrow_draw_release",
                    "draw_request_id": str(draw.id),
                },
            }
        )
        draw.refresh_from_db()
        self.assertEqual(draw.stripe_transfer_id, "tr_hook_123")
        self.assertIsNotNone(draw.transfer_created_at)

        _handle_draw_transfer_failed(
            {
                "id": "tr_hook_123",
                "failure_message": "destination account rejected transfer",
                "metadata": {
                    "kind": "escrow_draw_release",
                    "draw_request_id": str(draw.id),
                },
            }
        )
        draw.refresh_from_db()
        self.assertEqual(draw.transfer_failure_reason, "destination account rejected transfer")

    @override_settings(STRIPE_SECRET_KEY="sk_test_expense_fee", FRONTEND_URL="https://app.myhomebro.test")
    @patch("stripe.checkout.Session.create")
    def test_expense_checkout_uses_project_fee_cap_and_persists_trace_fields(self, mock_session_create):
        self.contractor.stripe_account_id = "acct_expense_ready"
        self.contractor.save(update_fields=["stripe_account_id"])

        Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1000.00"),
            status=InvoiceStatus.PAID,
            platform_fee_cents=40000,
        )
        DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=18,
            status=DrawRequestStatus.PAID,
            title="Historical Paid Draw",
            gross_amount=Decimal("2000.00"),
            retainage_amount=Decimal("200.00"),
            net_amount=Decimal("1800.00"),
            current_requested_amount=Decimal("2000.00"),
            platform_fee_cents=25000,
            payout_cents=175000,
            paid_at=timezone.now(),
        )

        expense = ExpenseRequest.objects.create(
            agreement=self.agreement,
            description="Fee cap expense",
            amount=Decimal("5000.00"),
        )

        mock_session_create.return_value = {
            "id": "cs_expense_123",
            "url": "https://checkout.stripe.test/expense-123",
            "payment_intent": "pi_expense_123",
        }

        from projects.services.expense_pay import create_expense_checkout_session

        checkout_url = create_expense_checkout_session(expense)

        self.assertEqual(checkout_url, "https://checkout.stripe.test/expense-123")
        mock_session_create.assert_called_once()
        session_kwargs = mock_session_create.call_args.kwargs
        self.assertEqual(session_kwargs["payment_intent_data"]["application_fee_amount"], 10000)
        self.assertEqual(session_kwargs["payment_intent_data"]["metadata"]["platform_fee_cents"], "10000")
        self.assertEqual(session_kwargs["payment_intent_data"]["metadata"]["payout_cents"], "490000")

        expense.refresh_from_db()
        self.assertEqual(expense.stripe_checkout_session_id, "cs_expense_123")
        self.assertEqual(expense.stripe_payment_intent_id, "pi_expense_123")
        self.assertEqual(expense.platform_fee_cents, 10000)
        self.assertEqual(expense.payout_cents, 490000)
        self.assertEqual(expense.stripe_checkout_url, "https://checkout.stripe.test/expense-123")

    def test_contractor_approve_endpoint_routes_escrow_draw_to_awaiting_release(self):
        self.agreement.payment_mode = "escrow"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=10,
            status=DrawRequestStatus.SUBMITTED,
            title="Contractor Approved Escrow Draw",
            gross_amount=Decimal("2600.00"),
            retainage_amount=Decimal("260.00"),
            net_amount=Decimal("2340.00"),
            current_requested_amount=Decimal("2600.00"),
        )

        approve_response = self.client.post(f"/api/projects/draws/{draw.id}/approve/", {}, format="json")

        self.assertEqual(approve_response.status_code, 200)
        self.assertEqual(approve_response.json()["workflow_status"], "payment_pending")
        self.assertTrue(approve_response.json()["is_awaiting_release"])
        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.AWAITING_RELEASE)

    def test_release_endpoint_rejects_direct_draws(self):
        self.agreement.payment_mode = "direct"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=11,
            status=DrawRequestStatus.APPROVED,
            title="Direct Draw",
            gross_amount=Decimal("1800.00"),
            retainage_amount=Decimal("180.00"),
            net_amount=Decimal("1620.00"),
            current_requested_amount=Decimal("1800.00"),
        )

        release_response = self.client.post(f"/api/projects/draws/{draw.id}/release/", {}, format="json")

        self.assertEqual(release_response.status_code, 400)
        self.assertIn("escrow", str(release_response.json()["detail"]).lower())

    def test_magic_draw_request_changes_sets_changes_requested_and_note(self):
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner"])

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            status=DrawRequestStatus.SUBMITTED,
            title="Submitted Draw",
            gross_amount=Decimal("2500.00"),
            retainage_amount=Decimal("250.00"),
            net_amount=Decimal("2250.00"),
            current_requested_amount=Decimal("2500.00"),
        )

        response = self.client.patch(
            f"/api/projects/draws/magic/{draw.public_token}/request_changes/",
            {"note": "Please clarify the completed scope before payment."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.CHANGES_REQUESTED)
        self.assertEqual(draw.homeowner_review_notes, "Please clarify the completed scope before payment.")
        self.assertEqual(response.json()["workflow_status"], "changes_requested")
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="draw_changes_requested",
            ).exists()
        )
        notification = Notification.objects.filter(
            contractor=self.contractor,
            event_type=Notification.EVENT_DRAW_CHANGES_REQUESTED,
            draw_request=draw,
            agreement=self.agreement,
        ).first()
        self.assertIsNotNone(notification)

    def test_finalize_draw_paid_marks_paid_and_creates_verified_payment_record(self):
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=4,
            status=DrawRequestStatus.APPROVED,
            title="Approved Draw",
            gross_amount=Decimal("3000.00"),
            retainage_amount=Decimal("300.00"),
            net_amount=Decimal("2700.00"),
            current_requested_amount=Decimal("3000.00"),
        )

        finalized = finalize_draw_paid(
            draw_request_id=draw.id,
            checkout_session_id="cs_test_draw_123",
            payment_intent_id="pi_test_draw_123",
            payment_method="stripe_checkout",
        )

        self.assertEqual(finalized.status, DrawRequestStatus.PAID)
        self.assertEqual(finalized.paid_via, "stripe_checkout")
        self.assertIsNotNone(finalized.paid_at)
        self.assertTrue(
            ExternalPaymentRecord.objects.filter(
                draw_request=draw,
                agreement=self.agreement,
                status=ExternalPaymentStatus.VERIFIED,
            ).exists()
        )
        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="draw_paid",
                dedupe_key=f"draw_paid:{draw.id}",
            ).exists()
        )
        notification = Notification.objects.filter(
            contractor=self.contractor,
            event_type=Notification.EVENT_DRAW_PAID,
            draw_request=draw,
            agreement=self.agreement,
        ).first()
        self.assertIsNotNone(notification)

    @override_settings(STRIPE_SECRET_KEY="sk_test_123", FRONTEND_URL="https://app.myhomebro.test")
    def test_invoice_direct_checkout_supports_card_and_ach(self):
        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode"])
        self.contractor.stripe_account_id = "acct_direct_ready"
        self.contractor.save(update_fields=["stripe_account_id"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("4250.00"),
            status=InvoiceStatus.PENDING,
        )

        created_calls = []

        def _fake_create(**kwargs):
            created_calls.append(kwargs)
            return {"id": "cs_test_invoice_123", "url": "https://checkout.stripe.test/invoice-123", "payment_intent": "pi_test_invoice_123"}

        with patch("stripe.checkout.Session.create", side_effect=_fake_create):
            checkout_url = create_direct_pay_checkout_for_invoice(invoice)

        self.assertEqual(checkout_url, "https://checkout.stripe.test/invoice-123")
        self.assertEqual(created_calls[0]["payment_method_types"], ["card", "us_bank_account"])

    def test_direct_pay_invoice_checkout_completion_keeps_invoice_pending_until_payment_intent_success(self):
        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1900.00"),
            status=InvoiceStatus.SENT,
        )

        _handle_direct_pay_checkout_completed(
            {
                "id": "cs_test_invoice_pending",
                "payment_intent": "pi_test_invoice_pending",
                "metadata": {
                    "invoice_id": str(invoice.id),
                    "payment_mode": "DIRECT",
                    "kind": "direct_pay_checkout",
                },
            }
        )

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.APPROVED)
        self.assertEqual(invoice.direct_pay_checkout_session_id, "cs_test_invoice_pending")
        self.assertEqual(invoice.direct_pay_payment_intent_id, "pi_test_invoice_pending")
        self.assertIsNone(invoice.direct_pay_paid_at)
        self.assertTrue(
            Notification.objects.filter(
                contractor=self.contractor,
                agreement=self.agreement,
                invoice=invoice,
                category=Notification.EVENT_INVOICE_APPROVED,
            ).exists()
        )

    def test_finalize_direct_pay_invoice_paid_creates_payment_released_notification(self):
        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1900.00"),
            status=InvoiceStatus.APPROVED,
            direct_pay_checkout_session_id="cs_test_invoice_paid",
            direct_pay_payment_intent_id="pi_test_invoice_paid",
        )

        finalize_direct_pay_invoice_paid(
            invoice_id=invoice.id,
            payment_intent_id="pi_test_invoice_paid",
        )

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.PAID)
        self.assertIsNotNone(invoice.direct_pay_paid_at)
        self.assertTrue(
            Notification.objects.filter(
                contractor=self.contractor,
                agreement=self.agreement,
                invoice=invoice,
                category=Notification.EVENT_PAYMENT_RELEASED,
            ).exists()
        )

    def test_payment_intent_processing_keeps_direct_invoice_in_payment_pending(self):
        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1400.00"),
            status=InvoiceStatus.SENT,
        )

        _handle_payment_intent_processing(
            {
                "id": "pi_test_invoice_processing",
                "metadata": {
                    "invoice_id": str(invoice.id),
                    "kind": "direct_pay_checkout",
                },
            }
        )

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.APPROVED)
        self.assertEqual(invoice.direct_pay_payment_intent_id, "pi_test_invoice_processing")
        self.assertIsNone(invoice.direct_pay_paid_at)

    def test_payment_intent_failure_marks_direct_invoice_as_disputed_issue(self):
        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode"])
        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1600.00"),
            status=InvoiceStatus.APPROVED,
        )

        _handle_payment_intent_failed(
            {
                "id": "pi_test_invoice_failed",
                "metadata": {
                    "invoice_id": str(invoice.id),
                    "kind": "direct_pay_checkout",
                },
                "last_payment_error": {"message": "ACH debit failed"},
            }
        )

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.DISPUTED)
        self.assertTrue(invoice.disputed)
        self.assertEqual(invoice.dispute_reason, "ACH debit failed")
        self.assertEqual(invoice.direct_pay_payment_intent_id, "pi_test_invoice_failed")

    def test_draw_checkout_completion_does_not_mark_draw_paid_before_payment_intent_success(self):
        self.agreement.payment_mode = "direct"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])

        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=13,
            status=DrawRequestStatus.APPROVED,
            title="Pending Stripe Draw",
            gross_amount=Decimal("2000.00"),
            retainage_amount=Decimal("200.00"),
            net_amount=Decimal("1800.00"),
            current_requested_amount=Decimal("2000.00"),
            stripe_checkout_session_id="cs_test_draw_pending",
            stripe_payment_intent_id="pi_test_draw_pending",
        )

        _handle_draw_direct_checkout_completed(
            {
                "id": "cs_test_draw_pending",
                "payment_intent": "pi_test_draw_pending",
                "payment_status": "paid",
                "metadata": {
                    "kind": "draw_direct_checkout",
                    "draw_request_id": str(draw.id),
                },
            }
        )

        draw.refresh_from_db()
        self.assertEqual(draw.status, DrawRequestStatus.APPROVED)
        self.assertIsNone(draw.paid_at)

    def test_payment_intent_failure_marks_draw_as_issue_without_creating_parallel_state(self):
        self.agreement.payment_mode = "direct"
        self.agreement.save(update_fields=["payment_mode"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=14,
            status=DrawRequestStatus.APPROVED,
            title="Draw With Failed ACH",
            gross_amount=Decimal("2100.00"),
            retainage_amount=Decimal("210.00"),
            net_amount=Decimal("1890.00"),
            current_requested_amount=Decimal("2100.00"),
            stripe_payment_intent_id="pi_test_draw_failed",
        )

        _handle_payment_intent_failed(
            {
                "id": "pi_test_draw_failed",
                "metadata": {
                    "kind": "draw_direct_checkout",
                    "draw_request_id": str(draw.id),
                },
                "last_payment_error": {"message": "Bank account verification failed"},
            }
        )

        payment_record = ExternalPaymentRecord.objects.get(draw_request=draw)
        self.assertEqual(payment_record.status, ExternalPaymentStatus.DISPUTED)
        self.assertEqual(payment_record.notes, "Bank account verification failed")

    def test_draw_list_serializes_payment_pending_for_direct_approved_draw(self):
        self.agreement.payment_mode = "direct"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=5,
            status=DrawRequestStatus.APPROVED,
            title="Approved Direct Draw",
            gross_amount=Decimal("1800.00"),
            retainage_amount=Decimal("180.00"),
            net_amount=Decimal("1620.00"),
            current_requested_amount=Decimal("1800.00"),
        )

        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/draws/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["results"][0]
        self.assertEqual(payload["id"], draw.id)
        self.assertEqual(payload["status"], "approved")
        self.assertEqual(payload["workflow_status"], "payment_pending")
        self.assertTrue(payload["is_payment_pending"])

    def test_draw_list_serializes_awaiting_release_for_escrow_draw(self):
        self.agreement.payment_mode = "escrow"
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["payment_mode", "signed_by_contractor", "signed_by_homeowner"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=12,
            status=DrawRequestStatus.AWAITING_RELEASE,
            title="Escrow Approved Draw",
            gross_amount=Decimal("1800.00"),
            retainage_amount=Decimal("180.00"),
            net_amount=Decimal("1620.00"),
            current_requested_amount=Decimal("1800.00"),
        )

        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/draws/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["results"][0]
        self.assertEqual(payload["id"], draw.id)
        self.assertEqual(payload["workflow_status"], "payment_pending")
        self.assertTrue(payload["is_awaiting_release"])

    def test_draw_list_serializes_disputed_when_payment_record_is_disputed(self):
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=6,
            status=DrawRequestStatus.APPROVED,
            title="Approved Draw",
            gross_amount=Decimal("2200.00"),
            retainage_amount=Decimal("220.00"),
            net_amount=Decimal("1980.00"),
            current_requested_amount=Decimal("2200.00"),
        )
        ExternalPaymentRecord.objects.create(
            agreement=self.agreement,
            draw_request=draw,
            gross_amount=Decimal("2200.00"),
            net_amount=Decimal("1980.00"),
            retainage_withheld_amount=Decimal("220.00"),
            payment_method="ach",
            payment_date=timezone.localdate(),
            status=ExternalPaymentStatus.DISPUTED,
            recorded_by=self.contractor_user,
        )

        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/draws/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["results"][0]
        self.assertEqual(payload["workflow_status"], "disputed")

    @override_settings(FRONTEND_URL="https://app.myhomebro.test")
    def test_contractor_draw_list_and_resend_review_endpoint_work(self):
        self.agreement.signed_by_contractor = True
        self.agreement.signed_by_homeowner = True
        self.agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner"])
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=7,
            status=DrawRequestStatus.SUBMITTED,
            title="Submitted Draw",
            gross_amount=Decimal("1500.00"),
            retainage_amount=Decimal("150.00"),
            net_amount=Decimal("1350.00"),
            current_requested_amount=Decimal("1500.00"),
        )

        list_response = self.client.get("/api/projects/draws/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["results"][0]["id"], draw.id)

        resend_response = self.client.post(f"/api/projects/draws/{draw.id}/resend_review/", {}, format="json")
        self.assertEqual(resend_response.status_code, 200)
        self.assertTrue(resend_response.json()["email_delivery"]["ok"])
        self.assertEqual(resend_response.json()["id"], draw.id)

    def test_notification_list_includes_draw_request_link(self):
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=8,
            status=DrawRequestStatus.APPROVED,
            title="Approved Draw",
            gross_amount=Decimal("1500.00"),
            retainage_amount=Decimal("150.00"),
            net_amount=Decimal("1350.00"),
            current_requested_amount=Decimal("1500.00"),
        )
        Notification.objects.create(
            contractor=self.contractor,
            user=self.contractor_user,
            category=Notification.EVENT_DRAW_APPROVED,
            event_type=Notification.EVENT_DRAW_APPROVED,
            agreement=self.agreement,
            draw_request=draw,
            title="Draw approved",
            message="Draw approved for payment.",
        )

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()[0]
        self.assertEqual(payload["draw_request_id"], draw.id)
        self.assertEqual(payload["agreement_id"], self.agreement.id)

    def test_business_dashboard_includes_progress_summary(self):
        draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            status=DrawRequestStatus.APPROVED,
            title="Approved Draw",
            gross_amount=Decimal("2500.00"),
            retainage_amount=Decimal("250.00"),
            net_amount=Decimal("2250.00"),
            current_requested_amount=Decimal("2500.00"),
        )
        ExternalPaymentRecord.objects.create(
            agreement=self.agreement,
            draw_request=draw,
            gross_amount=Decimal("2250.00"),
            net_amount=Decimal("2250.00"),
            retainage_withheld_amount=Decimal("0.00"),
            payment_method="ach",
            payment_date=timezone.localdate(),
            recorded_by=self.contractor_user,
        )
        DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=2,
            status=DrawRequestStatus.DRAFT,
            title="Draft Draw",
            gross_amount=Decimal("999.00"),
            retainage_amount=Decimal("99.00"),
            net_amount=Decimal("900.00"),
            current_requested_amount=Decimal("999.00"),
        )
        ExternalPaymentRecord.objects.create(
            agreement=self.agreement,
            draw_request=draw,
            gross_amount=Decimal("500.00"),
            net_amount=Decimal("500.00"),
            retainage_withheld_amount=Decimal("0.00"),
            payment_method="ach",
            payment_date=timezone.localdate(),
            status=ExternalPaymentStatus.VOIDED,
            recorded_by=self.contractor_user,
        )

        response = self.client.get("/api/projects/business/contractor/summary/?range=30")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["progress_summary"]
        self.assertEqual(payload["project_count"], 1)
        self.assertEqual(payload["contract_value"], "10000.00")
        self.assertEqual(payload["earned_to_date"], "2500.00")
        self.assertEqual(payload["approved_to_date"], "2500.00")
        self.assertEqual(payload["paid_to_date"], "2250.00")
        self.assertEqual(payload["retainage_held"], "250.00")


class ContractorProcessedVolumePricingTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="volume-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Volume Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Volume Homeowner",
            email="volume-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Volume Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Volume agreement",
            payment_structure="progress",
            payment_mode="escrow",
            total_cost=Decimal("50000.00"),
        )
        self.now = timezone.now()

    def _create_paid_invoice(self, *, amount, **kwargs):
        return Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal(str(amount)),
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=self.now,
            **kwargs,
        )

    def _create_released_draw(self, *, gross_amount, **kwargs):
        return DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=kwargs.pop("draw_number", DrawRequest.objects.filter(agreement=self.agreement).count() + 1),
            status=DrawRequestStatus.RELEASED,
            title=kwargs.pop("title", "Released Draw"),
            gross_amount=Decimal(str(gross_amount)),
            retainage_amount=Decimal("0.00"),
            net_amount=Decimal(str(gross_amount)),
            released_at=self.now,
            paid_at=None,
            **kwargs,
        )

    def test_invoice_only_monthly_volume_counts_paid_invoice_activity(self):
        self._create_paid_invoice(amount="1250.00")

        volume = get_monthly_processed_volume_for_contractor(self.contractor)

        self.assertEqual(volume, Decimal("1250.00"))

    def test_draw_only_monthly_volume_counts_released_draw_activity(self):
        self._create_released_draw(gross_amount="2400.00")

        volume = get_monthly_processed_volume_for_contractor(self.contractor)

        self.assertEqual(volume, Decimal("2400.00"))

    def test_mixed_invoice_and_draw_monthly_volume_is_unified(self):
        self._create_paid_invoice(amount="1250.00")
        self._create_released_draw(gross_amount="2400.00")

        volume = get_monthly_processed_volume_for_contractor(self.contractor)

        self.assertEqual(volume, Decimal("3650.00"))

    def test_threshold_crossing_uses_combined_monthly_volume(self):
        self._create_paid_invoice(amount="8000.00")
        self._create_released_draw(gross_amount="18000.00")

        summary = compute_fee_summary(
            project_amount=Decimal("1000.00"),
            contractor_created_at=self.now - timedelta(days=120),
            contractor=self.contractor,
            fee_payer="contractor",
            today=self.now.date(),
        )

        self.assertEqual(summary.rate_info.tier_name, "tier3")
        self.assertEqual(summary.rate_info.rate, Decimal("0.035"))

    def test_intro_period_still_overrides_volume_logic(self):
        self._create_paid_invoice(amount="15000.00")
        self._create_released_draw(gross_amount="15000.00")

        summary = compute_fee_summary(
            project_amount=Decimal("1000.00"),
            contractor_created_at=self.now - timedelta(days=10),
            contractor=self.contractor,
            fee_payer="contractor",
            today=self.now.date(),
        )

        self.assertTrue(summary.rate_info.is_intro)
        self.assertEqual(summary.rate_info.tier_name, "intro")
        self.assertEqual(summary.rate_info.rate, Decimal("0.03"))

    def test_linked_draw_payment_record_is_not_double_counted(self):
        draw = self._create_released_draw(gross_amount="2000.00")
        ExternalPaymentRecord.objects.create(
            agreement=self.agreement,
            draw_request=draw,
            gross_amount=Decimal("2000.00"),
            retainage_withheld_amount=Decimal("0.00"),
            net_amount=Decimal("2000.00"),
            payment_method="ach",
            payment_date=timezone.localdate(),
            reference_number="DRAW-2000",
            notes="Recorded draw payment",
            status=ExternalPaymentStatus.VERIFIED,
            recorded_by=self.contractor_user,
        )

        volume = get_monthly_processed_volume_for_contractor(self.contractor)

        self.assertEqual(volume, Decimal("2000.00"))

    def test_contractor_profile_pricing_summary_uses_unified_volume(self):
        self._create_paid_invoice(amount="8000.00")
        self._create_released_draw(gross_amount="18000.00")

        client = APIClient()
        client.force_authenticate(user=self.contractor_user)
        response = client.get("/api/projects/contractors/me/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["pricing_summary"]
        self.assertEqual(payload["monthly_volume"], "26000.00")
        self.assertEqual(payload["monthly_invoice_volume"], "8000.00")
        self.assertEqual(payload["monthly_draw_volume"], "18000.00")
        self.assertEqual(payload["tier_type"], "intro")
        self.assertTrue(payload["intro_active"])


class AgreementFundingPreviewAccessTests(TestCase):
    def setUp(self):
        user_model = get_user_model()

        self.contractor_user = user_model.objects.create_user(
            email="preview-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Preview Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Preview Homeowner",
            email="preview-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Preview Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Preview agreement",
            total_cost=Decimal("15000.00"),
        )

        self.other_user = user_model.objects.create_user(
            email="other-contractor@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Other Contractor",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Preview Project",
        )
        Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other preview agreement",
            total_cost=Decimal("9000.00"),
        )

        self.homeowner_user = user_model.objects.create_user(
            email=self.homeowner.email,
            password="testpass123",
        )

        self.client = APIClient()

    def test_contractor_can_access_own_agreement_funding_preview(self):
        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/funding_preview/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["project_amount"], "15000.00")
        self.assertIn("rate", payload)
        self.assertIn("tier_name", payload)
        self.assertEqual(payload["fee_cap"], "750.00")
        self.assertEqual(payload["fee_cap_label"], "$750 per project")

    def test_unrelated_contractor_cannot_access_funding_preview(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/funding_preview/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "You do not have access to this agreement.")

    def test_homeowner_email_match_can_access_funding_preview(self):
        self.client.force_authenticate(user=self.homeowner_user)
        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/funding_preview/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["project_amount"], "15000.00")


class ProjectLearningFoundationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="learning-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Learning Contractor",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Casey Prospect",
            email="casey@example.com",
            city="Austin",
            state="TX",
            zip_code="78701",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Kitchen Remodel",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78701",
            status=ProjectStatus.IN_PROGRESS,
        )
        self.template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Kitchen Remodel Template",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            estimated_days=21,
        )
        self.other_contractor_user = user_model.objects.create_user(
            email="learning-other-contractor@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Learning Other Contractor",
            city="Miami",
            state="FL",
        )

    def _create_completed_agreement(
        self,
        *,
        total_cost=Decimal("12000.00"),
        estimated_amounts=None,
        actual_total=None,
        status=ProjectStatus.IN_PROGRESS,
        use_template=True,
        start_date=None,
    ):
        estimated_amounts = estimated_amounts or [Decimal("3000.00"), Decimal("6000.00")]
        start_date = start_date or timezone.localdate() - timedelta(days=20)
        project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title=f"Kitchen Remodel {Agreement.objects.count() + 1}",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78701",
            status=ProjectStatus.IN_PROGRESS,
        )

        agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template=self.template if use_template else None,
            selected_template_name_snapshot=self.template.name if use_template else "",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            payment_mode="direct",
            signature_policy="both_required",
            total_cost=total_cost,
            retainage_percent=Decimal("10.00"),
            start=start_date,
            end=start_date + timedelta(days=14),
            project_address_city="Austin",
            project_address_state="TX",
            project_postal_code="78701",
            status=status,
            description="Kitchen remodel learning test.",
        )

        AgreementAIScope.objects.create(
            agreement=agreement,
            questions=[
                {"key": "cabinet_supplier", "question": "Who is supplying cabinets?"},
                {"key": "haul_away", "question": "Is debris hauling included?"},
            ],
            answers={
                "cabinet_supplier": "Owner supplied",
                "haul_away": "Included",
            },
        )

        milestone_one = Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Demo",
            description="Demo existing kitchen",
            amount=Decimal("4000.00"),
            start_date=start_date,
            completion_date=start_date + timedelta(days=5),
            completed=True,
            completed_at=timezone.now() - timedelta(days=10),
            is_invoiced=True,
            normalized_milestone_type="demolition",
            template_suggested_amount=estimated_amounts[0],
            recommended_days_from_start=0,
            recommended_duration_days=5,
        )
        milestone_two = Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Install",
            description="Install cabinets and finishes",
            amount=Decimal("8000.00"),
            start_date=start_date + timedelta(days=6),
            completion_date=start_date + timedelta(days=15),
            completed=True,
            completed_at=timezone.now() - timedelta(days=1),
            is_invoiced=True,
            normalized_milestone_type="cabinet_installation",
            ai_suggested_amount=estimated_amounts[1],
            recommended_days_from_start=6,
            recommended_duration_days=9,
        )

        Invoice.objects.create(
            agreement=agreement,
            amount=Decimal("4000.00"),
            status=InvoiceStatus.PAID,
            direct_pay_paid_at=timezone.now() - timedelta(days=10),
            milestone_id_snapshot=milestone_one.id,
            milestone_title_snapshot=milestone_one.title,
            milestone_description_snapshot=milestone_one.description,
        )
        Invoice.objects.create(
            agreement=agreement,
            amount=actual_total or Decimal("8000.00"),
            status=InvoiceStatus.PAID,
            direct_pay_paid_at=timezone.now() - timedelta(days=1),
            milestone_id_snapshot=milestone_two.id,
            milestone_title_snapshot=milestone_two.title,
            milestone_description_snapshot=milestone_two.description,
        )
        DrawRequest.objects.create(
            agreement=agreement,
            draw_number=1,
            status=DrawRequestStatus.APPROVED,
            title="Approved Draw",
            gross_amount=Decimal("12000.00"),
            retainage_amount=Decimal("1200.00"),
            net_amount=Decimal("10800.00"),
            current_requested_amount=Decimal("12000.00"),
        )
        return agreement

    def _seed_contractor_benchmark_snapshot(
        self,
        *,
        template_used: str,
        total_project_value: Decimal,
        actual_duration_days: int,
        milestone_count: int,
        dispute_flag: bool = False,
        amendment_count: int = 0,
    ):
        agreement = self._create_completed_agreement(
            total_cost=total_project_value,
            actual_total=total_project_value,
            status=ProjectStatus.COMPLETED,
            use_template=True,
        )
        snapshot = capture_project_outcome_snapshot(agreement)
        snapshot.project_family_key = "kitchen_remodel"
        snapshot.project_family_label = "Kitchen Remodel"
        snapshot.scope_mode = "install_removal"
        snapshot.template_used = template_used
        snapshot.total_project_value = total_project_value
        snapshot.actual_duration_days = actual_duration_days
        snapshot.milestone_count = milestone_count
        snapshot.dispute_flag = dispute_flag
        snapshot.amendment_count = amendment_count
        snapshot.completion_status = ProjectStatus.COMPLETED
        snapshot.estimated_value_range = {"low": str(total_project_value * Decimal("0.90")), "high": str(total_project_value * Decimal("1.10"))}
        snapshot.estimated_duration_range = {"low": str(max(actual_duration_days - 1, 1)), "high": str(actual_duration_days + 1)}
        snapshot.save(
            update_fields=[
                "project_family_key",
                "project_family_label",
                "scope_mode",
                "template_used",
                "total_project_value",
                "actual_duration_days",
                "milestone_count",
                "dispute_flag",
                "amendment_count",
                "completion_status",
                "estimated_value_range",
                "estimated_duration_range",
            ]
        )
        return snapshot

    def _seed_regional_outcome_snapshot(
        self,
        *,
        region_state: str = "TX",
        region_city: str = "Austin",
        template_used: str = "Kitchen Remodel Template",
        total_project_value: Decimal = Decimal("6500.00"),
        actual_duration_days: int = 5,
        milestone_count: int = 4,
        dispute_flag: bool = False,
        amendment_count: int = 0,
    ):
        agreement = self._create_completed_agreement(
            total_cost=total_project_value,
            actual_total=total_project_value,
            status=ProjectStatus.COMPLETED,
            use_template=True,
        )
        snapshot = ProjectOutcomeSnapshot.objects.create(
            agreement=agreement,
            contractor=None,
            source_lead=None,
            template=agreement.selected_template,
            project_family_key="kitchen_remodel",
            project_family_label="Kitchen Remodel",
            scope_mode="install_removal",
            template_used=template_used,
            region_key=build_normalized_region_key(country="US", state=region_state, city=region_city),
            region_label=f"{region_city}, {region_state}",
            region_granularity="city" if region_city and region_state else "state" if region_state else "unknown",
            original_intelligence_payload={},
            original_suggested_plan={},
            final_project_state={},
            final_milestones=[],
            total_project_value=total_project_value,
            estimated_value_range={"low": str(total_project_value * Decimal("0.90")), "high": str(total_project_value * Decimal("1.10"))},
            actual_duration_days=actual_duration_days,
            estimated_duration_range={"low": max(actual_duration_days - 1, 1), "high": actual_duration_days + 1},
            milestone_count=milestone_count,
            dispute_flag=dispute_flag,
            amendment_count=amendment_count,
            completion_status=ProjectStatus.COMPLETED,
        )
        return snapshot

    def test_snapshot_creation_when_agreement_becomes_completed(self):
        agreement = self._create_completed_agreement()

        with self.captureOnCommitCallbacks(execute=True):
            changed, check = recompute_and_apply_agreement_completion(agreement.id)

        self.assertTrue(changed)
        self.assertTrue(check.ok)

        snapshot = AgreementOutcomeSnapshot.objects.get(agreement=agreement)
        self.assertFalse(snapshot.excluded_from_benchmarks)
        self.assertEqual(snapshot.project_type, "Remodel")
        self.assertEqual(snapshot.project_subtype, "Kitchen Remodel")
        self.assertEqual(snapshot.template_id, self.template.id)
        self.assertEqual(snapshot.final_agreed_total_amount, Decimal("12000.00"))
        self.assertEqual(snapshot.final_paid_amount, Decimal("12000.00"))
        self.assertEqual(snapshot.milestone_count, 2)
        self.assertEqual(snapshot.clarification_summary["answered_count"], 2)
        self.assertEqual(snapshot.clarification_traits["cabinet_supplier"], "owner_supplied")
        self.assertTrue(snapshot.clarification_signature)
        self.assertFalse(snapshot.has_change_orders)
        self.assertEqual(snapshot.change_order_count, 0)
        self.assertEqual(snapshot.milestones.count(), 2)

        proposal_snapshot = AgreementProposalSnapshot.objects.get(
            agreement=agreement,
            stage=AgreementProposalSnapshot.Stage.FINALIZED,
        )
        self.assertTrue(proposal_snapshot.is_successful)
        self.assertEqual(proposal_snapshot.project_type, "Remodel")
        self.assertIn("Kitchen Remodel", proposal_snapshot.project_title)

    def test_project_outcome_snapshot_is_captured_when_agreement_becomes_completed(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.IN_PROGRESS)

        with self.captureOnCommitCallbacks(execute=True):
            changed, check = recompute_and_apply_agreement_completion(agreement.id)

        self.assertTrue(changed)
        self.assertTrue(check.ok)

        snapshot = ProjectOutcomeSnapshot.objects.get(agreement=agreement)
        self.assertEqual(snapshot.project_family_key, "kitchen_remodel")
        self.assertEqual(snapshot.project_family_label, "Kitchen Remodel")
        self.assertEqual(snapshot.region_key, "US-TX-AUSTIN")
        self.assertEqual(snapshot.region_label, "Austin, TX")
        self.assertEqual(snapshot.region_granularity, "city")
        self.assertEqual(snapshot.template_used, self.template.name)
        self.assertEqual(snapshot.total_project_value, Decimal("12000.00"))
        self.assertEqual(snapshot.milestone_count, 2)
        self.assertEqual(snapshot.completion_status, ProjectStatus.COMPLETED)
        self.assertEqual(snapshot.original_suggested_plan["project_family_key"], "kitchen_remodel")
        self.assertEqual(snapshot.final_project_state["total_project_value"], "12000.00")
        self.assertEqual(snapshot.final_project_state["completion_status"], ProjectStatus.COMPLETED)
        self.assertEqual(len(snapshot.final_milestones), 2)
        self.assertIn("analysis", snapshot.original_intelligence_payload)
        self.assertIn("suggested_plan", snapshot.original_intelligence_payload)
        self.assertIn("estimate_preview", snapshot.original_intelligence_payload)

    def test_project_outcome_snapshot_is_captured_when_payment_is_released(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.IN_PROGRESS)
        draw = agreement.draw_requests.first()
        self.assertIsNotNone(draw)

        finalized = finalize_draw_paid(draw_request_id=draw.id)
        self.assertEqual(finalized.status, DrawRequestStatus.PAID)

        snapshot = ProjectOutcomeSnapshot.objects.get(agreement=agreement)
        self.assertEqual(snapshot.project_family_key, "kitchen_remodel")
        self.assertEqual(snapshot.milestone_count, 2)
        self.assertIn(snapshot.completion_status, {ProjectStatus.COMPLETED, "payment_released"})
        self.assertEqual(snapshot.final_project_state["trigger_source"], "payment_released")
        self.assertIn(snapshot.final_project_state["completion_status"], {ProjectStatus.COMPLETED, "payment_released"})
        self.assertEqual(snapshot.final_project_state["template_used"], self.template.name)

    def test_proposal_snapshot_is_captured_when_agreement_is_created(self):
        payload = {
            "project": self.project,
            "contractor": self.contractor,
            "homeowner": self.homeowner,
            "project_title": "Kitchen Remodel",
            "description": "Replace the cabinets, countertops, and backsplash.",
            "project_class": "residential",
            "project_type": "Remodel",
            "project_subtype": "Kitchen Remodel",
            "payment_mode": "direct",
            "total_cost": Decimal("12000.00"),
            "project_address_city": "Austin",
            "project_address_state": "TX",
            "project_postal_code": "78701",
        }

        with self.captureOnCommitCallbacks(execute=True):
            agreement = create_agreement_from_validated(payload)

        snapshot = AgreementProposalSnapshot.objects.get(
            agreement=agreement,
            stage=AgreementProposalSnapshot.Stage.DRAFT_CREATED,
        )
        self.assertFalse(snapshot.is_successful)
        self.assertIn("Replace the cabinets", snapshot.proposal_text)
        self.assertEqual(snapshot.project_type, "Remodel")
        self.assertEqual(snapshot.project_subtype, "Kitchen Remodel")

    def test_snapshot_capture_is_idempotent_for_repeated_completion(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.COMPLETED)

        first_snapshot = capture_agreement_outcome_snapshot(agreement)
        snapshot_created_at = first_snapshot.snapshot_created_at
        first_snapshot.final_paid_amount = Decimal("9999.00")
        first_snapshot.save(update_fields=["final_paid_amount", "snapshot_updated_at"])

        second_snapshot = capture_agreement_outcome_snapshot(agreement)
        self.assertEqual(AgreementOutcomeSnapshot.objects.filter(agreement=agreement).count(), 1)
        self.assertEqual(second_snapshot.id, first_snapshot.id)
        self.assertEqual(second_snapshot.snapshot_created_at, snapshot_created_at)
        self.assertEqual(second_snapshot.final_paid_amount, Decimal("12000.00"))

    def test_successful_proposals_seed_learning_templates_and_fallback_still_works(self):
        first = self._create_completed_agreement(status=ProjectStatus.COMPLETED)
        second = self._create_completed_agreement(
            status=ProjectStatus.COMPLETED,
            total_cost=Decimal("14000.00"),
            estimated_amounts=[Decimal("3500.00"), Decimal("7000.00")],
        )

        capture_agreement_outcome_snapshot(first)
        capture_agreement_outcome_snapshot(second)
        capture_agreement_proposal_snapshot(first, stage=AgreementProposalSnapshot.Stage.FINALIZED)
        capture_agreement_proposal_snapshot(second, stage=AgreementProposalSnapshot.Stage.FINALIZED)

        learned_draft = build_proposal_draft(
            contractor=self.contractor,
            project_title="Kitchen Remodel",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Replace the cabinets, countertops, and backsplash.",
            budget_text="$12,000 - $14,000",
            timeline_text="About 3 weeks",
            measurement_handling="site_visit_required",
            photo_count=2,
            request_path_label="Multi-Quote Request",
            request_signals=["Guided Intake", "Photos", "Budget Provided"],
            clarification_summary=[
                {"key": "measurements", "label": "Measurements", "value": "Site visit required"}
            ],
        )

        self.assertTrue(learned_draft["learning"]["based_on_successful_projects"])
        self.assertGreaterEqual(learned_draft["learning"]["sample_size"], 2)
        self.assertIn("similar successful projects", learned_draft["text"])
        self.assertEqual(learned_draft["summary"]["projectFamilyKey"], "kitchen_remodel")
        self.assertIn("Kitchen remodels benefit from", learned_draft["text"])

        fallback_draft = build_proposal_draft(
            contractor=self.contractor,
            project_title="Patio Repair",
            project_type="Repair",
            project_subtype="General Repair",
            description="Fix cracked concrete and refresh the patio surface.",
        )
        self.assertFalse(fallback_draft["learning"]["based_on_successful_projects"])
        self.assertIn("Thanks for sharing the details", fallback_draft["text"])

    def test_project_intelligence_context_matches_common_categories_and_falls_back_gracefully(self):
        roofing = build_project_intelligence_context(
            project_title="Roof Repair",
            project_type="Roofing",
            project_subtype="Roof Replacement",
            description="Replace shingles and flashing after a leak.",
        )
        self.assertEqual(roofing["family_key"], "roofing")
        self.assertIn("Roofing-focused review", roofing["family_cue_label"])
        self.assertTrue(roofing["prep_items"])
        self.assertIn("leak location", roofing["prep_items"][0].lower())

        generic = build_project_intelligence_context(
            project_title="Custom Scope",
            project_type="Custom",
            project_subtype="Unique",
            description="Specialized work with no obvious family match.",
        )
        self.assertEqual(generic["family_key"], "general")
        self.assertFalse(generic["family_cue_label"])
        self.assertTrue(generic["is_generic"])

    def test_project_setup_recommendation_maps_kitchen_install_scope(self):
        recommendation = build_project_setup_recommendation(
            project_title="Need kitchen cabinets installed",
            project_type="Kitchen Remodel",
            project_subtype="Primary Kitchen",
            description="Remove old cabinets, install new cabinets already on site, and include backsplash work.",
        )

        self.assertEqual(recommendation["project_family_key"], "kitchen_remodel")
        self.assertEqual(recommendation["recommended_project_type"], "Kitchen Cabinet Installation")
        self.assertEqual(recommendation["recommended_project_subtype"], "Kitchen Cabinet Installation")
        self.assertEqual(recommendation["suggested_workflow"], "Install + removal")
        self.assertEqual(recommendation["suggested_template_label"], "Kitchen Cabinet Install Template")
        self.assertFalse(recommendation["strong_template_match"])

    def test_project_setup_recommendation_maps_shed_scope_to_outdoor(self):
        recommendation = build_project_setup_recommendation(
            project_title="Build backyard 12x14 shed",
            project_type="",
            project_subtype="",
            description="Build backyard 12x14 shed with slab foundation, single entry door, and shingle roof.",
        )

        self.assertEqual(recommendation["project_family_key"], "outdoor")
        self.assertEqual(recommendation["recommended_project_type"], "Outdoor")
        self.assertEqual(recommendation["recommended_project_subtype"], "Shed Build")
        self.assertEqual(recommendation["suggested_workflow"], "Outdoor structure workflow")
        self.assertEqual(recommendation["suggested_template_label"], "Shed Build Template")
        self.assertFalse(recommendation["strong_template_match"])

    def test_project_plan_recommendation_builds_kitchen_install_plan(self):
        plan = build_project_plan_suggestion(
            project_title="Need kitchen cabinets installed",
            project_type="Kitchen Remodel",
            project_subtype="Primary Kitchen",
            description="Remove old cabinets, install new cabinets already on site, and include backsplash work.",
            project_scope_summary="Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            clarification_answers={
                "materials": "Already on site",
                "inspection_requested": "Yes",
            },
            photo_count=2,
            region_state="TX",
            region_city="Austin",
            suggested_total_price="6250.00",
            suggested_price_low="5000.00",
            suggested_price_high="7500.00",
            suggested_duration_days=5,
            suggested_duration_low=3,
            suggested_duration_high=6,
            confidence_level="medium",
            confidence_reasoning="Moderate because the project type and scope are clear.",
            learned_benchmark_used=True,
            seeded_benchmark_used=True,
            benchmark_source="seeded_plus_learned",
            benchmark_match_scope="template_linked_profile",
            template_name="Kitchen Remodel Starter",
            selected_template_id=55,
        )

        self.assertEqual(plan["project_family_key"], "kitchen_remodel")
        self.assertEqual(plan["recommended_project_type"], "Kitchen Cabinet Installation")
        self.assertEqual(plan["suggested_workflow"], "Install + removal")
        self.assertEqual(plan["suggested_budget_low"], "5000.00")
        self.assertEqual(plan["suggested_budget_high"], "7500.00")
        self.assertIn("specific enough", plan["confidence_reasoning"].lower())
        self.assertIn("materials", " ".join(plan["explanation_points"]).lower())
        self.assertIn("finish work", " ".join(plan["explanation_points"]).lower())
        self.assertTrue(plan["milestones"])
        self.assertAlmostEqual(sum(row["allocation_percent"] for row in plan["milestones"]), 1.0, places=2)
        self.assertIn("learning_key", plan["learning_ready"])
        self.assertIn("deterministic_first", plan["source_metadata"]["recommendation_basis"])
        self.assertIn("source_type", plan["source_metadata"]["blended_benchmark"])
        self.assertIn("confidence", plan["source_metadata"]["blended_benchmark"])
        self.assertIn("regional", plan["source_metadata"]["blended_benchmark"])

    def test_project_plan_recommendation_falls_back_for_general_projects(self):
        plan = build_project_plan_suggestion(
            project_title="Need help around the house",
            project_type="Custom",
            project_subtype="General",
            description="Need help with a few different small tasks.",
            project_scope_summary="Small mixed repair tasks with no clear specialty trade.",
            clarification_answers={},
            photo_count=0,
            suggested_total_price=None,
            suggested_price_low=None,
            suggested_price_high=None,
            suggested_duration_days=None,
            suggested_duration_low=None,
            suggested_duration_high=None,
            confidence_level="low",
            confidence_reasoning="Limited details available.",
            learned_benchmark_used=False,
            seeded_benchmark_used=False,
            benchmark_source="none",
            benchmark_match_scope="none",
            region_state="",
            region_city="",
        )

        self.assertEqual(plan["project_family_key"], "general")
        self.assertEqual(plan["confidence_level"], "low")
        self.assertEqual(plan["suggested_workflow"], "General project review")
        self.assertNotEqual(plan["suggested_budget_high"], "0.00")
        self.assertTrue(plan["explanation_points"])
        self.assertTrue(plan["milestones"])

    def test_project_quantity_signals_scale_plan_ranges_deterministically(self):
        base_kwargs = dict(
            project_title="Need kitchen cabinets installed",
            project_type="Kitchen Remodel",
            project_subtype="Kitchen Cabinet Installation",
            description="Remove old cabinets, install new cabinets already on site, and include backsplash work.",
            project_scope_summary="Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            clarification_answers={
                "materials": "Already on site",
                "inspection_requested": "Yes",
            },
            photo_count=2,
            suggested_total_price="6250.00",
            suggested_price_low="5000.00",
            suggested_price_high="7500.00",
            suggested_duration_days=5,
            suggested_duration_low=3,
            suggested_duration_high=6,
            confidence_level="medium",
            confidence_reasoning="Moderate because the project type and scope are clear.",
            learned_benchmark_used=True,
            seeded_benchmark_used=True,
            benchmark_source="seeded_plus_learned",
            benchmark_match_scope="template_linked_profile",
            template_name="Kitchen Remodel Starter",
            selected_template_id=55,
            region_state="TX",
            region_city="Austin",
        )

        small_plan = build_project_plan_suggestion(
            **base_kwargs,
            quantity_context={
                "quantity_type": "count",
                "quantity_value": 6,
                "quantity_unit": "cabinets",
                "quantity_label": "6 cabinets",
                "quantity_source": "clarification_answers",
                "quantity_confidence": "high",
                "quantity_reference_value": 12,
                "quantity_scale_factor": "0.71",
                "quantity_ratio": "0.50",
                "quantity_reason": "Using 6 cabinets against a 12-cabinet kitchen baseline.",
            },
        )
        large_plan = build_project_plan_suggestion(
            **base_kwargs,
            quantity_context={
                "quantity_type": "count",
                "quantity_value": 20,
                "quantity_unit": "cabinets",
                "quantity_label": "20 cabinets",
                "quantity_source": "clarification_answers",
                "quantity_confidence": "high",
                "quantity_reference_value": 12,
                "quantity_scale_factor": "1.29",
                "quantity_ratio": "1.67",
                "quantity_reason": "Using 20 cabinets against a 12-cabinet kitchen baseline.",
            },
        )

        self.assertGreater(Decimal(large_plan["suggested_budget_high"]), Decimal(small_plan["suggested_budget_high"]))
        self.assertGreater(large_plan["suggested_duration_high_days"], small_plan["suggested_duration_high_days"])
        self.assertGreaterEqual(large_plan["suggested_milestone_count"], small_plan["suggested_milestone_count"])
        self.assertTrue(small_plan["source_metadata"]["quantity_adjustment"]["applied"])
        self.assertTrue(large_plan["source_metadata"]["quantity_adjustment"]["applied"])
        explanation_text = " ".join(large_plan["explanation_points"]).lower()
        self.assertIn("20 cabinets", explanation_text)
        self.assertIn("baseline", explanation_text)

    def test_project_quantity_missing_falls_back_safely(self):
        plan = build_project_plan_suggestion(
            project_title="Need help around the house",
            project_type="Custom",
            project_subtype="General",
            description="Need help with a small project and a few questions.",
            project_scope_summary="Small mixed repair tasks with no clear specialty trade.",
            clarification_answers={},
            photo_count=0,
            suggested_total_price=None,
            suggested_price_low=None,
            suggested_price_high=None,
            suggested_duration_days=None,
            suggested_duration_low=None,
            suggested_duration_high=None,
            confidence_level="low",
            confidence_reasoning="Limited details available.",
            learned_benchmark_used=False,
            seeded_benchmark_used=False,
            benchmark_source="none",
            benchmark_match_scope="none",
            region_state="",
            region_city="",
        )

        self.assertEqual(plan["source_metadata"]["quantity_adjustment"]["applied"], False)
        self.assertEqual(plan["source_metadata"]["quantity_context"]["quantity_type"], "")
        self.assertNotEqual(plan["suggested_budget_high"], "0.00")

    def test_project_intelligence_orchestrator_extracts_quantity_context_and_scales_plan(self):
        intelligence = build_project_intelligence(
            {
                "project_title": "Need kitchen cabinets installed",
                "project_type": "Kitchen Remodel",
                "project_subtype": "Primary Kitchen",
                "description": "Remove old cabinets, install new cabinets already on site, and include backsplash work.",
                "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
                "clarification_answers": {
                    "cabinet_count": "12",
                    "materials": "Already on site",
                },
                "photo_count": 1,
            }
        )

        quantity_context = intelligence["quantity_context"]
        self.assertEqual(quantity_context["quantity_type"], "count")
        self.assertEqual(quantity_context["quantity_unit"], "cabinets")
        self.assertEqual(quantity_context["quantity_label"], "12 cabinets")
        self.assertIn("12 cabinets", intelligence["analysis"]["project_scope_summary"])
        self.assertEqual(intelligence["recommended_setup"]["recommended_project_type"], "Kitchen Cabinet Installation")
        self.assertTrue(intelligence["suggested_plan"]["source_metadata"]["quantity_adjustment"]["applied"])
        self.assertGreater(Decimal(intelligence["suggested_plan"]["suggested_budget_high"]), Decimal("0.00"))

    def test_contractor_benchmark_blends_platform_and_history(self):
        context = {
            "project_family_key": "kitchen_remodel",
            "project_type": "Remodel",
            "project_subtype": "Kitchen Cabinet Installation",
            "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            "template_name": "Kitchen Remodel Template",
            "template_used": "Kitchen Remodel Template",
            "scope_mode": "install_removal",
            "region_state": "TX",
            "region_city": "Austin",
        }

        platform_only = get_blended_benchmark(context, self.contractor.id)
        self.assertEqual(platform_only["source_type"], "platform")
        self.assertEqual(platform_only["weights"]["contractor"], "0.00")
        self.assertEqual(platform_only["weights"]["regional"], "0.00")

        small_snapshot = self._seed_contractor_benchmark_snapshot(
            template_used="Kitchen Remodel Template Small",
            total_project_value=Decimal("6200.00"),
            actual_duration_days=5,
            milestone_count=4,
        )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])
        small_context = dict(context, template_name="Kitchen Remodel Template Small", template_used="Kitchen Remodel Template Small")
        small = get_blended_benchmark(small_context, self.contractor.id)
        self.assertEqual(small["contractor"]["sample_size"], 1)
        self.assertEqual(small["regional"]["sample_size"], 1)
        self.assertEqual(small["source_type"], "blended_all")
        self.assertGreater(Decimal(small["weights"]["contractor"]), Decimal("0.00"))
        self.assertLessEqual(Decimal(small["weights"]["contractor"]), Decimal("0.20"))
        self.assertEqual(
            ContractorBenchmarkAggregate.objects.get(
                contractor=self.contractor,
                project_family_key="kitchen_remodel",
                scope_mode="install_removal",
                template_used="Kitchen Remodel Template Small",
            ).sample_size,
            1,
        )

        for idx in range(7):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Strong",
                total_project_value=Decimal("6200.00") + Decimal(str(idx * 150)),
                actual_duration_days=5 + (idx % 2),
                milestone_count=4,
            )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])
        strong_context = dict(context, template_name="Kitchen Remodel Template Strong", template_used="Kitchen Remodel Template Strong")
        strong = get_blended_benchmark(strong_context, self.contractor.id)
        self.assertEqual(strong["contractor"]["sample_size"], 7)
        self.assertGreater(Decimal(strong["weights"]["contractor"]), Decimal(small["weights"]["contractor"]))
        self.assertGreater(Decimal(strong["weights"]["contractor"]), Decimal("0.40"))
        self.assertGreater(Decimal(strong["weights"]["regional"]), Decimal("0.00"))
        self.assertEqual(strong["source_type"], "blended_all")

        self.assertGreater(Decimal(strong["pricing_range"]["high"]), Decimal(strong["pricing_range"]["low"]))
        self.assertGreater(strong["duration_range"]["high"], strong["duration_range"]["low"])

        self.assertTrue(small_snapshot.id)

    def test_contractor_benchmark_high_dispute_history_reduces_weight(self):
        clean_context = {
            "project_family_key": "kitchen_remodel",
            "project_type": "Remodel",
            "project_subtype": "Kitchen Cabinet Installation",
            "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            "template_name": "Kitchen Remodel Template Clean",
            "template_used": "Kitchen Remodel Template Clean",
            "scope_mode": "install_removal",
            "region_state": "TX",
            "region_city": "Austin",
        }
        noisy_context = dict(clean_context, template_name="Kitchen Remodel Template Noisy", template_used="Kitchen Remodel Template Noisy")

        for idx in range(8):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Clean",
                total_project_value=Decimal("6400.00") + Decimal(str(idx * 100)),
                actual_duration_days=5,
                milestone_count=4,
                dispute_flag=False,
            )
        for idx in range(8):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Noisy",
                total_project_value=Decimal("6400.00") + Decimal(str(idx * 100)),
                actual_duration_days=5,
                milestone_count=4,
                dispute_flag=idx < 4,
                amendment_count=1 if idx < 4 else 0,
            )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])

        clean = get_blended_benchmark(clean_context, self.contractor.id)
        noisy = get_blended_benchmark(noisy_context, self.contractor.id)

        self.assertEqual(clean["contractor"]["sample_size"], 8)
        self.assertEqual(noisy["contractor"]["sample_size"], 8)
        self.assertEqual(clean["source_type"], "blended_all")
        self.assertEqual(noisy["source_type"], "blended_all")
        self.assertGreater(Decimal(clean["weights"]["contractor"]), Decimal(noisy["weights"]["contractor"]))
        self.assertLess(Decimal(noisy["weights"]["contractor"]), Decimal(clean["weights"]["contractor"]))
        self.assertLess(Decimal(noisy["weights"]["contractor"]), Decimal("0.40"))

    def test_regional_benchmark_aggregate_builds_from_outcome_snapshots(self):
        for idx in range(5):
            self._seed_regional_outcome_snapshot(
                region_state="TX",
                region_city="Austin",
                template_used="Kitchen Remodel Template Austin",
                total_project_value=Decimal("6400.00") + Decimal(str(idx * 120)),
                actual_duration_days=5 + (idx % 2),
                milestone_count=4,
            )
        created = rebuild_regional_benchmark_aggregates()

        self.assertGreater(created, 0)
        aggregate = RegionalBenchmarkAggregate.objects.get(
            region_key="US-TX-AUSTIN",
            project_family_key="kitchen_remodel",
            scope_mode="install_removal",
            template_used="Kitchen Remodel Template Austin",
        )
        self.assertEqual(aggregate.sample_size, 5)
        self.assertEqual(aggregate.region_label, "Austin, TX")
        self.assertEqual(aggregate.region_granularity, "city")
        self.assertGreater(Decimal(aggregate.p50_project_value), Decimal("0.00"))

    def test_blended_benchmark_uses_regional_data_when_contractor_history_missing(self):
        for idx in range(6):
            self._seed_regional_outcome_snapshot(
                region_state="TX",
                region_city="Austin",
                template_used="Kitchen Remodel Template Regional",
                total_project_value=Decimal("7000.00") + Decimal(str(idx * 80)),
                actual_duration_days=5 + (idx % 2),
                milestone_count=4,
            )
        rebuild_regional_benchmark_aggregates()

        context = {
            "project_family_key": "kitchen_remodel",
            "project_type": "Remodel",
            "project_subtype": "Kitchen Cabinet Installation",
            "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            "template_name": "Kitchen Remodel Template Regional",
            "template_used": "Kitchen Remodel Template Regional",
            "scope_mode": "install_removal",
            "region_state": "TX",
            "region_city": "Austin",
        }

        benchmark = get_blended_benchmark(context, self.other_contractor.id)
        self.assertEqual(benchmark["source_type"], "blended_platform_regional")
        self.assertEqual(benchmark["contractor"]["sample_size"], 0)
        self.assertGreater(Decimal(benchmark["weights"]["regional"]), Decimal("0.00"))
        self.assertEqual(benchmark["regional"]["sample_size"], 6)

    def test_high_dispute_regional_history_reduces_weight(self):
        for idx in range(6):
            self._seed_regional_outcome_snapshot(
                region_state="TX",
                region_city="Austin",
                template_used="Kitchen Remodel Template Clean Region",
                total_project_value=Decimal("6800.00") + Decimal(str(idx * 90)),
                actual_duration_days=5,
                milestone_count=4,
                dispute_flag=False,
            )
        for idx in range(6):
            self._seed_regional_outcome_snapshot(
                region_state="FL",
                region_city="Miami",
                template_used="Kitchen Remodel Template Noisy Region",
                total_project_value=Decimal("6800.00") + Decimal(str(idx * 90)),
                actual_duration_days=5,
                milestone_count=4,
                dispute_flag=idx < 4,
                amendment_count=1 if idx < 4 else 0,
            )
        rebuild_regional_benchmark_aggregates()

        clean_context = {
            "project_family_key": "kitchen_remodel",
            "project_type": "Remodel",
            "project_subtype": "Kitchen Cabinet Installation",
            "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            "template_name": "Kitchen Remodel Template Clean Region",
            "template_used": "Kitchen Remodel Template Clean Region",
            "scope_mode": "install_removal",
            "region_state": "TX",
            "region_city": "Austin",
        }
        noisy_context = dict(clean_context, template_name="Kitchen Remodel Template Noisy Region", template_used="Kitchen Remodel Template Noisy Region", region_state="FL", region_city="Miami")

        clean = get_blended_benchmark(clean_context, self.other_contractor.id)
        noisy = get_blended_benchmark(noisy_context, self.other_contractor.id)

        self.assertGreater(Decimal(clean["weights"]["regional"]), Decimal(noisy["weights"]["regional"]))
        self.assertLess(Decimal(noisy["weights"]["regional"]), Decimal("0.25"))

    def test_regional_blend_clamps_extreme_outliers(self):
        SeedBenchmarkProfile.objects.create(
            benchmark_key="remodel:kitchen_cabinet_installation:tx:austin",
            benchmark_match_key="remodel:kitchen_cabinet_installation",
            project_type="Remodel",
            project_subtype="Kitchen Cabinet Installation",
            region_state="TX",
            region_city="Austin",
            normalized_region_key="US-TX-AUSTIN",
            base_price_low=Decimal("12000.00"),
            base_price_high=Decimal("18000.00"),
            base_duration_days_low=5,
            base_duration_days_high=8,
            default_milestone_count=4,
        )
        platform = get_blended_benchmark(
            {
                "project_family_key": "kitchen_remodel",
                "project_type": "Remodel",
                "project_subtype": "Kitchen Cabinet Installation",
                "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
                "template_name": "Kitchen Remodel Template Clamp",
                "template_used": "Kitchen Remodel Template Clamp",
                "scope_mode": "install_removal",
                "region_state": "TX",
                "region_city": "Austin",
            },
            self.other_contractor.id,
        )

        for idx in range(6):
            self._seed_regional_outcome_snapshot(
                region_state="TX",
                region_city="Austin",
                template_used="Kitchen Remodel Template Clamp",
                total_project_value=Decimal("100000.00") + Decimal(str(idx * 5000)),
                actual_duration_days=12 + idx,
                milestone_count=6,
            )
        rebuild_regional_benchmark_aggregates()

        clamped = get_blended_benchmark(
            {
                "project_family_key": "kitchen_remodel",
                "project_type": "Remodel",
                "project_subtype": "Kitchen Cabinet Installation",
                "project_scope_summary": "Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
                "template_name": "Kitchen Remodel Template Clamp",
                "template_used": "Kitchen Remodel Template Clamp",
                "scope_mode": "install_removal",
                "region_state": "TX",
                "region_city": "Austin",
            },
            self.other_contractor.id,
        )

        self.assertEqual(clamped["source_type"], "blended_platform_regional")
        self.assertLessEqual(Decimal(clamped["pricing_range"]["high"]), Decimal(platform["pricing_range"]["high"]) * Decimal("1.75"))
        self.assertGreaterEqual(Decimal(clamped["pricing_range"]["low"]), Decimal(platform["pricing_range"]["low"]) * Decimal("0.60"))

    def test_contractor_insights_compare_against_platform_and_market(self):
        for idx in range(4):
            self._seed_contractor_benchmark_snapshot(
                template_used="Kitchen Remodel Template Insight",
                total_project_value=Decimal("22000.00") + Decimal(str(idx * 450)),
                actual_duration_days=16 + (idx % 2),
                milestone_count=7,
                dispute_flag=False,
                amendment_count=0,
            )
        for idx in range(6):
            self._seed_regional_outcome_snapshot(
                region_state="TX",
                region_city="Austin",
                template_used="Kitchen Remodel Template Insight",
                total_project_value=Decimal("14500.00") + Decimal(str(idx * 150)),
                actual_duration_days=10 + (idx % 2),
                milestone_count=5,
            )
        rebuild_contractor_benchmark_aggregates(contractor_ids=[self.contractor.id])
        rebuild_regional_benchmark_aggregates()

        insights = build_contractor_insights(
            contractor_id=self.contractor.id,
            project_family_key="kitchen_remodel",
            project_context={
                "project_type": "Remodel",
                "project_subtype": "Kitchen Remodel",
                "project_scope_summary": "Kitchen cabinet installation request with removal and backsplash work.",
                "region_state": "TX",
                "region_city": "Austin",
            },
        )

        self.assertEqual(insights["source_type"], "blended_all")
        self.assertEqual(insights["sample_sizes"]["contractor"], 4)
        self.assertGreater(insights["sample_sizes"]["regional"], 0)
        self.assertIn(insights["pricing_delta_vs_platform"]["direction"], {"above", "below", "similar"})
        self.assertIn("platform average", insights["pricing_delta_vs_platform"]["explanation"])
        self.assertTrue(insights["explanation_strings"])
        self.assertIsInstance(insights["suggested_adjustments"], list)
        self.assertIn(insights["confidence"], {"low", "medium", "high"})

    def test_contractor_insights_fall_back_to_platform_without_history(self):
        insights = build_contractor_insights(
            contractor_id=self.other_contractor.id,
            project_family_key="kitchen_remodel",
            project_context={
                "project_type": "Remodel",
                "project_subtype": "Kitchen Remodel",
                "project_scope_summary": "Kitchen cabinet installation request with removal and backsplash work.",
                "region_state": "TX",
                "region_city": "Austin",
            },
        )

        self.assertEqual(insights["source_type"], "platform")
        self.assertEqual(insights["confidence"], "low")
        self.assertEqual(insights["pricing_delta_vs_platform"]["direction"], "similar")
        self.assertGreaterEqual(len(insights["explanation_strings"]), 1)
        self.assertEqual(insights["suggested_adjustments"], [])

    def test_contractor_insights_suggest_adjustments_from_signals(self):
        with patch("projects.services.contractor_insights.get_blended_benchmark") as mock_blended, patch(
            "projects.services.contractor_insights.resolve_regional_benchmark"
        ) as mock_regional:
            mock_blended.side_effect = [
                {
                    "platform": {"sample_size": 80},
                    "pricing_range": {"low": "1000.00", "high": "1200.00"},
                    "duration_range": {"low": "4", "high": "5"},
                    "milestone_count": 4,
                },
                {
                    "contractor": {"sample_size": 9, "dispute_rate": "0.12", "amendment_rate": "0.18"},
                    "pricing_range": {"low": "1350.00", "high": "1450.00"},
                    "duration_range": {"low": "7", "high": "8"},
                    "milestone_count": 2,
                },
            ]
            mock_regional.return_value = {
                "region_key": "US-TX-AUSTIN",
                "region_label": "Austin, TX",
                "region_granularity": "city",
                "sample_size": 12,
                "learned_price": "1185.00",
                "learned_duration_days": 5,
                "learned_milestone_count": "4.00",
                "confidence": "medium",
                "reasoning": "Regional history from Austin, TX contributes 12 completed projects for this project family.",
                "dispute_rate": "0.08",
                "amendment_rate": "0.06",
            }

            insights = build_contractor_insights(
                contractor_id=self.contractor.id,
                project_family_key="kitchen_remodel",
                project_context={
                    "project_type": "Remodel",
                    "project_subtype": "Kitchen Remodel",
                    "project_scope_summary": "Kitchen cabinet installation request with removal and backsplash work.",
                    "region_state": "TX",
                    "region_city": "Austin",
                },
            )

        suggestion_types = {item["suggestion_type"] for item in insights["suggested_adjustments"]}
        self.assertIn("pricing", suggestion_types)
        self.assertIn("duration", suggestion_types)
        self.assertIn("structure", suggestion_types)
        self.assertEqual(len(insights["suggested_adjustments"]), 3)

    def test_contractor_insights_surface_scope_clarity_adjustment_from_quality_signals(self):
        with patch("projects.services.contractor_insights.get_blended_benchmark") as mock_blended, patch(
            "projects.services.contractor_insights.resolve_regional_benchmark"
        ) as mock_regional:
            mock_blended.side_effect = [
                {
                    "platform": {"sample_size": 80},
                    "pricing_range": {"low": "1000.00", "high": "1200.00"},
                    "duration_range": {"low": "4", "high": "5"},
                    "milestone_count": 4,
                },
                {
                    "contractor": {"sample_size": 9, "dispute_rate": "0.30", "amendment_rate": "0.25"},
                    "pricing_range": {"low": "1000.00", "high": "1200.00"},
                    "duration_range": {"low": "4", "high": "5"},
                    "milestone_count": 4,
                },
            ]
            mock_regional.return_value = {
                "region_key": "US-TX-AUSTIN",
                "region_label": "Austin, TX",
                "region_granularity": "city",
                "sample_size": 12,
                "learned_price": "1185.00",
                "learned_duration_days": 5,
                "learned_milestone_count": "4.00",
                "confidence": "medium",
                "reasoning": "Regional history from Austin, TX contributes 12 completed projects for this project family.",
                "dispute_rate": "0.20",
                "amendment_rate": "0.10",
            }

            insights = build_contractor_insights(
                contractor_id=self.contractor.id,
                project_family_key="kitchen_remodel",
                project_context={
                    "project_type": "Remodel",
                    "project_subtype": "Kitchen Remodel",
                    "project_scope_summary": "Kitchen cabinet installation request with removal and backsplash work.",
                    "region_state": "TX",
                    "region_city": "Austin",
                },
            )

        self.assertEqual(len(insights["suggested_adjustments"]), 1)
        self.assertEqual(insights["suggested_adjustments"][0]["suggestion_type"], "scope_clarity")

    def test_estimate_preview_includes_contractor_insights(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.COMPLETED)

        result = build_project_estimate(agreement=agreement)

        self.assertIn("contractor_insights", result)
        self.assertIn("pricing_delta_vs_platform", result["contractor_insights"])
        self.assertIn("duration_delta_vs_platform", result["contractor_insights"])
        self.assertIn("explanation_strings", result["contractor_insights"])
        self.assertIn("suggested_adjustments", result["contractor_insights"])

    def test_project_intelligence_orchestrator_matches_intake_and_agreement_paths(self):
        profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Unified Build Co",
            city="Austin",
            state="TX",
            phone_public="512-555-0100",
            email_public="unified@example.com",
        )
        intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            public_profile=profile,
            initiated_by="homeowner",
            status="submitted",
            customer_name="Unified Prospect",
            project_city="Austin",
            project_state="TX",
            accomplishment_text="Need kitchen cabinets installed.",
            ai_project_title="Kitchen cabinet install",
            ai_project_type="Installation",
            ai_project_subtype="Kitchen Cabinet Installation",
            ai_description="Kitchen cabinet installation request involving removal of existing cabinets and backsplash work.",
            ai_project_timeline_days=5,
            ai_project_budget=Decimal("6250.00"),
            ai_clarification_answers={
                "scope_kind": "New cabinets only",
                "demo_removal": "Remove old cabinets too",
                "materials_ready": "Already on site",
                "related_work": "Yes, backsplash also included",
            },
            measurement_handling="site_visit_required",
            ai_milestones=[
                {"order": 1, "title": "Demo and Prep", "description": "Protect work area and demo existing finishes."},
                {"order": 2, "title": "Install and Finish", "description": "Install cabinets, finishes, and fixtures."},
            ],
        )

        intake_bundle = build_project_intelligence({"intake": intake})
        agreement = convert_intake_to_agreement(intake=intake)
        agreement_bundle = build_project_intelligence({"agreement": agreement})

        self.assertEqual(intake_bundle["analysis"]["project_family_key"], agreement_bundle["analysis"]["project_family_key"])
        self.assertEqual(intake_bundle["analysis"]["project_scope_summary"], agreement_bundle["analysis"]["project_scope_summary"])
        self.assertEqual(intake_bundle["recommended_setup"], agreement_bundle["recommended_setup"])
        self.assertEqual(intake_bundle["suggested_plan"]["project_family_key"], agreement_bundle["suggested_plan"]["project_family_key"])
        self.assertEqual(intake_bundle["suggested_plan"]["project_scope_summary"], agreement_bundle["suggested_plan"]["project_scope_summary"])
        self.assertEqual(intake_bundle["suggested_plan"]["recommended_project_type"], agreement_bundle["suggested_plan"]["recommended_project_type"])
        self.assertEqual(intake_bundle["suggested_plan"]["suggested_workflow"], agreement_bundle["suggested_plan"]["suggested_workflow"])
        self.assertEqual(intake_bundle["normalized_input"]["region_context"], agreement_bundle["normalized_input"]["region_context"])

    def test_project_intelligence_orchestrator_uses_template_context(self):
        template = ProjectTemplate.objects.create(
            name="Kitchen Cabinet Install Template",
            project_type="Kitchen Remodel",
            project_subtype="Kitchen Cabinet Installation",
            description="Remove existing cabinets and install new cabinets already on site.",
            is_system=True,
            is_active=True,
            visibility=ProjectTemplate.Visibility.SYSTEM,
            allow_discovery=True,
        )

        bundle = build_project_intelligence(
            {
                "template": template,
                "project_title": template.name,
                "project_type": template.project_type,
                "project_subtype": template.project_subtype,
                "description": template.description,
                "template_id": template.id,
                "template_name": template.name,
            }
        )

        self.assertEqual(bundle["normalized_input"]["template_id"], template.id)
        self.assertEqual(bundle["analysis"]["project_family_key"], "kitchen_remodel")
        self.assertEqual(bundle["classification"]["family_key"], "kitchen_remodel")
        self.assertEqual(bundle["analysis"]["project_type"], "Installation")
        self.assertEqual(bundle["suggested_plan"]["project_family_key"], "kitchen_remodel")

    def test_brand_voice_personalizes_proposal_draft_without_breaking_fallback(self):
        ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Bright Build Co",
            tagline="Trusted renovations and repairs",
            bio="We keep projects clear and practical.",
            proposal_tone="friendly",
            preferred_signoff="Warmly, Bright Build Co",
            brand_primary_color="#1d4ed8",
        )

        branded_draft = build_proposal_draft(
            contractor=self.contractor,
            project_title="Custom Project",
            project_type="Custom",
            project_subtype="Custom Scope",
            description="Install trim and update the entry hallway.",
        )

        self.assertTrue(branded_draft["summary"]["brandVoiceApplied"])
        self.assertIn("Bright Build Co", branded_draft["text"])
        self.assertIn("friendly style", branded_draft["text"])
        self.assertIn("Warmly, Bright Build Co", branded_draft["text"])

        fallback_draft = build_proposal_draft(
            project_title="Basic Project",
            project_type="Custom",
            project_subtype="General",
            description="Simple scope with no profile preferences.",
        )
        self.assertFalse(fallback_draft["summary"]["brandVoiceApplied"])
        self.assertNotIn("Warmly, Bright Build Co", fallback_draft["text"])

    def test_project_type_shaping_coexists_with_learning_and_brand_voice(self):
        first = self._create_completed_agreement(status=ProjectStatus.COMPLETED)
        second = self._create_completed_agreement(
            status=ProjectStatus.COMPLETED,
            total_cost=Decimal("14000.00"),
            estimated_amounts=[Decimal("3500.00"), Decimal("7000.00")],
        )

        capture_agreement_outcome_snapshot(first)
        capture_agreement_outcome_snapshot(second)
        capture_agreement_proposal_snapshot(first, stage=AgreementProposalSnapshot.Stage.FINALIZED)
        capture_agreement_proposal_snapshot(second, stage=AgreementProposalSnapshot.Stage.FINALIZED)

        ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Bright Build Co",
            tagline="Trusted renovations and repairs",
            bio="We keep projects clear and practical.",
            proposal_tone="friendly",
            preferred_signoff="Warmly, Bright Build Co",
            brand_primary_color="#1d4ed8",
        )

        draft = build_proposal_draft(
            contractor=self.contractor,
            project_title="Kitchen Remodel",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Replace the cabinets, countertops, and backsplash.",
            budget_text="$12,000 - $14,000",
            timeline_text="About 3 weeks",
            measurement_handling="site_visit_required",
            photo_count=2,
            request_path_label="Multi-Quote Request",
            request_signals=["Guided Intake", "Photos", "Budget Provided"],
            clarification_summary=[
                {"key": "measurements", "label": "Measurements", "value": "Site visit required"}
            ],
        )

        self.assertTrue(draft["learning"]["based_on_successful_projects"])
        self.assertTrue(draft["summary"]["brandVoiceApplied"])
        self.assertEqual(draft["summary"]["projectFamilyKey"], "kitchen_remodel")
        self.assertIn("Kitchen remodels benefit from", draft["text"])
        self.assertIn("similar successful projects", draft["text"])
        self.assertIn("Warmly, Bright Build Co", draft["text"])

    def test_non_completed_or_cancelled_agreements_are_excluded_from_benchmarks(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.CANCELLED)

        snapshot = capture_agreement_outcome_snapshot(agreement)

        self.assertTrue(snapshot.excluded_from_benchmarks)
        self.assertIn("cancelled", snapshot.exclusion_reason.lower())
        rebuild_project_benchmarks()
        self.assertEqual(ProjectBenchmarkAggregate.objects.count(), 0)

    def test_snapshot_marks_change_orders_and_disputes(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.COMPLETED)
        agreement.amendment_number = 1
        agreement.save(update_fields=["amendment_number"])
        Dispute.objects.create(
            agreement=agreement,
            milestone=agreement.milestones.first(),
            initiator="homeowner",
            reason="Finish concern",
            status="open",
        )

        snapshot = capture_agreement_outcome_snapshot(agreement)

        self.assertTrue(snapshot.has_change_orders)
        self.assertEqual(snapshot.change_order_count, 1)
        self.assertTrue(snapshot.has_disputes)
        self.assertEqual(snapshot.dispute_count, 1)

    def test_aggregate_rebuild_produces_expected_metrics(self):
        agreement_one = self._create_completed_agreement(
            total_cost=Decimal("10000.00"),
            estimated_amounts=[Decimal("2500.00"), Decimal("6500.00")],
            status=ProjectStatus.COMPLETED,
            start_date=timezone.localdate() - timedelta(days=18),
        )
        agreement_two = self._create_completed_agreement(
            total_cost=Decimal("14000.00"),
            estimated_amounts=[Decimal("3000.00"), Decimal("7000.00")],
            actual_total=Decimal("10000.00"),
            status=ProjectStatus.COMPLETED,
            start_date=timezone.localdate() - timedelta(days=25),
        )

        capture_agreement_outcome_snapshot(agreement_one)
        capture_agreement_outcome_snapshot(agreement_two)

        rebuild_project_benchmarks()

        aggregate = ProjectBenchmarkAggregate.objects.get(
            scope=ProjectBenchmarkAggregate.Scope.GLOBAL,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            normalized_region_key="",
        )
        self.assertEqual(aggregate.completed_project_count, 2)
        self.assertEqual(aggregate.average_final_total, Decimal("12000.00"))
        self.assertEqual(aggregate.median_final_total, Decimal("12000.00"))
        self.assertEqual(aggregate.min_final_total, Decimal("10000.00"))
        self.assertEqual(aggregate.max_final_total, Decimal("14000.00"))
        self.assertEqual(aggregate.average_milestone_count, Decimal("2.00"))
        self.assertEqual(aggregate.estimate_variance_sample_size, 2)

    def test_template_linked_aggregates_are_created(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.COMPLETED)
        capture_agreement_outcome_snapshot(agreement)
        rebuild_project_benchmarks()

        template_aggregate = ProjectBenchmarkAggregate.objects.get(
            scope=ProjectBenchmarkAggregate.Scope.TEMPLATE,
            template=self.template,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
        )
        self.assertEqual(template_aggregate.completed_project_count, 1)
        self.assertEqual(template_aggregate.average_final_total, Decimal("12000.00"))
        self.assertEqual(template_aggregate.metadata["has_template_specificity"], True)

    def test_milestone_snapshot_normalization_persists_child_rows(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.COMPLETED)

        snapshot = capture_agreement_outcome_snapshot(agreement)

        child_rows = list(
            AgreementOutcomeMilestoneSnapshot.objects.filter(snapshot=snapshot).order_by("sort_order")
        )
        self.assertEqual(len(child_rows), 2)
        self.assertEqual(child_rows[0].normalized_milestone_type, "demolition")
        self.assertEqual(child_rows[1].normalized_milestone_type, "cabinet_installation")
        self.assertEqual(child_rows[0].paid_amount, Decimal("4000.00"))
        self.assertEqual(child_rows[1].paid_amount, Decimal("8000.00"))
        self.assertEqual(child_rows[0].amount_delta_from_estimate, Decimal("1000.00"))
        self.assertEqual(child_rows[1].amount_delta_from_estimate, Decimal("2000.00"))
        self.assertEqual(snapshot.milestone_summary["pattern_key"], "demolition > cabinet_installation")

    def test_clarification_specific_and_milestone_aggregates_are_created(self):
        agreement = self._create_completed_agreement(status=ProjectStatus.COMPLETED)
        snapshot = capture_agreement_outcome_snapshot(agreement)

        rebuild_project_benchmarks()
        rebuild_milestone_benchmarks()

        clarification_aggregate = ProjectBenchmarkAggregate.objects.get(
            scope=ProjectBenchmarkAggregate.Scope.TEMPLATE,
            template=self.template,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            clarification_signature=snapshot.clarification_signature,
        )
        self.assertEqual(clarification_aggregate.completed_project_count, 1)
        self.assertEqual(clarification_aggregate.clarification_traits["cabinet_supplier"], "owner_supplied")
        self.assertEqual(clarification_aggregate.average_final_paid_amount, Decimal("12000.00"))

        milestone_aggregate = MilestoneBenchmarkAggregate.objects.get(
            scope=MilestoneBenchmarkAggregate.Scope.TEMPLATE,
            template=self.template,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            normalized_milestone_type="demolition",
            clarification_signature=snapshot.clarification_signature,
        )
        self.assertEqual(milestone_aggregate.completed_milestone_count, 1)
        self.assertEqual(milestone_aggregate.paid_milestone_count, 1)
        self.assertEqual(milestone_aggregate.average_final_amount, Decimal("4000.00"))
        self.assertEqual(milestone_aggregate.average_paid_amount, Decimal("4000.00"))


class SeededBenchmarkFoundationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="seeded-template-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Seeded Template Contractor",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Jordan Homeowner",
            email="jordan@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Seeded Template Project",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78701",
        )
        call_command("seed_project_templates")

    def test_normalized_region_key_generation(self):
        self.assertEqual(build_normalized_region_key(country="US"), "US")
        self.assertEqual(build_normalized_region_key(country="us", state="tx"), "US-TX")
        self.assertEqual(
            build_normalized_region_key(country="us", state="tx", city="San Antonio"),
            "US-TX-SAN_ANTONIO",
        )

    def test_city_state_country_normalization_consistency(self):
        self.assertEqual(
            build_normalized_region_key(country="u.s.", state=" Tx ", city="San-Antonio"),
            "US-TX-SAN_ANTONIO",
        )
        self.assertEqual(
            build_normalized_region_key(country="US", state="tx", city="san antonio"),
            "US-TX-SAN_ANTONIO",
        )

    def test_normalized_region_key_persists_on_seeded_profiles(self):
        national = SeedBenchmarkProfile.objects.get(benchmark_key="remodel:kitchen_remodel")
        texas = SeedBenchmarkProfile.objects.get(benchmark_key="remodel:kitchen_remodel:tx")
        san_antonio = SeedBenchmarkProfile.objects.get(benchmark_key="remodel:kitchen_remodel:tx:san_antonio")

        self.assertEqual(national.normalized_region_key, "US")
        self.assertEqual(texas.normalized_region_key, "US-TX")
        self.assertEqual(san_antonio.normalized_region_key, "US-TX-SAN_ANTONIO")

    def test_exact_city_level_benchmark_resolution(self):
        result = resolve_seed_benchmark_defaults(
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            region_state="TX",
            region_city="San Antonio",
        )

        self.assertEqual(result["benchmark_source"], "seeded_benchmark_profile")
        self.assertEqual(result["match_scope"], "exact_subtype_city")
        self.assertEqual(result["region_scope_used"], "city")
        self.assertEqual(result["normalized_region_key"], "US-TX-SAN_ANTONIO")
        self.assertEqual(result["region_priority_weight"], "1.20")
        self.assertEqual(result["price_range"]["low"], "20500.00")
        self.assertTrue(result["milestone_defaults"])
        self.assertTrue(result["clarification_defaults"])

    def test_state_level_fallback_when_city_override_is_missing(self):
        result = resolve_seed_benchmark_defaults(
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            region_state="TX",
            region_city="Dallas",
        )

        self.assertEqual(result["benchmark_source"], "seeded_benchmark_profile")
        self.assertEqual(result["match_scope"], "exact_subtype_state")
        self.assertEqual(result["region_scope_used"], "state")
        self.assertEqual(result["normalized_region_key"], "US-TX")
        self.assertIn("state-level", result["fallback_reason"].lower())

    def test_subtype_to_type_fallback_within_same_geographic_chain(self):
        result = resolve_seed_benchmark_defaults(
            project_type="Remodel",
            project_subtype="Laundry Remodel",
            region_state="TX",
        )

        self.assertEqual(result["benchmark_source"], "seeded_benchmark_profile")
        self.assertEqual(result["match_scope"], "type_only_state")
        self.assertEqual(result["region_scope_used"], "state")
        self.assertEqual(result["normalized_region_key"], "US-TX")
        self.assertIn("fallback", result["fallback_reason"].lower())

    def test_national_fallback_when_no_local_match_exists(self):
        result = resolve_seed_benchmark_defaults(
            project_type="Plumbing",
            project_subtype="Plumbing Repair",
            region_state="FL",
            region_city="Miami",
        )

        self.assertEqual(result["benchmark_source"], "seeded_benchmark_profile")
        self.assertEqual(result["match_scope"], "exact_subtype_national")
        self.assertEqual(result["region_scope_used"], "national")
        self.assertEqual(result["normalized_region_key"], "US")
        self.assertIn("national", result["fallback_reason"].lower())

    def test_starter_library_templates_seed_with_expected_names_and_milestone_counts(self):
        expected_templates = {
            "Bathroom Remodel",
            "Kitchen Remodel",
            "Cabinet Installation",
            "Countertop Installation",
            "Appliance Installation",
            "Flooring Installation",
            "Interior Painting",
            "Roof Replacement",
            "Fence Installation",
            "Deck Build",
            "Plumbing Repair",
            "Electrical Work",
        }

        system_templates = {
            row.name: row
            for row in ProjectTemplate.objects.filter(
                is_system_template=True,
                is_published=True,
                name__in=expected_templates,
            ).prefetch_related("milestones")
        }

        self.assertEqual(set(system_templates.keys()), expected_templates)
        for name, template in system_templates.items():
            self.assertIn(template.project_subtype, expected_templates)
            self.assertGreaterEqual(template.milestones.count(), 4, msg=name)
            self.assertLessEqual(template.milestones.count(), 7, msg=name)

    def test_structured_resolver_output_includes_region_and_fallback_metadata(self):
        result = resolve_seed_benchmark_defaults(
            project_type="Roofing",
            project_subtype="Roof Replacement",
            region_state="CO",
            region_city="Denver",
        )

        self.assertIn("region_scope_used", result)
        self.assertIn("normalized_region_key", result)
        self.assertIn("region_priority_weight", result)
        self.assertIn("region_key_used", result)
        self.assertIn("fallback_reason", result)
        self.assertEqual(result["match_scope"], "exact_subtype_state")
        self.assertEqual(result["region_scope_used"], "state")
        self.assertEqual(result["normalized_region_key"], "US-CO")
        self.assertEqual(result["source_metadata"]["location_multiplier"], "1.1200")

    def test_system_template_regional_linkage_remains_intact(self):
        template = ProjectTemplate.objects.get(
            is_system_template=True,
            is_published=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )

        self.assertIsNotNone(template.benchmark_profile_id)
        self.assertEqual(template.project_type, "Remodel")
        self.assertEqual(template.project_subtype, "Kitchen Remodel")
        self.assertTrue(template.default_clarifications)
        self.assertTrue(template.milestones.exists())
        self.assertIn("TX", template.region_tags)

        result = resolve_seed_benchmark_defaults(
            selected_template_id=template.id,
            region_state="TX",
            region_city="San Antonio",
        )
        self.assertEqual(result["template_id"], template.id)
        self.assertEqual(result["benchmark_profile_id"], template.benchmark_profile_id)
        self.assertTrue(result["source_metadata"]["template_linked"])

    def test_seed_command_is_idempotent_with_regional_profiles(self):
        first_template_count = ProjectTemplate.objects.filter(is_system_template=True, is_published=True).count()
        first_profile_count = SeedBenchmarkProfile.objects.count()

        call_command("seed_project_templates")

        self.assertEqual(
            ProjectTemplate.objects.filter(is_system_template=True, is_published=True).count(),
            first_template_count,
        )
        self.assertEqual(SeedBenchmarkProfile.objects.count(), first_profile_count)
        self.assertEqual(
            SeedBenchmarkProfile.objects.get(benchmark_key="remodel:kitchen_remodel:tx").normalized_region_key,
            "US-TX",
        )

    def test_contractor_custom_template_behavior_remains_intact(self):
        system_template = ProjectTemplate.objects.get(
            is_system_template=True,
            is_published=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )
        agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template=system_template,
            selected_template_name_snapshot=system_template.name,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            total_cost=Decimal("15000.00"),
            description="Kitchen refresh from system starter.",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Demo",
            description="Demo scope",
            amount=Decimal("5000.00"),
        )

        custom_template = save_agreement_as_template(
            agreement=agreement,
            contractor=self.contractor,
            name="My Custom Kitchen Starter",
        )

        self.assertFalse(custom_template.is_system)
        self.assertEqual(custom_template.source_system_template_id, system_template.id)
        self.assertEqual(custom_template.benchmark_profile_id, system_template.benchmark_profile_id)
        self.assertEqual(custom_template.contractor_id, self.contractor.id)

    def test_save_agreement_as_template_preserves_structure_and_clears_pricing(self):
        agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            project_type="Outdoor",
            project_subtype="Shed Build",
            total_cost=Decimal("5000.00"),
            description="10x12 shed build with 8 ft walls and site cleanup.",
            start=timezone.localdate(),
            end=timezone.localdate() + timedelta(days=5),
        )
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Prep & materials",
            description="Stage materials and prepare the site.",
            amount=Decimal("1200.00"),
            start_date=timezone.localdate(),
            completion_date=timezone.localdate() + timedelta(days=1),
        )
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Primary installation",
            description="Build the main shed structure.",
            amount=Decimal("2800.00"),
            start_date=timezone.localdate() + timedelta(days=2),
            completion_date=timezone.localdate() + timedelta(days=4),
        )
        Milestone.objects.create(
            agreement=agreement,
            order=3,
            title="Cleanup & walkthrough",
            description="Finish cleanup and final walkthrough.",
            amount=Decimal("1000.00"),
            start_date=timezone.localdate() + timedelta(days=5),
            completion_date=timezone.localdate() + timedelta(days=5),
        )

        template = save_agreement_as_template(
            agreement=agreement,
            contractor=self.contractor,
            name="Shed Build Template",
            scope_description="10x12 shed build with 8 ft walls and final cleanup.",
        )

        rows = list(template.milestones.order_by("sort_order", "id"))

        self.assertEqual(template.default_scope, "standard size shed build with standard size walls and final cleanup.")
        self.assertEqual([row.start_offset for row in rows], [0, 2, 5])
        self.assertEqual([row.duration_days for row in rows], [2, 3, 1])
        self.assertTrue(all(row.suggested_amount_fixed is None for row in rows))
        self.assertFalse(any(row.pricing_advisory for row in rows))
        self.assertEqual([row.recommended_days_from_start for row in rows], [1, 3, 6])
        self.assertEqual([row.recommended_duration_days for row in rows], [2, 3, 1])

    def test_runtime_resolution_returns_estimation_ready_shape(self):
        result = resolve_seed_benchmark_defaults(
            project_type="Painting",
            project_subtype="Interior Painting",
            region_state="CA",
            region_city="San Diego",
        )

        self.assertIn("benchmark_profile_id", result)
        self.assertIn("benchmark_source", result)
        self.assertIn("match_scope", result)
        self.assertIn("region_scope_used", result)
        self.assertIn("normalized_region_key", result)
        self.assertIn("region_priority_weight", result)
        self.assertIn("price_range", result)
        self.assertIn("duration_range", result)
        self.assertIn("milestone_defaults", result)
        self.assertIn("clarification_defaults", result)
        self.assertIn("multipliers_available", result)
        self.assertIn("region_key_used", result)


class ProjectTemplateAdminTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_superuser(
            email="project-template-admin@example.com",
            password="testpass123",
        )
        self.factory = RequestFactory()
        self.admin = ProjectTemplateAdmin(ProjectTemplate, AdminSite())

    def _request(self):
        request = self.factory.post("/admin/projects/projecttemplate/")
        request.user = self.admin_user
        return request

    def test_admin_can_create_edit_publish_and_unpublish_system_template(self):
        template = ProjectTemplate(
            name="Admin Managed Starter",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Admin managed starter template.",
            contractor=None,
            is_system_template=True,
            is_published=True,
            visibility=ProjectTemplate.Visibility.PRIVATE,
            allow_discovery=False,
        )

        self.admin.save_model(self._request(), template, form=None, change=False)
        template.refresh_from_db()

        self.assertTrue(template.is_system_template)
        self.assertTrue(template.is_published)
        self.assertIsNone(template.contractor_id)
        self.assertEqual(template.visibility, ProjectTemplate.Visibility.SYSTEM)
        self.assertTrue(template.allow_discovery)
        self.assertEqual(template.published_by_id, self.admin_user.id)
        self.assertIsNotNone(template.published_at)

        template.description = "Updated admin-managed starter template."
        self.admin.save_model(self._request(), template, form=None, change=True)
        template.refresh_from_db()
        self.assertEqual(template.description, "Updated admin-managed starter template.")
        self.assertTrue(template.is_published)
        self.assertTrue(template.allow_discovery)

        template.is_published = False
        self.admin.save_model(self._request(), template, form=None, change=True)
        template.refresh_from_db()
        self.assertFalse(template.is_published)
        self.assertFalse(template.allow_discovery)
        self.assertIsNone(template.published_at)
        self.assertIsNone(template.published_by_id)


class ProjectEstimationEngineTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="estimate-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Estimator Contractor",
            city="San Antonio",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Estimator Homeowner",
            email="estimate-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Estimator Project",
            project_city="San Antonio",
            project_state="TX",
            project_zip_code="78205",
        )
        call_command("seed_project_templates")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _agreement(self, **overrides):
        system_template = ProjectTemplate.objects.get(
            is_system=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )
        agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template=system_template,
            selected_template_name_snapshot=system_template.name,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Kitchen remodel with updated finishes.",
            total_cost=Decimal("24000.00"),
            project_address_city="San Antonio",
            project_address_state="TX",
            project_postal_code="78205",
            **overrides,
        )
        AgreementAIScope.objects.create(
            agreement=agreement,
            answers={},
        )
        return agreement

    def test_seeded_only_estimate_generation(self):
        agreement = self._agreement()
        result = build_project_estimate(agreement=agreement)

        self.assertEqual(result["benchmark_source"], "seeded_only")
        self.assertTrue(result["seeded_benchmark_used"])
        self.assertFalse(result["learned_benchmark_used"])
        self.assertEqual(result["benchmark_match_scope"], "exact_subtype_city")
        self.assertEqual(result["source_metadata"]["learned_weight"], "0.00")
        self.assertEqual(result["source_metadata"]["template_weight"], "1.00")
        self.assertGreater(Decimal(result["suggested_total_price"]), Decimal("0.00"))
        self.assertTrue(result["milestone_suggestions"])

    def test_regional_seeded_estimate_resolution(self):
        agreement = self._agreement()
        result = build_project_estimate(agreement=agreement)

        self.assertEqual(result["source_metadata"]["seeded_normalized_region_key"], "US-TX-SAN_ANTONIO")
        self.assertEqual(result["source_metadata"]["seeded_region_scope"], "city")
        self.assertEqual(result["source_metadata"]["region_priority_weight"], "1.20")

    def test_learned_benchmark_blending_when_sample_size_is_strong(self):
        agreement = self._agreement()
        seeded_only = build_project_estimate(agreement=agreement)
        ProjectBenchmarkAggregate.objects.create(
            scope=ProjectBenchmarkAggregate.Scope.TEMPLATE,
            template=agreement.selected_template,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            country="US",
            state="TX",
            city="San Antonio",
            normalized_region_key="US-TX-SAN_ANTONIO",
            completed_project_count=12,
            average_final_total=Decimal("32000.00"),
            median_final_total=Decimal("31000.00"),
            min_final_total=Decimal("25000.00"),
            max_final_total=Decimal("42000.00"),
            average_actual_duration_days=Decimal("29.00"),
            median_actual_duration_days=Decimal("28.00"),
            average_milestone_count=Decimal("5.00"),
            amount_sample_size=12,
            duration_sample_size=12,
            amount_stddev=Decimal("2500.00"),
            duration_stddev=Decimal("3.00"),
            region_granularity="city",
        )

        result = build_project_estimate(agreement=agreement)

        self.assertEqual(result["benchmark_source"], "seeded_plus_learned")
        self.assertTrue(result["learned_benchmark_used"])
        self.assertEqual(result["source_metadata"]["learned_scope"], "template_exact_subtype")
        self.assertEqual(result["source_metadata"]["learned_weight"], "0.40")
        self.assertEqual(result["source_metadata"]["template_weight"], "0.60")
        self.assertGreater(Decimal(result["suggested_total_price"]), Decimal(seeded_only["suggested_total_price"]))

    def test_clarification_specific_benchmark_is_preferred_when_available(self):
        agreement = self._agreement()
        agreement.ai_scope.answers = {
            "square_footage": "320",
            "finish_level": "premium",
        }
        agreement.ai_scope.save(update_fields=["answers"])
        clarification_signature = _clarification_signature_from_answers(agreement.ai_scope.answers)

        ProjectBenchmarkAggregate.objects.create(
            scope=ProjectBenchmarkAggregate.Scope.REGIONAL,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            country="US",
            state="TX",
            city="San Antonio",
            normalized_region_key="US-TX-SAN_ANTONIO",
            completed_project_count=7,
            average_final_total=Decimal("26000.00"),
            median_final_total=Decimal("26000.00"),
            min_final_total=Decimal("22000.00"),
            max_final_total=Decimal("30000.00"),
            average_actual_duration_days=Decimal("20.00"),
            median_actual_duration_days=Decimal("20.00"),
            average_milestone_count=Decimal("4.00"),
            clarification_signature="",
            region_granularity="city",
        )
        ProjectBenchmarkAggregate.objects.create(
            scope=ProjectBenchmarkAggregate.Scope.REGIONAL,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            country="US",
            state="TX",
            city="San Antonio",
            normalized_region_key="US-TX-SAN_ANTONIO",
            completed_project_count=4,
            average_final_total=Decimal("34000.00"),
            median_final_total=Decimal("34000.00"),
            min_final_total=Decimal("31000.00"),
            max_final_total=Decimal("37000.00"),
            average_actual_duration_days=Decimal("30.00"),
            median_actual_duration_days=Decimal("30.00"),
            average_milestone_count=Decimal("5.00"),
            clarification_signature=clarification_signature,
            region_granularity="city",
        )

        result = build_project_estimate(agreement=agreement)

        self.assertEqual(result["benchmark_source"], "seeded_plus_learned")
        self.assertEqual(result["source_metadata"]["learned_scope"], "regional_exact_subtype_clarification")
        self.assertEqual(result["source_metadata"]["learned_clarification_signature"], clarification_signature)
        self.assertGreater(Decimal(result["suggested_total_price"]), Decimal("26000.00"))

    def test_clarification_driven_price_and_timeline_adjustments(self):
        agreement = self._agreement()
        agreement.ai_scope.answers = {
            "square_footage": "320",
            "finish_level": "premium",
            "demolition_required": "yes",
            "urgency": "urgent",
        }
        agreement.ai_scope.save(update_fields=["answers"])

        result = build_project_estimate(agreement=agreement)

        adjustment_labels = {row["label"] for row in result["price_adjustments"]}
        timeline_labels = {row["label"] for row in result["timeline_adjustments"]}
        self.assertIn("Finish level", adjustment_labels)
        self.assertIn("Project size", adjustment_labels)
        self.assertIn("Demolition", adjustment_labels)
        self.assertIn("Compressed schedule", adjustment_labels)
        self.assertIn("Project size", timeline_labels)
        self.assertIn("Demolition", timeline_labels)
        self.assertIn("Compressed schedule", timeline_labels)

    def test_estimate_preview_includes_contractor_insights_for_current_agreement(self):
        agreement = self._agreement()

        result = build_project_estimate(agreement=agreement)

        self.assertIn("contractor_insights", result)
        self.assertIn("pricing_delta_vs_platform", result["contractor_insights"])
        self.assertIn("duration_delta_vs_platform", result["contractor_insights"])
        self.assertIn("explanation_strings", result["contractor_insights"])
        self.assertIn("suggested_adjustments", result["contractor_insights"])

    def test_milestone_suggestion_output_shape(self):
        agreement = self._agreement()
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Demo & Prep",
            description="Prep area",
            amount=Decimal("4000.00"),
            normalized_milestone_type="demolition",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Install",
            description="Install scope",
            amount=Decimal("10000.00"),
            normalized_milestone_type="installation",
        )

        result = build_project_estimate(agreement=agreement)
        first = result["milestone_suggestions"][0]

        self.assertIn("title", first)
        self.assertIn("suggested_amount", first)
        self.assertIn("suggested_duration_days", first)
        self.assertIn("suggested_order", first)
        self.assertIn("source", first)


class TemplateMarketplaceDiscoveryTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="template-market-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Marketplace Contractor",
            city="San Antonio",
            state="TX",
        )
        self.other_user = user_model.objects.create_user(
            email="template-market-other@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Regional Publisher",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Template Market Homeowner",
            email="template-market-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Template Market Project",
            project_city="San Antonio",
            project_state="TX",
            project_zip_code="78205",
        )
        call_command("seed_project_templates")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.private_template = ProjectTemplate.objects.create(
            contractor=self.other_contractor,
            name="Private Roof Template",
            project_type="Roofing",
            project_subtype="Roof Replacement",
            visibility=ProjectTemplate.Visibility.PRIVATE,
            allow_discovery=False,
        )
        self.mine_template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="My Private Kitchen Template",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            visibility=ProjectTemplate.Visibility.PRIVATE,
            allow_discovery=False,
        )
        self.regional_template = ProjectTemplate.objects.create(
            contractor=self.other_contractor,
            name="San Antonio Kitchen Pro",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Regional kitchen template",
            visibility=ProjectTemplate.Visibility.REGIONAL,
            allow_discovery=True,
            normalized_region_key="US-TX-SAN_ANTONIO",
            benchmark_match_key="remodel:kitchen_remodel",
        )
        self.public_template = ProjectTemplate.objects.create(
            contractor=self.other_contractor,
            name="National Kitchen Starter",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Public kitchen starter",
            visibility=ProjectTemplate.Visibility.PUBLIC,
            allow_discovery=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )
        ProjectBenchmarkAggregate.objects.create(
            scope=ProjectBenchmarkAggregate.Scope.TEMPLATE,
            template=self.regional_template,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            country="US",
            state="TX",
            city="San Antonio",
            normalized_region_key="US-TX-SAN_ANTONIO",
            completed_project_count=6,
            average_final_total=Decimal("28000.00"),
            median_final_total=Decimal("27500.00"),
            min_final_total=Decimal("22000.00"),
            max_final_total=Decimal("34000.00"),
            average_actual_duration_days=Decimal("24.00"),
            median_actual_duration_days=Decimal("23.00"),
            average_milestone_count=Decimal("5.00"),
            amount_sample_size=6,
            duration_sample_size=6,
        )

    def _agreement(self, **overrides):
        system_template = ProjectTemplate.objects.get(
            is_system=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )
        agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template=system_template,
            selected_template_name_snapshot=system_template.name,
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            description="Kitchen remodel marketplace preview.",
            total_cost=Decimal("24000.00"),
            project_address_city="San Antonio",
            project_address_state="TX",
            project_postal_code="78205",
            **overrides,
        )
        AgreementAIScope.objects.create(agreement=agreement, answers={})
        return agreement

    def test_private_templates_remain_private(self):
        response = self.client.get("/api/projects/templates/discover/", {"source": "mine"})
        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()["results"]}
        self.assertIn(self.mine_template.id, ids)
        self.assertNotIn(self.private_template.id, ids)

        detail = self.client.get(f"/api/projects/templates/{self.private_template.id}/")
        self.assertEqual(detail.status_code, 403)

    def test_system_template_can_be_cloned_into_private_contractor_template(self):
        system_template = ProjectTemplate.objects.get(
            is_system=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )
        source_milestone_count = system_template.milestones.count()

        response = self.client.post(
            "/api/projects/templates/",
            {
                "source_template_id": system_template.id,
                "name": system_template.name,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        created = ProjectTemplate.objects.get(pk=response.json()["id"])

        self.assertFalse(created.is_system)
        self.assertEqual(created.contractor_id, self.contractor.id)
        self.assertEqual(created.visibility, ProjectTemplate.Visibility.PRIVATE)
        self.assertFalse(created.allow_discovery)
        self.assertEqual(created.source_system_template_id, system_template.id)
        self.assertEqual(created.name, system_template.name)
        self.assertEqual(created.project_type, system_template.project_type)
        self.assertEqual(created.project_subtype, system_template.project_subtype)
        self.assertEqual(created.description, system_template.description)
        self.assertEqual(created.default_scope, system_template.default_scope)
        self.assertEqual(created.default_clarifications, system_template.default_clarifications)
        self.assertEqual(created.project_materials_hint, system_template.project_materials_hint)
        self.assertEqual(created.milestones.count(), source_milestone_count)
        system_template.refresh_from_db()
        self.assertTrue(system_template.is_system)
        self.assertEqual(system_template.milestones.count(), source_milestone_count)

    def test_template_create_sequences_blank_offsets_from_duration(self):
        response = self.client.post(
            "/api/projects/templates/",
            {
                "name": "Auto Sequence Template",
                "project_type": "Outdoor",
                "project_subtype": "Shed Build",
                "description": "Reusable shed build scope.",
                "default_scope": "Reusable shed build scope.",
                "milestones": [
                    {
                        "title": "Site prep",
                        "description": "Prepare the site.",
                        "sort_order": 1,
                        "start_offset": 0,
                        "duration_days": 2,
                    },
                    {
                        "title": "Framing",
                        "description": "Frame the structure.",
                        "sort_order": 2,
                        "start_offset": 0,
                        "duration_days": 3,
                    },
                    {
                        "title": "Cleanup",
                        "description": "Finish cleanup.",
                        "sort_order": 3,
                        "start_offset": 0,
                        "duration_days": 1,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        template = ProjectTemplate.objects.get(pk=response.data["id"])
        rows = list(template.milestones.order_by("sort_order", "id"))
        self.assertEqual([row.start_offset for row in rows], [0, 2, 5])
        self.assertEqual([row.duration_days for row in rows], [2, 3, 1])
        self.assertEqual([row.recommended_days_from_start for row in rows], [1, 3, 6])

    def test_template_detail_persists_assumptions_and_exclusions(self):
        create_response = self.client.post(
            "/api/projects/templates/",
            {
                "name": "Scope Persistence Template",
                "project_type": "Outdoor",
                "project_subtype": "Shed Build",
                "description": "Reusable shed build scope.",
                "default_scope": "Reusable shed build scope.",
                "assumptions_text": (
                    "Customer Responsibilities\n"
                    "- Customer will confirm selections and approvals.\n\n"
                    "Contractor Responsibilities\n"
                    "- Contractor will verify measurements and site conditions."
                ),
                "exclusions_text": (
                    "Exclusions\n"
                    "- The following are not included unless explicitly added:\n"
                    "- Electrical\n"
                    "- Plumbing"
                ),
                "milestones": [
                    {
                        "title": "Site prep",
                        "description": "Prepare the site.",
                        "sort_order": 1,
                        "start_offset": 0,
                        "duration_days": 2,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201, create_response.data)
        template_id = create_response.data["id"]
        self.assertIn("assumptions_text", create_response.data)
        self.assertIn("exclusions_text", create_response.data)
        self.assertTrue(create_response.data["assumptions_text"])
        self.assertTrue(create_response.data["exclusions_text"])

        detail_response = self.client.get(f"/api/projects/templates/{template_id}/")
        self.assertEqual(detail_response.status_code, 200, detail_response.data)
        self.assertEqual(
            detail_response.data["assumptions_text"],
            create_response.data["assumptions_text"],
        )
        self.assertEqual(
            detail_response.data["exclusions_text"],
            create_response.data["exclusions_text"],
        )

        patch_response = self.client.patch(
            f"/api/projects/templates/{template_id}/",
            {
                "assumptions_text": (
                    "Customer Responsibilities\n"
                    "- Customer will confirm selections.\n\n"
                    "Contractor Responsibilities\n"
                    "- Contractor will verify access."
                ),
                "exclusions_text": (
                    "Exclusions\n"
                    "- The following are not included unless explicitly added:\n"
                    "- Permits"
                ),
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200, patch_response.data)
        self.assertEqual(
            patch_response.data["assumptions_text"],
            "Customer Responsibilities\n"
            "- Customer will confirm selections.\n\n"
            "Contractor Responsibilities\n"
            "- Contractor will verify access.",
        )
        self.assertEqual(
            patch_response.data["exclusions_text"],
            "Exclusions\n"
            "- The following are not included unless explicitly added:\n"
            "- Permits",
        )

    def test_system_templates_appear_in_discovery(self):
        response = self.client.get("/api/projects/templates/discover/", {"source": "system"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(row["is_system"] for row in response.json()["results"]))
        names = {row["name"] for row in response.json()["results"]}
        self.assertIn("Bathroom Remodel", names)
        self.assertIn("Kitchen Remodel", names)
        self.assertIn("Roof Replacement", names)

    def test_unpublished_system_templates_do_not_appear_in_discovery(self):
        hidden_template = ProjectTemplate.objects.create(
            name="Hidden System Starter",
            project_type="Remodel",
            project_subtype="Hidden System Starter",
            description="Hidden system-only starter.",
            is_system_template=True,
            is_published=False,
            visibility=ProjectTemplate.Visibility.SYSTEM,
            allow_discovery=False,
        )

        response = self.client.get("/api/projects/templates/discover/", {"source": "system"})
        self.assertEqual(response.status_code, 200)
        names = {row["name"] for row in response.json()["results"]}
        self.assertNotIn(hidden_template.name, names)

    def test_contractor_cannot_edit_system_template(self):
        system_template = ProjectTemplate.objects.get(
            is_system_template=True,
            is_published=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )

        response = self.client.patch(
            f"/api/projects/templates/{system_template.id}/",
            {"description": "Attempted contractor edit"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)


    def test_recommend_endpoint_can_return_seeded_starter_template(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "project_title": "Bathroom Remodel",
                "project_type": "Remodel",
                "project_subtype": "Bathroom Remodel",
                "description": "Full bathroom remodel with demo, waterproofing, tile, vanity, and fixture replacement.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "recommended")
        self.assertEqual(body["confidence_level"], "high")
        self.assertEqual(body["recommended_template"]["name"], "Bathroom Remodel")

    def test_recommend_endpoint_handles_natural_kitchen_remodel_description(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Kitchen renovation with demo, cabinet replacement, countertops, backsplash, plumbing and electrical updates.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "recommended")
        self.assertEqual(body["confidence_level"], "high")
        self.assertEqual(body["recommended_template"]["project_subtype"], "Kitchen Remodel")

    def test_recommend_endpoint_prefers_cabinet_installation_for_task_specific_scope(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Install new kitchen cabinets on one wall, align doors, add hardware, no plumbing or electrical changes.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "recommended")
        self.assertEqual(body["confidence_level"], "high")
        self.assertEqual(body["recommended_template"]["name"], "Cabinet Installation")

    def test_recommend_endpoint_prefers_roof_replacement_for_roof_scope(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Tear off existing asphalt shingles, inspect decking, install underlayment, flashing, and new architectural shingles.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "recommended")
        self.assertEqual(body["confidence_level"], "high")
        self.assertEqual(body["recommended_template"]["name"], "Roof Replacement")

    def test_project_setup_recommendation_maps_shed_scope_to_outdoor(self):
        recommendation = build_project_setup_recommendation(
            project_title="Build backyard 12x14 shed",
            project_type="",
            project_subtype="",
            description="Build backyard 12x14 shed with slab foundation, single entry door, and shingle roof.",
        )

        self.assertEqual(recommendation["project_family_key"], "outdoor")
        self.assertEqual(recommendation["recommended_project_type"], "Outdoor")
        self.assertEqual(recommendation["recommended_project_subtype"], "Shed Build")
        self.assertEqual(recommendation["suggested_workflow"], "Outdoor structure workflow")
        self.assertEqual(recommendation["suggested_template_label"], "Shed Build Template")
        self.assertFalse(recommendation["strong_template_match"])

    def test_project_setup_recommendation_keeps_shed_on_concrete_slab_as_outdoor(self):
        recommendation = build_project_setup_recommendation(
            project_title="Build backyard 12x14 shed",
            project_type="",
            project_subtype="",
            description="Build backyard 12x14 shed on a concrete slab with single entry door and cleanup.",
        )

        self.assertEqual(recommendation["project_family_key"], "outdoor")
        self.assertEqual(recommendation["recommended_project_type"], "Outdoor")
        self.assertEqual(recommendation["recommended_project_subtype"], "Shed Build")
        self.assertEqual(recommendation["suggested_template_label"], "Shed Build Template")
        self.assertFalse(recommendation["strong_template_match"])

    def test_project_setup_recommendation_maps_slab_only_request_to_concrete(self):
        recommendation = build_project_setup_recommendation(
            project_title="Pour concrete slab for shed",
            project_type="",
            project_subtype="",
            description="Pour concrete slab only for the shed foundation.",
        )

        self.assertEqual(recommendation["project_family_key"], "concrete")
        self.assertEqual(recommendation["recommended_project_type"], "Concrete")
        self.assertEqual(recommendation["recommended_project_subtype"], "Concrete Slab")
        self.assertEqual(recommendation["suggested_template_label"], "Concrete Slab Template")
        self.assertFalse(recommendation["strong_template_match"])

    def test_recommend_endpoint_does_not_fallback_to_roof_for_shed_scope(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Build backyard 12x14 shed on a concrete slab with single entry door and cleanup.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "none")
        self.assertEqual(body["confidence_level"], "low")
        self.assertIsNone(body["recommended_template"])
        self.assertIsNone(body["possible_match"])
        candidate_names = {row["name"] for row in body["candidates"]}
        self.assertNotIn("Roof Replacement", candidate_names)
        self.assertNotIn("Roof Repair", candidate_names)
        self.assertNotIn("Concrete Slab Installation", candidate_names)

    def test_recommend_endpoint_returns_optional_match_for_medium_confidence(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Looking at replacing worn shingles and checking flashing around vents.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "possible")
        self.assertEqual(body["confidence_level"], "medium")
        self.assertIsNone(body["recommended_template"])
        self.assertEqual(body["possible_match"]["name"], "Roof Replacement")

    def test_recommend_endpoint_can_recommend_concrete_template_when_available(self):
        concrete_template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Concrete Patio Slab",
            project_type="Concrete",
            project_subtype="Concrete Slab",
            description="Pour and finish a concrete slab for a backyard patio and small equipment pad.",
            visibility=ProjectTemplate.Visibility.PRIVATE,
            allow_discovery=False,
        )

        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Pour concrete slab for shed foundation and small equipment pad.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        matched = body["recommended_template"] or body["possible_match"]
        self.assertIsNotNone(matched)
        self.assertEqual(matched["name"], concrete_template.name)

    def test_recommend_endpoint_stays_silent_for_low_confidence(self):
        response = self.client.post(
            "/api/projects/templates/recommend/",
            {
                "description": "Need help with a home project and want an agreement template.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["confidence"], "none")
        self.assertEqual(body["confidence_level"], "low")
        self.assertIsNone(body["recommended_template"])
        self.assertIsNone(body["possible_match"])

    def test_regional_templates_rank_above_national_when_region_matches(self):
        result = discover_templates(
            contractor=self.contractor,
            source="all",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            region_state="TX",
            region_city="San Antonio",
            sort="relevant",
        )
        ids = [row.id for row in result["results"] if row.id in {self.regional_template.id, self.public_template.id}]
        regional_row = next(row for row in result["results"] if row.id == self.regional_template.id)
        self.assertEqual(ids[0], self.regional_template.id)
        self.assertEqual(getattr(regional_row, "region_match_scope", ""), "city")

    def test_project_type_subtype_and_search_filters_work(self):
        response = self.client.get(
            "/api/projects/templates/discover/",
            {
                "source": "all",
                "project_type": "Remodel",
                "project_subtype": "Kitchen Remodel",
                "q": "National Kitchen",
            },
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], self.public_template.id)

    def test_visibility_transitions_are_explicit_and_reversible(self):
        response = self.client.post(
            f"/api/projects/templates/{self.mine_template.id}/visibility/",
            {
                "visibility": "regional",
                "region_state": "TX",
                "region_city": "San Antonio",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.mine_template.refresh_from_db()
        self.assertEqual(self.mine_template.visibility, ProjectTemplate.Visibility.REGIONAL)
        self.assertTrue(self.mine_template.allow_discovery)
        self.assertEqual(self.mine_template.normalized_region_key, "US-TX-SAN_ANTONIO")

        response = self.client.post(
            f"/api/projects/templates/{self.mine_template.id}/visibility/",
            {"visibility": "private"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.mine_template.refresh_from_db()
        self.assertEqual(self.mine_template.visibility, ProjectTemplate.Visibility.PRIVATE)
        self.assertFalse(self.mine_template.allow_discovery)

    def test_ranking_metadata_output_shape_is_present(self):
        response = self.client.get(
            "/api/projects/templates/discover/",
            {"source": "all", "project_type": "Remodel", "project_subtype": "Kitchen Remodel"},
        )
        self.assertEqual(response.status_code, 200)
        first = response.json()["results"][0]
        self.assertIn("rank_score", first)
        self.assertIn("rank_reasons", first)
        self.assertIn("region_match_scope", first)
        self.assertIn("usage_count", first)
        self.assertIn("completed_project_count", first)

    def test_estimate_preview_endpoint_returns_structured_shape(self):
        agreement = self._agreement()

        response = self.client.post(
            f"/api/projects/agreements/{agreement.id}/estimate-preview/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("suggested_total_price", data)
        self.assertIn("suggested_price_low", data)
        self.assertIn("suggested_duration_days", data)
        self.assertIn("milestone_suggestions", data)
        self.assertIn("suggested_plan", data)
        self.assertIn("confidence_level", data)
        self.assertIn("confidence_reasoning", data)
        self.assertIn("source_metadata", data)


class ContractorComplianceFoundationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="compliance-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Compliance Builder",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Compliance Homeowner",
            email="compliance-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Compliance Project",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        call_command("seed_state_trade_license_requirements")

    def test_seeded_state_trade_requirement_resolution(self):
        requirement = get_trade_license_requirement("TX", "Electrical")

        self.assertIsNotNone(requirement)
        self.assertEqual(requirement.state_code, "TX")
        self.assertEqual(requirement.trade_key, "electrical")
        self.assertTrue(requirement.license_required)
        self.assertIn("tdlr", requirement.official_lookup_url.lower())

    def test_profile_trade_preview_returns_requirement_for_selected_state_and_trade(self):
        response = self.client.post(
            "/api/projects/compliance/profile-preview/",
            {"state": "TX", "skills": ["Electrical"]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["state_code"], "TX")
        self.assertEqual(len(data["trade_requirements"]), 1)
        self.assertEqual(data["trade_requirements"][0]["trade_key"], "electrical")
        self.assertTrue(data["trade_requirements"][0]["required"])

    def test_missing_required_license_detection(self):
        result = contractor_has_required_license(self.contractor, "TX", "electrical")

        self.assertFalse(result["has_license"])
        self.assertEqual(result["status"], "missing")

    def test_uploaded_license_is_recognized_for_required_trade(self):
        self.contractor.license_number = "TX-ELEC-101"
        self.contractor.license_expiration = timezone.localdate() + timedelta(days=45)
        self.contractor.license_file = SimpleUploadedFile(
            "license.pdf",
            b"license-file",
            content_type="application/pdf",
        )
        self.contractor.save()

        sync_legacy_contractor_compliance_records(self.contractor)
        result = contractor_has_required_license(self.contractor, "TX", "electrical")

        self.assertTrue(result["has_license"])
        self.assertIn(
            result["status"],
            {
                ContractorComplianceRecord.Status.ON_FILE,
                ContractorComplianceRecord.Status.VERIFIED,
                ContractorComplianceRecord.Status.PENDING_REVIEW,
            },
        )

    def test_public_trust_indicators_remain_conservative(self):
        self.contractor.insurance_file = SimpleUploadedFile(
            "insurance.pdf",
            b"insurance-file",
            content_type="application/pdf",
        )
        self.contractor.save(update_fields=["insurance_file"])
        sync_legacy_contractor_compliance_records(self.contractor)

        indicators = get_public_trust_indicators(self.contractor, show_license_public=True)
        self.assertEqual(indicators, ["Insurance on file"])

        self.contractor.license_number = "TX-GEN-200"
        self.contractor.license_file = SimpleUploadedFile(
            "license.pdf",
            b"license-file",
            content_type="application/pdf",
        )
        self.contractor.save(update_fields=["license_number", "license_file"])
        sync_legacy_contractor_compliance_records(self.contractor)

        indicators = get_public_trust_indicators(self.contractor, show_license_public=True)
        self.assertIn("License on file", indicators)
        self.assertIn("Insurance on file", indicators)

    def test_agreement_level_warning_metadata_for_licensed_trade(self):
        agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Electrical panel replacement",
            project_type="Electrical",
            project_subtype="Electrical",
            project_address_state="TX",
        )

        warning = get_agreement_compliance_warning(agreement)

        self.assertEqual(warning["trade_key"], "electrical")
        self.assertEqual(warning["state_code"], "TX")
        self.assertTrue(warning["required"])
        self.assertEqual(warning["warning_level"], "warning")
        self.assertIn("license", warning["message"].lower())

    def test_seed_command_is_idempotent(self):
        first_count = StateTradeLicenseRequirement.objects.count()

        call_command("seed_state_trade_license_requirements")

        self.assertEqual(StateTradeLicenseRequirement.objects.count(), first_count)

    def test_contractor_me_payload_exposes_compliance_records_without_breaking_profile(self):
        self.contractor.license_number = "TX-ROOF-300"
        self.contractor.license_file = SimpleUploadedFile(
            "roof-license.pdf",
            b"roof-license",
            content_type="application/pdf",
        )
        self.contractor.save(update_fields=["license_number", "license_file"])

        response = self.client.get("/api/projects/contractors/me/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("compliance_records", payload)
        self.assertIn("compliance_trade_requirements", payload)
        self.assertIn("insurance_status", payload)
        self.assertEqual(payload["license_number"], "TX-ROOF-300")


class AIOrchestratorTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="orchestrator-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Orchestrator Builder",
            city="San Antonio",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Orchestrator Homeowner",
            email="orchestrator-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Orchestrator Project",
            project_city="San Antonio",
            project_state="TX",
            project_zip_code="78205",
        )
        self.compliance_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Compliance Orchestrator Project",
            project_city="San Antonio",
            project_state="TX",
            project_zip_code="78205",
        )
        call_command("seed_project_templates")
        call_command("seed_state_trade_license_requirements")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.system_template = ProjectTemplate.objects.get(
            is_system=True,
            benchmark_match_key="remodel:kitchen_remodel",
        )
        self.regional_template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Regional Kitchen Winner",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            visibility=ProjectTemplate.Visibility.REGIONAL,
            allow_discovery=True,
            normalized_region_key="US-TX-SAN_ANTONIO",
            benchmark_match_key="remodel:kitchen_remodel",
        )

        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            selected_template=self.system_template,
            selected_template_name_snapshot=self.system_template.name,
            description="Kitchen remodel with updated finishes.",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            project_address_city="San Antonio",
            project_address_state="TX",
            total_cost=Decimal("24000.00"),
            milestone_count=0,
        )
        AgreementAIScope.objects.create(
            agreement=self.agreement,
            answers={"finish_level": "premium"},
        )

        self.compliance_agreement = Agreement.objects.create(
            project=self.compliance_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Electrical service upgrade",
            project_type="Electrical",
            project_subtype="Electrical",
            project_address_city="San Antonio",
            project_address_state="TX",
        )
        self.compliance_milestone = Milestone.objects.create(
            agreement=self.compliance_agreement,
            title="Electrical rough-in",
            description="Install new circuits",
            order=1,
            normalized_milestone_type="electrical",
            amount=Decimal("1800.00"),
        )

        self.sub_user = user_model.objects.create_user(
            email="sub-orchestrator@example.com",
            password="testpass123",
        )
        self.subcontractor = Contractor.objects.create(
            user=self.sub_user,
            business_name="Sub Electric",
            city="San Antonio",
            state="TX",
        )
        self.invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.compliance_agreement,
            invite_email="sub-orchestrator@example.com",
            invite_name="Sub Electric",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.sub_user,
            accepted_at=timezone.now(),
        )

    def test_orchestrator_selects_agreement_builder_for_resume_request(self):
        result = orchestrate_user_request(
            contractor=self.contractor,
            payload={
                "input": "Help me finish this agreement",
                "context": {"agreement_id": self.agreement.id},
            },
        )

        self.assertEqual(result["primary_intent"], "resume_agreement")
        self.assertIn("agreement_builder", result["selected_routines"])
        self.assertEqual(result["wizard_step_target"], 2)
        self.assertEqual(result["recommended_action"]["label"], "Open Milestone Builder")

    def test_template_recommendation_orchestration_returns_ranked_templates(self):
        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {
                "input": "Recommend a template for this kitchen remodel",
                "context": {
                    "agreement_id": self.agreement.id,
                    "project_type": "Remodel",
                    "project_subtype": "Kitchen Remodel",
                    "region_city": "San Antonio",
                    "region_state": "TX",
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["primary_intent"], "apply_template")
        self.assertTrue(data["preview_payload"]["templates"])
        self.assertIn("rank_score", data["preview_payload"]["templates"][0])
        self.assertIn("automation_plan", data)
        self.assertTrue(data["automation_plan"]["preview_only"])
        self.assertTrue(data["proposed_actions"])
        self.assertTrue(data["guided_step"])

    def test_estimation_orchestration_returns_structured_preview(self):
        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {
                "input": "Estimate this project",
                "context": {"agreement_id": self.agreement.id},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["primary_intent"], "estimate_project")
        self.assertIn("estimate_preview", data["preview_payload"])
        self.assertIn("suggested_total_price", data["preview_payload"]["estimate_preview"])
        self.assertIn("confidence_level", data["preview_payload"]["estimate_preview"])
        self.assertTrue(data["predictive_insights"])
        self.assertTrue(data["proactive_recommendations"])
        self.assertTrue(data["proposed_actions"])

    def test_compliance_orchestration_returns_safe_structured_warning(self):
        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {
                "input": "Why is there a compliance warning on this agreement?",
                "context": {"agreement_id": self.compliance_agreement.id},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["primary_intent"], "check_compliance")
        self.assertIn("compliance", data["preview_payload"])
        self.assertTrue(data["preview_payload"]["compliance"]["required"])
        self.assertIn("license", data["preview_payload"]["compliance"]["message"].lower())
        self.assertTrue(data["proactive_recommendations"])
        self.assertTrue(data["predictive_insights"])

    def test_subcontractor_assignment_orchestration_exposes_three_decision_paths(self):
        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {
                "input": "Assign this subcontractor to the milestone",
                "context": {
                    "agreement_id": self.compliance_agreement.id,
                    "milestone_id": self.compliance_milestone.id,
                    "subcontractor_invitation_id": self.invitation.id,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["primary_intent"], "subcontractor_assignment")
        self.assertTrue(data["confirmation_required"])
        action_keys = {item["key"] for item in data["available_actions"]}
        self.assertIn("assign_anyway", action_keys)
        self.assertIn("request_license", action_keys)
        self.assertIn("choose_another", action_keys)
        self.assertTrue(data["confirmation_required_actions"])

    def test_auto_build_preview_does_not_create_hidden_agreement_write(self):
        before_count = Agreement.objects.count()

        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {
                "input": "Build an agreement for this kitchen remodel lead and prepare everything for review",
                "context": {
                    "lead_id": self.homeowner.id,
                    "project_type": "Remodel",
                    "project_subtype": "Kitchen Remodel",
                    "region_city": "San Antonio",
                    "region_state": "TX",
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("automation_plan", data)
        self.assertTrue(data["automation_plan"]["preview_only"])
        self.assertIn("applyable_preview", data)
        self.assertEqual(Agreement.objects.count(), before_count)

    def test_low_confidence_navigation_request_can_fall_back_to_planner(self):
        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {"input": "", "context": {}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["fallback_to_planner"])
        self.assertEqual(data["planning_confidence"], "low")


class ContractorActivationOnboardingTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="activation-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Activation Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Activation Homeowner",
            email="activation-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Activation Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            payment_mode="direct",
            description="Activation agreement",
            project_type="HVAC",
            project_subtype="Maintenance",
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("150.00"),
            status=InvoiceStatus.PENDING,
            invoice_number="ACT-1001",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_onboarding_patch_updates_progress_and_soft_prompt(self):
        response = self.client.patch(
            "/api/projects/contractors/onboarding/",
            {
                "business_name": "Activation Contractor",
                "city": "San Antonio",
                "state": "TX",
                "zip": "78205",
                "service_radius_miles": 50,
                "skills": ["HVAC", "Inspection"],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "in_progress")
        self.assertEqual(payload["step"], "stripe")
        self.assertEqual(payload["trade_count"], 2)
        self.assertEqual(payload["service_radius_miles"], 50)
        self.assertFalse(payload["show_soft_stripe_prompt"])

        mark_response = self.client.patch(
            "/api/projects/contractors/onboarding/",
            {"mark_first_project_started": True},
            format="json",
        )
        self.assertEqual(mark_response.status_code, 200)
        marked_payload = mark_response.json()
        self.assertEqual(marked_payload["status"], "in_progress")
        self.assertEqual(marked_payload["step"], "stripe")
        self.assertTrue(marked_payload["first_value_reached"])
        self.assertTrue(marked_payload["show_soft_stripe_prompt"])
        self.assertEqual(marked_payload["activation"]["last_step_reached"], "stripe")
        self.assertTrue(
            ContractorActivationEvent.objects.filter(
                contractor=self.contractor,
                event_type="trade_selected",
            ).exists()
        )

    def test_direct_pay_link_returns_structured_stripe_requirement(self):
        response = self.client.post(f"/api/projects/invoices/{self.invoice.id}/direct_pay_link/")

        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertEqual(payload["code"], "STRIPE_ONBOARDING_REQUIRED")
        self.assertEqual(payload["action_attempted"], "create_direct_pay_link")
        self.assertEqual(payload["resume_url"], "/app/onboarding/stripe")
        self.assertIn("onboarding", payload)
        self.assertFalse(payload["stripe_status"]["connected"])

    def test_contractor_me_exposes_onboarding_snapshot(self):
        self.contractor.city = "San Antonio"
        self.contractor.state = "TX"
        self.contractor.service_radius_miles = 100
        self.contractor.save(update_fields=["city", "state", "service_radius_miles"])

        response = self.client.get("/api/projects/contractors/me/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("onboarding", payload)
        self.assertIn("contractor_onboarding_status", payload)
        self.assertEqual(payload["service_radius_miles"], 100)
        self.assertEqual(payload["onboarding"]["service_radius_miles"], 100)
        self.assertEqual(payload["onboarding"]["step"], "welcome")

    def test_onboarding_event_endpoint_tracks_activation_event(self):
        response = self.client.post(
            "/api/projects/contractors/onboarding/events/",
            {
                "event_type": "ai_used_for_project",
                "step": "first_job",
                "context": {"prompt_preview": "Bathroom remodel for Mike"},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            ContractorActivationEvent.objects.filter(
                contractor=self.contractor,
                event_type="ai_used_for_project",
                step="first_job",
            ).exists()
        )

    def test_orchestrator_returns_onboarding_specialist(self):
        response = self.client.post(
            "/api/projects/assistant/orchestrate/",
            {
                "input": "Help me finish setup and start my first project",
                "context": {"current_route": "/app/onboarding"},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["primary_intent"], "contractor_onboarding")
        self.assertIn("contractor_onboarding", data["selected_routines"])
        self.assertEqual(data["navigation_target"], "/app/onboarding")
        self.assertIn("onboarding", data["preview_payload"])


class ContractorActivityFeedTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="activity-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Activity Contractor",
            city="San Antonio",
            state="TX",
        )
        hvac = Skill.objects.create(name="HVAC", slug="hvac")
        self.contractor.skills.add(hvac)
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Activity Homeowner",
            email="activity-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Activity Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Activity agreement",
            project_type="Electrical",
            project_subtype="Repair",
            project_address_city="San Antonio",
            project_address_state="TX",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Panel upgrade",
            amount=Decimal("500.00"),
            assigned_subcontractor_invitation=None,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        call_command("seed_state_trade_license_requirements")

    def test_create_activity_event_dedupes_by_key(self):
        create_activity_event(
            contractor=self.contractor,
            actor_user=self.user,
            agreement=self.agreement,
            event_type="agreement_created",
            title="Agreement draft created",
            dedupe_key="agreement_created:1",
        )
        create_activity_event(
            contractor=self.contractor,
            actor_user=self.user,
            agreement=self.agreement,
            event_type="agreement_created",
            title="Agreement draft created",
            dedupe_key="agreement_created:1",
        )

        self.assertEqual(ContractorActivityEvent.objects.count(), 1)

    def test_activity_feed_endpoint_returns_results_and_next_best_action(self):
        create_activity_event(
            contractor=self.contractor,
            actor_user=self.user,
            agreement=self.agreement,
            event_type="agreement_created",
            title="Agreement draft created",
            summary="A draft agreement is ready.",
            navigation_target=f"/app/agreements/{self.agreement.id}/wizard?step=1",
            dedupe_key=f"agreement_created:{self.agreement.id}",
        )

        response = self.client.get("/api/projects/activity-feed/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("results", payload)
        self.assertIn("next_best_action", payload)
        self.assertEqual(payload["results"][0]["event_type"], "agreement_created")
        self.assertEqual(payload["next_best_action"]["action_type"], "finish_onboarding")

    def test_next_best_action_prefers_draft_after_onboarding_complete(self):
        self.contractor.first_project_started_at = timezone.now()
        self.contractor.first_agreement_created_at = timezone.now()
        self.contractor.payouts_enabled = True
        self.contractor.details_submitted = True
        self.contractor.save(
            update_fields=[
                "first_project_started_at",
                "first_agreement_created_at",
                "payouts_enabled",
                "details_submitted",
            ]
        )

        action = get_next_best_action(self.contractor)

        self.assertEqual(action["action_type"], "send_first_agreement")
        self.assertIn(str(self.agreement.id), action["navigation_target"])

    def test_compliance_request_creates_activity_event(self):
        accepted_user = get_user_model().objects.create_user(
            email="sub@example.com",
            password="testpass123",
        )
        invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="sub@example.com",
            invite_name="Sub Contractor",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=accepted_user,
        )
        self.milestone.assigned_subcontractor_invitation = invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])

        evaluation = evaluate_subcontractor_assignment_compliance(
            contractor=self.contractor,
            invitation=invitation,
            agreement=self.agreement,
            milestone=self.milestone,
        )
        apply_assignment_compliance_decision(
            milestone=self.milestone,
            evaluation=evaluation,
            action="request_license",
            acting_user=self.user,
        )

        self.assertTrue(
            ContractorActivityEvent.objects.filter(
                contractor=self.contractor,
                event_type="subcontractor_license_requested",
                milestone=self.milestone,
            ).exists()
        )

    def test_dashboard_payload_flags_recurring_attention(self):
        self.contractor.first_project_started_at = timezone.now()
        self.contractor.first_agreement_created_at = timezone.now()
        self.contractor.payouts_enabled = True
        self.contractor.details_submitted = True
        self.contractor.save(
            update_fields=[
                "first_project_started_at",
                "first_agreement_created_at",
                "payouts_enabled",
                "details_submitted",
            ]
        )
        self.agreement.agreement_mode = AgreementMode.MAINTENANCE
        self.agreement.recurring_service_enabled = True
        self.agreement.maintenance_status = MaintenanceStatus.ACTIVE
        self.agreement.status = ProjectStatus.SIGNED
        self.agreement.next_occurrence_date = timezone.localdate()
        self.agreement.save(
            update_fields=[
                "agreement_mode",
                "recurring_service_enabled",
                "maintenance_status",
                "status",
                "next_occurrence_date",
            ]
        )

        payload = build_dashboard_activity_payload(self.contractor, limit=5)

        self.assertEqual(payload["next_best_action"]["action_type"], "review_recurring_occurrence")
        create_activity_event(
            contractor=self.contractor,
            agreement=self.agreement,
            milestone=self.milestone,
            event_type="recurring_occurrence_generated",
            title="Recurring service occurrence generated",
            dedupe_key="recurring:1",
        )
        refreshed = build_dashboard_activity_payload(self.contractor, limit=5)
        self.assertEqual(refreshed["results"][0]["event_type"], "recurring_occurrence_generated")


class ProjectEmailReportTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="reports-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Reporting Builder",
            city="San Antonio",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Reporting Owner",
            email="owner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Reporting Project",
            project_city="San Antonio",
            project_state="TX",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Reporting agreement",
            total_cost=Decimal("24000.00"),
            project_type="Electrical",
            project_subtype="Electrical",
            project_address_city="San Antonio",
            project_address_state="TX",
            report_recipient_name="Investor Contact",
            report_recipient_email="investor@example.com",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Electrical rough-in",
            description="Install new circuits",
            amount=Decimal("1800.00"),
            completed=True,
            is_invoiced=True,
            completed_at=timezone.now() - timedelta(days=1),
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
            subcontractor_marked_complete_at=timezone.now() - timedelta(hours=2),
        )
        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("1800.00"),
            status=InvoiceStatus.PENDING,
            milestone_title_snapshot=self.milestone.title,
            milestone_completion_notes="Rough-in complete and ready for owner review.",
            escrow_released=False,
        )
        self.milestone.invoice = self.invoice
        self.milestone.save(update_fields=["invoice"])
        call_command("seed_state_trade_license_requirements")

    def test_milestone_approval_email_payload_generation(self):
        payload = build_project_email_report(
            event_type=ProjectEmailReportLog.EventType.MILESTONE_APPROVAL_REQUESTED,
            agreement=self.agreement,
            milestone=self.milestone,
        )

        self.assertEqual(payload.event_type, "milestone_approval_requested")
        self.assertEqual(payload.recipient_email, "investor@example.com")
        self.assertEqual(payload.context["milestone_title"], "Electrical rough-in")
        self.assertEqual(payload.context["requested_amount"], "1800.00")
        self.assertIn("/invoice/", payload.context["review_url"])

    def test_payment_release_email_payload_generation(self):
        self.invoice.escrow_released = True
        self.invoice.escrow_released_at = timezone.now()
        self.invoice.save(update_fields=["escrow_released", "escrow_released_at"])

        payload = build_project_email_report(
            event_type=ProjectEmailReportLog.EventType.PAYMENT_RELEASED,
            agreement=self.agreement,
            invoice=self.invoice,
        )

        self.assertEqual(payload.event_type, "payment_released")
        self.assertEqual(payload.context["released_amount"], "1800.00")
        self.assertEqual(payload.context["released_to_date"], "1800.00")

    def test_compliance_alert_email_payload_generation_is_safe(self):
        payload = build_project_email_report(
            event_type=ProjectEmailReportLog.EventType.COMPLIANCE_ALERT,
            agreement=self.agreement,
            milestone=self.milestone,
            compliance_note="Texas electrical license pending. License number TX-12345 should not be shown.",
        )

        self.assertEqual(payload.event_type, "compliance_alert")
        self.assertIn("license pending", payload.context["compliance_note"].lower())
        self.assertNotIn("TX-12345", payload.context["compliance_note"])

    def test_weekly_summary_payload_generation(self):
        self.invoice.escrow_released = True
        self.invoice.escrow_released_at = timezone.now() - timedelta(days=2)
        self.invoice.save(update_fields=["escrow_released", "escrow_released_at"])

        payload = build_project_email_report(
            event_type=ProjectEmailReportLog.EventType.WEEKLY_PROJECT_SUMMARY,
            agreement=self.agreement,
        )

        self.assertEqual(payload.event_type, "weekly_project_summary")
        self.assertIn("Electrical rough-in", payload.context["completed_milestones"])
        self.assertEqual(payload.context["funds_released_this_week"], "1800.00")

    @patch("projects.services.project_email_reports.EmailMultiAlternatives.send", return_value=1)
    def test_duplicate_send_prevention(self, _send):
        first = send_project_email_report(
            event_type=ProjectEmailReportLog.EventType.MILESTONE_APPROVAL_REQUESTED,
            agreement=self.agreement,
            milestone=self.milestone,
        )
        second = send_project_email_report(
            event_type=ProjectEmailReportLog.EventType.MILESTONE_APPROVAL_REQUESTED,
            agreement=self.agreement,
            milestone=self.milestone,
        )

        self.assertTrue(first["sent"])
        self.assertFalse(second["sent"])
        self.assertEqual(second["reason"], "duplicate")
        self.assertEqual(ProjectEmailReportLog.objects.count(), 1)

    @patch("projects.services.project_email_reports.EmailMultiAlternatives.send", return_value=1)
    def test_milestone_submit_work_trigger_creates_report_log(self, _send):
        submit_user = get_user_model().objects.create_user(
            email="assigned-reporting-sub@example.com",
            password="testpass123",
        )
        invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-reporting-sub@example.com",
            invite_name="Assigned Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=submit_user,
            accepted_at=timezone.now(),
        )
        workflow_milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Panel trim-out",
            description="Finish devices and final checks",
            amount=Decimal("950.00"),
            completed=False,
            is_invoiced=False,
            assigned_subcontractor_invitation=invitation,
            subcontractor_completion_status=SubcontractorCompletionStatus.NOT_SUBMITTED,
        )

        client = APIClient()
        client.force_authenticate(user=submit_user)
        response = client.post(
            f"/api/projects/milestones/{workflow_milestone.id}/submit-work/",
            {"note": "Ready for review"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            ProjectEmailReportLog.objects.filter(
                agreement=self.agreement,
                event_type=ProjectEmailReportLog.EventType.MILESTONE_APPROVAL_REQUESTED,
            ).exists()
        )


class RecurringMaintenanceTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        self.user = get_user_model().objects.create_user(
            email="maintenance@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Maintenance Builder",
            city="San Antonio",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Maintenance Owner",
            email="owner-maint@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="HVAC Service Plan",
            project_city="San Antonio",
            project_state="TX",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Quarterly HVAC maintenance",
            total_cost=Decimal("1200.00"),
            project_type="HVAC",
            project_subtype="Maintenance",
            agreement_mode=AgreementMode.MAINTENANCE,
            recurring_service_enabled=True,
            recurrence_pattern=RecurrencePattern.QUARTERLY,
            recurrence_interval=1,
            recurrence_start_date=timezone.localdate(),
            auto_generate_next_occurrence=True,
            maintenance_status=MaintenanceStatus.ACTIVE,
            recurring_summary_label="Quarterly HVAC Maintenance",
            report_recipient_email="investor-maint@example.com",
        )
        self.rule = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="HVAC Tune-Up",
            description="Replace filter and inspect system performance.",
            amount=Decimal("300.00"),
            is_recurring_rule=True,
            recurrence_pattern=RecurrencePattern.QUARTERLY,
            recurrence_interval=1,
            recurrence_anchor_date=self.agreement.recurrence_start_date,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_maintenance_agreement_creation_serializes_recurring_fields(self):
        response = self.client.get(f"/api/projects/agreements/{self.agreement.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["agreement_mode"], "maintenance")
        self.assertTrue(response.data["recurring_service_enabled"])
        self.assertEqual(response.data["recurrence_pattern"], "quarterly")
        self.assertEqual(response.data["recurrence_interval"], 1)
        self.assertEqual(response.data["recurring_summary_label"], "Quarterly HVAC Maintenance")
        self.assertIn("preview_occurrences", response.data["recurring_preview"])

    def test_recurring_occurrence_generation_is_idempotent(self):
        created_first = ensure_recurring_milestones(self.agreement, horizon=1)
        created_second = ensure_recurring_milestones(self.agreement, horizon=1)

        self.assertEqual(len(created_first), 1)
        self.assertEqual(len(created_second), 0)
        self.assertEqual(
            Milestone.objects.filter(
                agreement=self.agreement,
                generated_from_recurring_rule=True,
                recurring_rule_parent=self.rule,
            ).count(),
            1,
        )

    def test_recurring_occurrence_created_after_completion(self):
        ensure_recurring_milestones(self.agreement, horizon=1)
        occurrence = Milestone.objects.get(
            agreement=self.agreement,
            generated_from_recurring_rule=True,
            recurring_rule_parent=self.rule,
        )
        occurrence.completed = True
        occurrence.completed_at = timezone.now()
        occurrence.save(update_fields=["completed", "completed_at"])

        created = handle_milestone_recurring_state_change(occurrence)

        self.assertEqual(len(created), 1)
        self.assertEqual(
            Milestone.objects.filter(
                agreement=self.agreement,
                generated_from_recurring_rule=True,
                recurring_rule_parent=self.rule,
            ).count(),
            2,
        )
        self.agreement.refresh_from_db()
        self.assertIsNotNone(self.agreement.next_occurrence_date)

    def test_paused_or_cancelled_agreements_do_not_generate_occurrences(self):
        self.agreement.maintenance_status = MaintenanceStatus.PAUSED
        self.agreement.save(update_fields=["maintenance_status"])
        created_paused = ensure_recurring_milestones(self.agreement, horizon=1)

        self.agreement.maintenance_status = MaintenanceStatus.CANCELLED
        self.agreement.save(update_fields=["maintenance_status"])
        created_cancelled = ensure_recurring_milestones(self.agreement, horizon=1)

        self.assertEqual(created_paused, [])
        self.assertEqual(created_cancelled, [])
        self.assertEqual(
            Milestone.objects.filter(agreement=self.agreement, generated_from_recurring_rule=True).count(),
            0,
        )

    def test_invoice_and_reporting_payloads_work_for_recurring_occurrence(self):
        ensure_recurring_milestones(self.agreement, horizon=1)
        occurrence = Milestone.objects.get(
            agreement=self.agreement,
            generated_from_recurring_rule=True,
            recurring_rule_parent=self.rule,
        )
        occurrence.completed = True
        occurrence.is_invoiced = True
        occurrence.completed_at = timezone.now()
        occurrence.save(update_fields=["completed", "is_invoiced", "completed_at"])

        invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("300.00"),
            status=InvoiceStatus.PENDING,
            milestone_title_snapshot=occurrence.title,
            milestone_completion_notes="Quarterly maintenance visit completed.",
            escrow_released=True,
            escrow_released_at=timezone.now(),
        )
        occurrence.invoice = invoice
        occurrence.save(update_fields=["invoice"])

        payload = build_project_email_report(
            event_type=ProjectEmailReportLog.EventType.PAYMENT_RELEASED,
            agreement=self.agreement,
            invoice=invoice,
        )

        self.assertEqual(payload.event_type, "payment_released")
        self.assertIn("Quarterly HVAC Maintenance", payload.context["recurring_service_label"])

    def test_management_command_safe_repeat_execution(self):
        call_command("generate_recurring_maintenance_milestones")
        count_after_first = Milestone.objects.filter(
            agreement=self.agreement,
            generated_from_recurring_rule=True,
        ).count()
        call_command("generate_recurring_maintenance_milestones")
        count_after_second = Milestone.objects.filter(
            agreement=self.agreement,
            generated_from_recurring_rule=True,
        ).count()

        self.assertEqual(count_after_first, 1)
        self.assertEqual(count_after_second, 1)

    def test_build_recurring_preview_returns_upcoming_occurrences(self):
        preview = build_recurring_preview(self.agreement, horizon=3)

        self.assertEqual(preview["agreement_mode"], "maintenance")
        self.assertEqual(preview["recurrence_pattern"], "quarterly")
        self.assertGreaterEqual(len(preview["preview_occurrences"]), 1)


class AgreementStep1RecurringFieldSaveTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="step1-save@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Step 1 Save Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Step 1 Save Homeowner",
            email="step1-save-homeowner@example.com",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_standard_step1_draft_normalizes_recurring_fields_to_empty_strings(self):
        response = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Standard Step 1 Draft",
                "title": "Standard Step 1 Draft",
                "description": "Standard agreement draft.",
                "agreement_mode": AgreementMode.STANDARD,
                "recurring_service_enabled": False,
                "recurrence_pattern": None,
                "service_window_notes": None,
                "recurring_summary_label": None,
                "payment_mode": "escrow",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        agreement = Agreement.objects.get(pk=response.json()["id"])
        self.assertEqual(agreement.agreement_mode, AgreementMode.STANDARD)
        self.assertEqual(agreement.recurrence_pattern, "")
        self.assertEqual(agreement.service_window_notes, "")
        self.assertEqual(agreement.recurring_summary_label, "")

    def test_standard_step1_create_persists_scope_of_work_and_step_status(self):
        response = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Siding Replacement",
                "title": "Siding Replacement",
                "scope_of_work": "Replace exterior siding and trim.",
                "agreement_mode": AgreementMode.STANDARD,
                "recurring_service_enabled": False,
                "step_status": "step1",
                "payment_mode": "escrow",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        agreement = Agreement.objects.get(pk=response.json()["id"])
        self.assertEqual(agreement.description, "Replace exterior siding and trim.")
        self.assertEqual(agreement.step_status, "step1")

    def test_standard_step1_patch_persists_scope_of_work_and_step_status(self):
        created = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Initial Draft",
                "title": "Initial Draft",
                "description": "Initial scope.",
                "agreement_mode": AgreementMode.STANDARD,
                "recurring_service_enabled": False,
                "step_status": "step1",
                "payment_mode": "escrow",
            },
            format="json",
        )

        self.assertEqual(created.status_code, 201)
        agreement_id = created.json()["id"]

        patched = self.client.patch(
            f"/api/projects/agreements/{agreement_id}/",
            {
                "scope_of_work": "Updated scope of work.",
                "step_status": "step2",
            },
            format="json",
        )

        self.assertEqual(patched.status_code, 200)
        agreement = Agreement.objects.get(pk=agreement_id)
        self.assertEqual(agreement.description, "Updated scope of work.")
        self.assertEqual(agreement.step_status, "step2")

    def test_standard_step1_patch_persists_project_title_on_agreement_reload(self):
        created = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Initial Draft",
                "title": "Initial Draft",
                "description": "Initial scope.",
                "agreement_mode": AgreementMode.STANDARD,
                "recurring_service_enabled": False,
                "step_status": "step1",
                "payment_mode": "escrow",
            },
            format="json",
        )

        self.assertEqual(created.status_code, 201)
        agreement_id = created.json()["id"]

        patched = self.client.patch(
            f"/api/projects/agreements/{agreement_id}/",
            {
                "project_title": "Backyard Shed Build",
                "title": "Backyard Shed Build",
            },
            format="json",
        )

        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["project_title"], "Backyard Shed Build")

        reloaded = self.client.get(f"/api/projects/agreements/{agreement_id}/")
        self.assertEqual(reloaded.status_code, 200)
        self.assertEqual(reloaded.json()["project_title"], "Backyard Shed Build")
        agreement = Agreement.objects.get(pk=agreement_id)
        self.assertEqual(agreement.project.title, "Backyard Shed Build")

    def test_maintenance_step1_draft_preserves_recurrence_fields_without_nulls(self):
        response = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Recurring Step 1 Draft",
                "title": "Recurring Step 1 Draft",
                "description": "Recurring service draft.",
                "agreement_mode": AgreementMode.MAINTENANCE,
                "recurring_service_enabled": True,
                "recurrence_pattern": RecurrencePattern.MONTHLY,
                "recurrence_interval": 1,
                "recurrence_start_date": str(timezone.localdate()),
                "service_window_notes": None,
                "recurring_summary_label": None,
                "payment_mode": "escrow",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        agreement = Agreement.objects.get(pk=response.json()["id"])
        self.assertEqual(agreement.agreement_mode, AgreementMode.MAINTENANCE)
        self.assertEqual(agreement.recurrence_pattern, RecurrencePattern.MONTHLY)
        self.assertEqual(agreement.service_window_notes, "")
        self.assertEqual(agreement.recurring_summary_label, "")

    def test_pricing_strategy_defaults_and_persists_from_step1_patch(self):
        response = self.client.post(
            "/api/projects/agreements/",
            {
                "is_draft": True,
                "wizard_step": 1,
                "homeowner": self.homeowner.id,
                "project_title": "Pricing Strategy Draft",
                "title": "Pricing Strategy Draft",
                "description": "Pricing strategy draft.",
                "agreement_mode": AgreementMode.STANDARD,
                "recurring_service_enabled": False,
                "payment_mode": "escrow",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        agreement_id = response.json()["id"]
        agreement = Agreement.objects.get(pk=agreement_id)
        self.assertEqual(agreement.pricing_strategy, "fixed")

        patched = self.client.patch(
            f"/api/projects/agreements/{agreement_id}/",
            {
                "pricing_strategy": "requires_sub_quote",
                "step_status": "step1",
            },
            format="json",
        )

        self.assertEqual(patched.status_code, 200)
        agreement.refresh_from_db()
        self.assertEqual(agreement.pricing_strategy, "requires_sub_quote")


class CustomerPortalAccessTests(TestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.contractor_user = User.objects.create_user(
            email="builder@example.com",
            password="password123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Builder Co",
        )
        self.public_profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="Builder Co",
            allow_public_intake=True,
            is_public=True,
        )
        self.other_contractor_user = User.objects.create_user(
            email="partner@example.com",
            password="password123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Partner Co",
        )
        self.other_public_profile = ContractorPublicProfile.objects.create(
            contractor=self.other_contractor,
            business_name_public="Partner Co",
            allow_public_intake=True,
            is_public=True,
        )

        self.customer_email = "customer@example.com"
        self.customer_homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Pat Customer",
            email=self.customer_email,
            company_name="",
            status="active",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Other Customer",
            email="other@example.com",
            company_name="",
            status="active",
        )

        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.customer_homeowner,
            title="Kitchen Remodel",
            description="Primary project",
            project_street_address="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_zip_code="78701",
        )
        self.other_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.other_homeowner,
            title="Other Basement",
            description="Should not leak",
            project_street_address="456 Side St",
            project_city="Dallas",
            project_state="TX",
            project_zip_code="75201",
        )

        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.customer_homeowner,
            project_class=AgreementProjectClass.COMMERCIAL,
            total_cost=Decimal("15000.00"),
            description="Customer-facing portal agreement",
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.contractor,
            homeowner=self.other_homeowner,
            project_class=AgreementProjectClass.RESIDENTIAL,
            total_cost=Decimal("2500.00"),
            description="Other agreement",
            signed_by_contractor=True,
            signed_by_homeowner=True,
        )

        self.intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=self.customer_homeowner,
            agreement=self.agreement,
            initiated_by="homeowner",
            status="submitted",
            post_submit_flow="multi_contractor",
            lead_source="landing_page",
            customer_name="Pat Customer",
            customer_email=self.customer_email,
            customer_phone="555-111-2222",
            project_class="commercial",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            accomplishment_text="Need a commercial remodel.",
            submitted_at=timezone.now(),
            completed_at=timezone.now(),
            share_token="portal-test-token-1",
        )
        self.other_intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=self.other_homeowner,
            agreement=self.other_agreement,
            initiated_by="homeowner",
            status="submitted",
            post_submit_flow="single_contractor",
            lead_source="landing_page",
            customer_name="Other Customer",
            customer_email="other@example.com",
            customer_phone="555-333-4444",
            project_class="residential",
            project_address_line1="456 Side St",
            project_city="Dallas",
            project_state="TX",
            project_postal_code="75201",
            accomplishment_text="Other scope.",
            submitted_at=timezone.now(),
            completed_at=timezone.now(),
            share_token="portal-test-token-2",
        )

        self.comparison_intake = ProjectIntake.objects.create(
            contractor=self.contractor,
            homeowner=self.customer_homeowner,
            initiated_by="homeowner",
            status="submitted",
            post_submit_flow="multi_contractor",
            lead_source="landing_page",
            customer_name="Pat Customer",
            customer_email=self.customer_email,
            customer_phone="555-111-2222",
            project_class="commercial",
            project_address_line1="200 Market St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            accomplishment_text="Need an office fitout.",
            ai_project_title="Office Fitout",
            submitted_at=timezone.now(),
            completed_at=timezone.now(),
            share_token="portal-test-token-3",
        )

        self.lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.public_profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Pat Customer",
            email=self.customer_email,
            phone="555-111-2222",
            project_address="123 Main St",
            city="Austin",
            state="TX",
            zip_code="78701",
            project_type="Commercial Remodel",
            project_description="Commercial remodel bid.",
            preferred_timeline="ASAP",
            budget_text="$15,000",
            status=PublicContractorLead.STATUS_ACCEPTED,
            converted_agreement=self.agreement,
            converted_at=timezone.now(),
            accepted_at=timezone.now(),
        )
        self.intake.public_lead = self.lead
        self.intake.save(update_fields=["public_lead", "updated_at"])

        self.other_lead = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.public_profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Other Customer",
            email="other@example.com",
            phone="555-333-4444",
            project_address="456 Side St",
            city="Dallas",
            state="TX",
            zip_code="75201",
            project_type="Residential Remodel",
            project_description="Other bid.",
            preferred_timeline="Soon",
            budget_text="$2,500",
            status=PublicContractorLead.STATUS_NEW,
            converted_agreement=self.other_agreement,
        )
        self.other_intake.public_lead = self.other_lead
        self.other_intake.save(update_fields=["public_lead", "updated_at"])

        self.comparison_lead_one = PublicContractorLead.objects.create(
            contractor=self.contractor,
            public_profile=self.public_profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Pat Customer",
            email=self.customer_email,
            phone="555-111-2222",
            project_address="200 Market St",
            city="Austin",
            state="TX",
            zip_code="78701",
            project_type="Commercial Office Fitout",
            project_description="Commercial office fitout bid from Builder Co.",
            preferred_timeline="Q2",
            budget_text="$22,000",
            status=PublicContractorLead.STATUS_READY_FOR_REVIEW,
        )
        self.comparison_lead_two = PublicContractorLead.objects.create(
            contractor=self.other_contractor,
            public_profile=self.other_public_profile,
            source=PublicContractorLead.SOURCE_DIRECT,
            full_name="Pat Customer",
            email=self.customer_email,
            phone="555-111-2222",
            project_address="200 Market St",
            city="Austin",
            state="TX",
            zip_code="78701",
            project_type="Commercial Office Fitout",
            project_description="Commercial office fitout bid from Partner Co.",
            preferred_timeline="Q2",
            budget_text="$20,500",
            status=PublicContractorLead.STATUS_NEW,
        )

        self.invoice = Invoice.objects.create(
            agreement=self.agreement,
            amount=Decimal("15000.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=timezone.now(),
            platform_fee_cents=75000,
            payout_cents=1425000,
        )
        self.draw = DrawRequest.objects.create(
            agreement=self.agreement,
            draw_number=1,
            title="Progress draw",
            status=DrawRequestStatus.PAID,
            gross_amount=Decimal("12000.00"),
            net_amount=Decimal("11400.00"),
            platform_fee_cents=60000,
            payout_cents=1140000,
            paid_at=timezone.now(),
            released_at=timezone.now(),
            transfer_created_at=timezone.now(),
            stripe_transfer_id="tr_portal_draw",
        )
        self.attachment = AgreementAttachment.objects.create(
            agreement=self.agreement,
            title="Scope Addendum",
            category=AgreementAttachment.CATEGORY_ADDENDUM,
            file=SimpleUploadedFile("scope-addendum.txt", b"Portal document"),
            visible_to_homeowner=True,
        )

    def test_customer_portal_request_link_is_generic_and_sends_email_for_known_customer(self):
        response = self.client.post(
            "/api/projects/customer-portal/request-link/",
            {"email": self.customer_email},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertTrue(response.data["link_sent"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("/portal/", mail.outbox[0].body)
        self.assertIn(self.customer_email, mail.outbox[0].to)

        unknown = self.client.post(
            "/api/projects/customer-portal/request-link/",
            {"email": "nobody@example.com"},
            content_type="application/json",
        )

        self.assertEqual(unknown.status_code, 200)
        self.assertTrue(unknown.data["ok"])
        self.assertFalse(unknown.data["link_sent"])
        self.assertEqual(len(mail.outbox), 1)

    def test_customer_portal_returns_only_customer_owned_records(self):
        token = signing.dumps({"email": self.customer_email}, salt=PORTAL_TOKEN_SALT)
        response = self.client.get(f"/api/projects/customer-portal/{token}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["customer"]["email"], self.customer_email)
        self.assertEqual(response.data["summary"]["active_requests"], 2)
        self.assertEqual(response.data["summary"]["bids_received"], 3)
        self.assertEqual(response.data["summary"]["active_agreements"], 1)
        self.assertEqual(response.data["summary"]["payments"], 2)
        self.assertEqual(response.data["summary"]["documents"], 1)

        request_titles = [row["project_title"] for row in response.data["requests"]]
        bid_titles = [row["project_title"] for row in response.data["bids"]]
        agreement_titles = [row["project_title"] for row in response.data["agreements"]]
        payment_titles = [row["project_title"] for row in response.data["payments"]]
        document_titles = [row["project_title"] for row in response.data["documents"]]

        self.assertTrue(any("commercial remodel" in title.lower() for title in request_titles))
        self.assertTrue(any("office fitout" in title.lower() for title in bid_titles))
        self.assertIn("Kitchen Remodel", agreement_titles)
        self.assertIn("Kitchen Remodel", payment_titles)
        self.assertIn("Kitchen Remodel", document_titles)
        self.assertIn("Office Fitout", request_titles)
        self.assertNotIn("Other Basement", request_titles)
        self.assertNotIn("Other Basement", bid_titles)
        self.assertNotIn("Other Basement", agreement_titles)
        self.assertNotIn("Other Basement", payment_titles)
        self.assertNotIn("Other Basement", document_titles)

        comparison_row = next(row for row in response.data["requests"] if row["project_title"] == "Office Fitout")
        self.assertEqual(comparison_row["bids_count"], 2)
        self.assertEqual(comparison_row["action_label"], "Compare bids")
        self.assertFalse(comparison_row["agreement_token"])

        agreement_row = response.data["agreements"][0]
        self.assertNotIn("detail", agreement_row)
        self.assertNotIn("stripe_account_id", agreement_row)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_customer_portal_comparison_accepts_bid_and_reuses_agreement(self):
        token = signing.dumps({"email": self.customer_email}, salt=PORTAL_TOKEN_SALT)
        self.contractor.phone = "+12105550001"
        self.contractor.save(update_fields=["phone"])
        self.other_contractor.phone = "+12105550003"
        self.other_contractor.save(update_fields=["phone"])
        self.customer_homeowner.phone_number = "+12105550002"
        self.customer_homeowner.save(update_fields=["phone_number"])
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        set_sms_opt_in(
            phone_number=self.other_contractor.phone,
            contractor=self.other_contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        set_sms_opt_in(
            phone_number=self.customer_homeowner.phone_number,
            homeowner=self.customer_homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )

        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(sid=f"SM-{kwargs.get('to', 'unknown')}", status="queued")
            )
        )
        with patch("projects.services.sms_service._twilio_ready", return_value=True), patch(
            "projects.services.sms_service._twilio_client",
            return_value=fake_client,
        ):
            response = self.client.post(
                f"/api/projects/customer-portal/{token}/bids/lead-{self.comparison_lead_one.id}/accept/"
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertTrue(response.data["created"])
        agreement_id = response.data["agreement_id"]
        self.assertIsNotNone(agreement_id)
        self.assertTrue(response.data["detail_url"].startswith("/agreements/magic/"))
        self.assertTrue(response.data["portal"]["summary"]["active_agreements"] >= 2)

        portal = response.data["portal"]
        accepted_bid = next(row for row in portal["bids"] if row["bid_id"] == self.comparison_lead_one.id)
        competing_bid = next(row for row in portal["bids"] if row["bid_id"] == self.comparison_lead_two.id)
        comparison_row = next(row for row in portal["requests"] if row["project_title"] == "Office Fitout")

        self.assertEqual(accepted_bid["status"], "awarded")
        self.assertEqual(accepted_bid["status_label"], "Awarded")
        self.assertTrue(accepted_bid["linked_agreement_token"])
        self.assertEqual(competing_bid["status"], "expired")
        self.assertEqual(competing_bid["status_label"], "Not Selected")
        self.assertEqual(competing_bid["status_note"], "Another contractor was selected for this project.")
        self.assertEqual(comparison_row["action_label"], "Open Agreement")
        self.assertTrue(comparison_row["agreement_token"])

        winner_notifications = Notification.objects.filter(
            contractor=self.contractor,
            public_lead=self.comparison_lead_one,
            event_type=Notification.EVENT_BID_AWARDED,
        )
        competitor_notifications = Notification.objects.filter(
            contractor=self.other_contractor,
            public_lead=self.comparison_lead_two,
            event_type=Notification.EVENT_BID_NOT_SELECTED,
        )

        self.assertEqual(winner_notifications.count(), 1)
        self.assertEqual(competitor_notifications.count(), 1)
        self.assertEqual(len(mail.outbox), 3)
        self.assertEqual(mail.outbox[0].subject, "Your bid was selected on MyHomeBro")
        self.assertEqual(mail.outbox[0].to, [self.contractor_user.email])
        self.assertIn("Open the agreement", mail.outbox[0].body)
        self.assertIn("/app/agreements/", mail.outbox[0].body)
        self.assertEqual(mail.outbox[1].subject, "Your bid was not selected on MyHomeBro")
        self.assertEqual(mail.outbox[1].to, [self.other_contractor_user.email])
        self.assertIn("View your bids", mail.outbox[1].body)
        self.assertEqual(mail.outbox[2].subject, "Your contractor has been selected on MyHomeBro")
        self.assertEqual(mail.outbox[2].to, [self.customer_email])
        self.assertIn("Open Agreement", mail.outbox[2].body)
        self.assertIn("/agreements/magic/", mail.outbox[2].body)
        self.assertEqual(
            ContractorActivityEvent.objects.filter(event_type="sms_sent", agreement_id=agreement_id).count(),
            3,
        )
        self.assertNotIn(
            "unrelated-bid-notify@example.com",
            [recipient for message in mail.outbox for recipient in message.to],
        )

        notify_client = APIClient()
        notify_client.force_authenticate(user=self.contractor_user)
        notifications_response = notify_client.get("/api/notifications/")
        self.assertEqual(notifications_response.status_code, 200)
        self.assertTrue(notifications_response.data)
        self.assertEqual(notifications_response.data[0]["event_type"], Notification.EVENT_BID_AWARDED)
        self.assertEqual(notifications_response.data[0]["public_lead_id"], self.comparison_lead_one.id)
        self.assertEqual(notifications_response.data[0]["action_label"], "Open Agreement")
        self.assertEqual(
            notifications_response.data[0]["action_url"],
            f"/app/agreements/{response.data['agreement_id']}",
        )

        notify_client.force_authenticate(user=self.other_contractor_user)
        other_response = notify_client.get("/api/notifications/")
        self.assertEqual(other_response.status_code, 200)
        self.assertTrue(other_response.data)
        self.assertEqual(other_response.data[0]["event_type"], Notification.EVENT_BID_NOT_SELECTED)
        self.assertEqual(other_response.data[0]["public_lead_id"], self.comparison_lead_two.id)
        self.assertEqual(other_response.data[0]["action_label"], "View Bids")
        self.assertEqual(other_response.data[0]["action_url"], "/app/bids")

        unrelated_user = get_user_model().objects.create_user(
            email="unrelated-bid-notify@example.com",
            password="testpass123",
        )
        unrelated_contractor = Contractor.objects.create(
            user=unrelated_user,
            business_name="Unrelated Bid Notify",
        )
        notify_client.force_authenticate(user=unrelated_user)
        unrelated_response = notify_client.get("/api/notifications/")
        self.assertEqual(unrelated_response.status_code, 200)
        self.assertEqual(unrelated_response.json(), [])
        self.assertEqual(Notification.objects.filter(contractor=unrelated_contractor).count(), 0)

        repeat = self.client.post(f"/api/projects/customer-portal/{token}/bids/lead-{self.comparison_lead_one.id}/accept/")
        self.assertEqual(repeat.status_code, 200)
        self.assertFalse(repeat.data["created"])
        self.assertEqual(repeat.data["agreement_id"], response.data["agreement_id"])
        self.assertEqual(
            Notification.objects.filter(
                contractor=self.contractor,
                public_lead=self.comparison_lead_one,
                event_type=Notification.EVENT_BID_AWARDED,
            ).count(),
            1,
        )
        self.assertEqual(
            Notification.objects.filter(
                contractor=self.other_contractor,
                public_lead=self.comparison_lead_two,
                event_type=Notification.EVENT_BID_NOT_SELECTED,
            ).count(),
            1,
        )
        self.assertEqual(len(mail.outbox), 3)
        self.assertEqual(
            ContractorActivityEvent.objects.filter(event_type="sms_sent", agreement_id=response.data["agreement_id"]).count(),
            3,
        )

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_customer_portal_bid_accept_respects_sms_opt_outs(self):
        token = signing.dumps({"email": self.customer_email}, salt=PORTAL_TOKEN_SALT)
        self.contractor.phone = "+12105550001"
        self.contractor.save(update_fields=["phone"])
        self.other_contractor.phone = "+12105550003"
        self.other_contractor.save(update_fields=["phone"])
        self.customer_homeowner.phone_number = "+12105550002"
        self.customer_homeowner.save(update_fields=["phone_number"])
        set_sms_opt_out(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_OUT_SOURCE_API,
        )
        set_sms_opt_out(
            phone_number=self.customer_homeowner.phone_number,
            homeowner=self.customer_homeowner,
            source=SMSConsent.OPT_OUT_SOURCE_API,
        )
        set_sms_opt_in(
            phone_number=self.other_contractor.phone,
            contractor=self.other_contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )

        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(sid=f"SM-{kwargs.get('to', 'unknown')}", status="queued")
            )
        )
        with patch("projects.services.sms_service._twilio_ready", return_value=True), patch(
            "projects.services.sms_service._twilio_client",
            return_value=fake_client,
        ):
            response = self.client.post(
                f"/api/projects/customer-portal/{token}/bids/lead-{self.comparison_lead_one.id}/accept/"
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_customer_portal_bid_accept_continues_when_sms_delivery_fails(self):
        token = signing.dumps({"email": self.customer_email}, salt=PORTAL_TOKEN_SALT)
        self.contractor.phone = "+12105550001"
        self.contractor.save(update_fields=["phone"])
        self.other_contractor.phone = "+12105550003"
        self.other_contractor.save(update_fields=["phone"])
        self.customer_homeowner.phone_number = "+12105550002"
        self.customer_homeowner.save(update_fields=["phone_number"])
        set_sms_opt_in(
            phone_number=self.contractor.phone,
            contractor=self.contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        set_sms_opt_in(
            phone_number=self.other_contractor.phone,
            contractor=self.other_contractor,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )
        set_sms_opt_in(
            phone_number=self.customer_homeowner.phone_number,
            homeowner=self.customer_homeowner,
            source=SMSConsent.OPT_IN_SOURCE_ADMIN,
        )

        class FailingMessages:
            @staticmethod
            def create(**kwargs):
                raise RuntimeError("twilio unavailable")

        fake_client = SimpleNamespace(messages=FailingMessages())
        with patch("projects.services.sms_service._twilio_ready", return_value=True), patch(
            "projects.services.sms_service._twilio_client",
            return_value=fake_client,
        ):
            response = self.client.post(
                f"/api/projects/customer-portal/{token}/bids/lead-{self.comparison_lead_one.id}/accept/"
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertEqual(
            Notification.objects.filter(
                contractor=self.contractor,
                public_lead=self.comparison_lead_one,
                event_type=Notification.EVENT_BID_AWARDED,
            ).count(),
            1,
        )
        self.assertEqual(
            ContractorActivityEvent.objects.filter(event_type="sms_failed", agreement_id=response.data["agreement_id"]).count(),
            3,
        )

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_customer_portal_bid_accept_continues_when_email_delivery_fails(self):
        token = signing.dumps({"email": self.customer_email}, salt=PORTAL_TOKEN_SALT)
        with patch("projects.services.bid_notifications._send_customer_confirmation_email", side_effect=RuntimeError("smtp down")):
            response = self.client.post(
                f"/api/projects/customer-portal/{token}/bids/lead-{self.comparison_lead_one.id}/accept/"
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertEqual(
            Notification.objects.filter(
                contractor=self.contractor,
                public_lead=self.comparison_lead_one,
                event_type=Notification.EVENT_BID_AWARDED,
            ).count(),
            1,
        )
        self.assertEqual(
            Notification.objects.filter(
                contractor=self.other_contractor,
                public_lead=self.comparison_lead_two,
                event_type=Notification.EVENT_BID_NOT_SELECTED,
            ).count(),
            1,
        )
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[0].subject, "Your bid was selected on MyHomeBro")
        self.assertEqual(mail.outbox[1].subject, "Your bid was not selected on MyHomeBro")

    def test_customer_portal_rejects_other_customer_bid_accept(self):
        token = signing.dumps({"email": self.customer_email}, salt=PORTAL_TOKEN_SALT)
        other_token = signing.dumps({"email": self.other_homeowner.email}, salt=PORTAL_TOKEN_SALT)

        response = self.client.post(
            f"/api/projects/customer-portal/{other_token}/bids/lead-{self.comparison_lead_one.id}/accept/"
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("your own request", response.data["detail"])

    def test_customer_portal_rejects_invalid_token(self):
        response = self.client.get("/api/projects/customer-portal/not-a-valid-token/")

        self.assertEqual(response.status_code, 403)
        self.assertIn("Invalid portal link", response.data["detail"])


class AdminTemplateManagementTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_superuser(
            email="admin-template-manager@example.com",
            password="testpass123",
        )
        contractor_user = user_model.objects.create_user(
            email="admin-template-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=contractor_user,
            business_name="Contractor Library",
            city="Austin",
            state="TX",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin_user)

        self.contractor_template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Contractor Shed Template",
            project_type="Outdoor",
            project_subtype="Shed Build",
            description="Contractor-owned shed template.",
            default_scope="Contractor-owned shed template.",
            visibility=ProjectTemplate.Visibility.PRIVATE,
            allow_discovery=False,
        )
        self.contractor_template.milestones.create(
            title="Prep",
            description="Prepare site.",
            sort_order=1,
            start_offset=0,
            duration_days=2,
            recommended_days_from_start=1,
            recommended_duration_days=2,
        )
        self.system_template = ProjectTemplate.objects.create(
            name="System Shed Template",
            project_type="Outdoor",
            project_subtype="Shed Build",
            description="System shed starter.",
            default_scope="System shed starter.",
            is_system=True,
            is_system_template=True,
            is_published=True,
            visibility=ProjectTemplate.Visibility.SYSTEM,
            allow_discovery=True,
            published_by=self.admin_user,
            published_at=timezone.now(),
        )

    def test_admin_lists_all_templates_and_filters_system(self):
        response = self.client.get("/api/projects/templates/", {"source": "all", "q": "shed"})
        self.assertEqual(response.status_code, 200, response.data)
        names = {row["name"] for row in response.data}
        self.assertIn(self.contractor_template.name, names)
        self.assertIn(self.system_template.name, names)

        system_response = self.client.get("/api/projects/templates/", {"source": "system"})
        self.assertEqual(system_response.status_code, 200, system_response.data)
        system_names = {row["name"] for row in system_response.data}
        self.assertIn(self.system_template.name, system_names)
        self.assertNotIn(self.contractor_template.name, system_names)

    def test_admin_can_create_publish_and_duplicate_system_template(self):
        create_response = self.client.post(
            "/api/projects/templates/",
            {
                "name": "Admin System Template Draft",
                "project_type": "Outdoor",
                "project_subtype": "Shed Build",
                "description": "Admin system draft.",
                "default_scope": "Admin system draft.",
                "is_system": True,
                "milestones": [
                    {
                        "title": "Site prep",
                        "description": "Prepare site.",
                        "sort_order": 1,
                        "start_offset": 0,
                        "duration_days": 2,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        created = ProjectTemplate.objects.get(pk=create_response.data["id"])
        self.assertTrue(created.is_system_template)
        self.assertTrue(created.is_system)
        self.assertEqual(created.visibility, ProjectTemplate.Visibility.SYSTEM)
        self.assertFalse(created.allow_discovery)

        publish_response = self.client.patch(
            f"/api/projects/templates/{created.id}/",
            {"is_published": True},
            format="json",
        )
        self.assertEqual(publish_response.status_code, 200, publish_response.data)
        created.refresh_from_db()
        self.assertTrue(created.is_published)
        self.assertTrue(created.allow_discovery)
        self.assertEqual(created.published_by_id, self.admin_user.id)

        duplicate_response = self.client.post(
            "/api/projects/templates/",
            {
                "source_template_id": self.contractor_template.id,
                "name": "Admin Copy of Contractor Template",
                "is_system": True,
            },
            format="json",
        )
        self.assertEqual(duplicate_response.status_code, 201, duplicate_response.data)
        duplicated = ProjectTemplate.objects.get(pk=duplicate_response.data["id"])
        self.assertTrue(duplicated.is_system_template)
        self.assertTrue(duplicated.is_system)
        self.assertIsNone(duplicated.contractor_id)
        self.assertEqual(duplicated.source_system_template_id, None)
        self.assertEqual(duplicated.name, "Admin Copy of Contractor Template")


class AdminGeoTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_superuser(
            email="admin-geo@example.com",
            password="testpass123",
        )
        contractor_user = user_model.objects.create_user(
            email="geo-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=contractor_user,
            business_name="Geo Contractor",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Geo Homeowner",
            email="geo-homeowner@example.com",
            city="Austin",
            state="Texas",
            zip_code="78701-1234",
        )
        self.geo_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Geo Enabled Project",
            project_city="Austin",
            project_state="Texas",
            project_zip_code="78701-1234",
        )
        self.geo_agreement = Agreement.objects.create(
            project=self.geo_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Geo agreement",
            project_type="Outdoor",
            project_subtype="Shed Build",
        )
        self.missing_project = Project.objects.create(
            contractor=self.contractor,
            title="Missing Geo Project",
        )
        self.missing_agreement = Agreement.objects.create(
            project=self.missing_project,
            contractor=self.contractor,
            description="Missing geo agreement",
            project_type="Outdoor",
            project_subtype="Shed Build",
        )
        self.invoice = Invoice.objects.create(
            agreement=self.geo_agreement,
            amount=Decimal("200.00"),
            status=InvoiceStatus.PAID,
            escrow_released=True,
            escrow_released_at=timezone.now(),
            stripe_payment_intent_id="pi_geo_001",
            platform_fee_cents=3500,
        )
        Receipt.objects.create(
            invoice=self.invoice,
            agreement=self.geo_agreement,
            receipt_number="R-ADMIN-GEO-001",
            stripe_payment_intent_id="pi_geo_001",
            stripe_charge_id="ch_geo_001",
            amount_paid_cents=20000,
            platform_fee_cents=3500,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin_user)

    def test_admin_geo_returns_state_city_zip_and_debug_counts(self):
        response = self.client.get("/api/projects/admin/geo/")

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()

        self.assertEqual(payload["total_agreements_l12m"], 2)
        self.assertEqual(payload["agreements_with_geo"], 1)
        self.assertEqual(payload["agreements_missing_geo"], 1)
        self.assertEqual(payload["receipts_l12m"], 1)
        self.assertEqual(payload["receipts_with_geo"], 1)
        self.assertEqual(payload["receipts_missing_geo"], 0)
        self.assertGreaterEqual(len(payload["missing_geo_samples"]), 1)

        states = {row["state"] for row in payload["states"]}
        self.assertIn("TX", states)

        tx_cities = payload["cities_by_state"].get("TX", [])
        tx_zips = payload["zips_by_state"].get("TX", [])
        self.assertTrue(any(row["city"] == "Austin" for row in tx_cities))
        self.assertTrue(any(row["zip"] == "78701" for row in tx_zips))

        tx_state = next(row for row in payload["states"] if row["state"] == "TX")
        self.assertEqual(tx_state["agreements"], 1)
        self.assertEqual(tx_state["fees"], "35.00")
        self.assertEqual(tx_state["escrow"], "0.00")

    def test_admin_geo_missing_project_geo_does_not_crash(self):
        response = self.client.get("/api/projects/admin/geo/")

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["agreements_missing_geo"], 1)
        self.assertEqual(payload["receipts_missing_geo"], 0)
        self.assertTrue(
            any(sample["agreement_id"] == self.missing_agreement.id for sample in payload["missing_geo_samples"])
        )

    def test_admin_overview_uses_active_dispute_count_and_dispute_filters(self):
        active_dispute = Dispute.objects.create(
            agreement=self.geo_agreement,
            initiator="homeowner",
            reason="Needs review",
            description="Active dispute for attention count coverage.",
            status="open",
            fee_amount=Decimal("10.00"),
        )
        Dispute.objects.create(
            agreement=self.geo_agreement,
            initiator="contractor",
            reason="Resolved issue",
            description="Resolved dispute should not count toward attention.",
            status="resolved_contractor",
            fee_amount=Decimal("12.00"),
        )

        response = self.client.get("/api/projects/admin/overview/")
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["summary"]["open_disputes"], 1)

        active_response = self.client.get("/api/projects/admin/disputes/?status=active")
        self.assertEqual(active_response.status_code, 200, active_response.data)
        active_payload = active_response.json()
        self.assertEqual(active_payload["count"], 1)
        self.assertEqual(active_payload["results"][0]["id"], active_dispute.id)
        self.assertEqual(active_payload["filter_label"], "Active disputes")

        all_response = self.client.get("/api/projects/admin/disputes/?status=all")
        self.assertEqual(all_response.status_code, 200, all_response.data)
        all_payload = all_response.json()
        self.assertEqual(all_payload["count"], 2)
        self.assertEqual(all_payload["filter_label"], "All disputes")

    def test_admin_agreements_support_escrow_in_flight_filter(self):
        self.geo_agreement.escrow_funded_amount = Decimal("400.00")
        self.geo_agreement.save(update_fields=["escrow_funded_amount"])

        response = self.client.get("/api/projects/admin/overview/")
        self.assertEqual(response.status_code, 200, response.data)
        overview = response.json()
        self.assertEqual(overview["money"]["escrow_in_flight_total"], "200.00")

        agreements_response = self.client.get("/api/projects/admin/agreements/?escrow_status=in_flight")
        self.assertEqual(agreements_response.status_code, 200, agreements_response.data)
        agreements_payload = agreements_response.json()
        self.assertEqual(agreements_payload["count"], 1)
        self.assertEqual(agreements_payload["filter_label"], "Escrow in flight")
        self.assertEqual(agreements_payload["results"][0]["id"], self.geo_agreement.id)
        self.assertEqual(agreements_payload["results"][0]["escrow_status"], "in_flight")


class DisputeMutationSafetyTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="dispute-contractor@example.com",
            password="testpass123",
        )
        self.admin_user = user_model.objects.create_superuser(
            email="dispute-admin@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Dispute Contractor",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Dispute Homeowner",
            email="dispute-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Dispute Safety Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Dispute safety agreement",
        )
        self.terminal_dispute = Dispute.objects.create(
            agreement=self.agreement,
            initiator="contractor",
            reason="Closed dispute",
            description="Terminal dispute for mutation safety.",
            status="closed",
            fee_amount=Decimal("12.00"),
            fee_paid=True,
            escrow_frozen=False,
        )
        self.contractor_client = APIClient()
        self.contractor_client.force_authenticate(user=self.contractor_user)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin_user)

    def test_terminal_dispute_status_helper_covers_closed_aliases(self):
        from projects.services.dispute_status import is_terminal_dispute_status

        self.assertTrue(is_terminal_dispute_status("resolved_contractor"))
        self.assertTrue(is_terminal_dispute_status("resolved_customer"))
        self.assertTrue(is_terminal_dispute_status("closed"))
        self.assertTrue(is_terminal_dispute_status("cancelled"))
        self.assertFalse(is_terminal_dispute_status("open"))

    def test_terminal_dispute_rejects_mutations(self):
        attachment = SimpleUploadedFile("evidence.txt", b"terminal dispute evidence")

        respond = self.contractor_client.patch(
            f"/api/projects/disputes/{self.terminal_dispute.id}/respond/",
            {"response": "This should not be accepted."},
            format="json",
        )
        cancel = self.contractor_client.patch(
            f"/api/projects/disputes/{self.terminal_dispute.id}/cancel/",
            {},
            format="json",
        )
        upload = self.contractor_client.post(
            f"/api/projects/disputes/{self.terminal_dispute.id}/attachments/",
            {"file": attachment, "kind": "photo"},
            format="multipart",
        )
        resolve = self.admin_client.post(
            f"/api/projects/disputes/{self.terminal_dispute.id}/resolve/",
            {"outcome": "contractor", "admin_notes": "Should fail."},
            format="json",
        )

        for response in (respond, cancel, upload, resolve):
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(str(response.data["detail"]), "This dispute is resolved and can no longer be modified.")

    def test_terminal_dispute_can_be_archived_and_hidden_by_default(self):
        archive_response = self.contractor_client.post(
            f"/api/projects/disputes/{self.terminal_dispute.id}/archive/",
            {},
            format="json",
        )
        self.assertEqual(archive_response.status_code, 200, archive_response.data)
        self.terminal_dispute.refresh_from_db()
        self.assertTrue(self.terminal_dispute.is_archived)

        default_list = self.contractor_client.get("/api/projects/disputes/?mine=true")
        self.assertEqual(default_list.status_code, 200, default_list.data)
        default_payload = default_list.json()
        self.assertTrue(all(not row.get("is_archived") for row in default_payload))
        self.assertFalse(any(row["id"] == self.terminal_dispute.id for row in default_payload))

        include_archived = self.contractor_client.get("/api/projects/disputes/?mine=true&include_archived=1")
        self.assertEqual(include_archived.status_code, 200, include_archived.data)
        archived_payload = include_archived.json()
        self.assertTrue(any(row["id"] == self.terminal_dispute.id and row.get("is_archived") for row in archived_payload))

        admin_list = self.admin_client.get("/api/projects/admin/disputes/?status=all&include_archived=1")
        self.assertEqual(admin_list.status_code, 200, admin_list.data)
        admin_payload = admin_list.json()
        self.assertTrue(any(row["id"] == self.terminal_dispute.id and row.get("is_archived") for row in admin_payload["results"]))

    def test_active_dispute_cannot_be_archived(self):
        active_dispute = Dispute.objects.create(
            agreement=self.agreement,
            initiator="homeowner",
            reason="Active dispute",
            description="Active dispute should not archive.",
            status="open",
            fee_amount=Decimal("10.00"),
            fee_paid=True,
            escrow_frozen=True,
        )

        response = self.contractor_client.post(
            f"/api/projects/disputes/{active_dispute.id}/archive/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("Only terminal disputes can be archived.", str(response.data["detail"]))


class TemplateAIGenerationTests(TestCase):
    def test_create_template_from_scope_returns_structured_guidance_bundle(self):
        from projects.ai.template_builder import create_template_from_scope

        fake_payload = {
            "name": "Kitchen Remodel Starter",
            "project_type": "Remodel",
            "project_subtype": "Kitchen Remodel",
            "description_scope": "Scope of Work\nWork includes a reusable kitchen remodel scope.\n\nIncluded Work Phases\n- Planning\n- Demo\n- Install\n\nOptional Components\n- May include appliance upgrades when specified.",
            "assumptions": "Customer Responsibilities\n- Customer will confirm selections.\n\nContractor Responsibilities\n- Contractor will verify measurements.",
            "exclusions": "Exclusions\n- The following are not included unless explicitly added:\n- Structural changes\n- Permits",
            "description": "Scope of Work\nWork includes a reusable kitchen remodel scope.\n\nIncluded Work Phases\n- Planning\n- Demo\n- Install\n\nOptional Components\n- May include appliance upgrades when specified.",
            "estimated_days": 14,
            "project_materials_hint": "Cabinetry, trim, fasteners, sealant, cleanup materials.",
            "pricing": {
                "total_range": "$18,000-$28,000",
                "milestone_percentages": [
                    {
                        "milestone": "Planning & site protection",
                        "percentage": "15%",
                        "notes": "Mobilization and protection.",
                    },
                    {
                        "milestone": "Demolition & rough prep",
                        "percentage": "35%",
                        "notes": "Demo and prep work.",
                    },
                ],
            },
            "materials": [
                {
                    "category": "Project Materials",
                    "options": ["Cabinetry", "Trim", "Fasteners", "Sealant"],
                    "notes": "Use cabinet-grade materials and finish supplies.",
                }
            ],
            "timeline": "About 14 working days",
            "clarification_questions": [
                "Confirm access to the property",
                "Are material selections already made?",
            ],
            "default_clarifications": [
                {
                    "key": "access",
                    "label": "Confirm access to the property",
                    "type": "text",
                    "required": False,
                    "options": [],
                    "help": "Confirm access and site readiness.",
                }
            ],
            "milestones": [
                {
                    "title": "Planning & site protection",
                    "description": "Confirm scope and protect the work area.",
                    "sort_order": 1,
                    "normalized_milestone_type": "site_prep",
                    "suggested_amount_fixed": 2500,
                    "suggested_amount_low": 2000,
                    "suggested_amount_high": 3000,
                    "pricing_confidence": "medium",
                    "pricing_source_note": "Based on typical planning and setup effort.",
                    "payment_guidance": "Use an initial deposit to cover setup and mobilization.",
                    "notes": "Do not start demolition until selections are confirmed.",
                    "recommended_days_from_start": 0,
                    "recommended_duration_days": 2,
                    "materials_hint": "Protection materials and basic setup supplies.",
                    "is_optional": False,
                }
            ],
        }

        fake_client = SimpleNamespace(
            responses=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(output_text=json.dumps(fake_payload))
            )
        )

        with patch("projects.ai.template_builder._require_openai_client", return_value=fake_client), patch(
            "projects.ai.template_builder._model_name",
            return_value="test-model",
        ):
            result = create_template_from_scope(
                name="Kitchen Remodel Starter",
                project_type="Remodel",
                project_subtype="Kitchen Remodel",
                description="Kitchen remodel with planning, install, and closeout.",
            )

        self.assertEqual(result["description_scope"], fake_payload["description_scope"])
        self.assertEqual(result["assumptions"], fake_payload["assumptions"])
        self.assertEqual(result["exclusions"], fake_payload["exclusions"])
        self.assertEqual(result["description"], fake_payload["description_scope"])
        self.assertEqual(result["default_scope"], fake_payload["description_scope"])
        self.assertEqual(result["assumptions_text"], fake_payload["assumptions"])
        self.assertEqual(result["exclusions_text"], fake_payload["exclusions"])
        self.assertEqual(result["timeline"], "About 14 working days")
        self.assertEqual(result["pricing"]["total_range"], "$18,000-$28,000")
        self.assertEqual(result["pricing"]["milestone_percentages"][0]["milestone"], "Planning & site protection")
        self.assertEqual(result["materials"][0]["category"], "Project Materials")
        self.assertEqual(result["clarification_questions"], fake_payload["clarification_questions"])
        self.assertTrue(result["default_clarifications"])
        self.assertIn("insights", result)
        self.assertEqual(result["insights"]["milestone_count"]["value"], 1)
        self.assertEqual(result["insights"]["milestone_count"]["typical_range"], [1, 2])
        self.assertEqual(result["insights"]["timeline"]["value"], "About 14 working days")
        self.assertEqual(result["insights"]["pricing"]["range"], "$18,000-$28,000")
        self.assertTrue(result["insights"]["completeness"]["has_pricing"])
        self.assertTrue(result["insights"]["completeness"]["has_materials"])
        self.assertTrue(result["insights"]["completeness"]["has_clarifications"])
        self.assertEqual(result["milestones"][0]["payment_guidance"], "Use an initial deposit to cover setup and mobilization.")
        self.assertEqual(result["milestones"][0]["notes"], "Do not start demolition until selections are confirmed.")

    def test_create_template_from_scope_splits_combined_scope_when_ai_returns_one_block(self):
        from projects.ai.template_builder import create_template_from_scope

        combined_payload = {
            "name": "Shed Build Starter",
            "project_type": "Outdoor",
            "project_subtype": "Shed Build",
            "description": (
                "Scope of Work\nWork includes construction of an exterior shed structure.\n\n"
                "Included Work Phases\n- Site preparation\n- Foundation setup\n- Framing\n\n"
                "Optional Components\n- May include doors and windows when specified.\n\n"
                "Customer Responsibilities\n- Customer will confirm selections.\n\n"
                "Contractor Responsibilities\n- Contractor will verify site conditions.\n\n"
                "Exclusions\n- The following are not included unless explicitly added:\n- Electrical\n- Plumbing"
            ),
            "estimated_days": 10,
            "project_materials_hint": "Framing lumber, sheathing, roofing, fasteners.",
            "pricing": {"total_range": "Consult contractor for pricing", "milestone_percentages": []},
            "materials": [],
            "timeline": "About 10 working days",
            "clarification_questions": [],
            "default_clarifications": [],
            "milestones": [],
        }

        fake_client = SimpleNamespace(
            responses=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(output_text=json.dumps(combined_payload))
            )
        )

        with patch("projects.ai.template_builder._require_openai_client", return_value=fake_client), patch(
            "projects.ai.template_builder._model_name",
            return_value="test-model",
        ):
            result = create_template_from_scope(
                name="Shed Build Starter",
                project_type="Outdoor",
                project_subtype="Shed Build",
                description="Backyard shed build scope.",
            )

        self.assertIn("Scope of Work", result["description_scope"])
        self.assertIn("Included Work Phases", result["description_scope"])
        self.assertNotIn("Exclusions", result["description_scope"])
        self.assertIn("Customer Responsibilities", result["assumptions"])
        self.assertIn("Contractor Responsibilities", result["assumptions"])
        self.assertIn("The following are not included unless explicitly added", result["exclusions"])
        self.assertNotIn("Customer Responsibilities", result["description_scope"])
        self.assertNotIn("Contractor Responsibilities", result["description_scope"])

    def test_create_template_from_scope_falls_back_when_ai_times_out(self):
        from projects.ai.template_builder import create_template_from_scope

        def raise_timeout(**kwargs):
            raise RuntimeError("AI timed out")

        fake_client = SimpleNamespace(
            responses=SimpleNamespace(
                create=raise_timeout,
            )
        )

        with patch("projects.ai.template_builder._require_openai_client", return_value=fake_client), patch(
            "projects.ai.template_builder._model_name",
            return_value="test-model",
        ):
            result = create_template_from_scope(
                name="Kitchen Remodel Starter",
                project_type="Remodel",
                project_subtype="Kitchen Remodel",
                description="Kitchen remodel with planning, install, and closeout.",
            )

        self.assertTrue(result["_partial"])
        self.assertEqual(result["_generation_status"]["description"], "fallback")
        self.assertEqual(result["_generation_status"]["milestones"], "fallback")
        self.assertEqual(result["_generation_status"]["pricing"], "fallback")
        self.assertEqual(result["_generation_status"]["materials"], "fallback")
        self.assertEqual(result["_generation_status"]["clarifications"], "fallback")
        self.assertTrue(result["milestones"])
        self.assertTrue(result["pricing"]["milestone_percentages"])
        self.assertTrue(result["materials"])
        self.assertTrue(result["default_clarifications"])
        self.assertIn("insights", result)
        self.assertIn("milestone_count", result["insights"])
        self.assertIn("timeline", result["insights"])
        self.assertIn("pricing", result["insights"])
        self.assertIn("completeness", result["insights"])


class TemplateAIPermissionGateTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="template-ai-contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Template AI Contractor",
        )
        self.admin_user = user_model.objects.create_superuser(
            email="template-ai-admin@example.com",
            password="testpass123",
        )
        self.normal_user = user_model.objects.create_user(
            email="template-ai-user@example.com",
            password="testpass123",
        )
        self.contractor_client = APIClient()
        self.contractor_client.force_authenticate(user=self.contractor_user)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin_user)
        self.normal_client = APIClient()
        self.normal_client.force_authenticate(user=self.normal_user)

    def test_template_ai_create_from_scope_allows_contractor_and_admin(self):
        path = "/api/projects/templates/ai/create-from-scope/"
        payload = {
            "name": "Template AI Test",
            "project_type": "Outdoor",
            "project_subtype": "Shed Build",
            "description": "Backyard shed build scope.",
        }

        with patch(
            "projects.views.template_views.create_template_from_scope",
            return_value={"description_scope": "ok", "assumptions": "", "exclusions": "", "milestones": []},
        ):
            contractor_response = self.contractor_client.post(path, payload, format="json")
            admin_response = self.admin_client.post(path, payload, format="json")
            normal_response = self.normal_client.post(path, payload, format="json")

        self.assertEqual(contractor_response.status_code, 200, contractor_response.data)
        self.assertEqual(admin_response.status_code, 200, admin_response.data)
        self.assertEqual(normal_response.status_code, 403, normal_response.data)
        self.assertEqual(
            str(normal_response.data["detail"]),
            "AI tools are available to contractors and admins",
        )

    def test_template_ai_generate_materials_allows_contractor_and_admin(self):
        path = "/api/projects/templates/ai/generate-materials/"
        payload = {
            "name": "Template AI Test",
            "project_type": "Outdoor",
            "project_subtype": "Shed Build",
            "description": "Backyard shed build scope.",
            "milestones": [{"title": "Site prep", "description": "Prep the site."}],
        }

        with patch(
            "projects.views_template.generate_materials_from_scope",
            return_value={"milestones": [], "project_materials_hint": "Framing lumber, fasteners."},
        ):
            contractor_response = self.contractor_client.post(path, payload, format="json")
            admin_response = self.admin_client.post(path, payload, format="json")
            normal_response = self.normal_client.post(path, payload, format="json")

        self.assertEqual(contractor_response.status_code, 200, contractor_response.data)
        self.assertEqual(admin_response.status_code, 200, admin_response.data)
        self.assertEqual(normal_response.status_code, 403, normal_response.data)
        self.assertEqual(
            str(normal_response.data["detail"]),
            "AI tools are available to contractors and admins",
        )


from .support_ticket_tests import SupportTicketTests  # noqa: E402,F401
