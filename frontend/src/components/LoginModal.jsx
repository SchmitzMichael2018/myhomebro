// src/components/LoginModal.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import logo from "../assets/myhomebro_logo.png";

export default function LoginModal() {
  const { isLoginOpen, closeLogin, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isLoginOpen) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      await login({ email, password, remember });
      closeLogin();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError("Login failed. Check your email/password and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
      onClick={closeLogin}
    >
      <div
        className="w-[360px] max-w-[92vw] rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-2">
          <img
            src={logo}
            alt="MyHomeBro"
            className="h-[58px] inline-block"
          />
        </div>

        <h2 className="text-xl font-bold mb-3 text-center">Sign in</h2>

        <form onSubmit={submit}>
          <label className="block text-xs font-semibold mb-1">Email</label>
          <input
            className="w-full h-10 rounded-lg border border-slate-300 px-3 outline-none"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <label className="block text-xs font-semibold mt-3 mb-1">Password</label>
          <div className="relative">
            <input
              className="w-full h-10 rounded-lg border border-slate-300 px-3 pr-20 outline-none"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            <button
              type="button"
              className="absolute right-2 top-1.5 h-7 px-2 rounded-md border border-slate-300 bg-slate-50 text-sm"
              onClick={() => setShowPw((s) => !s)}
              aria-label="Toggle password visibility"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>

          <label className="mt-3 inline-flex items-center select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm">Remember me</span>
          </label>

          {error ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full h-10 rounded-lg bg-blue-900 font-bold text-white hover:bg-blue-800 disabled:opacity-70"
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>

          <button
            type="button"
            onClick={closeLogin}
            className="mt-2 w-full h-9 rounded-lg border border-slate-300 bg-white"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
