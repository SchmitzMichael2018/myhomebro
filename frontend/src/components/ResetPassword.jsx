// frontend/src/components/ResetPassword.jsx
// v2025-11-28 — Password reset confirmation page (matches ForgotPassword styling)

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { uid, token } = useParams();

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleReset = async (e) => {
    e.preventDefault();
    setSuccessMsg("");
    setErrorMsg("");

    if (password.length < 8) {
      setErrorMsg("⚠️ Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setErrorMsg("⚠️ Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/accounts/auth/password-reset/confirm/", {
        uid,
        token,
        new_password: password,
      });

      setSuccessMsg("✅ Your password has been reset. Redirecting…");
      setTimeout(() => navigate("/?login=1"), 1500);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        "⚠️ This reset link is invalid or expired.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-100 to-blue-300">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <h2 className="text-2xl font-bold text-blue-700 mb-6">
          Set a New Password
        </h2>

        <form className="space-y-4" onSubmit={handleReset}>
          {/* Password */}
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Confirm password */}
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              placeholder="Confirm new password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              minLength={8}
              required
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Toggle show/hide */}
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showPw}
              onChange={() => setShowPw((s) => !s)}
            />
            Show Passwords
          </label>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2 flex items-center justify-center ${
              loading ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            } text-white rounded-lg transition duration-300`}
          >
            {loading ? "Saving…" : "Save New Password"}
          </button>
        </form>

        {/* Success */}
        {successMsg && (
          <div className="mt-4 text-green-600 flex items-center gap-2">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            <p>{successMsg}</p>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="mt-4 text-red-600 flex items-center gap-2">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <p>{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
