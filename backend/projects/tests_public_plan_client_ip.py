from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory

from core.checks import public_planning_client_ip_check
from projects.services.public_plan_admission import PublicPlanClientIPUnavailable, public_plan_client_ip
from projects.views.public_improvements import PublicImprovementPlanView


@override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="direct", PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=False)
class PublicPlanClientIPTests(SimpleTestCase):
    def request(self, **metadata):
        return SimpleNamespace(META={"REMOTE_ADDR": "10.0.0.8", **metadata})

    def test_direct_mode_ignores_all_forwarded_identity_claims(self):
        request = self.request(
            HTTP_X_REAL_IP="198.51.100.2", HTTP_X_FORWARDED_FOR="203.0.113.4, 198.51.100.2",
            HTTP_FORWARDED="for=203.0.113.8", HTTP_CF_CONNECTING_IP="203.0.113.9",
            HTTP_HOST="www.myhomebro.com",
        )
        self.assertEqual(public_plan_client_ip(request), "10.0.0.8")

    def test_direct_identity_canonicalizes_ipv6_and_ipv4_mapped_addresses(self):
        self.assertEqual(public_plan_client_ip(self.request(REMOTE_ADDR="2001:0db8:0:0:0:0:0:0001")), "2001:db8::1")
        self.assertEqual(public_plan_client_ip(self.request(REMOTE_ADDR="::ffff:192.0.2.8")), "192.0.2.8")

    def test_missing_or_invalid_direct_identity_fails_closed(self):
        for address in (None, "", "not-an-address", "192.0.2.8:443", "fe80::1%eth0", "192.0.2.8, 192.0.2.9"):
            with self.subTest(address=address), self.assertRaises(PublicPlanClientIPUnavailable):
                public_plan_client_ip(self.request(REMOTE_ADDR=address))

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="pythonanywhere")
    def test_host_mode_requires_verified_ingress_even_when_headers_look_valid(self):
        with self.assertRaises(PublicPlanClientIPUnavailable):
            public_plan_client_ip(self.request(HTTP_X_REAL_IP="198.51.100.2", HTTP_X_FORWARDED_FOR="198.51.100.2"))
        self.assertEqual([message.id for message in public_planning_client_ip_check(None)], ["core.E132"])

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="unrecognized")
    def test_unrecognized_mode_fails_preflight_and_request_resolution(self):
        with self.assertRaises(PublicPlanClientIPUnavailable):
            public_plan_client_ip(self.request())
        self.assertEqual([message.id for message in public_planning_client_ip_check(None)], ["core.E131"])

    def test_direct_mode_passes_configuration_check(self):
        self.assertEqual(public_planning_client_ip_check(None), [])

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="pythonanywhere", PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=True)
    def test_pythonanywhere_uses_single_edge_identity_and_ignores_untrusted_prefixes(self):
        for prefix in ("203.0.113.9", "spoofed, broken:port", "127.0.0.1, 203.0.113.44"):
            with self.subTest(prefix=prefix):
                self.assertEqual(public_plan_client_ip(self.request(
                    HTTP_X_REAL_IP="198.51.100.2", HTTP_X_FORWARDED_FOR=f"{prefix}, 198.51.100.2",
                    HTTP_FORWARDED="for=203.0.113.8", HTTP_CF_CONNECTING_IP="203.0.113.9",
                )), "198.51.100.2")
        self.assertEqual(public_planning_client_ip_check(None), [])

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="pythonanywhere", PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=True)
    def test_pythonanywhere_does_not_require_the_optional_forwarded_chain(self):
        self.assertEqual(public_plan_client_ip(self.request(HTTP_X_REAL_IP="198.51.100.2")), "198.51.100.2")

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="pythonanywhere", PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=True)
    def test_pythonanywhere_canonicalizes_both_trusted_addresses_before_comparison(self):
        self.assertEqual(public_plan_client_ip(self.request(
            HTTP_X_REAL_IP="::ffff:192.0.2.8", HTTP_X_FORWARDED_FOR="spoofed, 192.0.2.8",
        )), "192.0.2.8")
        self.assertEqual(public_plan_client_ip(self.request(
            HTTP_X_REAL_IP="2001:0db8:0:0:0:0:0:0001", HTTP_X_FORWARDED_FOR="spoofed, 2001:db8::1",
        )), "2001:db8::1")

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="pythonanywhere", PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=True)
    def test_bad_missing_duplicated_and_mismatched_proxy_values_fail_closed(self):
        metadata_cases = [
            {}, {"HTTP_X_REAL_IP": ""}, {"HTTP_X_REAL_IP": "not-an-address"},
            {"HTTP_X_REAL_IP": "198.51.100.2, 203.0.113.4"}, {"HTTP_X_REAL_IP": "198.51.100.2:443"},
            {"HTTP_X_REAL_IP": "fe80::1%eth0"}, {"HTTP_X_REAL_IP": "x" * 65},
            {"HTTP_X_REAL_IP": "198.51.100.2", "HTTP_X_FORWARDED_FOR": "203.0.113.4"},
            {"HTTP_X_REAL_IP": "198.51.100.2", "HTTP_X_FORWARDED_FOR": "198.51.100.2,"},
            {"HTTP_X_REAL_IP": "198.51.100.2", "HTTP_X_FORWARDED_FOR": "x" * 4097},
        ]
        for metadata in metadata_cases:
            with self.subTest(metadata=metadata), self.assertRaises(PublicPlanClientIPUnavailable):
                public_plan_client_ip(self.request(**metadata))

    @override_settings(PUBLIC_PLANNING_CLIENT_IP_SOURCE="pythonanywhere", PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=True)
    def test_invalid_proxy_identity_never_allocates_slots_or_calls_provider(self):
        request = APIRequestFactory().post("/plan/", {"desired_outcome": "Paint the vanity"}, format="json",
                                          REMOTE_ADDR="10.0.0.8", HTTP_X_REAL_IP="203.0.113.4",
                                          HTTP_X_FORWARDED_FOR="198.51.100.2")
        with patch("projects.views.public_improvements.reserve_public_plan_slot") as reserve, \
                patch("projects.views.public_improvements.build_public_plan_preview") as provider:
            response = PublicImprovementPlanView.as_view()(request, category_slug="bathroom", improvement_slug="vanity")
        self.assertEqual(response.status_code, 503)
        self.assertIn("temporarily unavailable", str(response.data))
        self.assertNotIn("198.51.100.2", str(response.data))
        reserve.assert_not_called()
        provider.assert_not_called()
