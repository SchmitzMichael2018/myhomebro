// src/components/PdfPreviewModal.jsx
import React from "react";

export default function PdfPreviewModal({ open, onClose, fileUrl, title = "Preview" }) {
  if (!open) return null;

  // ⬇️ Use the frame-exempt backend route
  const viewerUrl = `/pdf/viewer/?file=${encodeURIComponent(fileUrl)}#pagemode=none`;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl h-[80vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="text-sm font-medium">{title}</div>
          <div className="flex items-center gap-3">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Open raw PDF</a>
            <button onClick={onClose} className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100">✕</button>
          </div>
        </div>
        <iframe title="PDF Preview" src={viewerUrl} className="flex-1 w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-downloads" />
      </div>
    </div>
  );
}
