// frontend/src/components/PreviewAgreementPdfButton.jsx
// v2025-10-09 — Uses signed preview link (no 401). Optional mark_previewed ping.

import React, { useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function PreviewAgreementPdfButton({
  agreementId,
  onPreviewed,          // optional callback
  size = "md",          // "sm" | "md"
  children,             // custom button label
  pingMarkPreviewed = true,
}) {
  const [loading, setLoading] = useState(false);

  const cls = size === "sm"
    ? "inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-sm font-semibold bg-white hover:bg-gray-50"
    : "inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 text-base font-semibold bg-white hover:bg-gray-50";

  const handleClick = async () => {
    if (!agreementId) {
      toast.error("Missing agreement id.");
      return;
    }
    try {
      setLoading(true);

      // 1) Ask backend for a signed, short-lived URL
      const { data } = await api.post(`/projects/agreements/${agreementId}/preview_link/`);
      const url = data?.url;
      if (!url) throw new Error("No preview URL returned.");

      // 2) Open in a new tab (no Authorization header required)
      window.open(url, "_blank", "noopener,noreferrer");

      // 3) Optional mark_previewed to flip gates in UI
      if (pingMarkPreviewed) {
        try { await api.post(`/projects/agreements/${agreementId}/mark_previewed/`); } catch {}
      }

      onPreviewed?.(true);
    } catch (err) {
      console.error(err);
      toast.error("Could not open preview.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" className={cls} onClick={handleClick} disabled={loading} title="Preview Agreement PDF">
      {loading ? "Opening…" : (children || "Preview PDF")}
    </button>
  );
}
