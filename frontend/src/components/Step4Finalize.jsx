// frontend/src/components/Step4Finalize.jsx
// v2025-10-22-amend-ui — Adds Amendment badge + "Start Amendment" button
// - Shows "#<agreement> — Amendment <n>" when amendment_number > 0
// - "Start Amendment" appears only when BOTH parties have signed
// - On success: clears both signatures locally so "Sign as Contractor" reappears
// - Keeps Unsign + Sign flows with instant UI updates (no page reload)

import React, { useMemo, useState } from "react";
import api from "../api";

function fmtDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export default function Step4Finalize({
  agreement,
  id,
  milestones,
  totals,
  attachments,
  defaultWarrantyText,
  customWarranty,
  useDefaultWarranty,
  previewPdf,
  goPublic,
  goBack,
}) {
  // ----- Pull initial signature metadata from server -----
  const initContractor = useMemo(
    () => ({
      name:
        agreement?.contractor_signature_name ||
        agreement?.contractor_name ||
        "",
      at:
        agreement?.contractor_signed_at ||
        agreement?.signed_at_contractor ||
        null,
      ip:
        agreement?.contractor_signature_ip ||
        agreement?.contractor_signed_ip ||
        agreement?.contractor_ip ||
        null,
      ua:
        agreement?.contractor_signature_useragent ||
        agreement?.contractor_user_agent ||
        null,
    }),
    [agreement]
  );

  const initHomeowner = useMemo(
    () => ({
      name:
        agreement?.homeowner_signature_name || agreement?.homeowner_name || "",
      at:
        agreement?.homeowner_signed_at ||
        agreement?.signed_at_homeowner ||
        null,
      ip:
        agreement?.homeowner_signature_ip ||
        agreement?.homeowner_signed_ip ||
        agreement?.homeowner_ip ||
        null,
      ua:
        agreement?.homeowner_signature_useragent ||
        agreement?.homeowner_user_agent ||
        null,
    }),
    [agreement]
  );

  // Robust “signed” flags (boolean OR timestamp)
  const [contractorSigned, setContractorSigned] = useState(
    !!(agreement?.signed_by_contractor || initContractor.at)
  );
  const [homeownerSigned, setHomeownerSigned] = useState(
    !!(agreement?.signed_by_homeowner || initHomeowner.at)
  );

  // Local copies (instant UI updates after actions)
  const [contractorMeta, setContractorMeta] = useState(initContractor);
  const [homeownerMeta, setHomeownerMeta] = useState(initHomeowner);

  // Amendment label (e.g., "#5 — Amendment 1")
  const [amendmentNumber, setAmendmentNumber] = useState(
    Number(agreement?.amendment_number || 0)
  );

  // Action states
  const [unsigning, setUnsigning] = useState(false);
  const [startingAmend, setStartingAmend] = useState(false);
  const [typedName, setTypedName] = useState(""); // contractor sign
  const [signing, setSigning] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePhone, setSharePhone] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);

  const warrantyText = useDefaultWarranty
    ? defaultWarrantyText
    : customWarranty?.trim()
    ? customWarranty
    : defaultWarrantyText;

  // ----- Actions -----

  const doUnsign = async () => {
    if (!contractorSigned || homeownerSigned) return;
    if (!window.confirm("Revoke your signature to make edits?")) return;
    setUnsigning(true);
    try {
      const res = await api.post(
        `/api/projects/agreements/${id}/unsign/`
      );
      // Flip UI to unsigned immediately
      setContractorSigned(false);
      setContractorMeta({ name: "", at: null, ip: null, ua: null });
      console.log("unsign ok", res?.data || {});
    } catch (err) {
      console.error("unsign failed", err);
      alert("Could not revoke signature.");
    } finally {
      setUnsigning(false);
    }
  };

  const doContractorSign = async () => {
    const name = (typedName || "").trim();
    if (!name) {
      alert("Please type your full legal name to sign.");
      return;
    }
    setSigning(true);
    try {
      const form = new FormData();
      form.append("typed_name", name);
      await api.post(
        `/api/projects/agreements/${id}/contractor_sign/`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      // Optimistic UI update
      const nowIso = new Date().toISOString();
      setContractorSigned(true);
      setContractorMeta({
        name,
        at: nowIso,
        ip: contractorMeta.ip,
        ua: navigator.userAgent || contractorMeta.ua,
      });
      setTypedName("");
    } catch (err) {
      console.error("contractor_sign failed", err);
      alert("Signing failed. Check server logs/console for details.");
    } finally {
      setSigning(false);
    }
  };

  const startAmendment = async () => {
    if (!(contractorSigned && homeownerSigned)) return;
    if (
      !window.confirm(
        "Start a new amendment? Both signatures will be cleared and a new signing round will be required."
      )
    )
      return;
    setStartingAmend(true);
    try {
      const res = await api.post(
        `/api/projects/agreements/${id}/start_amendment/`
      );
      // Clear BOTH signatures locally, bump amendment number, keep UI consistent
      setContractorSigned(false);
      setHomeownerSigned(false);
      setContractorMeta({ name: "", at: null, ip: null, ua: null });
      setHomeownerMeta({ name: "", at: null, ip: null, ua: null });
      if (res?.data?.amendment_number !== undefined) {
        setAmendmentNumber(Number(res.data.amendment_number) || 0);
      } else {
        setAmendmentNumber((n) => n + 1);
      }
      alert("Amendment started. Both parties must re-sign.");
    } catch (err) {
      console.error("start_amendment failed", err);
      alert("Could not start the amendment.");
    } finally {
      setStartingAmend(false);
    }
  };

  const sendEmail = async () => {
    if (!shareEmail?.trim()) return;
    setSendingEmail(true);
    try {
      await api.post(
        `/api/projects/agreements/${id}/share_email/`,
        { email: shareEmail.trim() }
      );
      alert("Email sent.");
    } catch (err) {
      console.error("share email failed", err);
      alert("Could not send the email link.");
    } finally {
      setSendingEmail(false);
    }
  };

  const sendSms = async () => {
    if (!sharePhone?.trim()) return;
    setSendingSms(true);
    try {
      await api.post(
        `/api/projects/agreements/${id}/share_sms/`,
        { phone: sharePhone.trim() }
      );
      alert("Text message sent (or queued).");
    } catch (err) {
      console.error("share sms failed", err);
      alert("Could not send the text link.");
    } finally {
      setSendingSms(false);
    }
  };

  // ----- UI -----

  return (
    <div className="rounded-lg border bg-white p-4 space-y-6">
      {/* Header with Amendment badge */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
        <div className="rounded border bg-gray-50 px-3 py-2">
          <div className="text-xs text-gray-500">Agreement</div>
          <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
            <span>#{agreement?.id || id}</span>
            {amendmentNumber > 0 && (
              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                Amendment {amendmentNumber}
              </span>
            )}
            <span className="text-gray-700">
              — {agreement?.project_title || agreement?.title || "Project"}
            </span>
          </div>
        </div>

        <div className="rounded border bg-gray-50 px-3 py-2">
          <div className="text-xs text-gray-500">Total Amount</div>
          <div className="text-sm font-medium">
            ${Number(totals?.totalAmt || 0).toFixed(2)}
          </div>
        </div>

        <div className="rounded border bg-gray-50 px-3 py-2">
          <div className="text-xs text-gray-500">Start — End</div>
          <div className="text-sm font-medium">
            {totals?.minStart || "—"} — {totals?.maxEnd || "—"}
          </div>
        </div>

        <div className="rounded border bg-gray-50 px-3 py-2">
          <div className="text-xs text-gray-500">Total Days</div>
          <div className="text-sm font-medium">
            {String(totals?.totalDays || 0)}
          </div>
        </div>
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
                  <td className="px-3 py-2">
                    {fmtDateOnly(
                      m.completion_date ||
                        m.end_date ||
                        m.end ||
                        m.due_date ||
                        m.scheduled_date ||
                        m.start_date ||
                        m.start
                    ) || "—"}
                  </td>
                  <td className="px-3 py-2">
                    ${Number(m.amount || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    {m.status || (m.completed ? "Completed" : "Pending")}
                  </td>
                </tr>
              ))}
              {!milestones?.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-gray-500"
                  >
                    No milestones.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Attachments */}
      <section>
        <div className="text-sm font-semibold mb-2">
          Attachments &amp; Addenda (Visible)
        </div>
        {(attachments || []).filter(
          (a) => a.visible || a.is_visible || a.public || a.is_public
        ).length ? (
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
                  .filter(
                    (a) => a.visible || a.is_visible || a.public || a.is_public
                  )
                  .map((a) => {
                    const url =
                      a.file ||
                      a.url ||
                      a.file_url ||
                      a.download_url ||
                      a.download ||
                      a.absolute_url ||
                      null;
                    return (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-2">
                          {(a.category || "").toUpperCase()}
                        </td>
                        <td className="px-3 py-2">
                          {a.title || a.filename || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {url ? (
                            <a
                              className="text-blue-600 hover:underline"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
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

      {/* Signatures */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Signatures</div>

          {/* Start Amendment — only when BOTH are signed */}
          {contractorSigned && homeownerSigned && (
            <button
              type="button"
              onClick={startAmendment}
              disabled={startingAmend}
              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:bg-gray-400"
              title="Create a new amendment and require new signatures"
            >
              {startingAmend ? "Starting…" : "Start Amendment"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contractor block */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Contractor Signature</div>

            {contractorSigned ? (
              <div className="space-y-2 text-sm">
                <div className="text-green-700">
                  ✓ Already signed by contractor
                  {contractorMeta.name ? ` (${contractorMeta.name})` : ""}.
                </div>
                <div className="text-gray-700">
                  <div>
                    <span className="text-gray-500">Signed At:</span>{" "}
                    {fmtDateTime(contractorMeta.at) || "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">IP:</span>{" "}
                    {contractorMeta.ip || "—"}
                  </div>
                  <div className="break-words">
                    <span className="text-gray-500">User-Agent:</span>{" "}
                    {contractorMeta.ua || "—"}
                  </div>
                </div>

                {!homeownerSigned && (
                  <button
                    type="button"
                    onClick={doUnsign}
                    disabled={unsigning}
                    className="mt-2 rounded bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:bg-gray-400"
                    title="Revoke your signature to make edits (only before homeowner signs)"
                  >
                    {unsigning ? "Revoking…" : "Unsign Agreement"}
                  </button>
                )}
              </div>
            ) : (
              <>
                <label className="block text-sm mb-1">
                  Type full legal name
                </label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="e.g., Jane Q. Contractor"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                />

                <div className="mt-3">
                  <button
                    type="button"
                    disabled={!typedName?.trim() || signing}
                    onClick={doContractorSign}
                    className={`rounded px-3 py-2 text-sm text-white ${
                      typedName?.trim()
                        ? "bg-indigo-600 hover:bg-indigo-700"
                        : "bg-gray-400 cursor-not-allowed"
                    }`}
                    title={
                      !typedName?.trim()
                        ? "Type your full legal name to sign"
                        : "Sign as Contractor"
                    }
                  >
                    {signing ? "Signing…" : "Sign as Contractor"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Homeowner block */}
          <div className="rounded border p-3">
            <div className="text-sm font-medium mb-2">Homeowner Signature</div>

            {homeownerSigned ? (
              <div className="space-y-2 text-sm">
                <div className="text-green-700">
                  ✓ Signed by homeowner
                  {homeownerMeta.name ? ` (${homeownerMeta.name})` : ""}.
                </div>
                <div className="text-gray-700">
                  <div>
                    <span className="text-gray-500">Signed At:</span>{" "}
                    {fmtDateTime(homeownerMeta.at) || "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">IP:</span>{" "}
                    {homeownerMeta.ip || "—"}
                  </div>
                  <div className="break-words">
                    <span className="text-gray-500">User-Agent:</span>{" "}
                    {homeownerMeta.ua || "—"}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="text-sm text-gray-600 mb-3">
                  Share the public link or open it directly.
                </div>
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() =>
                      window.open(`/agreements/public/${id}/`, "_blank")
                    }
                    className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-black"
                    title="Open the public signing link"
                  >
                    Open Public Signing Link
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm mb-1">Send via Email</label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded border px-3 py-2 text-sm"
                        placeholder="homeowner@email.com"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={sendEmail}
                        disabled={!shareEmail || sendingEmail}
                        className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:bg-gray-400"
                      >
                        {sendingEmail ? "Sending…" : "Send Email"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm mb-1">
                      Send via Text (SMS)
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded border px-3 py-2 text-sm"
                        placeholder="+1 210 555 0123"
                        value={sharePhone}
                        onChange={(e) => setSharePhone(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={sendSms}
                        disabled={!sharePhone || sendingSms}
                        className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:bg-gray-400"
                      >
                        {sendingSms ? "Sending…" : "Send Text"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
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
