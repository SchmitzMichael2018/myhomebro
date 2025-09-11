// src/components/StripeOnboarding.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function StripeOnboarding() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");        // onboarding_status from API
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  async function fetchStatus() {
    setLoading(true);
    setError("");
    try {
      // GET status is public-safe; when authenticated it reports actual state
      const { data } = await api.get("/projects/contractor-onboarding-status/");
      setStatus(String(data?.onboarding_status || ""));
      setConnected(Boolean(data?.connected));
      // If already completed, bounce to dashboard
      if (String(data?.onboarding_status) === "completed") {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      setError("Failed to fetch onboarding status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startOrContinue() {
    setLoading(true);
    setError("");
    try {
      // POST always returns a fresh AccountLink to (re)open onboarding
      const { data } = await api.post("/projects/contractor-onboarding/");
      const url = data?.onboarding_url;
      if (url) {
        window.location.href = url;
      } else {
        setError("Onboarding URL not returned from server.");
      }
    } catch (err) {
      setError("Failed to start onboarding.");
    } finally {
      setLoading(false);
    }
  }

  const pretty = status
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : connected
    ? "Completed"
    : "Not started";

  return (
    <div className="mx-auto mt-16 max-w-lg rounded bg-white p-8 text-center shadow">
      <h2 className="mb-4 text-2xl font-bold text-blue-700">Stripe Connect Onboarding</h2>

      {loading ? (
        <div>Loading status…</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : (
        <>
          <p className="mb-4">
            <span className="font-semibold">Status:</span>{" "}
            <span className={connected ? "text-green-600" : "text-yellow-600"}>{pretty}</span>
          </p>

          {!connected && (
            <button
              className="rounded bg-blue-600 px-6 py-2 font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
              onClick={startOrContinue}
              disabled={loading}
            >
              Open Stripe Onboarding
            </button>
          )}

          {connected && (
            <button
              className="mt-3 rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              onClick={() => navigate("/dashboard")}
            >
              Go to Dashboard
            </button>
          )}
        </>
      )}
    </div>
  );
}
