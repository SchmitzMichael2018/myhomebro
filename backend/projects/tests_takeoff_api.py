from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Capture,
    Contractor,
    Homeowner,
    MaterialLibraryItem,
    MeasurementCalculatedResult,
    MeasurementSession,
    Project,
    ProposalLineItem,
    TakeoffItem,
    TakeoffSession,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    TAKEOFF_ENABLED=True,
    TAKEOFF_ESTIMATE_HANDOFF_ENABLED=False,
    TAKEOFF_PRICE_STALE_DAYS=90,
)
class TakeoffApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="takeoff@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Takeoff Builders")
        self.customer = Homeowner.objects.create(created_by=self.contractor, full_name="Owner", email="owner@example.com")
        self.project = Project.objects.create(contractor=self.contractor, homeowner=self.customer, title="Floor")
        capture = Capture.objects.create(
            contractor=self.contractor, captured_by=self.user, capture_type="measurement",
            project=self.project, customer=self.customer, status="applied",
        )
        self.measurement = MeasurementSession.objects.create(
            contractor=self.contractor, project=self.project, customer=self.customer,
            room_name="Living Room", purpose="flooring", guided_profile="rectangular_room",
            captured_by=self.user, source_capture=capture, status="verified",
        )
        self.result = MeasurementCalculatedResult.objects.create(
            session=self.measurement, result_type="net_area", label="Net area",
            normalized_value=Decimal("27590.4"), normalized_unit="square_inches",
            display_value="191.60", display_unit="square_feet",
            formula_key="area.net.v1", source_entry_keys=["length", "width"],
            verification_status="verified", lineage={},
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.material_payload = {
            "name": "Oak Flooring", "category": "flooring", "unit_price": "67.18",
            "price_basis": "per_selling_unit", "selling_unit": "box",
            "package_quantity": "1", "coverage_quantity": "22.4",
            "coverage_unit": "square_feet", "waste_default": "10",
            "markup_default": "0", "price_source": "Manual supplier quote",
            "price_effective_date": date.today().isoformat(),
        }

    def create_material(self):
        response = self.client.post("/api/projects/materials/", self.material_payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return MaterialLibraryItem.objects.get(pk=response.data["id"])

    def create_takeoff(self, material=None, **overrides):
        material = material or self.create_material()
        payload = {
            "measurement_session_id": self.measurement.id,
            "measurement_result_id": self.result.id,
            "trade_profile": "flooring", "material_id": material.id,
            "waste_percentage": "10", "tax_rate": "0", "markup_rate": "0",
        }
        payload.update(overrides)
        return self.client.post("/api/projects/takeoffs/", payload, format="json")

    def test_material_crud_stale_price_and_scope(self):
        material = self.create_material()
        update = self.client.patch(
            f"/api/projects/materials/{material.id}/",
            {"unit_price": "70.00", "is_preferred": True, "price_effective_date": (date.today() - timedelta(days=100)).isoformat()},
            format="json",
        )
        self.assertEqual(update.status_code, 200)
        self.assertTrue(update.data["price_is_stale"])
        self.assertEqual(update.data["price_entered_by"], self.user.id)
        other_user = get_user_model().objects.create_user(email="other@example.com", password="test")
        Contractor.objects.create(user=other_user, business_name="Other")
        self.client.force_authenticate(other_user)
        self.assertEqual(self.client.patch(f"/api/projects/materials/{material.id}/", {"is_active": False}, format="json").status_code, 404)

    def test_verified_takeoff_confirm_snapshot_revision_and_preview_never_mutates_estimate(self):
        material = self.create_material()
        create = self.create_takeoff(material)
        self.assertEqual(create.status_code, 201, create.data)
        session = TakeoffSession.objects.get(pk=create.data["id"])
        original_snapshot = TakeoffItem.objects.get(session=session).product_snapshot
        material.unit_price = Decimal("99")
        material.save()
        self.assertEqual(TakeoffItem.objects.get(session=session).product_snapshot, original_snapshot)
        revise = self.client.patch(
            f"/api/projects/takeoffs/{session.id}/",
            {"expected_version": 1, "waste_percentage": "12", "markup_rate": "5"},
            format="json",
        )
        self.assertEqual(revise.status_code, 200, revise.data)
        self.assertEqual(revise.data["version"], 2)
        self.assertEqual(TakeoffItem.objects.filter(session=session).count(), 2)
        confirm = self.client.post(
            f"/api/projects/takeoffs/{session.id}/confirm/",
            {"expected_version": 2}, format="json",
        )
        self.assertEqual(confirm.status_code, 200, confirm.data)
        preview = self.client.post(f"/api/projects/takeoffs/{session.id}/estimate-preview/", {}, format="json")
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertTrue(preview.data["preview_only"])
        self.assertEqual(ProposalLineItem.objects.count(), 0)

    def test_provisional_requires_acknowledgement_and_cannot_confirm_or_preview(self):
        self.result.verification_status = "estimated"
        self.result.save()
        rejected = self.create_takeoff()
        self.assertEqual(rejected.status_code, 400)
        material = MaterialLibraryItem.objects.first()
        create = self.create_takeoff(material, acknowledge_provisional=True)
        self.assertEqual(create.status_code, 201)
        self.assertTrue(create.data["provisional"])
        confirm = self.client.post(
            f"/api/projects/takeoffs/{create.data['id']}/confirm/",
            {"expected_version": 1}, format="json",
        )
        self.assertEqual(confirm.status_code, 400)
        preview = self.client.post(f"/api/projects/takeoffs/{create.data['id']}/estimate-preview/", {}, format="json")
        self.assertEqual(preview.status_code, 400)

    def test_stale_version_and_cross_contractor_material_are_rejected(self):
        create = self.create_takeoff()
        self.assertEqual(create.status_code, 201)
        stale = self.client.patch(
            f"/api/projects/takeoffs/{create.data['id']}/",
            {"expected_version": 0, "waste_percentage": "5"}, format="json",
        )
        self.assertEqual(stale.status_code, 409)
        other_user = get_user_model().objects.create_user(email="other2@example.com", password="test")
        other = Contractor.objects.create(user=other_user, business_name="Other Two")
        foreign = MaterialLibraryItem.objects.create(
            contractor=other, name="Foreign", category="flooring", unit_price=1,
            price_basis="per_selling_unit", selling_unit="box", package_quantity=1,
            coverage_quantity=1, coverage_unit="square_feet", price_source="Manual",
            price_effective_date=date.today(), price_entered_by=other_user,
        )
        response = self.create_takeoff(foreign)
        self.assertEqual(response.status_code, 404)

    @override_settings(TAKEOFF_ENABLED=False)
    def test_feature_disabled_fails_closed(self):
        self.assertEqual(self.client.get("/api/projects/materials/").status_code, 404)
        self.assertEqual(self.client.get("/api/projects/takeoffs/").status_code, 404)
