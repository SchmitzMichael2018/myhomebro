// frontend/src/components/MilestoneInfoBar.jsx
// Compact header strip for milestone editor: homeowner, address, links.
import React from "react";

export default function MilestoneInfoBar({ milestone }) {
  const meta = milestone?._meta || {};
  const homeowner = meta.homeownerName || "—";
  const address = meta.projectAddress || "";
  const agrNo = meta.agreementNumber || milestone?.agreement_number || "—";
  const total = meta.agreementTotal;
  const links = meta.links || {};

  const openAgreement = () => {
    if (links.agreementDetailUrl) {
      // use SPA route if present; fallback to hard navigation
      window.location.assign(links.agreementDetailUrl);
    }
  };

  const openPreview = () => {
    if (links.previewSignedUrl) {
      window.open(links.previewSignedUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div><span className="font-semibold">Agreement</span>: #{agrNo}</div>
        <div><span className="font-semibold">Homeowner</span>: {homeowner}</div>
        {address ? (
          <div className="truncate max-w-[420px]">
            <span className="font-semibold">Address</span>: {address}
          </div>
        ) : null}
        {typeof total !== "undefined" && total !== null ? (
          <div><span className="font-semibold">Agreement Total</span>: {Number(total).toLocaleString(undefined, { style: "currency", currency: "USD" })}</div>
        ) : null}
        <div className="ml-auto flex gap-2">
          {links.agreementDetailUrl ? (
            <button
              type="button"
              onClick={openAgreement}
              className="px-3 py-1 rounded-md bg-slate-900 text-white hover:opacity-90"
            >
              View Agreement
            </button>
          ) : null}
          {links.previewSignedUrl ? (
            <button
              type="button"
              onClick={openPreview}
              className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:opacity-90"
            >
              Preview PDF
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
