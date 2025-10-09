// frontend/src/components/PreviewAgreementPdfButton.jsx
// Full file replacement

import React, { useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

/**
 * Usage:
 *   <PreviewAgreementPdfButton agreementId={agreement.id} />
 *
 * Flow:
 *   1) POST /projects/agreements/:id/preview_link/  (sends Bearer automatically)
 *   2) Receive { url } and window.open(url, "_blank")
 */
export default function PreviewAgreementPdfButton({ agreementId, label = "Preview PDF" }) {
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    if (!agreementId) {
      toast.error("Missing agreement ID");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post(`/projects/agreements/${agreementId}/preview_link/`);
      const url = data?.url;
      if (!url) throw new Error("No preview URL returned.");
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        // Popup blocker fallback
        window.location.href = url;
      }
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Could not create a preview link.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handlePreview}
      disabled={loading}
      className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? "Generating..." : label}
    </button>
  );
}
