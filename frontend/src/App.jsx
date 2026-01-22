// src/App.jsx
// v2026-01-16 — mounts PublicRoutes correctly (fixes dispute decision links)

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

import DashboardRouter from "./components/DashboardRouter.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import { protectedRoutes } from "./routes/ProtectedRoutes.jsx";

// ✅ NEW: Public routes bundle
import PublicRoutes from "./routes/PublicRoutes.jsx";

import "./styles/ui.css";
import "./styles/modal.css";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>

          {/* 🔓 ALL public routes (landing, magic links, disputes, decisions) */}
          <Route path="/*" element={<PublicRoutes />} />

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

          {/* 🔐 Contractor app */}
          <Route path="/app/*" element={<DashboardRouter />} />

          {/* Contractor team */}
          <Route path="/team" element={<TeamPage />} />

          {/* Auth-protected routes */}
          {protectedRoutes()}

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
