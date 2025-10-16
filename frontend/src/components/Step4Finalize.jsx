// frontend/src/components/Step4Finalize.jsx
// v2025-10-14 footer-only actions

import React from "react";

function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded border bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

export default function Step4Finalize({
  agreement, id, previewPdf, goPublic, milestones, totals,
  hasPreviewed,
  ackReviewed, setAckReviewed,
  ackTos, setAckTos,
  ackEsign, setAckEsign,
  typedName, setTypedName,
  canSign, signing, signContractor,
  attachments, defaultWarrantyText, customWarranty, useDefaultWarranty,
  goBack,
}) {
  const warrantyText = useDefaultWarranty
    ? defaultWarrantyText
    : (customWarranty?.trim() ? customWarranty : defaultWarrantyText);

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Agreement" value={`#${agreement?.id || id} — ${agreement?.project_title || agreement?.title || "Project"}`} />
        <SummaryCard label="Total Amount" value={`$${Number(totals.totalAmt || 0).toFixed(2)}`} />
        <SummaryCard label="Start → End" value={`${totals.minStart || "—"} → ${totals.maxEnd || "—"}`} />
        <SummaryCard label="Total Days" value={String(totals.totalDays || 0)} />
      </div>

      {/* Warranty snapshot */}
      <section>
        <div className="text-sm font-semibold mb-2">Warranty (Snapshot)</div>
        <div className="border rounded bg-gray-50 p-3 max-h-44 overflow-auto text-sm leading-relaxed whitespace-pre-wrap">
          {warrantyText}
        </div>
      </section>

      {/* Milestones */}
      <section>
        <div className="text-sm font-semibold mb-2">Milestones</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(milestones || []).map((m, i) => (
                <tr key={m.id || i} className="border-t">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{m.title || m.description || "—"}</td>
                  <td className="px-3 py-2">{toDateOnly(m.completion_date || m.end_date || m.end || m.due_date || m.scheduled_date || m.start_date || m.start) || "—"}</td>
                  <td className="px-3 py-2">${Number(m.amount || 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{m.status || (m.completed ? "Completed" : "Pending")}</td>
                </tr>
              ))}
              {!milestones?.length && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No milestones.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Attachments */}
      <section>
        <div className="text-sm font-semibold mb-2">Attachments &amp; Addenda (Visible)</div>
        {(attachments || []).filter(a => a.visible || a.is_visible || a.public || a.is_public).length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">File</th>
                </tr>
              </thead>
              <tbody>
                {(attachments || [])
                  .filter(a => a.visible || a.is_visible || a.public || a.is_public)
                  .map((a) => {
                    const url = a.file || a.url || a.file_url || a.download_url || a.download || a.absolute_url || null;
                    return (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-2">{(a.category || "").toUpperCase()}</td>
                        <td className="px-3 py-2">{a.title || a.filename || "—"}</td>
                        <td className="px-3 py-2">{url ? <a className="text-blue-600 hover:underline" href={url} target="_blank" rel="noreferrer">Download</a> : "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-gray-500">No visible attachments.</div>
        )}
      </section>

      {/* Review acknowledgments */}
      <section className="space-y-2 text-sm">
        <div className="text-sm font-semibold">Agreement Review</div>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackReviewed} onChange={(e) => setAckReviewed(e.target.checked)} />
          <span>I have reviewed the entire agreement and all attached exhibits/attachments.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackTos} onChange={(e) => setAckTos(e.target.checked)} />
          <span>
            I agree to the&nbsp;
            <a className="text-blue-600 hover:underline" href="/static/legal/terms_of_service.txt" target="_blank" rel="noreferrer">Terms of Service</a>
            &nbsp;and&nbsp;
            <a className="text-blue-600 hover:underline" href="/static/legal/privacy_policy.txt" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackEsign} onChange={(e) => setAckEsign(e.target.checked)} />
          <span>
            I consent to conduct business electronically and use electronic signatures under the U.S. E-SIGN Act.
            I understand my electronic signature is legally binding, and I can request a paper copy.
          </span>
        </label>
        <div className="rounded border bg-yellow-50 text-yellow-800 px-3 py-2">
          <strong>Note:</strong> You must preview the PDF before signing.
        </div>
      </section>

      {/* Signatures (NO preview button beside Sign) */}
      <section>
        <div className="text-sm font-semibold mb-2">Signatures</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contractor */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Contractor Signature</div>
            {agreement?.signed_by_contractor ? (
              <div className="text-sm text-green-700">
                ✓ Already signed by contractor {agreement?.contractor_signature_name ? `(${agreement.contractor_signature_name})` : ""}.
              </div>
            ) : (
              <>
                <label className="block text-sm mb-1">Type full legal name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="e.g., Jane Q. Contractor"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                />
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={!canSign || signing}
                    onClick={signContractor}
                    className={`rounded px-3 py-2 text-sm text-white ${canSign ? "bg-indigo-600 hover:bg-indigo-700" : "bg-gray-400 cursor-not-allowed"}`}
                    title={!canSign ? "Preview + all checkboxes + typed name required" : "Sign as Contractor"}
                  >
                    {signing ? "Signing…" : "Sign as Contractor"}
                  </button>
                </div>
                {!hasPreviewed && <div className="mt-2 text-xs text-amber-700">Please preview the PDF before signing.</div>}
              </>
            )}
          </div>

          {/* Homeowner */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Homeowner Signature</div>
            {agreement?.signed_by_homeowner ? (
              <div className="text-sm text-green-700">✓ Already signed by homeowner.</div>
            ) : (
              <>
                <div className="text-sm text-gray-600">The homeowner signs via their public link.</div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => window.open(`/agreements/public/${id}/`, "_blank")}
                    className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
                    title="Open the public signing link"
                  >
                    Open Public Signing Link
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer — ONLY HERE */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={goBack}
          className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          title="Back to previous step"
        >
          Back
        </button>

        <button
          type="button"
          onClick={previewPdf}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          title="Open preview PDF"
        >
          Preview PDF
        </button>

        <button
          type="button"
          onClick={goPublic}
          className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
          title="Open the public link"
        >
          View Public Link
        </button>
      </div>
    </div>
  );
}
