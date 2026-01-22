// src/routes/PublicRoutes.jsx
// v2026-01-15 — adds decision route: /disputes/:id/decision
// Keeps your thread route: /disputes/:id

import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "../components/LandingPage.jsx";
import LoginForm from "../components/LoginForm.jsx";
import SignUpForm from "../components/SignUpForm.jsx";
import ForgotPassword from "../components/ForgotPassword.jsx";

// Public pages
import HomeownerSign from "../pages/HomeownerSign.jsx"; // /agreements/sign/:id?token=...
import MagicInvoice from "../pages/MagicInvoice.jsx"; // /invoices/magic/:token
import MagicAgreement from "../pages/MagicAgreement.jsx"; // /agreements/magic/:token (recommended)
import PublicProfile from "../pages/PublicProfile.jsx"; // /contractors/:id public view

// Optional: your /invoice/:token router page
import InvoicePage from "../pages/InvoicePage.jsx"; // /invoice/:token → redirects to /invoices/magic/:token

// ✅ Public dispute thread view (existing)
import PublicDisputeView from "../pages/PublicDisputeView.jsx"; // /disputes/:id?token=...

// ✅ NEW: public dispute decision view
import PublicDisputeDecision from "../pages/PublicDisputeDecision.jsx"; // /disputes/:id/decision?token=...

export default function PublicRoutes() {
  return (
    <Routes>
      {/* Landing & Auth */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginForm />} />
      <Route path="/signup" element={<SignUpForm />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Public signature / magic links */}
      <Route path="/agreements/sign/:id" element={<HomeownerSign />} />

      {/* ✅ Public invoice entry (optional but recommended) */}
      <Route path="/invoice/:token" element={<InvoicePage />} />

      {/* ✅ Public magic invoice */}
      <Route path="/invoices/magic/:token" element={<MagicInvoice />} />

      {/* ✅ Magic agreement */}
      <Route path="/agreements/magic/:token" element={<MagicAgreement />} />

      {/* ✅ Public dispute thread (existing) */}
      <Route path="/disputes/:id" element={<PublicDisputeView />} />

      {/* ✅ NEW: Public dispute decision */}
      <Route path="/disputes/:id/decision" element={<PublicDisputeDecision />} />

      {/* Public contractor profile */}
      <Route path="/contractors/:id" element={<PublicProfile />} />

      {/* catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
