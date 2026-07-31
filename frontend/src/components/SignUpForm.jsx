// src/components/SignUpForm.jsx
// v2026-02-10b — fix signup 404 by using real backend routes under /accounts/auth/*

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api, { setTokens } from "../api";
import toast from "react-hot-toast";

export function ContractorSignupForm({ embedded = false, onComplete }) {
  const navigate = useNavigate();
  const location = useLocation();
  const firstRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    passwordConfirm: "",
    phone: "",
    agree: false,
  });

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const subcontractorInviteToken = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      return (sp.get("subcontractor_invite") || "").trim();
    } catch {
      return "";
    }
  }, [location.search]);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
  };

  const validate = () => {
    if (!form.agree) return "Please agree to the Terms to continue.";
    if (!form.first_name.trim() || !form.last_name.trim()) return "First and last name are required.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return "Enter a valid email.";
    if (form.password.length < 8) return "Password must be at least 8 characters.";
    if (form.password !== form.passwordConfirm) return "Passwords do not match.";
    if (form.phone && !/^[0-9]{10}$/.test(form.phone)) return "Phone must be 10 digits (numbers only).";
    return null;
  };

  async function registerContractor(payload) {
    const candidates = [
      "/accounts/auth/contractor-register/",
      "/accounts/auth/register/",
      // fallback (if you later expose these)
      "/auth/contractor-register/",
      "/auth/register/",
    ];

    let last404 = null;
    for (const url of candidates) {
      try {
        const res = await api.post(url, payload);
        return { ...res, __used_url: url };
      } catch (e) {
        const st = e?.response?.status;
        if (st === 404) {
          last404 = e;
          continue;
        }
        throw { ...e, __used_url: url };
      }
    }
    throw last404 || new Error("No registration endpoint found.");
  }

  const submit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: form.email.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_number: form.phone,
      };

      const { data, __used_url } = await registerContractor(payload);
      // eslint-disable-next-line no-console
      console.log("✅ Contractor register used endpoint:", __used_url);

      if (data?.access) {
        setTokens(data.access, data.refresh || null, true);
        toast.success("Account created!");
        onComplete?.();
        if (subcontractorInviteToken) {
          return navigate(`/subcontractor-invitations/accept/${encodeURIComponent(subcontractorInviteToken)}`);
        }
        return navigate("/onboarding");
      }

      toast.success(data?.message || "Registration successful. Check your email to verify.");
      onComplete?.();
      navigate("/");
    } catch (err2) {
      const status = err2?.response?.status;
      if (status === 404) {
        toast.error("Signup endpoint not found on the server.");
        // eslint-disable-next-line no-console
        console.error("SignUpForm 404:", err2);
        return;
      }

      const msg =
        err2?.response?.data?.detail ||
        err2?.response?.data?.email ||
        (Array.isArray(err2?.response?.data?.password) ? err2.response.data.password[0] : null) ||
        err2?.message ||
        "Registration failed.";
      toast.error(String(msg));
      // eslint-disable-next-line no-console
      console.error("SignUpForm error:", err2);
    } finally {
      setLoading(false);
    }
  };

  const formContent = (
    <div className={`w-full max-w-md bg-white ${embedded ? "p-1" : "rounded-xl p-8 shadow-md"}`}>
      <h2 id={embedded ? "mhb-signup-title" : undefined} className="mb-6 text-center text-3xl font-bold text-blue-700">
        Contractor Sign Up
      </h2>

      {subcontractorInviteToken ? (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Create your account with the invited email address to continue to the subcontractor invitation.
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          <input
            ref={firstRef}
            name="first_name"
            value={form.first_name}
            onChange={onChange}
            placeholder="First Name"
            aria-label="First Name"
            autoComplete="given-name"
            required
            className="input-field"
          />
          <input
            name="last_name"
            value={form.last_name}
            onChange={onChange}
            placeholder="Last Name"
            aria-label="Last Name"
            autoComplete="family-name"
            required
            className="input-field"
          />
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={onChange}
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            required
            className="input-field"
          />
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={onChange}
            placeholder="Password"
            aria-label="Password"
            autoComplete="new-password"
            required
            className="input-field"
          />
          <input
            type="password"
            name="passwordConfirm"
            value={form.passwordConfirm}
            onChange={onChange}
            placeholder="Confirm Password"
            aria-label="Confirm Password"
            autoComplete="new-password"
            required
            className="input-field"
          />
          <input
            name="phone"
            value={form.phone}
            onChange={onChange}
            placeholder="Phone (10 digits)"
            aria-label="Phone (10 digits)"
            autoComplete="tel"
            pattern="^[0-9]{10}$"
            className="input-field"
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="agree"
            checked={form.agree}
            onChange={onChange}
            className="mt-0.5 shrink-0"
          />
          <span className="min-w-0">
            <span data-testid="signup-consent-copy">I agree to the </span>
            <Link
              to="/legal/terms-of-service/"
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-blue-700 underline decoration-1 underline-offset-2 visited:text-purple-700 hover:text-blue-900 hover:decoration-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Terms of Service
            </Link>
            <span> and </span>
            <Link
              to="/legal/privacy-policy/"
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-blue-700 underline decoration-1 underline-offset-2 visited:text-purple-700 hover:text-blue-900 hover:decoration-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Privacy Policy
            </Link>
            <span>.</span>
          </span>
        </label>

        <button type="submit" disabled={loading} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition">
          {loading ? "Signing Up..." : "Sign Up"}
        </button>
      </form>
    </div>
  );

  if (embedded) return formContent;

  return <div className="flex min-h-[70vh] items-center justify-center bg-gradient-to-r from-blue-50 to-blue-100">{formContent}</div>;
}

export default function SignUpForm() {
  return <ContractorSignupForm />;
}
