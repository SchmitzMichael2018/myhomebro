// frontend/src/components/Step4Finalize.jsx
// v2025-10-12 — Review + robust Due fallback + safe preview + typed OR image signature.

import React, { useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

/** Normalize to YYYY-MM-DD (accepts ISO strings or timestamps) */
function toDateOnly(v) {
  if (!v) return "";
  if (typeof v === "number") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Robust due fallback (mirrors serializer + PDF builder) */
function dueOf(m) {
  const keys = [
    "completion_date",
    "due_date",
    "end_date",
    "end",
    "target_date",
    "finish_date",
    "scheduled_date",
    "start_date",
    "start",
  ];
  for (const k of keys) {
    const v = m?.[k];
    const d = toDateOnly(v);
    if (d) return d;
  }
  return "—";
}

function currency(n) {
  const v = Number(n || 0);
  try {
    return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

export default function Step4Finalize({
  agreement,
  id,
  previewPdf,      // optional: opens signed link (no auth header)
  goPublic,

  milestones,
  totals,

  // Review + consent state passed from AgreementWizard
  hasPreviewed,
  ackReviewed, setAckReviewed,
  ackTos, setAckTos,
  ackEsign, setAckEsign,

  // Signing text + control passed from AgreementWizard
  typedName, setTypedName,
  canSign, signing, signContractor,   // optional upstream sign handler

  // Warranty/attachments context
  attachments,
  defaultWarrantyText,
  customWarranty,
  useDefaultWarranty,

  // Optional callbacks
  onPreviewed,      // optional: parent can flip hasPreviewed=true
  goBack,
}) {
  const [sigFile, setSigFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);

  const warrantyText = useMemo(() => {
    return useDefaultWarranty
      ? defaultWarrantyText
      : (customWarranty?.trim() ? customWarranty : defaultWarrantyText);
  }, [useDefaultWarranty, defaultWarrantyText, customWarranty]);

  const visibleAttachments = useMemo(() => {
    const list = Array.isArray(attachments) ? attachments : [];
    return list.filter(
      (a) => !!(a?.visible ?? a?.is_visible ?? a?.public ?? a?.is_public)
    );
  }, [attachments]);

  /**
   * Safe preview handler:
   * 1) If a previewPdf prop exists, call it (legacy).
   * 2) Else POST /projects/agreements/:id/preview_link/ to get a signed URL.
   * 3) If that fails, fall back to tokenless contractor/staff path with ?agreement_id=.
   */
  const handlePreview = async () => {
    try {
      setOpeningPreview(true);
      if (typeof previewPdf === "function") {
        await Promise.resolve(previewPdf());
        onPreviewed?.(true);
        return;
      }
      // 2) Try creating a signed link (no auth header required when opened)
      try {
        const { data } = await api.post(`/projects/agreements/${id}/preview_link/`);
        if (data?.url) {
          window.open(data.url, "_blank", "noopener,noreferrer");
          onPreviewed?.(true);
          return;
        }
      } catch {
        // ignore, we’ll fall back
      }
      // 3) Fallback (contractor/staff logged in)
      const url = `/api/projects/agreements/preview_signed/?agreement_id=${id}`;
      window.open(url, "_blank", "noopener,noreferrer");
      onPreviewed?.(true);
    } catch (e) {
      toast.error("Could not open preview. Please try again.");
    } finally {
      setOpeningPreview(false);
    }
  };

  /** Local contractor sign (typed or typed + image) */
  const handleSignLocal = async () => {
    if (!hasPreviewed) return toast.error("Please preview the PDF before signing.");
    if (!ackReviewed || !ackTos || !ackEsign) return toast.error("Please accept all acknowledgments.");
    if (!typedName || typedName.trim().length < 2) return toast.error("Please type your full name to sign.");

    if (submitting) return;
    setSubmitting(true);
    try {
      if (sigFile) {
        const fd = new FormData();
        fd.append("typed_name", typedName.trim());
        fd.append("signature", sigFile);
        await api.post(`/projects/agreements/${id}/contractor_sign/`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await api.post(`/projects/agreements/${id}/contractor_sign/`, {
          typed_name: typedName.trim(),
        });
      }
      toast.success("Signed as Contractor.");
      // Optionally send homeowner email
      try { await api.post(`/projects/agreements/${id}/send_for_signature/`); } catch {}
      window.location.reload();
    } catch (e) {
      const resp = e?.response;
      const msg = (resp?.data && (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data)))
        || resp?.statusText || e?.message || "Sign failed";
      toast.error(`Sign failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveCanSign =
    canSign ?? (hasPreviewed && ackReviewed && ackTos && ackEsign && (typedName?.trim().length >= 2));
  const signingInProgress = !!(signing || submitting);

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Agreement"
          value={`#${agreement?.id ?? id} — ${agreement?.project_title || agreement?.title || "Project"}`}
        />
        <SummaryCard label="Total Amount" value={currency(totals?.totalAmt || 0)} />
        <SummaryCard label="Start → End" value={`${totals?.minStart || "—"} → ${totals?.maxEnd || "—"}`} />
        <SummaryCard label="Total Days" value={String(totals?.totalDays || 0)} />
      </div>

      {/* Warranty snapshot */}
      <section>
        <div className="text-sm font-semibold mb-2">Warranty (Snapshot)</div>
        <div className="border rounded bg-gray-50 p-3 max-h-44 overflow-auto text-sm leading-relaxed whitespace-pre-wrap">
          {warrantyText}
        </div>
      </section>

      {/* Milestones with Due fallback */}
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
                  <td className="px-3 py-2">{dueOf(m)}</td>
                  <td className="px-3 py-2">{currency(m.amount)}</td>
                  <td className="px-3 py-2">{m.status || (m.completed ? "Completed" : "Pending")}</td>
                </tr>
              ))}
              {!milestones?.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                    No milestones.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Attachments (visible only) */}
      <section>
        <div className="text-sm font-semibold mb-2">Attachments &amp; Addenda (Visible)</div>
        {visibleAttachments.length ? (
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
                {visibleAttachments.map((a) => {
                  const url =
                    a.file_url ||
                    a.url ||
                    a.download_url ||
                    a.download ||
                    a.absolute_url ||
                    a.file ||
                    null;
                  return (
                    <tr key={a.id} className="border-t">
                      <td className="px-3 py-2">{(a.category || "").toUpperCase()}</td>
                      <td className="px-3 py-2">{a.title || a.filename || "—"}</td>
                      <td className="px-3 py-2">
                        {url ? (
                          <a className="text-blue-600 hover:underline" href={url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
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

      {/* Review & Acknowledgments */}
      <section className="space-y-2 text-sm">
        <div className="text-sm font-semibold">Agreement Review</div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={!!ackReviewed}
            onChange={(e) => setAckReviewed?.(e.target.checked)}
          />
          <span>I have reviewed the entire agreement and all attached exhibits/attachments.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackTos} onChange={(e) => setAckTos?.(e.target.checked)} />
          <span>
            I agree to the{" "}
            <a
              className="text-blue-600 hover:underline"
              href="/static/legal/terms_of_service.txt"
              target="_blank"
              rel="noreferrer"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              className="text-blue-600 hover:underline"
              href="/static/legal/privacy_policy.txt"
              target="_blank"
              rel="noreferrer"
            >
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!!ackEsign} onChange={(e) => setAckEsign?.(e.target.checked)} />
          <span>
            I consent to conduct business electronically and use electronic signatures under the U.S. E-SIGN Act.
            I understand my electronic signature is legally binding, and I can request a paper copy.
          </span>
        </label>
        <div className="rounded border bg-yellow-50 text-yellow-800 px-3 py-2">
          <strong>Note:</strong> You must preview the PDF before signing.
        </div>
      </section>

      {/* Signatures */}
      <section>
        <div className="text-sm font-semibold mb-2">Signatures</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contractor */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Contractor Signature</div>

            {agreement?.signed_by_contractor ? (
              <div className="text-sm text-green-700">
                ✓ Already signed by contractor{" "}
                {agreement?.contractor_signature_name ? `(${agreement.contractor_signature_name})` : ""}.
              </div>
            ) : (
              <>
                <label className="block text-sm mb-1">Type full legal name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="e.g., Jane Q. Contractor"
                  value={typedName || ""}
                  onChange={(e) => setTypedName?.(e.target.value)}
                />

                {/* Optional image upload */}
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1">Upload Signature (optional, PNG/JPG)</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (file && !file.type.startsWith("image/")) {
                        toast.error("Please upload an image (PNG/JPG).");
                        e.target.value = "";
                        return;
                      }
                      setSigFile(file);
                    }}
                  />
                  {sigFile && (
                    <div className="mt-1 text-xs text-gray-600">
                      Selected: <span className="font-medium">{sigFile.name}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={openingPreview}
                    className={`rounded px-3 py-2 text-sm ${
                      openingPreview ? "bg-indigo-100 text-indigo-400 cursor-wait" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    }`}
                    title="Open PDF preview in a new tab"
                  >
                    {openingPreview ? "Opening…" : "Preview PDF"}
                  </button>

                  {/* If a parent sign handler was provided, use it; else use local */}
                  <button
                    type="button"
                    disabled={!effectiveCanSign || signingInProgress}
                    onClick={signContractor ? () => signContractor() : handleSignLocal}
                    className={`rounded px-3 py-2 text-sm text-white ${
                      effectiveCanSign && !signingInProgress
                        ? "bg-indigo-600 hover:bg-indigo-700"
                        : "bg-gray-400 cursor-not-allowed"
                    }`}
                    title={!effectiveCanSign ? "Preview + all checkboxes + typed name required" : "Sign as Contractor"}
                  >
                    {signingInProgress ? "Signing…" : "Sign as Contractor"}
                  </button>
                </div>

                {!hasPreviewed && (
                  <div className="mt-2 text-xs text-amber-700">Please preview the PDF before signing.</div>
                )}
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
                    onClick={goPublic}
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

      {/* Footer actions */}
      <div className="flex gap-2">
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
          onClick={handlePreview}
          disabled={openingPreview}
          className={`rounded px-3 py-2 text-sm ${
            openingPreview ? "bg-indigo-100 text-indigo-400 cursor-wait" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          }`}
          title="Open PDF preview in a new tab"
        >
          {openingPreview ? "Opening…" : "Preview PDF"}
        </button>
        <button
          type="button"
          onClick={goPublic}
          className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
          title="Open the public signing link"
        >
          View Public Link
        </button>
      </div>
    </div>
  );
}

/* ---- shared tiny UI ---- */
function SummaryCard({ label, value }) {
  return (
    <div className="rounded border bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
