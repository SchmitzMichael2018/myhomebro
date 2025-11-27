// src/App.jsx
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

          {/* Existing auth-protected app sections */}
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
