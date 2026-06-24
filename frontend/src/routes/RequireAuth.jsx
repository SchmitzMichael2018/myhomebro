// src/routes/RequireAuth.jsx
// v2025-12-21 — allow public magic invoice routes

import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAuth({ children }) {
  const { isAuthed, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null; // or a tiny splash

  // ✅ CRITICAL: allow homeowner magic invoice links
  // even if a contractor is logged in
  if (location.pathname.startsWith("/invoices/magic/")) {
    return children;
  }

  if (!isAuthed) {
    // not signed in → back to landing
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return children;
}
