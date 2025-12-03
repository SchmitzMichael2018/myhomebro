// src/App.jsx (fixed)
// Adds: <Route path="/public-sign/:token" element={<PublicSign />} />
//       <Route path="/public-fund/:token" element={<PublicFund />} />

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
import PublicFund from "./components/PublicFund";   // ← NEW

import "./styles/ui.css";
import "./styles/modal.css";

import { protectedRoutes } from "./routes/ProtectedRoutes.jsx";
import DashboardRouter from "./components/DashboardRouter.jsx";
import TeamPage from "./pages/TeamPage.jsx";

console.log(
  "App.jsx v2025-11-24 — Stripe onboarding page + contractor profile onboarding + /app dashboard router + /team route"
);

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />

          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route
            path="/reset-password/:uid/:token"
            element={<ResetPassword />}
          />

          {/* PUBLIC SIGNING ROUTE — homeowner signs here */}
          <Route path="/public-sign/:token" element={<PublicSign />} />

          {/* PUBLIC FUNDING ROUTE — homeowner sees escrow funding details here */}
          <Route path="/public-fund/:token" element={<PublicFund />} />

          {/* Public agreement preview (legacy / read-only) */}
          <Route path="/agreements/:id" element={<AgreementReview />} />

          {/* Stripe Connect onboarding (status + start/continue + back to /app) */}
          <Route path="/onboarding" element={<StripeOnboarding />} />

          {/* Contractor profile onboarding form (business details + skills, etc.) */}
          <Route
            path="/onboarding/profile"
            element={<ContractorOnboardingForm />}
          />

          {/* New unified dashboard route (contractor / employee) */}
          <Route path="/app" element={<DashboardRouter />} />

          {/* Contractor team management (Team page) */}
          <Route path="/team" element={<TeamPage />} />

          {/* Existing auth-protected app sections (contractor console) */}
          {protectedRoutes()}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Global modals */}
        <LoginModal />
        <SignUpModal />

        {/* Global UI */}
        <Toaster position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
