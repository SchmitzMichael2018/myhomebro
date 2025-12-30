// src/App.jsx
// v2025-12-23 — public invoice magic link routing fixed
// Key fixes:
// - /invoice/:token (public)
// - /invoices/magic/:token (public)
// - prevents homeowner invoice email links from falling into contractor dashboard routes

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";

import LandingPage from "./components/LandingPage.jsx";
import LoginModal from "./components/LoginModal.jsx";
import SignUpModal from "./components/SignUpModal.jsx";

import AgreementReview from "./pages/AgreementReview.jsx";
import ContractorOnboardingForm from "./components/ContractorOnboardingForm.jsx";
import StripeOnboarding from "./components/Stripe/StripeOnboarding.jsx";

import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";

import PublicSign from "./components/PublicSign";
import PublicFund from "./components/PublicFund";

import InvoicePage from "./pages/InvoicePage.jsx";
import MagicInvoice from "./pages/MagicInvoice.jsx";

import DashboardRouter from "./components/DashboardRouter.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import { protectedRoutes } from "./routes/ProtectedRoutes.jsx";

import "./styles/ui.css";
import "./styles/modal.css";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />

          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />

          {/* PUBLIC SIGNING ROUTE — homeowner signs agreement */}
          <Route path="/public-sign/:token" element={<PublicSign />} />

          {/* PUBLIC FUNDING ROUTE — homeowner funds escrow */}
          <Route path="/public-fund/:token" element={<PublicFund />} />

          {/* ✅ PUBLIC INVOICE MAGIC LINK ENTRY */}
          <Route path="/invoice/:token" element={<InvoicePage />} />

          {/* ✅ PUBLIC MAGIC INVOICE PAGE */}
          <Route path="/invoices/magic/:token" element={<MagicInvoice />} />

          {/* Public agreement preview (legacy / read-only) */}
          <Route path="/agreements/:id" element={<AgreementReview />} />

          {/* Stripe Connect onboarding */}
          <Route path="/onboarding" element={<StripeOnboarding />} />
          <Route path="/onboarding/profile" element={<ContractorOnboardingForm />} />

          {/* Contractor dashboard */}
          <Route path="/app" element={<DashboardRouter />} />

          {/* Contractor team management */}
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
