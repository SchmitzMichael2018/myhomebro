// src/components/SignUpModal.jsx
// v2025-11-09 — Contractor Sign Up modal with Show/Hide password
// Links include a cache-buster (?v=timestamp) to avoid stale browser cache.

import React, { useEffect, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import api, { setTokens } from "../api";
import logo from "../assets/myhomebro_logo.png";

export default function SignUpModal() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm: "",
    phone: "",
    agree: false,
  });

  const [showPw, setShowPw] = useState(false);
  const firstRef = useRef(null);

  const openSignup = useCallback(() => setVisible(true), []);
  const close = () => { if (!loading) setVisible(false); };

  // Global opener + event listener
  useEffect(() => {
    window.mhbOpenSignup = () => openSignup();
    const onEvt = () => openSignup();
    window.addEventListener("mhb:open-signup", onEvt);
    return () => {
      try { delete window.mhbOpenSignup; } catch {}
      window.removeEventListener("mhb:open-signup", onEvt);
    };
  }, [openSignup]);

  useEffect(() => {
    if (visible) setTimeout(() => firstRef.current?.focus(), 0);
  }, [visible]);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
  };

  const validate = () => {
    if (!form.agree) return "Please agree to the Terms to continue.";
    if (!form.first_name.trim() || !form.last_name.trim()) return "First and last name are required.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return "Enter a valid email.";
    if (form.password.length < 8) return "Password must be at least 8 characters.";
    if (form.password !== form.confirm) return "Passwords do not match.";
    if (form.phone && !/^[0-9]{10}$/.test(form.phone)) return "Phone must be 10 digits (numbers only).";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }

    setLoading(true);
    try {
      const payload = {
        email: form.email.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_number: form.phone.trim(),
      };
      const { data } = await api.post("/auth/contractor-register/", payload);

      if (data?.access) {
        setTokens(data.access, data.refresh || null, true);
        toast.success("Account created!");
        setVisible(false);
        window.location.href = "/onboarding";
        return;
      }

      toast.success(data?.message || "Registration successful. Check your email to verify.");
      setVisible(false);
    } catch (err2) {
      const msg =
        err2?.response?.data?.detail ||
        err2?.response?.data?.email ||
        (Array.isArray(err2?.response?.data?.password) ? err2.response.data.password[0] : null) ||
        err2?.message ||
        "Registration failed.";
      toast.error(String(msg));
      console.error("SignUpModal error:", err2);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  // Prevent label click from toggling the checkbox when clicking links
  const stopLabelToggle = (e) => e.stopPropagation();
  const openFresh = (path) => {
    const url = `${path}?v=${Date.now()}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="mhb-modal-overlay" role="dialog" aria-modal="true">
      <div className="mhb-modal-card" style={{ maxWidth: 520 }}>
        <div className="mhb-modal-header" style={{ justifyContent: "center" }}>
          <div style={{ display: "grid", placeItems: "center", width: "100%" }}>
            <div
              style={{
                display: "grid", placeItems: "center", width: 88, height: 88, borderRadius: 18,
                border: "4px solid rgba(0,0,0,0.06)", outline: "2px solid rgba(0,0,0,0.03)",
                background: "radial-gradient(100px 100px at 30% 20%, rgba(0,0,0,0.06), rgba(0,0,0,0) 60%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,.6), 0 10px 24px rgba(0,0,0,.08)",
                overflow: "hidden",
              }}
            >
              <img src={logo} alt="MyHomeBro" style={{ maxWidth: 72, maxHeight: 72, display: "block" }} />
            </div>
            <h2 style={{ margin: "10px 0 0", fontSize: 20, fontWeight: 900 }}>Contractor Sign Up</h2>
          </div>
          <button className="mhb-modal-close" onClick={close} aria-label="Close">✕</button>
        </div>

        <div className="mhb-modal-body">
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>First Name</div>
                  <input
                    ref={firstRef}
                    name="first_name"
                    value={form.first_name}
                    onChange={onChange}
                    required
                    style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}
                  />
                </label>
                <label>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Last Name</div>
                  <input
                    name="last_name"
                    value={form.last_name}
                    onChange={onChange}
                    required
                    style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}
                  />
                </label>
              </div>

              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Email</div>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={onChange}
                  required
                  style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}
                  placeholder="you@company.com"
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Password</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type={showPw ? "text" : "password"}
                      name="password"
                      value={form.password}
                      onChange={onChange}
                      required
                      minLength={8}
                      style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}
                      placeholder="••••••••"
                    />
                    <label style={{ display: "inline-flex", gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
                      Show
                    </label>
                  </div>
                </label>
                <label>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Confirm Password</div>
                  <input
                    type="password"
                    name="confirm"
                    value={form.confirm}
                    onChange={onChange}
                    required
                    minLength={8}
                    style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}
                    placeholder="••••••••"
                  />
                </label>
              </div>

              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Phone (10 digits)</div>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={onChange}
                  pattern="^[0-9]{10}$"
                  style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px" }}
                  placeholder="2105551212"
                />
              </label>

              {/* Agree row with inline links that always fetch fresh text */}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input type="checkbox" name="agree" checked={form.agree} onChange={onChange} />
                <span>
                  I agree to the{" "}
                  <span onClick={stopLabelToggle} style={{ fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
                        role="link" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openFresh("/static/legal/terms_of_service.txt"); }}
                        onClick={() => openFresh("/static/legal/terms_of_service.txt")}>
                    Terms of Service
                  </span>
                  {" "}and{" "}
                  <span onClick={stopLabelToggle} style={{ fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
                        role="link" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openFresh("/static/legal/privacy_policy.txt"); }}
                        onClick={() => openFresh("/static/legal/privacy_policy.txt")}>
                    Privacy Policy
                  </span>.
                </span>
              </label>

              <button
                type="submit"
                className="mhb-btn primary"
                disabled={loading}
                style={{ justifyContent: "center" }}
              >
                {loading ? "Signing Up..." : "Sign Up"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
