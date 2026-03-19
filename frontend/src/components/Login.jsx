// frontend/src/components/Login.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * Bridge component to preserve your current login UX (Landing + LoginModal).
 * Behavior:
 *  - If logged in -> go to /dashboard (or where the user was heading)
 *  - If not logged in -> redirect to "/?login=1" which auto-opens LoginModal
 *
 * ✅ v2026-02-09:
 * - Preserves ?invite=<token> so contractors can accept invites after login
 *   Example: /login?invite=abc -> /?login=1&invite=abc
 *
 * NOTE: Make sure <LoginModal /> is mounted on your Landing page so ?login=1 works.
 */
export default function Login() {
  const location = useLocation();

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("access") ||
        localStorage.getItem("accessToken") ||
        sessionStorage.getItem("access") ||
        sessionStorage.getItem("accessToken")
      : null;

  if (token) {
    const to = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={to} replace />;
  }

  // ✅ Preserve invite token (if present) when handing off to Landing
  let invite = "";
  try {
    const sp = new URLSearchParams(location.search || "");
    invite = (sp.get("invite") || "").trim();
  } catch {
    invite = "";
  }

  const qs = invite ? `/?login=1&invite=${encodeURIComponent(invite)}` : "/?login=1";

  // Hand off to Landing so your existing LoginModal pops open (no layout changes).
  return <Navigate to={qs} replace state={{ from: location }} />;
}
