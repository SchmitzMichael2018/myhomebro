// src/components/LoginForm.jsx
// v2026-02-09 Invite token + Remember Me
// - If URL includes ?invite=<token>, after successful login we call:
//   POST /api/projects/invites/<token>/accept/
// - Remember Me controls token persistence via setTokens(..., remember)

import React, { useEffect, useRef, useState, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import api, { setTokens } from "../api";
import toast from "react-hot-toast";
import { resolveAuthenticatedEntry } from "../lib/contractorOnboardingRoute.js";
import logo from "../assets/myhomebro_logo.png";

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
    } catch { /* Ignore malformed return parameters and preserve the current route. */ }
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
          const sourceIntakeUrl = result?.data?.source_intake_url || "";
          if (sourceIntakeUrl) {
            toast.success("Invite accepted. Opening the project intake.");
            navigate(sourceIntakeUrl);
            return;
          }
          toast.success("Invite accepted - customer imported into your client list.");
          removeInviteFromUrl();
        } else {
          toast.success("Welcome back!");
        }
      } else {
        toast.success("Welcome back!");
      }

      if (redirectTo === "/dashboard" || redirectTo === "/app/dashboard") {
        const { data: identityData } = await api.get("/projects/whoami/");
        const identity = Array.isArray(identityData) ? identityData[0] : identityData;
        const nextRoute = await resolveAuthenticatedEntry(identity);
        if (!nextRoute) throw new Error("Unable to determine the signed-in account route.");
        navigate(nextRoute);
      } else {
        navigate(redirectTo);
      }
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Invalid email or password.";
      toast.error(String(msg));
      console.error("LoginForm error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(245,178,30,0.24),_transparent_34%),linear-gradient(145deg,_#06152d,_#0a2b59)] px-4 py-8">
      <section className="w-full max-w-md rounded-3xl border border-white/15 bg-white p-6 shadow-2xl sm:p-8" aria-labelledby="login-title">
        <div className="mb-7 text-center">
          <Link to="/" className="inline-flex items-center justify-center gap-3" aria-label="MyHomeBro home">
            <img src={logo} alt="" className="h-14 w-14 rounded-2xl object-cover shadow-lg" />
            <span className="text-2xl font-black tracking-tight text-slate-950">
              MyHome<span className="text-amber-500">Bro</span>
            </span>
          </Link>
          <h1 id="login-title" className="mt-6 text-2xl font-extrabold text-slate-950">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sign in to your contractor, team member, or customer workspace.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
      <input
        ref={emailRef}
        type="email"
        name="email"
        data-testid="login-email-input"
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
          data-testid="login-password-input"
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
        data-testid="login-submit-button"
        disabled={loading}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
      >
        {loading ? "Signing In..." : "Sign In"}
      </button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-200 pt-5 text-sm">
          <Link to="/forgot-password" className="font-semibold text-blue-700 hover:text-blue-800 hover:underline">
            Forgot password?
          </Link>
          <Link to="/" className="font-semibold text-slate-600 hover:text-slate-900 hover:underline">
            Back to home
          </Link>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">Secure project access by MyHomeBro</p>
      </section>
    </main>
  );
}
