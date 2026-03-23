// src/components/LoginForm.jsx
// v2026-02-09 Invite token + Remember Me
// - If URL includes ?invite=<token>, after successful login we call:
//   POST /api/projects/invites/<token>/accept/
// - Remember Me controls token persistence via setTokens(..., remember)

import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api, { setTokens } from "../api";
import toast from "react-hot-toast";

export default function LoginForm({ redirectTo = "/dashboard" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const emailRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [form, setForm] = useState({ email: "", password: "" });

  const inviteToken = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      return (sp.get("invite") || "").trim();
    } catch {
      return "";
    }
  }, [location.search]);

  const subcontractorInviteToken = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      return (sp.get("subcontractor_invite") || "").trim();
    } catch {
      return "";
    }
  }, [location.search]);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const removeInviteFromUrl = () => {
    try {
      const sp = new URLSearchParams(location.search || "");
      if (!sp.get("invite")) return;
      sp.delete("invite");
      const nextSearch = sp.toString() ? `?${sp.toString()}` : "";
      navigate(`${location.pathname}${nextSearch}`, { replace: true });
    } catch {}
  };

  const acceptInviteIfPresent = async (token) => {
    const t = String(token || "").trim();
    if (!t) return { ok: false, skipped: true };
    try {
      const endpoint = `/projects/invites/${encodeURIComponent(t)}/accept/`;
      const { data } = await api.post(endpoint, {});
      return { ok: true, data };
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Invite acceptance failed (you are still signed in).";
      toast.error(String(msg));
      console.error("LoginForm invite accept error:", err);
      return { ok: false, error: err };
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login/", {
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      const access = data?.access || data?.access_token;
      const refresh = data?.refresh || data?.refresh_token;
      if (!access) throw new Error("Login succeeded but no tokens returned.");

      setTokens(access, refresh || null, !!rememberMe);

      if (subcontractorInviteToken) {
        toast.success("Signed in. Review the invitation to continue.");
        return navigate(
          `/subcontractor-invitations/accept/${encodeURIComponent(
            subcontractorInviteToken
          )}`
        );
      }

      if (inviteToken) {
        const result = await acceptInviteIfPresent(inviteToken);
        if (result?.ok) {
          toast.success("Invite accepted - customer imported into your client list.");
          removeInviteFromUrl();
        } else {
          toast.success("Welcome back!");
        }
      } else {
        toast.success("Welcome back!");
      }

      navigate(redirectTo);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Invalid email or password.";
      toast.error(String(msg));
      console.error("LoginForm error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        ref={emailRef}
        type="email"
        name="email"
        value={form.email}
        onChange={onChange}
        placeholder="Email"
        required
        className="input-field"
      />

      <div className="relative">
        <input
          type={showPw ? "text" : "password"}
          name="password"
          value={form.password}
          onChange={onChange}
          placeholder="Password"
          required
          className="input-field pr-12"
        />

        <button
          type="button"
          onClick={() => setShowPw((s) => !s)}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-slate-500 hover:text-slate-800"
        >
          {showPw ? "Hide" : "Show"}
        </button>
      </div>

      {/* Remember Me */}
      <label className="flex items-center gap-2 text-xs text-slate-600 select-none">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          disabled={loading}
        />
        Remember me
      </label>

      {subcontractorInviteToken ? (
        <div className="text-xs text-slate-600">
          Sign in with the invited email address to continue to the subcontractor invitation.
        </div>
      ) : inviteToken ? (
        <div className="text-xs text-slate-600">
          Sign in to accept the invite and import the customer as a client.
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
      >
        {loading ? "Signing In..." : "Sign In"}
      </button>
    </form>
  );
}
