import json
import struct
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.services.attribution import acquisition_report
from projects.views.customer_portal import _portal_token


@override_settings(
    SECURE_SSL_REDIRECT=False,
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    },
)
class PublicImprovementLibraryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.reviewer = get_user_model().objects.create_user(
            email="reviewer@example.com", password="not-used"
        )
        cls.published = cls._template(
            "QA Replace Bathroom Vanity", "qa-replace-bathroom-vanity", "published"
        )
        cls.related = cls._template(
            "QA Replace Bathroom Faucet", "qa-replace-bathroom-faucet", "published"
        )
        cls.published.related_public_templates.add(cls.related)
        cls.draft = cls._template("QA Replace Toilet", "qa-replace-toilet", "draft")
        cls.archived = cls._template(
            "QA Install Shower Door", "qa-install-shower-door", "archived"
        )

    @classmethod
    def _template(cls, name, slug, status):
        template = ProjectTemplate.objects.create(
            name=name,
            is_system=True,
            public_category_slug="bathroom",
            public_slug=slug,
            public_summary=f"Authoritative summary for {name}.",
            public_intro=f"Reviewed introduction for {name}.",
            seo_description=f"Plan {name.lower()} with reviewed MyHomeBro project information.",
            public_publication_status="draft",
            public_reviewed_by=cls.reviewer,
            public_reviewed_at="2026-09-21T12:00:00Z",
        )
        ProjectTemplateMilestone.objects.create(
            template=template, title="Prepare the work area", description="Protect adjacent surfaces."
        )
        template.public_publication_status = status
        template.full_clean()
        template.save()
        return template

    def test_library_category_and_search_only_return_published_content(self):
        library = self.client.get("/api/projects/public/improvements/")
        category = self.client.get("/api/projects/public/improvements/bathroom/")
        search = self.client.get("/api/projects/public/improvements/?q=toilet")

        self.assertEqual(library.status_code, 200)
        self.assertEqual(category.status_code, 200)
        self.assertEqual({row["id"] for row in library.json()["improvements"]}, {self.published.id, self.related.id})
        self.assertEqual(search.json()["improvements"], [])
        self.assertEqual(self.client.get("/api/projects/public/improvements/kitchen/").status_code, 404)

    def test_published_detail_has_related_content_and_private_states_404(self):
        response = self.client.get(
            "/api/projects/public/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["related"][0]["id"], self.related.id)
        self.assertEqual(
            self.client.get("/api/projects/public/improvements/bathroom/qa-replace-toilet/").status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/projects/public/improvements/bathroom/qa-install-shower-door/").status_code,
            404,
        )

    def test_shell_metadata_canonical_and_slug_redirect(self):
        response = self.client.get(
            "/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertContains(response, "QA Replace Bathroom Vanity: DIY &amp; Project Guide | MyHomeBro")
        self.assertContains(
            response,
            'href="https://www.myhomebro.com/improvements/bathroom/qa-replace-bathroom-vanity/"',
        )
        self.assertContains(
            response,
            "https://www.myhomebro.com/static/social/myhomebro-default-1200x630.png",
        )

        self.published.public_slug = "qa-replace-a-bathroom-vanity"
        self.published.save()
        redirect = self.client.get(
            "/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertRedirects(
            redirect,
            "/improvements/bathroom/qa-replace-a-bathroom-vanity/",
            status_code=301,
            fetch_redirect_response=False,
        )

    def test_sitemap_includes_published_category_and_content_only(self):
        body = self.client.get("/sitemap.xml").content.decode()
        self.assertIn("/improvements/", body)
        self.assertIn("/improvements/bathroom/", body)
        self.assertIn("qa-replace-bathroom-vanity", body)
        self.assertNotIn("qa-replace-toilet", body)
        self.assertNotIn("qa-install-shower-door", body)

    def test_publication_validation_and_social_override(self):
        invalid = ProjectTemplate(
            name="Incomplete",
            public_publication_status="published",
            social_image="/media/unapproved.png",
        )
        with self.assertRaises(ValidationError):
            invalid.full_clean()

        self.published.social_image = "/static/social/vanity-1200x630.png"
        self.published.full_clean()
        self.published.save()
        response = self.client.get(
            "/api/projects/public/improvements/bathroom/qa-replace-bathroom-vanity/"
        )
        self.assertEqual(response.json()["social_image"], "/static/social/vanity-1200x630.png")

    def test_default_social_asset_is_valid_1200_by_630_png(self):
        path = Path(__file__).resolve().parents[1] / "static" / "social" / "myhomebro-default-1200x630.png"
        raw = path.read_bytes()[:24]
        self.assertEqual(raw[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", raw[16:24]), (1200, 630))

    def test_contractor_intake_and_diy_project_preserve_template_identity(self):
        intake = self.client.post(
            "/api/projects/public-intake/start/",
            {
                "customer_name": "Home Owner",
                "customer_email": "owner@example.com",
                "customer_phone": "2105550100",
                "source": "landing_page",
                "template_id": self.published.id,
            },
        )
        self.assertEqual(intake.status_code, 201)
        self.assertEqual(self.published.public_intakes.get().pk, intake.json()["intake_id"])

        token = _portal_token("owner@example.com")
        diy = self.client.post(
            f"/api/projects/customer-portal/{token}/diy-projects/",
            {
                "title": self.published.name,
                "desired_outcome": self.published.public_summary,
                "source_template_id": self.published.id,
            },
        )
        self.assertEqual(diy.status_code, 201)
        self.assertEqual(diy.json()["source_template_id"], self.published.id)
        self.assertEqual(len(diy.json()["phases"]), 1)

    def test_improvement_cta_events_are_reported_by_template_and_category(self):
        for event_type in (
            "improvement_template_view",
            "diy_project_started",
            "hire_pro_clicked",
        ):
            response = self.client.post(
                "/api/projects/attribution/track/",
                {
                    "event_type": event_type,
                    "landing_page": f"/improvements/bathroom/{self.published.public_slug}/",
                    "object_type": "improvement",
                    "object_id": str(self.published.id),
                    "metadata": {"category": "bathroom"},
                },
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 201)

        report = acquisition_report()
        self.assertEqual(
            {row["event_type"] for row in report["by_improvement"]},
            {"improvement_template_view", "diy_project_started", "hire_pro_clicked"},
        )
        self.assertEqual(
            {row["metadata__category"] for row in report["by_improvement_category"]},
            {"bathroom"},
        )

    def test_audience_and_category_filters_never_reveal_drafts(self):
        self.published.public_audience = "contractor"
        self.published.public_audiences = ["contractor", "homeowner"]
        self.published.public_audience_actions = {
            "contractor": "sign_up",
            "homeowner": "create_project",
        }
        self.published.save()
        response = self.client.get("/api/projects/public/improvements/?audience=contractor&category=bathroom")
        self.assertEqual([row["id"] for row in response.json()["improvements"]], [self.published.id])
        homeowner = self.client.get("/api/projects/public/improvements/?audience=homeowner&category=bathroom")
        homeowner_ids = [row["id"] for row in homeowner.json()["improvements"]]
        self.assertIn(self.published.id, homeowner_ids)
        self.assertNotIn(self.draft.id, homeowner_ids)
        multi_audience_row = next(row for row in homeowner.json()["improvements"] if row["id"] == self.published.id)
        self.assertEqual(multi_audience_row["audience_actions"]["homeowner"], "create_project")
        self.assertEqual(response.json()["published_count"], 2)
        self.assertNotIn(self.draft.id, [row["id"] for row in response.json()["improvements"]])


@override_settings(SECURE_SSL_REDIRECT=False)
class ImprovementEditorialWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = get_user_model().objects.create_user(
            email="editor@example.com", password="not-used", is_staff=True
        )
        self.article = ProjectTemplate.objects.create(
            name="Payment plan editorial QA", is_system=True,
            public_title="Payment plan editorial QA", public_slug="qa-payment-plan-editorial",
            public_category_slug="contractor-practice", public_audience="contractor",
            public_summary="A concise guide for contractors.",
            public_problem="Completion and payment can be unclear.",
            public_evidence="The FTC recommends a written contract.",
            public_evidence_source="https://consumer.ftc.gov/articles/how-avoid-home-improvement-scam",
            public_viewpoint="Agree on deliverables and review steps up front.",
            public_practical_steps="1. Write the scope. 2. Agree on the schedule.",
            public_next_action="sign_up", seo_description="A practical contractor payment-planning guide.",
        )

    def test_staff_only_preview_and_publication_gate(self):
        detail = f"/api/projects/admin/improvements/{self.article.id}/"
        self.assertIn(self.client.get(detail).status_code, (401, 403))
        self.assertEqual(self.client.get("/api/projects/public/improvements/").json()["improvements"], [])
        self.assertEqual(self.client.get("/api/projects/public/improvements/contractor-practice/qa-payment-plan-editorial/").status_code, 404)
        self.client.force_authenticate(self.admin)
        preview = self.client.get(detail)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()["viewpoint"], self.article.public_viewpoint)
        self.assertEqual(preview.json()["publication_status"], "draft")
        self.assertEqual(self.client.post(f"{detail}publish/").status_code, 400)
        self.assertEqual(self.client.post(f"{detail}submit/").status_code, 200)
        review = self.client.post(f"{detail}review/")
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["reviewed_by_id"], self.admin.pk)
        self.article.refresh_from_db()
        self.assertEqual(self.article.public_reviewed_by_id, self.admin.pk)
        self.assertIsNotNone(self.article.public_reviewed_at)
        publish = self.client.post(f"{detail}publish/")
        self.assertEqual(publish.status_code, 200, publish.json())
        public = self.client.get("/api/projects/public/improvements/contractor-practice/qa-payment-plan-editorial/")
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.json()["viewpoint"], self.article.public_viewpoint)
        self.assertIn("qa-payment-plan-editorial", self.client.get("/sitemap.xml").content.decode())
        self.assertEqual(self.client.patch(detail, {"public_viewpoint": "A revised take."}, content_type="application/json").status_code, 200)
        self.article.refresh_from_db()
        self.assertEqual(self.article.public_publication_status, "draft")
        self.assertIsNone(self.article.public_reviewed_at)
        self.assertEqual(self.client.get("/api/projects/public/improvements/contractor-practice/qa-payment-plan-editorial/").status_code, 404)

    def test_incomplete_editorial_claims_cannot_publish(self):
        self.client.force_authenticate(self.admin)
        detail = f"/api/projects/admin/improvements/{self.article.id}/"
        self.client.patch(detail, {"public_evidence_source": ""}, content_type="application/json")
        self.client.post(f"{detail}submit/")
        self.client.post(f"{detail}review/")
        response = self.client.post(f"{detail}publish/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("public_evidence_source", response.json())

    def test_walkthrough_requires_complete_reviewed_metadata_and_text_alternative(self):
        self.client.force_authenticate(self.admin)
        detail = f"/api/projects/admin/improvements/{self.article.id}/"
        preview = f"/api/projects/admin/improvements/preview/{self.article.public_slug}/"
        self.assertIsNone(self.client.get(preview).json()["video"])
        incomplete = self.client.patch(detail, {"public_video_url": "https://example.com/watch"}, format="json")
        self.assertEqual(incomplete.status_code, 200)
        self.assertIsNone(self.client.get(preview).json()["video"])
        self.client.post(f"{detail}submit/")
        self.client.post(f"{detail}review/")
        refused = self.client.post(f"{detail}publish/")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("public_video_poster_url", refused.json())
        self.assertIn("public_video_text_summary", refused.json())

        complete = {
            "public_video_url": "https://example.com/watch",
            "public_video_title": "Planning one payment milestone",
            "public_video_description": "A synthetic walkthrough of scope, proof, review, and outcome.",
            "public_video_poster_url": "https://example.com/poster.jpg",
            "public_video_text_summary": "Define scope, set milestones, document work, review, then determine the outcome.",
        }
        self.assertEqual(self.client.patch(detail, complete, format="json").status_code, 200)
        self.assertIsNone(self.client.get(preview).json()["video"])
        self.assertEqual(self.client.post(f"{detail}submit/").status_code, 200)
        reviewed = self.client.post(f"{detail}review/")
        self.assertEqual(reviewed.status_code, 200)
        self.assertEqual(reviewed.json()["reviewed_by_id"], self.admin.pk)
        self.assertEqual(self.client.get(preview).json()["video"]["title"], complete["public_video_title"])
        self.assertEqual(self.client.post(f"{detail}publish/").status_code, 200)
        public = self.client.get("/api/projects/public/improvements/contractor-practice/qa-payment-plan-editorial/")
        self.assertEqual(public.json()["video"]["url"], complete["public_video_url"])
        self.assertEqual(self.client.patch(detail, {"public_video_title": "Revised title"}, format="json").status_code, 200)
        self.assertIsNone(self.client.get(preview).json()["video"])
        self.article.refresh_from_db()
        self.assertEqual(self.article.public_publication_status, "draft")
        self.assertIsNone(self.article.public_reviewed_at)

    def test_walkthrough_urls_require_https(self):
        self.client.force_authenticate(self.admin)
        detail = f"/api/projects/admin/improvements/{self.article.id}/"
        for field in ("public_video_url", "public_video_poster_url", "public_video_transcript_url"):
            response = self.client.patch(detail, {field: "http://example.com/media"}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertIn(field, response.json())

    def test_seeded_contractor_drafts_have_private_stable_previews(self):
        slugs = [
            "contractor-payment-plan",
            "contractor-deposit-vs-milestones",
            "contractor-change-orders",
        ]
        for slug in slugs:
            article = ProjectTemplate.objects.get(public_slug=slug)
            self.assertEqual(article.public_publication_status, "draft")
            self.assertEqual(article.public_audience, "contractor")
            self.assertTrue(article.public_evidence_source.startswith("https://"))
            self.assertTrue(article.public_viewpoint)
            self.assertEqual(article.related_public_templates.count(), 2)
            self.assertNotIn(slug, self.client.get("/sitemap.xml").content.decode())
            self.assertEqual(
                self.client.get(f"/api/projects/public/improvements/contractor-practice/{slug}/").status_code,
                404,
            )
            self.assertIn(self.client.get(f"/api/projects/admin/improvements/preview/{slug}/").status_code, (401, 403))
            self.client.force_authenticate(self.admin)
            preview = self.client.get(f"/api/projects/admin/improvements/preview/{slug}/")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.json()["preview_path"], f"/app/admin/improvements/preview/{slug}")
            self.assertIsNone(preview.json()["video"])
            self.client.force_authenticate(user=None)
        payment = ProjectTemplate.objects.get(public_slug="contractor-payment-plan")
        self.assertIn("not a residential-contractor statistic", payment.public_evidence)
        deposit = ProjectTemplate.objects.get(public_slug="contractor-deposit-vs-milestones")
        self.assertIn("not automatically held or protected", deposit.public_viewpoint)
        self.assertIn("not money held through MyHomeBro", deposit.public_viewpoint)
        change = ProjectTemplate.objects.get(public_slug="contractor-change-orders")
        self.assertIn("does not show that contractors caused", change.public_evidence)

        balanced = ProjectTemplate.objects.get(public_slug="payment-risk-for-both-sides")
        self.assertEqual(balanced.public_publication_status, "draft")
        self.assertEqual(balanced.public_audiences, ["contractor", "homeowner"])
        self.assertEqual(
            balanced.public_audience_actions,
            {"contractor": "sign_up", "homeowner": "create_project"},
        )
        self.assertIn("Homeowners:", balanced.public_practical_steps)
        self.assertIn("Contractors:", balanced.public_practical_steps)
        self.assertIn("scope and payment milestones", balanced.public_viewpoint)
        self.assertIn("does not guarantee payment", balanced.public_viewpoint)
        self.assertIn(
            "does not guarantee payment, prove that work is complete, provide escrow protection",
            balanced.public_viewpoint,
        )
        self.assertEqual(
            balanced.public_sections[0]["title"], "When to seek outside help."
        )
        outside_help = balanced.public_sections[0]["body"]
        self.assertIn("mediation", outside_help)
        self.assertIn("applicable agreement", outside_help)
        self.assertIn("small claims court where eligible", outside_help)
        self.assertIn("deadlines, liens, substantial losses, or alleged fraud", outside_help)
        self.assertIn("not binding arbitration", outside_help)
        self.assertIn("does not replace a court decision", outside_help)
        self.assertEqual(
            self.client.get("/api/projects/public/improvements/project-planning/payment-risk-for-both-sides/").status_code,
            404,
        )

    def test_staff_assistance_is_proposal_only_and_never_publishes(self):
        endpoint = "/api/projects/admin/improvements/assist/"
        context = {
            "public_title": self.article.public_title,
            "public_audience": "contractor",
            "public_audiences": ["contractor", "homeowner"],
            "public_problem": self.article.public_problem,
            "public_evidence": self.article.public_evidence,
            "public_evidence_source": self.article.public_evidence_source,
            "public_viewpoint": self.article.public_viewpoint,
            "public_practical_steps": self.article.public_practical_steps,
        }
        payload = {"mode": "rewrite", "section": "public_problem", "article": context}
        self.assertIn(self.client.post(endpoint, payload, format="json").status_code, (401, 403))
        nonstaff = get_user_model().objects.create_user(email="nonstaff@example.com", password="not-used")
        self.client.force_authenticate(nonstaff)
        self.assertEqual(self.client.post(endpoint, payload, format="json").status_code, 403)
        self.client.force_authenticate(self.admin)
        provider = Mock()
        provider.responses.create.return_value = SimpleNamespace(
            output_text='{"public_problem":"Contractors need a clear review and payment plan."}'
        )
        with patch("projects.ai.improvement_editorial._require_openai_client", return_value=provider):
            response = self.client.post(endpoint, payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["proposal"], {"public_problem": "Contractors need a clear review and payment plan."})
        self.assertFalse(response.json()["saved"])
        self.article.refresh_from_db()
        self.assertEqual(self.article.public_problem, context["public_problem"])
        self.assertEqual(self.article.public_publication_status, "draft")
        self.assertEqual(self.client.get("/api/projects/public/improvements/").json()["improvements"], [])

        section_context = {
            **context,
            "public_sections": [
                {"id": "outside-help", "title": "When to seek outside help.", "body": ""}
            ],
        }
        provider.responses.create.return_value = SimpleNamespace(
            output_text='{"section_body":"Mediation may help with an unresolved disagreement."}'
        )
        with patch("projects.ai.improvement_editorial._require_openai_client", return_value=provider):
            section_response = self.client.post(
                endpoint,
                {"mode": "section", "section": "outside-help", "article": section_context},
                format="json",
            )
        self.assertEqual(section_response.status_code, 200)
        self.assertEqual(
            section_response.json()["proposal"],
            {"section_body": "Mediation may help with an unresolved disagreement."},
        )
        self.assertFalse(section_response.json()["saved"])
        self.article.refresh_from_db()
        self.assertEqual(self.article.public_sections, [])
        self.assertEqual(self.article.public_publication_status, "draft")

    def test_staff_can_save_reorder_remove_and_publish_sections_without_losing_legacy_content(self):
        self.client.force_authenticate(self.admin)
        detail = f"/api/projects/admin/improvements/{self.article.id}/"
        original_problem = self.article.public_problem
        sections = [
            {"id": "second", "title": "Second section", "body": "Second body."},
            {"id": "first", "title": "First section", "body": "First body."},
        ]
        saved = self.client.patch(detail, {"public_sections": sections}, format="json")
        self.assertEqual(saved.status_code, 200, saved.json())
        self.assertEqual(saved.json()["sections"], sections)
        self.assertEqual(saved.json()["public_sections"], sections)
        self.article.refresh_from_db()
        self.assertEqual(self.article.public_problem, original_problem)
        self.assertEqual(self.article.public_sections, sections)
        preview = self.client.get(
            "/api/projects/admin/improvements/preview/qa-payment-plan-editorial/"
        )
        self.assertEqual(preview.json()["sections"], sections)

        remaining = [sections[1]]
        removed = self.client.patch(
            detail, {"public_sections": remaining}, format="json"
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()["sections"], remaining)
        invalid = self.client.patch(
            detail,
            {"public_sections": [{"id": "blank", "title": "", "body": ""}]},
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("public_sections", invalid.json())

        self.assertEqual(self.client.post(f"{detail}submit/").status_code, 200)
        self.assertEqual(self.client.post(f"{detail}review/").status_code, 200)
        self.assertEqual(self.client.post(f"{detail}publish/").status_code, 200)
        public = self.client.get(
            "/api/projects/public/improvements/contractor-practice/qa-payment-plan-editorial/"
        )
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.json()["sections"], remaining)

    def test_assistance_rejects_unsupported_claims_and_evidence_rewrites(self):
        self.client.force_authenticate(self.admin)
        endpoint = "/api/projects/admin/improvements/assist/"
        context = {"public_title": "Payment planning", "public_audience": "contractor", "public_viewpoint": "Plan together."}
        self.assertEqual(self.client.post(endpoint, {"mode": "rewrite", "section": "public_evidence", "article": context}, format="json").status_code, 400)
        for unsafe in (
            "Payment is guaranteed for 56% of contractors.",
            "See https://example.com/invented-study for proof.",
            "Payment is guaranteed after the milestone.",
            "According to a study, every project goes smoothly.",
            "MyHomeBro ensures contractors get paid.",
        ):
            provider = Mock()
            provider.responses.create.return_value = SimpleNamespace(output_text=json.dumps({"public_problem": unsafe}))
            with patch("projects.ai.improvement_editorial._require_openai_client", return_value=provider):
                response = self.client.post(endpoint, {"mode": "rewrite", "section": "public_problem", "article": context}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("proposal", response.json())

    def test_staff_can_create_save_preview_review_and_publish_separately(self):
        self.client.force_authenticate(self.admin)
        endpoint = "/api/projects/admin/improvements/"
        create = self.client.post(endpoint, {
            "public_title": "Synthetic editorial draft", "public_slug": "synthetic-editorial-draft",
            "public_category_slug": "contractor-practice", "public_audience": "contractor",
            "public_audiences": ["contractor", "homeowner"],
            "public_audience_actions": {"contractor": "sign_up", "homeowner": "create_project"},
            "public_next_action": "sign_up",
        }, format="json")
        self.assertEqual(create.status_code, 201)
        article_id = create.json()["id"]
        detail = f"{endpoint}{article_id}/"
        self.assertEqual(create.json()["publication_status"], "draft")
        self.assertEqual(self.client.get(endpoint).json()["results"][0]["publication_status"], "draft")
        edit = self.client.patch(detail, {
            "public_problem": "A synthetic problem.", "public_evidence": "A source-backed observation.",
            "public_evidence_source": "https://example.com/source", "public_viewpoint": "Plan the next step.",
            "public_practical_steps": "Discuss scope and review steps.", "public_summary": "A synthetic guide.",
            "seo_description": "Synthetic editorial test guide.",
        }, format="json")
        self.assertEqual(edit.status_code, 200)
        self.assertEqual(edit.json()["publication_status"], "draft")
        self.assertEqual(self.client.get(f"{endpoint}preview/synthetic-editorial-draft/").status_code, 200)
        self.assertEqual(self.client.post(f"{detail}publish/").status_code, 400)
        self.assertEqual(self.client.post(f"{detail}submit/").status_code, 200)
        self.assertEqual(self.client.post(f"{detail}review/").status_code, 200)
        publish = self.client.post(f"{detail}publish/")
        self.assertEqual(publish.status_code, 200, publish.json())
