// src/components/AgreementReviewStep.jsx
import React, { useMemo, useRef, useState } from "react";

/**
 * Step 3 ONLY renders & prints the summary, then calls onSubmit().
 * The Wizard performs the POST via createAgreementFromWizardState().
 */

const asMoney = (v) => {
  const n = parseFloat(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (mins) => {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${pad(h)}:${pad(r)}`;
};

export default function AgreementReviewStep({ data, onBack, onSubmit }) {
  const printRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);

  const ms = Array.isArray(data?.milestones) ? data.milestones : [];
  const totals = useMemo(() => {
    const cost = ms.reduce((s, m) => s + asMoney(m.amount), 0);
    const minutes = ms.reduce(
      (s, m) => s + Number(m.duration_minutes ?? m.minutes ?? 0),
      0
    );
    return { cost, minutes, count: ms.length };
  }, [ms]);

  const homeownerName = data?.homeownerName || data?.homeowner_name || "—";
  const homeownerEmail = data?.homeownerEmail || data?.homeowner_email || "—";
  const projectTitle = data?.project_title || data?.projectName || "—";
  const useCustomerAddress = !!data?.useCustomerAddress;

  const computedAddress = useMemo(() => {
    if (useCustomerAddress) return "— (Using customer’s address)";
    const line2 = data?.project_address_line_2 || data?.projectAddressLine2 || "";
    const cityState = [data?.project_city, data?.project_state].filter(Boolean).join(", ");
    return (
      [
        data?.project_street_address,
        line2,
        cityState,
        data?.project_zip_code,
      ]
        .filter(Boolean)
        .join(", ") || "—"
    );
  }, [useCustomerAddress, data]);

  const handlePrint = () => {
    const html = printRef.current?.innerHTML || "";
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (w) {
      w.document.write(`
        <html>
          <head>
            <title>Agreement Summary - ${projectTitle}</title>
            <style>
              body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 24px; }
              h1,h2,h3 { margin: 0 0 8px; }
              table { border-collapse: collapse; width: 100%; font-size: 14px; }
              th, td { border: 1px solid #ddd; padding: 6px 8px; }
              thead { background: #f8fafc; }
            </style>
          </head>
          <body>${html}</body>
        </html>
      `);
      w.document.close();
      w.focus();
      w.print();
      w.close();
    } else {
      window.print();
    }
  };

  const handleSubmit = async () => {
    if (!onSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(); // Wizard does the POST using createAgreementFromWizardState()
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Step 3: Review &amp; Submit</h2>
        <button
          type="button"
          onClick={handlePrint}
          className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700"
        >
          🖨️ Print Summary
        </button>
      </div>

      <div ref={printRef} className="space-y-4 text-gray-700">
        {/* Homeowner */}
        <div className="border-b pb-4">
          <h3 className="text-lg font-semibold">Homeowner Information</h3>
          <p><strong>Name:</strong> {homeownerName}</p>
          <p><strong>Email:</strong> {homeownerEmail}</p>
        </div>

        {/* Project */}
        <div className="border-b pb-4 mt-4">
          <h3 className="text-lg font-semibold">Project Details</h3>
          <p><strong>Project Name:</strong> {projectTitle}</p>
          <p><strong>Address:</strong> {computedAddress}</p>
        </div>

        {/* Milestones */}
        <div className="border-b pb-4 mt-4">
          <h3 className="text-lg font-semibold">Milestones</h3>
          {ms.length === 0 ? (
            <p className="italic text-gray-500">No milestones added.</p>
          ) : (
            <table className="w-full text-sm mt-2 border">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">Title</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                  <th className="px-2 py-1 text-left">Start</th>
                  <th className="px-2 py-1 text-left">End</th>
                  <th className="px-2 py-1 text-left">Duration</th>
                </tr>
              </thead>
              <tbody>
                {ms.map((m, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">{i + 1}</td>
                    <td className="px-2 py-1">{m.title || "—"}</td>
                    <td className="px-2 py-1 text-right">
                      {asMoney(m.amount).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </td>
                    <td className="px-2 py-1">{m.start || m.start_date || "—"}</td>
                    <td className="px-2 py-1">{m.end || m.completion_date || "—"}</td>
                    <td className="px-2 py-1">
                      {m.duration_minutes != null
                        ? hhmm(m.duration_minutes)
                        : `${m.days || 0}d ${m.hours || 0}h ${m.minutes || 0}m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pricing Summary */}
        <div className="mt-4">
          <h3 className="text-lg font-semibold">Pricing Summary</h3>
          <p><strong>Total Cost:</strong> {totals.cost.toLocaleString("en-US", { style: "currency", currency: "USD" })}</p>
          <p><strong>Total Duration:</strong> {hhmm(totals.minutes)}</p>
          <p><strong>Milestone Count:</strong> {totals.count}</p>
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 bg-gray-300 rounded hover:bg-gray-400 transition"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={`px-6 py-2 rounded text-white ${submitting ? "bg-gray-400 cursor-wait" : "bg-green-600 hover:bg-green-700"} transition`}
        >
          {submitting ? "Submitting…" : "Submit Agreement"}
        </button>
      </div>
    </div>
  );
}
