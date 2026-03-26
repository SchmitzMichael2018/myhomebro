// src/components/LoginModal.jsx
import React, { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import api, { setTokens } from "../api";
import logo from "../assets/myhomebro_logo.png";

/**
 * LoginModal (Sign In only)
 *
 * ✅ Remember Me:
 * - If checked, tokens persist (localStorage)
 * - If unchecked, tokens are session-only (sessionStorage)
 *
 * ✅ Invite support:
 * - If URL includes ?invite=<token>, after successful login we call:
 *   POST /api/projects/invites/<token>/accept/
 *
 * ✅ UX:
 * - On invite accept success, route contractor to Customers list with:
 *   /customers?new_customer_id=<id>
 */
export default function LoginModal() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const [rememberMe, setRememberMe] = useState(true);
  const [inviteToken, setInviteToken] = useState("");

  const openLogin = useCallback(() => setVisible(true), []);
  const close = () => {
    if (!loading) setVisible(false);
  };

  const getInviteFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      return (url.searchParams.get("invite") || "").trim();
    } catch {
      return "";
    }
  };

  const removeInviteFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams;
      if (!q.get("invite")) return;
      q.delete("invite");
      const cleaned = `${url.pathname}${q.toString() ? "?" + q.toString() : ""}${
        url.hash || ""
      }`;
      window.history.replaceState({}, "", cleaned);
    } catch {}
  };

  const acceptInviteIfPresent = async (token) => {
    const t = String(token || "").trim();
    if (!t) return { ok: false, skipped: true };
    try {
      // api.js baseURL is "/api"
      const endpoint = `/projects/invites/${encodeURIComponent(t)}/accept/`;
      const { data } = await api.post(endpoint, {});
      return { ok: true, data };
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Invite acceptance failed (you are still signed in).";
      toast.error(String(msg));
      console.error("Invite accept error:", err);
      return { ok: false, error: err };
    }
  };

  // Global opener + event listener
  useEffect(() => {
    window.mhbOpenLogin = (mode = "login", opts = {}) => {
      if (mode === "signup") {
        if (typeof window.mhbOpenSignup === "function") window.mhbOpenSignup();
        else window.dispatchEvent(new CustomEvent("mhb:open-signup"));
        return;
      }

      const urlInvite = getInviteFromUrl();
      const passedInvite = (opts?.invite || "").trim();
      setInviteToken(urlInvite || passedInvite || "");

      openLogin();
    };

    const onEvt = (e) => {
      const mode = e?.detail?.mode || "login";
      if (mode === "signup") {
        if (typeof window.mhbOpenSignup === "function") window.mhbOpenSignup();
        else window.dispatchEvent(new CustomEvent("mhb:open-signup"));
        return;
      }

      const urlInvite = getInviteFromUrl();
      const passedInvite = (e?.detail?.invite || "").trim();
      setInviteToken(urlInvite || passedInvite || "");

      openLogin();
    };

    window.addEventListener("mhb:open-login", onEvt);
    return () => {
      try {
        delete window.mhbOpenLogin;
      } catch {}
      window.removeEventListener("mhb:open-login", onEvt);
    };
  }, [openLogin]);

  // Auto-open / URL hints
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    const hash = (url.hash || "").toLowerCase();

    const wantsLogin = q.get("login") === "1" || hash.includes("login");
    const wantsSignup = q.get("signup") === "1" || hash.includes("signup");

    const invite = (q.get("invite") || "").trim();
    if (invite) setInviteToken(invite);

    if (wantsSignup) {
      if (q.get("signup")) q.delete("signup");
      const cleaned = `${url.pathname}${q.toString() ? "?" + q.toString() : ""}`;
      window.history.replaceState({}, "", cleaned);
      if (typeof window.mhbOpenSignup === "function") window.mhbOpenSignup();
      else window.dispatchEvent(new CustomEvent("mhb:open-signup"));
      return;
    }

    if (wantsLogin) {
      if (q.get("login")) {
        q.delete("login");
        const cleaned = `${url.pathname}${q.toString() ? "?" + q.toString() : ""}`;
        window.history.replaceState({}, "", cleaned);
      }
      openLogin();
    }
  }, [openLogin]);

  const handleForgotPassword = (e) => {
    e.preventDefault();
    if (!loading) {
      setVisible(false);
      window.location.href = "/forgot-password";
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();

    // Reset tokens before login
    try {
      localStorage.removeItem("access");
      localStorage.removeItem("refresh");
      sessionStorage.removeItem("access");
      sessionStorage.removeItem("refresh");
    } catch {}

    const payload = {
      email: String(email || "").trim().toLowerCase(),
      password: String(password || ""),
    };

    if (!payload.email || !payload.password) {
      toast.error("Enter both email and password.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("/auth/login/", payload);
      const access = data?.access || data?.access_token;
      const refresh = data?.refresh || data?.refresh_token;
      if (!access) throw new Error("Missing tokens");

      setTokens(access, refresh || null, !!rememberMe);

      const tokenToAccept = inviteToken || getInviteFromUrl();
      if (tokenToAccept) {
        const result = await acceptInviteIfPresent(tokenToAccept);
        if (result?.ok) {
          const newId = result?.data?.client_id;
          toast.success("Customer created successfully!");
          removeInviteFromUrl();
          setVisible(false);

          // ✅ Route to customer list so they see it immediately (and can show NEW badge)
          if (newId) {
            window.location.href = `/customers?new_customer_id=${encodeURIComponent(
              String(newId)
            )}`;
          } else {
            window.location.href = "/customers";
          }
          return;
        }
      }

      toast.success("Signed in. Redirecting to your dashboard.");
      setVisible(false);
      window.location.href = "/dashboard";
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        "Unable to sign in. Check your email and password and try again.";
      toast.error(String(msg));
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="mhb-modal-overlay" role="dialog" aria-modal="true">
      <div className="mhb-modal-card" style={{ maxWidth: 520 }}>
        <div className="mhb-modal-header" style={{ justifyContent: "center" }}>
          <div style={{ display: "grid", placeItems: "center", width: "100%" }}>
            <div
              style={{
                display: "grid",
                placeItems: "center",
                width: 88,
                height: 88,
                borderRadius: 18,
                border: "4px solid rgba(0,0,0,0.06)",
                outline: "2px solid rgba(0,0,0,0.03)",
                background:
                  "radial-gradient(100px 100px at 30% 20%, rgba(0,0,0,0.06), rgba(0,0,0,0) 60%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,.6), 0 10px 24px rgba(0,0,0,.08)",
                overflow: "hidden",
              }}
            >
              <img
                src={logo}
                alt="MyHomeBro"
                style={{ maxWidth: 72, maxHeight: 72, display: "block" }}
              />
            </div>

            <h2 style={{ margin: "10px 0 0", fontSize: 20, fontWeight: 900 }}>
              Sign In
            </h2>

            {inviteToken ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                Sign in to accept this invite and add the homeowner to your customer list.
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                Sign in to manage agreements, leads, payments, and project updates.
              </div>
            )}
          </div>

          <button className="mhb-modal-close" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mhb-modal-body">
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                Email
              </div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                style={{
                  width: "100%",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
                placeholder="you@example.com"
              />
            </label>

            <label>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                Password
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPw ? "text" : "password"}
                    required
                    style={{
                      width: "100%",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                    placeholder="••••••••"
                  />

                  <label
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      fontSize: 12,
                      cursor: "pointer",
                      userSelect: "none",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showPw}
                      onChange={(e) => setShowPw(e.target.checked)}
                    />
                    Show
                  </label>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 2,
                  }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      gap: 8,
                      fontSize: 12,
                      color: "#64748b",
                      cursor: "pointer",
                      userSelect: "none",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={loading}
                    />
                    Remember me
                  </label>

                  <a
                    href="/forgot-password"
                    onClick={handleForgotPassword}
                    style={{ color: "#0ea5e9", fontWeight: 600, fontSize: 12 }}
                  >
                    Forgot password?
                  </a>
                </div>
              </div>
            </label>

            <button
              type="submit"
              className="mhb-btn primary"
              disabled={loading}
              style={{ justifyContent: "center" }}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

            <div
              style={{
                marginTop: 2,
                fontSize: 12,
                color: "#64748b",
                textAlign: "center",
              }}
            >
              New here?{" "}
              <a
                href="/contractor/signup"
                style={{ fontWeight: 800, color: "#0ea5e9" }}
                onClick={(e) => {
                  e.preventDefault();
                  if (typeof window.mhbOpenSignup === "function") window.mhbOpenSignup();
                  else window.dispatchEvent(new CustomEvent("mhb:open-signup"));
                }}
              >
                Sign up
              </a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
