// src/App.jsx
// v2026-02-09 — Redirect legacy /customers routes into /app to avoid landing fallback.
// v2026-02-24 — ✅ Fix /app routing: remove DashboardRouter shadow route so ProtectedRoutes / AgreementWizard render

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";

import LoginModal from "./components/LoginModal.jsx";
import SignUpModal from "./components/SignUpModal.jsx";

import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";

import AgreementReview from "./pages/AgreementReview.jsx";
import ContractorOnboardingForm from "./components/ContractorOnboardingForm.jsx";
import StripeOnboarding from "./components/Stripe/StripeOnboarding.jsx";

import PublicSign from "./components/PublicSign";
import PublicFund from "./components/PublicFund";

import InvoicePage from "./pages/InvoicePage.jsx";
import MagicInvoice from "./pages/MagicInvoice.jsx";

// ✅ App routes live under protectedRoutes() (/app + AuthenticatedLayout + RoleGate)
import { protectedRoutes } from "./routes/ProtectedRoutes.jsx";

import PublicRoutes from "./routes/PublicRoutes.jsx";

import "./styles/ui.css";
import "./styles/modal.css";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ✅ Legacy redirects (pre-/app routing) */}
          <Route path="/customers" element={<Navigate to="/app/customers" replace />} />
          <Route path="/customers/:id/edit" element={<Navigate to="/app/customers/:id/edit" replace />} />

          {/* 🔐 Public password reset */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />

          {/* 🔓 Public agreement signing / funding */}
          <Route path="/public-sign/:token" element={<PublicSign />} />
          <Route path="/public-fund/:token" element={<PublicFund />} />

          {/* 🔓 Public invoice links */}
          <Route path="/invoice/:token" element={<InvoicePage />} />
          <Route path="/invoices/magic/:token" element={<MagicInvoice />} />

          {/* 🔓 Public agreement preview */}
          <Route path="/agreements/public/:id" element={<AgreementReview />} />

          {/* Stripe onboarding */}
          <Route path="/onboarding" element={<StripeOnboarding />} />
          <Route path="/onboarding/profile" element={<ContractorOnboardingForm />} />

          {/* ✅ Auth-protected /app routes */}
          {protectedRoutes()}

          {/* 🔓 Public routes bundle (landing, magic links, disputes, decisions) */}
          <Route path="/*" element={<PublicRoutes />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Global modals */}
        <LoginModal />
        <SignUpModal />

        {/* Toasts */}
        <Toaster position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
