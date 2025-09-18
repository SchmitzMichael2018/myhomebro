// src/components/ContractorOnboardingForm.jsx
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

/**
 * Contractor Stripe Onboarding
 *
 * Backend routes (as defined in your projects/urls.py):
 *   POST /api/projects/contractor-onboarding/          -> { url | onboarding_url | redirect_url }
 *   GET  /api/projects/contractor-onboarding-status/   -> status object
 *
 * Notes:
 * - Uses the shared axios client `api` (baseURL="/api") — do NOT prefix paths with "/api".
 * - The text fields are optional for now (kept for future profile save flow).
 * - Click "Start / Continue Onboarding" to get redirected to Stripe Connect.
 * - Click "Refresh Status" after returning from Stripe.
 */

export default function ContractorOnboardingForm() {
  const [form, setForm] = useState({
    business_name: "",
    name: "",
    email: "",
    phone: "",
    skills: "",
  });

  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const fetchStatus = async () => {
    try {
      setStatusLoading(true);
      const { data } = await api.get("/projects/contractor-onboarding-status/");
      setStatus(data || null);
    } catch (err) {
      console.error(err);
      toast.error("Unable to load onboarding status.");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const startOnboarding = async () => {
    setMsg(null);
    setLoading(true);
    try {
      // Your backend should return a redirect URL under one of these keys:
      const { data } = await api.post("/projects/contractor-onboarding/", {});
      const url = data?.url || data?.onboarding_url || data?.redirect_url;
      if (!url) {
        setMsg("Onboarding URL not returned by server.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error(err);
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message ||
        "Could not start onboarding.";
      setMsg(detail);
    } finally {
      setLoading(false);
    }
  };

  const StatusBadge = ({ text, tone = "gray" }) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs rounded
        ${tone === "green" ? "bg-green-100 text-green-800" :
          tone === "yellow" ? "bg-yellow-100 text-yellow-800" :
          tone === "red" ? "bg-red-100 text-red-800" :
          "bg-gray-100 text-gray-800"}`}
    >
      {text}
    </span>
  );

  const renderStatus = () => {
    if (statusLoading) return <StatusBadge text="Checking…" />;
    if (!status) return <StatusBadge text="Unknown" tone="red" />;

    const pills = [];

    if ("charges_enabled" in status) {
      pills.push(
        <StatusBadge
          key="charges"
          text={status.charges_enabled ? "Charges Enabled" : "Charges Disabled"}
          tone={status.charges_enabled ? "green" : "yellow"}
        />
      );
    }

    if ("details_submitted" in status) {
      pills.push(
        <StatusBadge
          key="details"
          text={status.details_submitted ? "Details Submitted" : "Details Pending"}
          tone={status.details_submitted ? "green" : "yellow"}
        />
      );
    }

    if ("requirements_due" in status && Array.isArray(status.requirements_due)) {
      pills.push(
        <StatusBadge
          key="reqs"
          text={
            status.requirements_due.length
              ? `${status.requirements_due.length} item(s) due`
              : "No outstanding requirements"
          }
          tone={status.requirements_due.length ? "yellow" : "green"}
        />
      );
    }

    return pills.length ? <div className="flex flex-wrap gap-2">{pills}</div> : <StatusBadge text="Status loaded" />;
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); startOnboarding(); }}
      className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg"
    >
      <h2 className="text-2xl font-bold mb-2 text-center text-blue-800">
        Contractor Stripe Onboarding
      </h2>

      <div className="flex items-center justify-center mb-6">
        {renderStatus()}
      </div>

      {msg && <div className="mb-4 text-red-600 text-sm">{msg}</div>}

      {/* Optional fields (kept for future profile-save flow) */}
      <div className="mb-4">
        <label className="block font-semibold mb-1">Business Name</label>
        <input
          name="business_name"
          value={form.business_name}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Your business name"
        />
      </div>
      <div className="mb-4">
        <label className="block font-semibold mb-1">Your Name</label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Full name"
        />
      </div>
      <div className="mb-4">
        <label className="block font-semibold mb-1">Email</label>
        <input
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
        />
      </div>
      <div className="mb-4">
        <label className="block font-semibold mb-1">Phone</label>
        <input
          name="phone"
          value={form.phone}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="Phone number"
        />
      </div>
      <div className="mb-6">
        <label className="block font-semibold mb-1">Skills</label>
        <input
          name="skills"
          value={form.skills}
          onChange={handleChange}
          className="w-full border rounded px-3 py-2"
          placeholder="e.g., Flooring, Plumbing, Painting"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={`w-full py-3 rounded-xl font-bold transition duration-150 ${
          loading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        }`}
      >
        {loading ? "Starting Onboarding..." : "Start / Continue Onboarding"}
      </button>

      <div className="text-xs text-gray-500 mt-4 text-center">
        You’ll be redirected to Stripe to complete verification. After you return, click{" "}
        <span className="font-semibold">Refresh Status</span>.
      </div>

      <div className="flex justify-center mt-3">
        <button
          type="button"
          onClick={fetchStatus}
          disabled={statusLoading}
          className="px-3 py-1.5 rounded border border-gray-300 text-gray-800 hover:bg-gray-50 text-sm"
        >
          {statusLoading ? "Checking…" : "Refresh Status"}
        </button>
      </div>
    </form>
  );
}
