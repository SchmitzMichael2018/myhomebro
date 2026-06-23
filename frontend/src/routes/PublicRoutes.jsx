// src/routes/PublicRoutes.jsx
// v2026-03-10b — add start-project routes and keep legacy public-intake token route
// v2026-03-10 — add public intake route
// v2026-02-09 — add legacy redirects for /customers/* into /app/customers/*
// Keeps dispute routes and existing public pages.

import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";

import LandingPage from "../components/LandingPage.jsx";
import LoginForm from "../components/LoginForm.jsx";
import SignUpForm from "../components/SignUpForm.jsx";
import ForgotPassword from "../components/ForgotPassword.jsx";

// Public pages
import HomeownerSign from "../pages/HomeownerSign.jsx"; // /agreements/sign/:id?token=...
import PublicIntake from "../pages/PublicIntake.jsx"; // /start-project/:token or legacy /public-intake/:token
import StartProjectIntake from "../pages/StartProjectIntake.jsx"; // /start-project
import MagicInvoice from "../pages/MagicInvoice.jsx"; // /invoices/magic/:token
import MagicDrawRequest from "../pages/MagicDrawRequest.jsx"; // /draws/magic/:token
import MagicAgreement from "../pages/MagicAgreement.jsx"; // /agreements/magic/:token
import PublicProfile from "../pages/PublicProfile.jsx"; // /contractors/:slug public view
import LegalPage from "../pages/LegalPage.jsx";

// Optional: your /invoice/:token router page
import InvoicePage from "../pages/InvoicePage.jsx"; // /invoice/:token → redirects to /invoices/magic/:token

// Public dispute thread + decision
import PublicDisputeView from "../pages/PublicDisputeView.jsx"; // /disputes/:id?token=...
import PublicDisputeDecision from "../pages/PublicDisputeDecision.jsx"; // /disputes/:id/decision?token=...
import SubcontractorInvitationAcceptPage from "../pages/SubcontractorInvitationAcceptPage.jsx";
import CustomerPortalPage from "../pages/CustomerPortalPage.jsx"; // /portal
import ContractorClaimPage from "../pages/ContractorClaimPage.jsx";
import TenantMaintenanceRequestPage from "../pages/TenantMaintenanceRequestPage.jsx";
import TenantMaintenanceStatusPage from "../pages/TenantMaintenanceStatusPage.jsx";

function PortalTokenRedirect() {
  const { token = "" } = useParams();
  return <Navigate to={`/portal/${encodeURIComponent(token)}`} replace />;
}

export default function PublicRoutes() {
  return (
    <Routes>
      {/* ✅ Legacy redirects (pre-/app routing) */}
      <Route path="/customers" element={<Navigate to="/app/customers" replace />} />
      <Route path="/customers/new" element={<Navigate to="/app/customers/new" replace />} />
      <Route path="/customers/:id/edit" element={<Navigate to="/app/customers/:id/edit" replace />} />

      {/* Landing & Auth */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginForm />} />
      <Route path="/signup" element={<SignUpForm />} />
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

      {/* Legal docs */}
      <Route path="/legal/:slug" element={<LegalPage />} />

      <Route
        path="/subcontractor-invitations/accept/:token"
        element={<SubcontractorInvitationAcceptPage />}
      />

      {/* catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
