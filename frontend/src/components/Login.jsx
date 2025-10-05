// frontend/src/components/Login.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * Bridge component to preserve your current login UX (Landing + LoginModal).
 * Behavior:
 *  - If logged in -> go to /dashboard (or where the user was heading)
 *  - If not logged in -> redirect to "/?login=1" which auto-opens LoginModal
 *
 * NOTE: Make sure <LoginModal /> is mounted on your Landing page so ?login=1 works.
 */
export default function Login() {
  const location = useLocation();
  const token = typeof window !== "undefined" ? (localStorage.getItem("access") || localStorage.getItem("accessToken")) : null;

  if (token) {
    const to = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={to} replace />;
  }

  // Hand off to Landing so your existing LoginModal pops open (no layout changes).
  return <Navigate to="/?login=1" replace state={{ from: location }} />;
}
