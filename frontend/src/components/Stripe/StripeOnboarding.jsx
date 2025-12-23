// frontend/src/components/Stripe/StripeOnboarding.jsx
// Simple Contractor Stripe Connect Onboarding
// - Uses /api/payments/onboarding/status|start|manage/
// - UI only; access is controlled by ProtectedRoutes + Sidebar.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api"; // from src/components/Stripe -> ../../api

export default function StripeOnboarding() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState("");

  // ──────────────────────────────────────────────
  // Fetch Stripe status
  // ──────────────────────────────────────────────
  async function fetchStatus() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/payments/onboarding/status/");
      const s = String(data?.onboarding_status || "");
      const isLinked =
        Boolean(data?.linked) ||
        Boolean(data?.connected) ||
        Boolean(data?.charges_enabled) ||
        Boolean(data?.payouts_enabled);

      setStatus(s);
      setLinked(isLinked);
    } catch (err) {
      console.error("Stripe onboarding status error", err?.response || err);
      setError("Failed to fetch Stripe onboarding status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ──────────────────────────────────────────────
  // Start or continue onboarding (redirect to Stripe)
  // ──────────────────────────────────────────────
  async function startOrContinue() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/payments/onboarding/start/");
      const url =
        data?.onboarding_overview_url || data?.onboarding_url || data?.url;

      if (url) {
        window.location.href = url; // full-page redirect to Stripe
      } else {
        setError("Onboarding URL not returned from server.");
      }
    } catch (err) {
      console.error("Stripe onboarding start error", err?.response || err);
      setError("Failed to start Stripe onboarding.");
    } finally {
      setLoading(false);
    }
  }

  // ──────────────────────────────────────────────
  // Open manage / login link (redirect to Stripe)
  // ──────────────────────────────────────────────
  async function openManage() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/payments/onboarding/manage/");
      const url = data?.manage_url || data?.url;

      if (url) {
        window.location.href = url;
      } else {
        setError("Manage URL not returned from server.");
      }
    } catch (err) {
      console.error("Stripe onboarding manage error", err?.response || err);
      setError("Failed to open Stripe settings.");
    } finally {
      setLoading(false);
    }
  }

  const prettyStatus = linked
    ? "Completed"
    : status
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : "Not started";

  const badgeClass =
    linked || status === "completed"
      ? "bg-green-100 text-green-700 border-green-300"
      : status
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : "bg-gray-100 text-gray-600 border-gray-300";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-blue-500 to-yellow-400 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {/* Top bar */}
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Back to Dashboard
          </button>
          <span className="text-xs text-gray-400">Stripe Onboarding</span>
        </div>

        <h1 className="mb-2 text-xl font-bold text-gray-900 text-center">
          Contractor Stripe Onboarding
        </h1>

        <p className="mb-4 text-xs text-gray-600 text-center">
          Connect your Stripe account to receive secure milestone payouts
          through MyHomeBro.
        </p>

        {/* Status badges */}
        <div className="mb-4 flex justify-center gap-2 text-xs">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 ${badgeClass}`}
          >
            {linked ? "Charges Enabled" : "Charges Disabled"}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 ${badgeClass}`}
          >
            {linked ? "Details Completed" : "Details Pending"}
          </span>
        </div>

        {/* Status text */}
        <p className="mb-4 text-center text-sm text-gray-700">
          Current status:{" "}
          <span className="font-semibold">{prettyStatus}</span>
        </p>

        {/* Error display */}
        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          {!linked && (
            <button
              type="button"
              onClick={startOrContinue}
              disabled={loading}
              className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Opening Stripe…" : "Start / Continue Onboarding"}
            </button>
          )}

          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="w-full rounded-md border border-gray-300 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {loading ? "Checking…" : "Refresh Status"}
          </button>

          <button
            type="button"
            onClick={openManage}
            disabled={loading || !linked}
            className="w-full rounded-md border border-gray-300 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Manage Stripe Settings
          </button>
        </div>
      </div>
    </div>
  );
}
