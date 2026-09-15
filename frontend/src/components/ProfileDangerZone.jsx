import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../context/AuthContext";

/** Permanently remove an unused contractor role without deleting the shared login. */
export default function ProfileDangerZone() {
  const [confirmText, setConfirmText] = useState("");
  const [hardDelete, setHardDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockedCounts, setBlockedCounts] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const navigate = useNavigate();
  const { logout } = useAuth();

  const canDelete = hardDelete && confirmText.trim().toUpperCase() === "DELETE" && !busy;

  const requestDelete = async () => {
    return api.delete("/projects/contractors/me/", { params: { hard: 1 } });
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      const res = await requestDelete();
      if (res.status === 204 || res.status === 200) {
        toast.success("Contractor profile deleted. Your other workspace access is unchanged.");
        await logout?.();
        navigate("/signin", { replace: true });
        return;
      }
      toast.error("Unexpected response. Please refresh and try again.");
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 409 && data?.related_counts) {
        setBlockedCounts(data.related_counts);
        toast.error(
          `Deletion blocked (customers: ${data.related_counts.customers}, projects: ${data.related_counts.projects}, agreements: ${data.related_counts.agreements}, invoices: ${data.related_counts.invoices}).`
        );
      } else {
        toast.error(data?.detail || "Delete failed. Please try again.");
      }
      console.error("Delete profile error:", err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    const confirmed = window.confirm(
      "Deactivate this contractor profile? Your business records will be retained, and your login and other workspace access will remain available."
    );
    if (!confirmed) return;

    setDeactivating(true);
    try {
      await api.post("/projects/contractors/me/deactivate/");
      toast.success("Contractor profile deactivated. Your records were retained.");
      await logout?.();
      navigate("/signin", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Deactivation failed. Please try again.");
      console.error("Deactivate contractor profile error:", err);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <details className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-5" data-testid="profile-danger-zone">
      <summary className="cursor-pointer text-base font-semibold text-[var(--mhb-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mhb-border-focus)]">
        Danger Zone
        <span className="ml-2 text-sm font-normal text-[var(--mhb-text-muted)]">Account deletion controls</span>
      </summary>
      <section className="mhb-profile-danger-panel mt-5 rounded-xl border border-red-300 bg-red-50 p-4">
      <h2 className="text-lg font-semibold text-red-800 mb-2">Delete contractor profile</h2>
      <p className="text-sm text-red-800 mb-3">
        This permanently removes only your contractor profile and contractor workspace access. Your login
        and any customer or property-manager workspace remain available. Deletion is blocked if this contractor
        has related customers, projects, agreements, or invoices.
      </p>

      <label className="mhb-profile-danger-label flex items-center gap-2 text-sm text-red-800 mb-3">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={hardDelete}
          onChange={(e) => setHardDelete(e.target.checked)}
          disabled={busy}
        />
        I understand this permanently deletes only my contractor profile
      </label>

      <div className="mb-3">
        <label
          htmlFor="mhb-profiledangerzone-88"
          className="mhb-profile-danger-label block text-sm font-medium text-red-900 mb-1"
          data-testid="profile-danger-confirm-label"
        >
          Type <span className="mhb-profile-danger-token font-mono bg-red-100 px-1 rounded">DELETE</span> to confirm
        </label>
        <input id="mhb-profiledangerzone-88"
          type="text"
          className="w-full max-w-sm border rounded px-3 py-2"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          disabled={busy}
        />
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={!canDelete}
        className={`px-4 py-2 rounded text-white ${
          canDelete ? "bg-red-600 hover:bg-red-700" : "bg-red-400 cursor-not-allowed"
        }`}
      >
        {busy ? "Deleting…" : "Delete my profile"}
      </button>

      {blockedCounts ? (
        <div
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="status"
          data-testid="profile-deactivation-fallback"
        >
          <h3 className="font-semibold">Permanent deletion isn’t available</h3>
          <p className="mt-1 text-sm leading-6">
            This profile has {blockedCounts.customers} customer{blockedCounts.customers === 1 ? "" : "s"},{" "}
            {blockedCounts.projects} project{blockedCounts.projects === 1 ? "" : "s"},{" "}
            {blockedCounts.agreements} agreement{blockedCounts.agreements === 1 ? "" : "s"}, and{" "}
            {blockedCounts.invoices} invoice{blockedCounts.invoices === 1 ? "" : "s"}. You can deactivate the
            contractor workspace instead. Its records will be retained, while your login and other workspace access
            remain available.
          </p>
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={deactivating || busy}
            className="mt-3 rounded bg-amber-700 px-4 py-2 font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deactivating ? "Deactivating…" : "Deactivate contractor profile"}
          </button>
        </div>
      ) : null}
      </section>
    </details>
  );
}
