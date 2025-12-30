// src/routes/PublicRoutes.jsx
// v2025-12-23 — public routes aligned to token-in-path for magic invoice links

import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "../components/LandingPage.jsx";
import LoginForm from "../components/LoginForm.jsx";
import SignUpForm from "../components/SignUpForm.jsx";
import ForgotPassword from "../components/ForgotPassword.jsx";

// Public pages
import HomeownerSign from "../pages/HomeownerSign.jsx";   // /agreements/sign/:id?token=...
import MagicInvoice from "../pages/MagicInvoice.jsx";     // /invoices/magic/:token
import MagicAgreement from "../pages/MagicAgreement.jsx"; // /agreements/magic/:token (recommended)
import PublicProfile from "../pages/PublicProfile.jsx";   // /contractors/:id public view

// Optional: your /invoice/:token router page (if you use PublicRoutes as the main router)
import InvoicePage from "../pages/InvoicePage.jsx";       // /invoice/:token → redirects to /invoices/magic/:token

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

      {/* ✅ Public magic invoice (token in path, no querystring token) */}
      <Route path="/invoices/magic/:token" element={<MagicInvoice />} />

      {/* ✅ Recommended: magic agreement token in path (if you move that flow too) */}
      <Route path="/agreements/magic/:token" element={<MagicAgreement />} />

      {/* Public contractor profile */}
      <Route path="/contractors/:id" element={<PublicProfile />} />

      {/* catch-all for unauthenticated users */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
