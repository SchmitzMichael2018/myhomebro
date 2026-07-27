import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from projects.models import Capture, Contractor, Homeowner, MeasurementCalculatedResult, MeasurementSession, PhotoMeasurementDocument, Project, ProposalMeasurement


@override_settings(SECURE_SSL_REDIRECT=False, CAPTURE_MEASUREMENT_ENABLED=True, MEASUREMENT_PHOTO_ASSISTED_ENABLED=True)
class PhotoMeasurementApiTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(email="photo-measure@example.com",password="test")
        self.contractor=Contractor.objects.create(user=self.user,business_name="Photo Builders")
        customer=Homeowner.objects.create(created_by=self.contractor,full_name="Customer",email="photo-customer@example.com")
        self.project=Project.objects.create(contractor=self.contractor,homeowner=customer,title="Photo Project")
        capture=Capture.objects.create(contractor=self.contractor,captured_by=self.user,capture_type="measurement",capture_method="camera",raw_text_payload={},status=Capture.STATUS_APPLIED)
        self.session=MeasurementSession.objects.create(contractor=self.contractor,project=self.project,room_name="Room",captured_by=self.user,source_capture=capture)
        self.client=APIClient(); self.client.force_authenticate(self.user)

    def image(self, orientation=6):
        output=io.BytesIO(); image=Image.new("RGB",(800,600),"white"); exif=image.getexif(); exif[274]=orientation; exif[34853]={1:"removed"}
        image.save(output,format="JPEG",exif=exif)
        return SimpleUploadedFile("room.jpg",output.getvalue(),content_type="image/jpeg")

    def document(self):
        response=self.client.post("/api/projects/measurement-photo-documents/",{"measurement_session":self.session.id,"file":self.image()},format="multipart")
        self.assertEqual(response.status_code,201,response.data); return response.data

    def calibration(self, document, attested=True):
        response=self.client.post(f"/api/projects/measurement-photo-documents/{document['id']}/calibrations/",{"reference_geometry":{"points":[{"x":"0.1","y":"0.2"},{"x":"0.5","y":"0.2"}]},"known_length":"4","unit":"feet","same_plane_attested":attested,"expected_document_version":document["version"]},format="json")
        return response

    def test_orientation_calibration_annotation_and_proposal(self):
        document=self.document()
        self.assertEqual((document["normalized_width"],document["normalized_height"]),(600,800))
        self.assertEqual(document["orientation_transform"],"rotate_90_cw")
        calibration=self.calibration(document); self.assertEqual(calibration.status_code,201,calibration.data)
        annotation=self.client.post(f"/api/projects/measurement-photo-documents/{document['id']}/annotations/",{"calibration_id":calibration.data["id"],"geometry_type":"line","geometry":{"points":[{"x":"0.1","y":"0.4"},{"x":"0.5","y":"0.4"}]},"label":"Wall","category":"walls","expected_document_version":2},format="json")
        self.assertEqual(annotation.status_code,201,annotation.data)
        proposal=self.client.post(f"/api/projects/measurement-photo-annotations/{annotation.data['id']}/create-proposal/",{},format="json")
        self.assertEqual(proposal.status_code,200,proposal.data)
        result=MeasurementCalculatedResult.objects.get(pk=proposal.data["measurement_result_id"])
        self.assertEqual(result.lineage["provider"],"photo_reference")
        self.assertTrue(result.lineage["same_plane_attested"])
        self.assertEqual(ProposalMeasurement.objects.count(),0)

    def test_same_plane_signature_limits_and_cross_contractor(self):
        document=self.document()
        self.assertEqual(self.calibration(document,False).status_code,400)
        bad=SimpleUploadedFile("fake.jpg",b"not-an-image",content_type="image/jpeg")
        self.assertEqual(self.client.post("/api/projects/measurement-photo-documents/",{"measurement_session":self.session.id,"file":bad},format="multipart").status_code,400)
        other=get_user_model().objects.create_user(email="photo-other@example.com",password="test"); Contractor.objects.create(user=other,business_name="Other")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(f"/api/projects/measurement-photo-documents/{document['id']}/").status_code,404)
        self.assertEqual(self.client.get(f"/api/projects/measurement-photo-documents/{document['id']}/image/").status_code,404)

    @override_settings(MEASUREMENT_PHOTO_ASSISTED_ENABLED=False)
    def test_feature_disabled_fails_closed(self):
        response=self.client.get("/api/projects/measurement-photo-documents/",{"measurement_session":self.session.id})
        self.assertEqual(response.status_code,404); self.assertEqual(response.data["code"],"feature_disabled")

    def test_repeat_variance_downgrades_confidence(self):
        document=self.document(); calibration=self.calibration(document).data
        first=self.client.post(f"/api/projects/measurement-photo-documents/{document['id']}/annotations/",{"calibration_id":calibration["id"],"geometry_type":"line","geometry":{"points":[{"x":".1","y":".4"},{"x":".5","y":".4"}]},"label":"Wall","repeat_group":"wall-a","expected_document_version":2},format="json")
        second=self.client.post(f"/api/projects/measurement-photo-documents/{document['id']}/annotations/",{"calibration_id":calibration["id"],"geometry_type":"line","geometry":{"points":[{"x":".1","y":".5"},{"x":".8","y":".5"}]},"label":"Wall repeat","repeat_group":"wall-a","expected_document_version":3},format="json")
        self.assertEqual(first.status_code,201); self.assertEqual(second.status_code,201,second.data)
        self.assertEqual(second.data["confidence"],"low")
        self.assertTrue(second.data["repeat_statistics"]["variance_warning"])
        self.assertEqual(self.client.post(f"/api/projects/measurement-photo-annotations/{second.data['id']}/create-proposal/",{},format="json").status_code,400)

    def test_revision_preserves_history_and_calibration_can_be_invalidated(self):
        document=self.document(); calibration=self.calibration(document).data
        annotation=self.client.post(f"/api/projects/measurement-photo-documents/{document['id']}/annotations/",{"calibration_id":calibration["id"],"geometry_type":"line","geometry":{"points":[{"x":".1","y":".4"},{"x":".5","y":".4"}]},"label":"Original","expected_document_version":2},format="json")
        revised=self.client.post(f"/api/projects/measurement-photo-annotations/{annotation.data['id']}/revise/",{"calibration_id":calibration["id"],"geometry_type":"line","geometry":{"points":[{"x":".1","y":".4"},{"x":".6","y":".4"}]},"label":"Revised","expected_document_version":3,"expected_annotation_version":1},format="json")
        self.assertEqual(revised.status_code,201,revised.data)
        self.assertEqual(revised.data["previous_revision_id"],annotation.data["id"])
        detail=self.client.get(f"/api/projects/measurement-photo-documents/{document['id']}/")
        self.assertEqual([row["label"] for row in detail.data["annotations"]],["Revised"])
        invalidated=self.client.post(f"/api/projects/measurement-photo-calibrations/{calibration['id']}/invalidate/",{},format="json")
        self.assertEqual(invalidated.status_code,200,invalidated.data)
        self.assertIsNotNone(invalidated.data["invalidated_at"])
