// frontend/src/components/ReviewPdfButton.jsx
// Full file replacement

import React, { useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

/**
 * ReviewPdfButton
 *
 * Usage:
 *   <ReviewPdfButton agreementId={agreement.id} label="Review PDF" className="..." />
 *
 * What it does:
 *   1) Authenticated POST to /projects/agreements/:id/preview_link/
 *   2) Receives a short-lived signed URL
 *   3) Opens that URL in a new tab (no 401s even without Authorization header)
 *
 * Notes:
 *   - Requires the backend action preview_link from AgreementViewSet.
 *   - If a popup blocker stops it, we fall back to same-tab navigation.
 */
export default function ReviewPdfButton({
  agreementId,
  label = "Review PDF",
  className = "px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50",
  disabled = false,
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!agreementId) {
      toast.error("Missing agreement ID.");
      return;
    }
    if (loading) return;

    setLoading(true);
    try {
      // This POST must include Authorization: Bearer <access> via api interceptor
      const { data } = await api.post(`/projects/agreements/${agreementId}/preview_link/`);
      const url = data?.url;
      if (!url) throw new Error("No preview URL returned from server.");

      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        // Popup blocked — degrade gracefully
        window.location.href = url;
      }
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Could not generate preview link.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      className={className}
      aria-label={label}
      title={label}
    >
      {loading ? "Generating…" : label}
    </button>
  );
}
