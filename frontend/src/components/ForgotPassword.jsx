// frontend/src/components/ForgotPassword.jsx
// v2025-12-31 — Fix invalid regex pattern + request reset link

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function ForgotPassword() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessMsg("");
    setErrorMsg("");

    const trimmed = (email || "").trim().toLowerCase();
    if (!trimmed) {
      setErrorMsg("⚠️ Please enter your email.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/accounts/auth/password-reset/request/", { email: trimmed });
      setSuccessMsg("✅ If this email is registered, a reset link has been sent.");
      setTimeout(() => navigate("/?login=1"), 1500);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        "⚠️ Could not request a reset link. Please try again.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-100 to-blue-300">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <h2 className="text-2xl font-bold text-blue-700 mb-6">Forgot Password</h2>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            // ✅ IMPORTANT: no pattern attribute (prevents the invalid regex crash)
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2 flex items-center justify-center ${
              loading ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            } text-white rounded-lg transition duration-300`}
          >
            {loading ? "Sending…" : "Send Reset Link"}
          </button>
        </form>

        {successMsg && (
          <div className="mt-4 text-green-600 flex items-center gap-2 justify-center">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            <p>{successMsg}</p>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 text-red-600 flex items-center gap-2 justify-center">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <p>{errorMsg}</p>
          </div>
        )}

        <button
          className="mt-6 text-sm text-blue-700 hover:underline"
          onClick={() => navigate("/?login=1")}
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
