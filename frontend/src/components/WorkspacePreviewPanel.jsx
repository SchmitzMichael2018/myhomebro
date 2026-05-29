import React from "react";
import { ArrowRight, AlertTriangle, Info } from "lucide-react";

function Badge({ children, tone = "default" }) {
  const cls =
    tone === "residential"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "commercial"
      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function FlagRow({ flag }) {
  const isWarning = flag.severity === "warning";
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
        isWarning
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-sky-100 bg-sky-50 text-sky-800"
      }`}
    >
      {isWarning ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{flag.message}</span>
    </div>
  );
}

function money(n) {
  if (!n || isNaN(Number(n))) return null;
  return `$${Number(n).toLocaleString()}`;
}

export default function WorkspacePreviewPanel({
  title = "",
  customer = null,
  projectAddress = null,
  projectPath = null,
  templateName = null,
  milestoneCount = 0,
  estimatedPriceLow = null,
  estimatedPriceHigh = null,
  unresolvedFlags = [],
  onConfirm,
  onEditDetails,
}) {
  const pathBadge =
    projectPath === "residential"
      ? "Residential"
      : projectPath === "commercial"
      ? "Commercial"
      : null;

  const addressStr = projectAddress
    ? [
        projectAddress.street || projectAddress.address_line1 || projectAddress.line1,
        projectAddress.city,
        projectAddress.state,
        projectAddress.zip || projectAddress.postal_code,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  const priceLow = money(estimatedPriceLow);
  const priceHigh = money(estimatedPriceHigh);
  const priceRange = priceLow && priceHigh ? `${priceLow} – ${priceHigh}` : priceLow || priceHigh || null;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="workspace-preview-panel"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        Job Preview
      </div>

      <h3
        className="mt-2 text-xl font-bold text-slate-900"
        data-testid="workspace-preview-title"
      >
        {title || "New Agreement"}
      </h3>

      <div className="mt-3 space-y-2">
        {pathBadge ? (
          <Badge tone={projectPath}>{pathBadge}</Badge>
        ) : null}

        {customer ? (
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Customer:</span>{" "}
            {customer.full_name || customer.name || "—"}
            {customer.email ? ` · ${customer.email}` : ""}
          </div>
        ) : null}

        {addressStr ? (
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Project address:</span> {addressStr}
          </div>
        ) : null}

        {templateName ? (
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Template:</span> {templateName}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4 text-sm">
          {milestoneCount > 0 ? (
            <span className="text-slate-700">
              <span className="font-semibold">{milestoneCount}</span> milestone{milestoneCount !== 1 ? "s" : ""}
            </span>
          ) : null}
          {priceRange ? (
            <span className="text-slate-700">
              <span className="font-semibold">Est:</span> {priceRange}
            </span>
          ) : null}
        </div>
      </div>

      {unresolvedFlags.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Unresolved items
          </div>
          {unresolvedFlags.map((flag, i) => (
            <FlagRow key={i} flag={flag} />
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="workspace-preview-confirm"
          onClick={onConfirm}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Open agreement wizard
          <ArrowRight className="h-4 w-4" />
        </button>
        {onEditDetails ? (
          <button
            type="button"
            data-testid="workspace-preview-edit"
            onClick={onEditDetails}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Edit details first
          </button>
        ) : null}
      </div>
    </div>
  );
}
