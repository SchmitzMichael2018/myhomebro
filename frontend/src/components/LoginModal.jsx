// src/components/LoginModal.jsx
import React, { useEffect, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import api, { setTokens } from "../api";
import logo from "../assets/myhomebro_logo.png";

/**
 * LoginModal (Sign In only)
 */
export default function LoginModal() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const openLogin = useCallback(() => setVisible(true), []);
  const close = () => { if (!loading) setVisible(false); };

  // Global opener + event listener
  useEffect(() => {
    window.mhbOpenLogin = (mode = "login") => {
      if (mode === "signup") {
        if (typeof window.mhbOpenSignup === "function") window.mhbOpenSignup();
        else window.dispatchEvent(new CustomEvent("mhb:open-signup"));
        return;
      }
      openLogin();
    };
    const onEvt = (e) => {
      const mode = e?.detail?.mode || "login";
      if (mode === "signup") {
        if (typeof window.mhbOpenSignup === "function") window.mhbOpenSignup();
        else window.dispatchEvent(new CustomEvent("mhb:open-signup"));
      } else {
        openLogin();
      }
    };
    window.addEventListener("mhb:open-login", onEvt);
    return () => {
      try { delete window.mhbOpenLogin; } catch {}
      window.removeEventListener("mhb:open-login", onEvt);
    };
  }, [openLogin]);

  // Auto-open / redirect from URL hints (kept as-is)
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    const hash = (url.hash || "").toLowerCase();

    const wantsLogin = q.get("login") === "1" || hash.includes("login");
    const wantsSignup = q.get("signup") === "1" || hash.includes("signup");

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

  const handleSubmit = async (e) => {
    e?.preventDefault?.();

    // hard reset tokens before attempting auth
    try {
      localStorage.removeItem('access');
      localStorage.removeItem('refresh');
      sessionStorage.removeItem('access');
      sessionStorage.removeItem('refresh');
    } catch {}

    const payload = {
      email: String(email || '').trim().toLowerCase(),
      password: String(password || ''),
    };

    if (!payload.email || !payload.password) {
      toast.error("Enter email and password.");
      return;
    }

    setLoading(true);
    try {
      // Correct endpoint
      const { data } = await api.post("/auth/login/", payload);
      const access = data?.access || data?.access_token;
      const refresh = data?.refresh || data?.refresh_token;
      if (!access) throw new Error("Missing tokens");
      setTokens(access, refresh);
      toast.success("Signed in!");
      setVisible(false);
      window.location.href = "/dashboard";
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        "Sign-in failed.";
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
                placeholder="you@company.com"
              />
            </label>

            <label>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                Password
              </div>
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
                <label style={{ display: "inline-flex", gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={showPw}
                    onChange={(e) => setShowPw(e.target.checked)}
                  />
                  Show
                </label>
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
              New contractor?{" "}
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
