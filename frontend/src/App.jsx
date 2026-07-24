// src/App.jsx
// v2026-02-09 — Redirect legacy /customers routes into /app to avoid landing fallback.
// v2026-02-24 — ✅ Fix /app routing: remove DashboardRouter shadow route so ProtectedRoutes / AgreementWizard render

import React, { lazy, Suspense, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { clearExpiredConversations } from "./lib/conversationStorage.js";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";

import LoginModal from "./components/LoginModal.jsx";
import SignUpModal from "./components/SignUpModal.jsx";

const ForgotPassword = lazy(() => import("./components/ForgotPassword"));
const ResetPassword = lazy(() => import("./components/ResetPassword"));
const TeamAccountSetup = lazy(() => import("./components/TeamAccountSetup"));

const AgreementReview = lazy(() => import("./pages/AgreementReview.jsx"));
const ProjectDashboardPage = lazy(() => import("./pages/ProjectDashboardPage.jsx"));
const CustomerPortalUploadSessionPage = lazy(() => import("./pages/CustomerPortalUploadSessionPage.jsx"));
const StripeOnboarding = lazy(() => import("./components/Stripe/StripeOnboarding.jsx"));

const PublicSign = lazy(() => import("./components/PublicSign"));
const PublicFund = lazy(() => import("./components/PublicFund"));

const InvoicePage = lazy(() => import("./pages/InvoicePage.jsx"));
const MagicDrawRequest = lazy(() => import("./pages/MagicDrawRequest.jsx"));
const MagicInvoice = lazy(() => import("./pages/MagicInvoice.jsx"));

// ✅ App routes live under protectedRoutes() (/app + AuthenticatedLayout + RoleGate)
import { protectedRoutes } from "./routes/ProtectedRoutes.jsx";

const PublicRoutes = lazy(() => import("./routes/PublicRoutes.jsx"));
import RouteLoadingFallback from "./components/RouteLoadingFallback.jsx";

import "./styles/ui.css";
import "./styles/modal.css";

function LegacyPortalTokenRedirect() {
  const { token = "" } = useParams();
  return <Navigate to={`/portal/${encodeURIComponent(token)}`} replace />;
}

export default function App() {
  const cleanedRef = useRef(false);
  useEffect(() => {
    if (!cleanedRef.current) {
      cleanedRef.current = true;
      clearExpiredConversations();
    }
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
          {/* ✅ Legacy redirects (pre-/app routing) */}
          <Route path="/customers" element={<Navigate to="/app/customers" replace />} />
          <Route path="/customers/:id/edit" element={<Navigate to="/app/customers/:id/edit" replace />} />
          <Route path="/customer-portal" element={<Navigate to="/portal" replace />} />
          <Route path="/customer-portal/:token" element={<LegacyPortalTokenRedirect />} />
          <Route path="/my-records" element={<Navigate to="/portal" replace />} />
          <Route path="/my-records/:token" element={<LegacyPortalTokenRedirect />} />
          <Route path="/portal/upload-session/:sessionToken" element={<CustomerPortalUploadSessionPage />} />

          {/* 🔐 Public password reset */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />
          <Route path="/team-account-setup/:uid/:token" element={<TeamAccountSetup />} />

          {/* 🔓 Public agreement signing / funding */}
          <Route path="/public-sign/:token" element={<PublicSign />} />
          <Route path="/public-fund/:token" element={<PublicFund />} />

          {/* 🔓 Public invoice links */}
          <Route path="/invoice/:token" element={<InvoicePage />} />
          <Route path="/invoices/magic/:token" element={<MagicInvoice />} />
          <Route path="/draws/magic/:token" element={<MagicDrawRequest />} />

          {/* 🔓 Public agreement preview */}
          <Route path="/agreements/public/:id" element={<AgreementReview />} />
          <Route path="/app/project/:project_id" element={<ProjectDashboardPage />} />

          {/* Stripe onboarding */}
          <Route path="/onboarding" element={<StripeOnboarding />} />
          <Route path="/onboarding/profile" element={<Navigate to="/app/onboarding" replace />} />

          {/* ✅ Auth-protected /app routes */}
          {protectedRoutes()}

          {/* 🔓 Public routes bundle (landing, magic links, disputes, decisions) */}
          <Route path="/*" element={<PublicRoutes />} />

          {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        {/* Global modals */}
        <LoginModal />
        <SignUpModal />

        {/* Toasts */}
        <Toaster position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
