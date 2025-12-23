// src/pages/ContractorSignUp.jsx
// v2025-11-09 — Contractor registration → login tokens → to /onboarding
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setTokens } from "../api";
import toast from "react-hot-toast";

export default function ContractorSignUp() {
  const navigate = useNavigate();
  const firstRef = useRef(null);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm: "",
    business_name: "",
    phone: "",
    agree: false,
  });
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
  };

  const validate = () => {
    if (!form.agree) return "Please agree to the Terms to continue.";
    if (!form.first_name.trim() || !form.last_name.trim()) return "First and last name are required.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return "Please enter a valid email.";
    if (form.password.length < 8) return "Password must be at least 8 characters.";
    if (form.password !== form.confirm) return "Passwords do not match.";
    if (form.phone && !/^\d{10}$/.test(form.phone.replace(/\D/g, ""))) return "Enter a valid 10-digit phone number.";
    return null;
  };

  async function registerContractor() {
    // Your backend exposes POST /api/auth/contractor-register/ (no extra /accounts):contentReference[oaicite:5]{index=5}:contentReference[oaicite:6]{index=6}
    const payload = {
      email: form.email.trim(),
      password: form.password,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      // Optional extras (serializer supports phone_number + Contractor created)
      phone_number: form.phone.replace(/\D/g, ""),
    };
    return api.post("/auth/contractor-register/", payload);
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    const msg = validate();
    if (msg) { toast.error(msg); return; }
    setBusy(true);
    try {
      const { data, status } = await registerContractor();

      // If email verification disabled, tokens are included; otherwise show message only:contentReference[oaicite:7]{index=7}
      const access = data?.access;
      const refresh = data?.refresh;

      if (access) {
        setTokens(access, refresh || null, true);
        toast.success("Account created!");
        navigate("/onboarding");
        return;
      }

      // No token → verification required
      toast.success(data?.message || "Registration successful. Please verify your email.");
      navigate("/");
    } catch (err) {
      const detail =
        err?.response?.data?.detail ||
        (Array.isArray(err?.response?.data?.password) ? err.response.data.password[0] : null) ||
        err?.response?.data?.email ||
        err?.message ||
        "Sign up failed.";
      toast.error(String(detail));
      // console for debugging
      // eslint-disable-next-line no-console
      console.error("ContractorSignUp error:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-xl bg-white rounded-2xl shadow p-6 space-y-5">
        <h1 className="text-2xl font-bold">Contractor Sign Up</h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">First name</span>
            <input ref={firstRef} name="first_name" value={form.first_name} onChange={onChange}
                   className="w-full border rounded px-3 py-2" autoComplete="given-name" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Last name</span>
            <input name="last_name" value={form.last_name} onChange={onChange}
                   className="w-full border rounded px-3 py-2" autoComplete="family-name" required />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input type="email" name="email" value={form.email} onChange={onChange}
                 className="w-full border rounded px-3 py-2" autoComplete="email" required />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <div className="relative">
              <input type={showPass ? "text" : "password"} name="password" value={form.password} onChange={onChange}
                     className="w-full border rounded px-3 py-2 pr-16" autoComplete="new-password" required minLength={8} />
              <button type="button" onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-blue-600">
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Confirm password</span>
            <input type="password" name="confirm" value={form.confirm} onChange={onChange}
                   className="w-full border rounded px-3 py-2" autoComplete="new-password" required minLength={8} />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Phone (optional)</span>
          <input name="phone" value={form.phone} onChange={onChange}
                 className="w-full border rounded px-3 py-2" placeholder="(555) 555-5555"
                 inputMode="tel" pattern="^\d{10}$" />
          <span className="text-xs text-slate-500">Digits only, e.g. 2105551212</span>
        </label>

        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="agree" checked={form.agree} onChange={onChange} />
          <span>I agree to the Terms of Service and Privacy Policy.</span>
        </label>

        <button type="submit" disabled={busy}
                className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-60">
          {busy ? "Creating your account…" : "Create Account"}
        </button>

        <p className="text-xs text-gray-500">
          You’ll be redirected to connect your Stripe account next.
        </p>
      </form>
    </div>
  );
}
