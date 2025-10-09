// frontend/src/components/Step4Finalize.jsx
// v2025-10-08 — Finalize & Review step (signed-link preview fix)
// - Requires: api helper at ../api
// - Wire this inside AgreementWizard when step===4

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

// Keep in sync with your Step 3 default text
const DEFAULT_WARRANTY = `Standard workmanship warranty: Contractor warrants all labor performed under this Agreement for one (1) year from substantial completion. Materials are covered by the manufacturer’s warranties. This warranty excludes damage caused by misuse, neglect, alteration, improper maintenance, or acts of God.`;

function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
function daySpan(start, end) {
  const a = start ? new Date(start) : null;
  const b = end ? new Date(end) : null;
  if (!a || !b || isNaN(a) || isNaN(b)) return 0;
  const ms = b.getTime() - a.getTime();
  return ms >= 0 ? Math.floor(ms / 86400000) + 1 : 0;
}

export default function Step4Finalize({
  agreement,                 // full agreement object
  id,                        // agreement id (string or number)
  milestones = [],           // array of milestones
  // optional totals from parent; if not passed we compute
  totals: parentTotals,
  // callbacks
  onBack,                    // function
}) {
  const [attachments, setAttachments] = useState([]);
  const [loadingAtt, setLoadingAtt] = useState(true);

  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [ackReviewed, setAckReviewed] = useState(false);
  const [ackTos, setAckTos] = useState(false);
  const [ackEsign, setAckEsign] = useState(false);

  const [typedName, setTypedName] = useState("");
  const [signing, setSigning] = useState(false);

  // 1) Fetch visible attachments
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingAtt(true);
      try {
        const { data } = await api.get(`/projects/agreements/${id}/attachments/`);
        const list = Array.isArray(data) ? data : [];
        const visible = list.filter(
          (a) => a.visible || a.is_visible || a.public || a.is_public
        );
        setAttachments(visible);
      } catch (e) {
        console.error(e);
        setAttachments([]);
      } finally {
        setLoadingAtt(false);
      }
    })();
  }, [id]);

  // 2) Compute totals if not provided
  const totals = useMemo(() => {
    if (parentTotals) return parentTotals;
    const totalAmt = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const starts = milestones.map(m => toDateOnly(m.start_date || m.start || m.scheduled_date)).filter(Boolean);
    const ends   = milestones.map(m => toDateOnly(m.completion_date || m.end_date || m.end || m.due_date)).filter(Boolean);
    const minStart = starts.length ? [...starts].sort()[0] : toDateOnly(agreement?.start);
    const maxEnd   = ends.length ? [...ends].sort().slice(-1)[0] : toDateOnly(agreement?.end);
    const totalDays = (minStart && maxEnd) ? daySpan(minStart, maxEnd) : 0;
    return { totalAmt, minStart, maxEnd, totalDays };
  }, [parentTotals, milestones, agreement?.start, agreement?.end]);

  // 3) Warranty snapshot that will be in the PDF
  const warrantyText = useMemo(() => {
    const t = (agreement?.warranty_text_snapshot || "").trim();
    const isDefault =
      String(agreement?.warranty_type || "").toUpperCase() === "DEFAULT" ||
      !t || t === DEFAULT_WARRANTY.trim() || agreement?.use_default_warranty;
    return isDefault ? DEFAULT_WARRANTY : (agreement?.warranty_text_snapshot || DEFAULT_WARRANTY);
  }, [agreement]);

  // 4) Preview PDF (uses signed short-lived link to avoid 401s on new tab)
  const previewPdf = async () => {
    try {
      const { data } = await api.post(`/projects/agreements/${id}/preview_link/`);
      const url = data?.url;
      if (!url) throw new Error("No preview URL returned.");
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        // Popup blocked — degrade gracefully
        window.location.href = url;
      }
      setHasPreviewed(true);
      // Optional: ping a side-effect endpoint if you add one later
      await api.post(`/projects/agreements/${id}/mark_previewed/`).catch(() => {});
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Could not generate preview link.";
      toast.error(msg);
    }
  };

  // 5) Sign (contractor)
  const canSign = hasPreviewed && ackReviewed && ackTos && ackEsign && typedName.trim().length >= 2;

  const signContractor = async () => {
    if (!canSign) return;
    setSigning(true);
    try {
      // Your API already supports typed-name-only signatures (image optional)
      const payload = { typed_name: typedName.trim() };
      const { data } = await api.post(`/projects/agreements/${id}/contractor_sign/`, payload);
      toast.success("Signed as Contractor.");
      // Optionally refresh the agreement in parent if you pass a callback
      // or just reload:
      window.location.reload();
      return data;
    } catch (e) {
      const resp = e?.response;
      const msg =
        (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data))) ||
        resp?.statusText || e?.message || "Sign failed";
      toast.error(`Sign failed: ${msg}`);
    } finally {
      setSigning(false);
    }
  };

  // 6) Public link (homeowner signs)
  const openPublicLink = () => {
    // If you expose a public link endpoint already, open it; else fall back to your existing path
    const tokenUrl = agreement?.public_url || `/agreements/public/${id}/`;
    window.open(tokenUrl, "_blank", "noopener");
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      {/* Header Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Agreement" value={`#${agreement?.id ?? id} — ${agreement?.project_title || agreement?.title || "Project"}`} />
        <SummaryCard label="Total Amount" value={`$${Number(totals.totalAmt || 0).toFixed(2)}`} />
        <SummaryCard label="Start → End" value={`${totals.minStart || "—"} → ${totals.maxEnd || "—"}`} />
        <SummaryCard label="Total Days" value={String(totals.totalDays || 0)} />
      </div>

      {/* Warranty Snapshot */}
      <section>
        <SectionTitle>Warranty (Snapshot)</SectionTitle>
        <div className="border rounded bg-gray-50 p-3 max-h-44 overflow-auto text-sm leading-relaxed whitespace-pre-wrap">
          {warrantyText}
        </div>
      </section>

      {/* Milestones */}
      <section>
        <SectionTitle>Milestones</SectionTitle>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <Th>#</Th>
                <Th>Title</Th>
                <Th>Due</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m, i) => {
                const due = toDateOnly(m.completion_date || m.end_date || m.due_date || m.start_date || m.start);
                return (
                  <tr key={m.id} className="border-t">
                    <Td>{i + 1}</Td>
                    <Td>{m.title}</Td>
                    <Td>{due || "—"}</Td>
                    <Td>${Number(m.amount || 0).toFixed(2)}</Td>
                    <Td>{m.status || (m.completed ? "Completed" : "Pending")}</Td>
                  </tr>
                );
              })}
              {!milestones.length && (
                <tr><Td colSpan={5} className="text-center text-gray-500 py-6">No milestones.</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Attachments (visible) */}
      <section>
        <SectionTitle>Attachments &amp; Addenda (Visible)</SectionTitle>
        {loadingAtt ? (
          <div className="text-sm text-gray-500">Loading attachments…</div>
        ) : attachments.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <Th>Category</Th>
                  <Th>Title</Th>
                  <Th>File</Th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((a) => {
                  const url = a.file || a.url || a.file_url || a.download_url || a.download || a.absolute_url || null;
                  return (
                    <tr key={a.id} className="border-t">
                      <Td>{(a.category || "").toUpperCase()}</Td>
                      <Td>{a.title || a.filename || "—"}</Td>
                      <Td>{url ? <a className="text-blue-600 hover:underline" href={url} target="_blank" rel="noreferrer">Download</a> : "—"}</Td>
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

      {/* Review & Consents */}
      <section>
        <SectionTitle>Agreement Review</SectionTitle>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ackReviewed} onChange={(e) => setAckReviewed(e.target.checked)} />
            <span>I have reviewed the entire agreement and all attached exhibits/attachments.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ackTos} onChange={(e) => setAckTos(e.target.checked)} />
            <span>
              I agree to the&nbsp;
              <a className="text-blue-600 hover:underline" href="/static/legal/terms_of_service.txt" target="_blank" rel="noreferrer">Terms of Service</a>
              &nbsp;and&nbsp;
              <a className="text-blue-600 hover:underline" href="/static/legal/privacy_policy.txt" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ackEsign} onChange={(e) => setAckEsign(e.target.checked)} />
            <span>
              I consent to conduct business electronically and use electronic signatures under the U.S. E-SIGN Act. I understand my electronic signature is legally binding, and I can request a paper copy.
            </span>
          </label>
          <div className="rounded border bg-yellow-50 text-yellow-800 px-3 py-2">
            <strong>Note:</strong> Previewing the PDF is required before signing.
          </div>
        </div>
      </section>

      {/* Signatures */}
      <section>
        <SectionTitle>Signatures</SectionTitle>
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
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={previewPdf}
                    className="rounded bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
                  >
                    Preview PDF
                  </button>
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
                <div className="text-sm text-gray-600">
                  The homeowner signs via their public link.
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={openPublicLink}
                    className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
                  >
                    Open Public Signing Link
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer actions */}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">
          Back
        </button>
        <button type="button" onClick={previewPdf} className="rounded bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100">
          Preview PDF
        </button>
        <button type="button" onClick={openPublicLink} className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black">
          View Public Link
        </button>
      </div>
    </div>
  );
}

/* ---------- small presentational helpers ---------- */
function SectionTitle({ children }) {
  return <div className="text-sm font-semibold mb-2">{children}</div>;
}
function SummaryCard({ label, value }) {
  return (
    <div className="rounded border bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
function Th({ children }) {
  return <th className="px-3 py-2">{children}</th>;
}
function Td({ children, colSpan }) {
  return <td className="px-3 py-2" colSpan={colSpan}>{children}</td>;
}
