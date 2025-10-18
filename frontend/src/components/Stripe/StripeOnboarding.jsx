// COMPLETE FILE — Stripe Connect Onboarding + Manage button (r2)
// Place at: src/components/Stripe/StripeOnboarding.jsx

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api";

export default function StripeOnboarding() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState("");

  async function fetchStatus() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/api/payments/onboarding/status/");
      const s = String(data?.onboarding_status || "");
      const isLinked = Boolean(data?.linked || data?.connected);

      setStatus(s);
      setLinked(isLinked);

      // If fully complete, optionally return them to dashboard
      // (comment this out if you want them to see the manage button anyway)
      // if (s === "completed" || isLinked) {
      //   navigate("/dashboard", { replace: true });
      // }
    } catch (err) {
      console.error(err);
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
      const { data } = await api.post("/api/payments/onboarding/start/");
      const url = data?.onboarding_url || data?.url;
      if (url) {
        window.location.href = url;
      } else {
        setError("Onboarding URL not returned from server.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to start onboarding.");
    } finally {
      setLoading(false);
    }
  }

  async function openManage() {
    setLoading(true);
    setError("");
    try {
      // Prefer account_update link; fallback to login link if you like:
      const { data } = await api.post("/api/payments/onboarding/manage/");
      const url = data?.manage_url;
      if (url) {
        window.location.href = url;
      } else {
        setError("Manage URL not returned from server.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to open Stripe settings.");
    } finally {
      setLoading(false);
    }
  }

  const pretty = status
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : linked
    ? "Completed"
    : "Not started";

  return (
    <div className="mx-auto mt-10 max-w-2xl rounded bg-white p-8 shadow">
      <h1 className="mb-2 text-2xl font-bold">Stripe Connect</h1>
      <p className="mb-6 text-sm text-gray-600">
        Connect and manage your Stripe account to receive milestone payouts through MyHomeBro.
      </p>

      {loading ? (
        <div>Loading status…</div>
      ) : error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-red-700">{error}</div>
      ) : (
        <>
          <div className="mb-6">
            <span className="font-semibold">Status:</span>{" "}
            <span className={linked ? "text-green-600" : "text-yellow-700"}>{pretty}</span>
          </div>

          <div className="flex flex-wrap gap-3">
            {!linked && (
              <button
                onClick={startOrContinue}
                disabled={loading}
                className="rounded bg-blue-600 px-6 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Open Stripe Onboarding
              </button>
            )}

            {/* Always allow manage button; Stripe will show the appropriate UI */}
            <button
              onClick={openManage}
              disabled={loading}
              className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              title="Update bank account, tax info, or verification docs"
            >
              Manage Stripe Settings
            </button>

            <button
              onClick={() => navigate("/dashboard")}
              className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Go to Dashboard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
