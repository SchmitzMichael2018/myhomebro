// frontend/src/components/Step4Finalize.jsx
// v2025-12-02e — Homeowner signature uses send_signature_request; Contractor uses SignatureModal + finger pad
// + UI note: once both parties have signed, MyHomeBro automatically emails the escrow funding link.
// + Manual backup: after both signatures, contractor can resend escrow funding link from Step 4.

import React, { useEffect, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import SignatureModal from "./SignatureModal";
import SendFundingLinkButton from "./SendFundingLinkButton";

function toDateOnly(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate() + 0).padStart(2, "0"); // keep behavior
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatPhone(phoneStr) {
  if (!phoneStr) return "—";
  const cleaned = ("" + phoneStr).replace(/\D/g, "");
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return phoneStr;
}

function SummaryCard({ label, value, className = "" }) {
  return (
    <div className={`rounded border bg-gray-50 px-3 py-2 h-full ${className}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium whitespace-pre-wrap text-gray-900 break-words">
        {value}
      </div>
    </div>
  );
}

/**
 * Build "City, State ZIP" like the backend helpers.
 */
function buildCityStateZip(city, state, postal) {
  const cityClean = (city || "").trim();
  const stateClean = (state || "").trim();
  const postalClean = (postal || "").trim();

  const cs = [cityClean, stateClean].filter(Boolean).join(", ");
  const tail = [cs, postalClean].filter(Boolean).join(" ");
  return tail.trim();
}

/**
 * Build homeowner address from Agreement + optional explicit homeowner object.
 */
function getHomeownerAddressFromAgreement(agreement, homeownerObj) {
  if (!agreement) return "—";
  const a = agreement;

  // 0) Single-line snapshot string from backend sync
  const snapSingle =
    (typeof a.homeowner_address_snapshot === "string" &&
      a.homeowner_address_snapshot.trim()) ||
    (typeof a.homeowner_address_text === "string" &&
      a.homeowner_address_text.trim());

  if (snapSingle) {
    return snapSingle;
  }

  // 1) NESTED HOMEOWNER OBJECT (if present)
  const ho =
    homeownerObj ||
    (typeof a.homeowner === "object" ? a.homeowner : null) ||
    null;
  if (ho && typeof ho === "object") {
    const hoLine1 =
      (ho.address_line1 ||
        ho.address1 ||
        ho.street_address ||
        ho.address ||
        "").trim();
    const hoLine2 =
      (ho.address_line2 ||
        ho.address2 ||
        ho.unit ||
        ho.apt ||
        ho.suite ||
        "").trim();
    const hoCity = (ho.city || "").trim();
    const hoState =
      (ho.state || ho.region || ho.state_code || "").trim();
    const hoPostal =
      (ho.zip_code || ho.zip || ho.postal_code || ho.postcode || "").trim();

    const hoLines = [];
    if (hoLine1) hoLines.push(hoLine1);
    if (hoLine2) hoLines.push(hoLine2);
    const hoLastLine = buildCityStateZip(hoCity, hoState, hoPostal);
    if (hoLastLine) hoLines.push(hoLastLine);
    if (hoLines.length) return hoLines.join("\n");
  }

  // 2) As last resort, show homeowner_address from serializer (already formatted)
  if (a.homeowner_address && String(a.homeowner_address).trim()) {
    return String(a.homeowner_address).trim();
  }

  return "—";
}

/**
 * Build project address from Agreement (EXPLICIT project_address_* fields only).
 */
function getProjectAddressFromAgreement(agreement) {
  if (!agreement) return "—";
  const a = agreement;

  const line1 = (a.project_address_line1 || "").trim();
  const line2 = (a.project_address_line2 || "").trim();
  const city = (a.project_address_city || "").trim();
  const state = (a.project_address_state || "").trim();
  const postal = (a.project_postal_code || "").trim();

  if (!line1 && !line2 && !city && !state && !postal) {
    return "—";
  }

  const parts = [];
  if (line1) parts.push(line1);
  if (line2) parts.push(line2);

  const lastLine = buildCityStateZip(city, state, postal);
  if (lastLine) parts.push(lastLine);

  return parts.join("\n").trim();
}

export default function Step4Finalize({
  agreement,
  dLocal, // Step 1 view-model (for debug display only now)
  id,
  previewPdf,
  goPublic, // legacy prop (no longer used)
  milestones,
  totals,
  hasPreviewed,
  ackReviewed,
  setAckReviewed,
  ackTos,
  setAckTos,
  ackEsign,
  setAckEsign,
  typedName,
  setTypedName,
  canSign,
  signing,
  signContractor, // (unused but kept for compatibility)
  submitSign, // legacy handler (no longer used directly)
  attachments,
  defaultWarrantyText,
  customWarranty,
  useDefaultWarranty,
  goBack,
  isEdit,
  unsignContractor,
}) {
  const [loadingHomeowner, setLoadingHomeowner] = useState(false);
  const [homeownerObj, setHomeownerObj] = useState(null);

  const [sendingLink, setSendingLink] = useState(false);
  const [lastSentUrl, setLastSentUrl] = useState(null);
  const [sendError, setSendError] = useState(null);

  const [showSignatureModal, setShowSignatureModal] = useState(false);

  // If agreement.homeowner is just an ID, fetch full homeowner record.
  useEffect(() => {
    const fetchHomeowner = async () => {
      if (!agreement) return;
      const candidate = agreement.homeowner;

      // If we already have an object snapshot, don't fetch.
      if (
        agreement.homeowner_snapshot &&
        typeof agreement.homeowner_snapshot === "object"
      ) {
        setHomeownerObj(agreement.homeowner_snapshot);
        return;
      }

      if (!candidate) return;
      const idVal =
        typeof candidate === "number"
          ? candidate
          : parseInt(candidate, 10);
      if (!idVal || Number.isNaN(idVal)) return;

      setLoadingHomeowner(true);
      try {
        const { data } = await api.get(`/projects/homeowners/${idVal}/`);
        setHomeownerObj(data);
      } catch (e) {
        // fail silently
      } finally {
        setLoadingHomeowner(false);
      }
    };

    fetchHomeowner();
  }, [agreement]);

  // Addresses from Agreement (backend truth)
  const homeownerAddressDisplay = getHomeownerAddressFromAgreement(
    agreement,
    homeownerObj
  );
  const projectAddressDisplay = getProjectAddressFromAgreement(agreement);

  // Homeowner Contact Details
  const homeownerName =
    agreement?.homeowner_name ||
    homeownerObj?.full_name ||
    agreement?.homeowner?.full_name ||
    "—";
  const homeownerEmail =
    agreement?.homeowner_email ||
    homeownerObj?.email ||
    agreement?.homeowner?.email ||
    "—";
  const homeownerPhone =
    homeownerObj?.phone_number ||
    agreement?.homeowner?.phone_number ||
    agreement?.homeowner?.phone ||
    "—";

  // Totals / summary
  const totalAmount =
    totals?.totalAmt ??
    agreement?.display_milestone_total ??
    agreement?.total_cost ??
    agreement?.total ??
    0;

  const status = agreement?.status || "DRAFT";
  const displayMilestones = milestones || agreement?.milestones || [];

  const isFullySigned =
    !!agreement?.signed_by_contractor && !!agreement?.signed_by_homeowner;
  const escrowFunded = !!agreement?.escrow_funded;

  // ---------------- Contractor signing (open SignatureModal) ----------------

  const handleOpenContractorModal = () => {
    if (!hasPreviewed) {
      toast.error("You must preview the PDF before signing.");
      return;
    }
    if (!ackReviewed || !ackTos || !ackEsign) {
      toast.error(
        "Please confirm you have reviewed the agreement, agree to the Terms & Privacy Policy, and consent to e-sign."
      );
      return;
    }
    if (!typedName.trim()) {
      toast.error("Please type your full legal name.");
      return;
    }
    setShowSignatureModal(true);
  };

  const handleContractorSigned = () => {
    setShowSignatureModal(false);
    // Simple refresh to pull updated signed_by_contractor + signature fields
    window.location.reload();
  };

  // ---------------- Homeowner link sender (signing link) ----------------

  const handleSendHomeownerLink = async () => {
    if (!agreement?.id) return;
    setSendingLink(true);
    setSendError(null);
    try {
      const { data } = await api.post(
        `/projects/agreements/${agreement.id}/send_signature_request/`
      );
      if (data?.sign_url) {
        setLastSentUrl(data.sign_url);
      }
      toast.success("Homeowner signing link sent.");
    } catch (err) {
      console.error("send_signature_request error:", err);
      const msg =
        err?.response?.data?.detail ||
        "Unable to send homeowner signing link.";
      setSendError(msg);
      toast.error(msg);
    } finally {
      setSendingLink(false);
    }
  };

  return (
    <div className="mt-4 space-y-6">
      {/* Top Summary Card: Agreement & Homeowner Details */}
      <div className="rounded-lg border bg-white p-4 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Agreement &amp; Homeowner Details
        </h3>

        {/* Project summary row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Project Title"
            value={
              agreement?.project_title ||
              agreement?.title ||
              "Untitled Project"
            }
          />
          <SummaryCard
            label="Agreement ID"
            value={agreement?.id ? `#${agreement.id}` : "New"}
          />
          <SummaryCard
            label="Project Type"
            value={
              agreement?.project_type ||
              agreement?.project?.project_type ||
              "—"
            }
          />
          <SummaryCard label="Status" value={status} />
        </div>

        {/* Homeowner contact row — give Email extra width */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <SummaryCard label="Homeowner Name" value={homeownerName} />
          <SummaryCard
            label="Homeowner Phone"
            value={formatPhone(homeownerPhone)}
          />
          <SummaryCard
            label="Homeowner Email"
            value={homeownerEmail}
            className="md:col-span-3"
          />
        </div>
      </div>

      {/* Addresses */}
      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border bg-white p-4 shadow h-full">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Homeowner Address
            </h3>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">
              {homeownerAddressDisplay}
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow h-full">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Project Address
            </h3>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">
              {projectAddressDisplay}
            </div>
          </div>
        </div>

        {/* DEBUG */}
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-gray-500">
            Debug: Step1 dLocal vs Agreement project/homeowner snapshots
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words bg-gray-50 border rounded p-2 text-[11px] text-gray-800">
            {JSON.stringify(
              {
                dLocal: {
                  address_line1: dLocal?.address_line1,
                  address_line2: dLocal?.address_line2,
                  address_city: dLocal?.address_city,
                  address_state: dLocal?.address_state,
                  address_postal_code: dLocal?.address_postal_code,
                },
                agreement_project_fields: {
                  project_address_line1: agreement?.project_address_line1,
                  project_address_line2: agreement?.project_address_line2,
                  project_address_city: agreement?.project_address_city,
                  project_address_state: agreement?.project_address_state,
                  project_postal_code: agreement?.project_postal_code,
                },
                derived_projectAddressDisplay: projectAddressDisplay,
                homeowner_address_snapshot:
                  agreement?.homeowner_address_snapshot,
                homeowner_address_text: agreement?.homeowner_address_text,
                serializer_homeowner_address: agreement?.homeowner_address,
                homeowner_nested_object: agreement?.homeowner || null,
                fetched_homeowner: homeownerObj || null,
              },
              null,
              2
            )}
          </pre>
        </details>
      </section>

      {/* Project Scope */}
      <section className="rounded-lg border bg-white p-4 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Project Scope &amp; Description
        </h3>
        <div className="whitespace-pre-wrap text-sm text-gray-700">
          {agreement?.description || "No project description provided."}
        </div>
      </section>

      {/* Milestones */}
      <section className="rounded-lg border bg-white p-4 shadow">
        <div className="text-lg font-semibold mb-2">
          Milestones &amp; Total ({displayMilestones.length})
        </div>
        <div className="mb-3 text-sm font-medium text-gray-700">
          Total Project Cost: $
          {Number(totalAmount || 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  #
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayMilestones.map((m, i) => (
                <tr key={m.id || i} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                    {m.title || "Untitled"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                    {toDateOnly(
                      m.due_date || m.completion_date || m.end_date
                    ) || "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right text-sm text-gray-500">
                    {typeof m.amount === "number"
                      ? `$${m.amount.toFixed(2)}`
                      : m.amount || "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-center text-sm text-gray-500">
                    {m.status_display || m.status || "Pending"}
                  </td>
                </tr>
              ))}
              {!displayMilestones.length && (
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

      {/* Warranty & Attachments */}
      <section className="rounded-lg border bg-white p-4 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Warranty &amp; Attachments
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <SummaryCard
            label="Warranty Type"
            value={useDefaultWarranty ? "Default Warranty" : "Custom Warranty"}
          />
          <SummaryCard
            label="Attachments"
            value={attachments?.length || 0}
          />
        </div>

        {(attachments || []).length > 0 ? (
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
                {(attachments || []).map((a) => {
                  const url =
                    a.file ||
                    a.url ||
                    a.file_url ||
                    a.download_url ||
                    a.download ||
                    a.absolute_url ||
                    null;
                  return (
                    <tr
                      key={a.id || a.name || a.url}
                      className="border-t"
                    >
                      <td className="px-3 py-2">
                        {(a.category || "").toUpperCase()}
                      </td>
                      <td className="px-3 py-2">
                        {a.title || a.filename || "Attachment"}
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
          <div className="text-sm text-gray-500">
            No visible attachments.
          </div>
        )}
      </section>

      {/* Signatures */}
      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contractor */}
          <div className="rounded-lg border bg-white p-4 shadow flex flex-col justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900 mb-2">
                Contractor Signature
              </div>

              {agreement?.signed_by_contractor ? (
                <div className="space-y-3">
                  <div className="text-sm text-green-700 font-medium p-2 bg-green-50 rounded">
                    ✓ Already signed by contractor{" "}
                    {agreement?.contractor_signature_name
                      ? `(${agreement.contractor_signature_name})`
                      : ""}
                    .
                  </div>

                  {/* UNSIGN button — only show if homeowner has NOT signed */}
                  {!agreement?.signed_by_homeowner && (
                    <button
                      type="button"
                      onClick={unsignContractor}
                      className="w-full inline-flex justify-center rounded-md border border-red-300 shadow-sm px-4 py-2 text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                    >
                      Unsign (Remove Contractor Signature)
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    Please review before signing.
                  </p>

                  {/* Agreements / Checkboxes */}
                  <div className="space-y-2 text-sm mb-4">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={!!ackReviewed}
                        onChange={(e) => setAckReviewed(e.target.checked)}
                        className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-700">
                        I have reviewed the entire agreement and all attached
                        exhibits/attachments.
                      </span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={!!ackTos}
                        onChange={(e) => setAckTos(e.target.checked)}
                        className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-700">
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
                      <input
                        type="checkbox"
                        checked={!!ackEsign}
                        onChange={(e) => setAckEsign(e.target.checked)}
                        className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-700">
                        I consent to conduct business electronically and use
                        electronic signatures under the U.S. E-SIGN Act.
                      </span>
                    </label>
                    {!hasPreviewed && (
                      <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
                        ⚠️ You must <b>Preview PDF</b> before signing.
                      </div>
                    )}
                  </div>

                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Type full legal name
                  </label>
                  <input
                    className="w-full rounded border px-3 py-2 text-sm mb-3"
                    placeholder="e.g., Jane Q. Contractor"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                  />

                  <button
                    type="button"
                    disabled={!canSign || signing}
                    onClick={handleOpenContractorModal}
                    className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
                      canSign
                        ? "bg-indigo-600 hover:bg-indigo-700"
                        : "bg-gray-400 cursor-not-allowed"
                    }`}
                  >
                    {signing ? "Signing…" : "Sign as Contractor"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Homeowner */}
          <div className="rounded-lg border bg-white p-4 shadow flex flex-col">
            <div className="text-lg font-semibold text-gray-900 mb-2">
              Homeowner Signature
            </div>
            {agreement?.signed_by_homeowner ? (
              <div className="space-y-3">
                <div className="text-sm text-green-700 font-medium p-2 bg-green-50 rounded">
                  ✓ Already signed by homeowner.
                </div>
                {isFullySigned && (
                  <div className="space-y-2">
                    <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                      This agreement is fully signed. MyHomeBro automatically
                      emails the homeowner a secure escrow funding link tied to
                      this project when both parties sign using the latest
                      flow.
                      {escrowFunded && (
                        <> Escrow is already marked as funded in the system.</>
                      )}
                    </div>

                    {/* Manual backup: allow contractor to (re)send funding link */}
                    {!escrowFunded && agreement?.id && (
                      <SendFundingLinkButton
                        agreementId={agreement.id}
                        isFullySigned={isFullySigned}
                        amount={totalAmount}
                        className="mt-1"
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="text-sm text-gray-600 mb-4 flex-grow">
                  The homeowner will receive an email with a secure link to
                  review and sign this agreement in MyHomeBro. You can also copy
                  the link after sending if you want to text it manually or open
                  it on a tablet.
                </div>
                {sendError && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-2">
                    {sendError}
                  </div>
                )}
                {lastSentUrl && (
                  <div className="mb-2">
                    <div className="text-xs text-gray-600 mb-1">
                      Last sent link (copy to share manually):
                    </div>
                    <input
                      type="text"
                      readOnly
                      className="w-full text-xs border rounded px-2 py-1 bg-gray-50"
                      value={lastSentUrl}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                )}
                <div className="mt-auto space-y-2">
                  <button
                    type="button"
                    onClick={handleSendHomeownerLink}
                    disabled={sendingLink}
                    className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-gray-800 text-sm font-medium text-white hover:bg-black focus:outline-none"
                    title="Email a secure signing link to the homeowner"
                  >
                    {sendingLink
                      ? "Sending link…"
                      : "Send Homeowner Signing Link"}
                  </button>

                  <div className="text-[11px] text-slate-500">
                    After both you and the homeowner have signed, MyHomeBro will
                    automatically email the homeowner a secure link to fund
                    escrow for this project. If needed, you can later use the
                    funding button that appears here once both signatures are
                    in.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer — ONLY HERE */}
      <div className="flex flex-wrap gap-3 justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={goBack}
          className="rounded bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          title="Back to previous step"
        >
          Back
        </button>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={previewPdf}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 shadow-sm"
            title="Open preview PDF"
          >
            Preview PDF {!agreement?.signed_by_contractor && "(Required)"}
          </button>
        </div>
      </div>

      {/* Contractor Signature Modal with finger/mouse pad */}
      {agreement && (
        <SignatureModal
          isOpen={showSignatureModal}
          onClose={() => setShowSignatureModal(false)}
          agreement={agreement}
          signingRole="contractor"
          defaultName={typedName}
          compact={true}
          onSigned={handleContractorSigned}
        />
      )}
    </div>
  );
}
