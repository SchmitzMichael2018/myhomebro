import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../context/AuthContext";

/**
 * Danger Zone – delete profile (soft or hard).
 * Soft delete (default): scrubs contractor PII and (optionally) deactivates the user.
 * Hard delete: only allowed when there are no related records; otherwise 409 with counts.
 */
export default function ProfileDangerZone() {
  const [confirmText, setConfirmText] = useState("");
  const [hardDelete, setHardDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const { onLogout } = useAuth();

  const canDelete = confirmText.trim().toUpperCase() === "DELETE" && !busy;

  const requestDelete = async () => {
    // Try both routes to match your backend wiring
    for (const url of ["/contractors/me/", "/projects/contractors/me/"]) {
      try {
        return await api.delete(url, { params: { hard: hardDelete ? 1 : 0 } });
      } catch (err) {
        const code = err?.response?.status;
        if (code && ![404, 405].includes(code)) throw err;
      }
    }
    throw new Error("No delete endpoint available.");
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      const res = await requestDelete();
      if (res.status === 204 || res.status === 200) {
        toast.success(hardDelete ? "Profile permanently deleted." : "Profile deactivated and data scrubbed.");
        try {
          localStorage.removeItem("access");
          localStorage.removeItem("refresh");
        } catch {}
        onLogout?.();
        navigate("/signin", { replace: true });
        return;
      }
      toast.error("Unexpected response. Please refresh and try again.");
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 409 && data?.related_counts) {
        toast.error(
          `Hard delete blocked (projects: ${data.related_counts.projects}, agreements: ${data.related_counts.agreements}, invoices: ${data.related_counts.invoices}).`
        );
      } else {
        toast.error(data?.detail || "Delete failed. Please try again.");
      }
      console.error("Delete profile error:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 border border-red-200 bg-red-50 rounded-lg p-5">
      <h2 className="text-xl font-semibold text-red-700 mb-2">Danger Zone</h2>
      <p className="text-sm text-red-800 mb-3">
        Deleting your contractor profile will remove your business information and deactivate your account.
        You can optionally request a <strong>hard delete</strong>; this only succeeds if you have no related
        projects, agreements, or invoices.
      </p>

      <label className="flex items-center gap-2 text-sm text-red-800 mb-3">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={hardDelete}
          onChange={(e) => setHardDelete(e.target.checked)}
          disabled={busy}
        />
        Permanently delete my profile if there are no related records (hard delete)
      </label>

      <div className="mb-3">
        <label className="block text-sm font-medium text-red-900 mb-1">
          Type <span className="font-mono bg-red-100 px-1 rounded">DELETE</span> to confirm
        </label>
        <input
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
    </section>
  );
}
