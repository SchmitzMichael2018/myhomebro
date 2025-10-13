// src/components/PdfPreviewModal.jsx
import React, { useEffect } from "react";

export default function PdfPreviewModal({ open, onClose, fileUrl, title = "Preview" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Use the frame-exempt backend route
  const viewerUrl = `/pdf/viewer/?file=${encodeURIComponent(fileUrl)}#pagemode=none`;

  const handleBackdrop = (e) => {
    if (e.target.dataset?.backdrop === "1") onClose?.();
  };

  return (
    <div
      data-backdrop="1"
      onClick={handleBackdrop}
      className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-6xl h-[80vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="text-sm font-medium">{title}</div>
          <div className="flex items-center gap-3">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              Open raw PDF
            </a>
            <button onClick={onClose} className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100" aria-label="Close">✕</button>
          </div>
        </div>
        <iframe
          title="PDF Preview"
          src={viewerUrl}
          className="flex-1 w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms allow-top-navigation-by-user-activation"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
