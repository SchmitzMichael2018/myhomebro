// src/routes/PublicRoutes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import LandingPage    from "../components/LandingPage.jsx";
import LoginForm      from "../components/LoginForm.jsx";
import SignUpForm     from "../components/SignUpForm.jsx";
import ForgotPassword from "../components/ForgotPassword.jsx";

// Public pages
import HomeownerSign  from "../pages/HomeownerSign.jsx";   // /agreements/sign/:id?token=...
import MagicInvoice   from "../pages/MagicInvoice.jsx";    // /invoices/magic/:id?token=...
import MagicAgreement from "../pages/MagicAgreement.jsx";  // /agreements/magic/:id?token=...
import PublicProfile  from "../pages/PublicProfile.jsx";   // /contractors/:id public view

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
      <Route path="/invoices/magic/:id" element={<MagicInvoice />} />
      <Route path="/agreements/magic/:id" element={<MagicAgreement />} />

      {/* Public contractor profile */}
      <Route path="/contractors/:id" element={<PublicProfile />} />

      {/* catch-all for unauthenticated users */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
