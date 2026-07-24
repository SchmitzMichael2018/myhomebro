// src/routes/PublicRoutes.jsx
// v2026-03-10b — add start-project routes and keep legacy public-intake token route
// v2026-03-10 — add public intake route
// v2026-02-09 — add legacy redirects for /customers/* into /app/customers/*
// Keeps dispute routes and existing public pages.

import React, { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import RouteLoadingFallback from "../components/RouteLoadingFallback.jsx";

const LandingPage = lazy(() => import("../components/LandingPage.jsx"));
const LoginForm = lazy(() => import("../components/LoginForm.jsx"));
const SignUpForm = lazy(() => import("../components/SignUpForm.jsx"));
const ForgotPassword = lazy(() => import("../components/ForgotPassword.jsx"));

// Public pages
const HomeownerSign = lazy(() => import("../pages/HomeownerSign.jsx"));
const PublicIntake = lazy(() => import("../pages/PublicIntake.jsx"));
const StartProjectIntake = lazy(() => import("../pages/StartProjectIntake.jsx"));
const MagicInvoice = lazy(() => import("../pages/MagicInvoice.jsx"));
const MagicDrawRequest = lazy(() => import("../pages/MagicDrawRequest.jsx"));
const MagicAgreement = lazy(() => import("../pages/MagicAgreement.jsx"));
const PublicProfile = lazy(() => import("../pages/PublicProfile.jsx"));
const PublicWebsitePage = lazy(() => import("../pages/PublicWebsitePage.jsx"));
const LegalPage = lazy(() => import("../pages/LegalPage.jsx"));

// Optional: your /invoice/:token router page
const InvoicePage = lazy(() => import("../pages/InvoicePage.jsx"));

// Public dispute thread + decision
const PublicDisputeView = lazy(() => import("../pages/PublicDisputeView.jsx"));
const PublicDisputeDecision = lazy(() => import("../pages/PublicDisputeDecision.jsx"));
const SubcontractorInvitationAcceptPage = lazy(() => import("../pages/SubcontractorInvitationAcceptPage.jsx"));
const CustomerPortalPage = lazy(() => import("../pages/CustomerPortalPage.jsx"));
const ContractorClaimPage = lazy(() => import("../pages/ContractorClaimPage.jsx"));
const TenantMaintenanceRequestPage = lazy(() => import("../pages/TenantMaintenanceRequestPage.jsx"));
const TenantMaintenanceStatusPage = lazy(() => import("../pages/TenantMaintenanceStatusPage.jsx"));
const CustomerAccountOnboardingPage = lazy(() => import("../pages/CustomerAccountOnboardingPage.jsx"));
const EmailVerifiedPage = lazy(() => import("../pages/EmailVerifiedPage.jsx"));

function PortalTokenRedirect() {
  const { token = "" } = useParams();
  return <Navigate to={`/portal/${encodeURIComponent(token)}`} replace />;
}

export default function PublicRoutes() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
      {/* ✅ Legacy redirects (pre-/app routing) */}
      <Route path="/customers" element={<Navigate to="/app/customers" replace />} />
      <Route path="/customers/new" element={<Navigate to="/app/customers/new" replace />} />
      <Route path="/customers/:id/edit" element={<Navigate to="/app/customers/:id/edit" replace />} />

      {/* Landing & Auth */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginForm />} />
      <Route path="/signup" element={<SignUpForm />} />
      <Route path="/create-account" element={<CustomerAccountOnboardingPage />} />
      <Route path="/email-verified" element={<EmailVerifiedPage />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Public signature / magic links */}
      <Route path="/agreements/sign/:id" element={<HomeownerSign />} />

      {/* Customer portal */}
      <Route path="/portal" element={<CustomerPortalPage />} />
      <Route path="/portal/:token" element={<CustomerPortalPage />} />
      <Route path="/customer-portal" element={<Navigate to="/portal" replace />} />
      <Route path="/customer-portal/:token" element={<PortalTokenRedirect />} />
      <Route path="/my-records" element={<Navigate to="/portal" replace />} />
      <Route path="/my-records/:token" element={<PortalTokenRedirect />} />

      {/* Tenant maintenance intake */}
      <Route path="/maintenance-request" element={<TenantMaintenanceRequestPage />} />
      <Route path="/maintenance-request/status/:token" element={<TenantMaintenanceStatusPage />} />
      <Route path="/maintenance-request/:token" element={<TenantMaintenanceRequestPage />} />

      {/* Public intake */}
      <Route path="/start-project" element={<StartProjectIntake />} />
      <Route path="/start-project/:token" element={<PublicIntake />} />

      {/* Legacy public intake route kept for older emailed links */}
      <Route path="/public-intake/:token" element={<PublicIntake />} />

      {/* Public invoice entry (optional) */}
      <Route path="/invoice/:token" element={<InvoicePage />} />

      {/* Public magic invoice */}
      <Route path="/invoices/magic/:token" element={<MagicInvoice />} />

      {/* Public magic draw review */}
      <Route path="/draws/magic/:token" element={<MagicDrawRequest />} />

      {/* Magic agreement */}
      <Route path="/agreements/magic/:token" element={<MagicAgreement />} />

      {/* Public dispute thread */}
      <Route path="/disputes/:id" element={<PublicDisputeView />} />

      {/* Public dispute decision */}
      <Route path="/disputes/:id/decision" element={<PublicDisputeDecision />} />

      {/* Public contractor profile */}
      <Route path="/contractors/directory-claim/:token" element={<ContractorClaimPage />} />
      <Route path="/contractors/claim/:token" element={<ContractorClaimPage />} />
      <Route path="/contractors/:slug" element={<PublicProfile />} />

      {/* Public contractor website */}
      <Route path="/websites/:slug" element={<PublicWebsitePage />} />
      <Route path="/websites/:slug/:pageSlug" element={<PublicWebsitePage />} />

      {/* Legal docs */}
      <Route path="/legal/:slug" element={<LegalPage />} />

      <Route
        path="/subcontractor-invitations/accept/:token"
        element={<SubcontractorInvitationAcceptPage />}
      />

      {/* catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
