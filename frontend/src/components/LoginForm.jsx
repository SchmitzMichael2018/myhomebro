// frontend/src/components/LoginForm.jsx
// v2025-11-28 — Added Show/Hide Password toggle

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { setTokens } from "../api";
import toast from "react-hot-toast";

export default function LoginForm({ redirectTo = "/dashboard" }) {
  const navigate = useNavigate();
  const emailRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [form, setForm] = useState({ email: "", password: "" });

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login/", {
        email: form.email.trim(),
        password: form.password,
      });
      const access = data?.access || data?.access_token;
      const refresh = data?.refresh || data?.refresh_token;
      if (!access) throw new Error("Login succeeded but no tokens returned.");
      setTokens(access, refresh || null, true);
      toast.success("Welcome back!");
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

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
      >
        {loading ? "Signing In…" : "Sign In"}
      </button>
    </form>
  );
}
