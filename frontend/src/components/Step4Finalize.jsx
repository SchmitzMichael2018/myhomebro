// frontend/src/components/Step4Finalize.jsx
// v2025-12-13c — Funding preview auto-refresh when milestones change + cache bust
// - Refetches /funding_preview/ when milestones change (add/remove/edit amounts)
// - Busts cache using _ts query param
// - Prefers fundingPreview.total_required when present (new backend), falls back safely
// - Keeps existing UX/layout intact

import React, { useEffect, useMemo, useState } from "react";
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
  const dd = String(d.getDate()).padStart(2, "0");
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

function buildCityStateZip(city, state, postal) {
  const cityClean = (city || "").trim();
  const stateClean = (state || "").trim();
  const postalClean = (postal || "").trim();

  const cs = [cityClean, stateClean].filter(Boolean).join(", ");
  const tail = [cs, postalClean].filter(Boolean).join(" ");
  return tail.trim();
}

function getHomeownerAddressFromAgreement(agreement, homeownerObj) {
  if (!agreement) return "—";
  const a = agreement;

  const snapSingle =
    (typeof a.homeowner_address_snapshot === "string" &&
      a.homeowner_address_snapshot.trim()) ||
    (typeof a.homeowner_address_text === "string" &&
      a.homeowner_address_text.trim());

  if (snapSingle) {
    return snapSingle;
  }

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
    const hoState = (ho.state || ho.region || ho.state_code || "").trim();
    const hoPostal =
      (ho.zip_code || ho.zip || ho.postal_code || ho.postcode || "").trim();

    const hoLines = [];
    if (hoLine1) hoLines.push(hoLine1);
    if (hoLine2) hoLines.push(hoLine2);
    const hoLastLine = buildCityStateZip(hoCity, hoState, hoPostal);
    if (hoLastLine) hoLines.push(hoLastLine);
    if (hoLines.length) return hoLines.join("\n");
  }

  if (a.homeowner_address && String(a.homeowner_address).trim()) {
    return String(a.homeowner_address).trim();
  }

  return "—";
}

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
  dLocal,
  id,
  previewPdf,
  goPublic,
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
  signContractor,
  submitSign,
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
  const [sendError, setSendError] = useState(null);

  const [showSignatureModal, setShowSignatureModal] = useState(false);

  const [fundingPreview, setFundingPreview] = useState(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState("");

  // ─────────────────────────────────────────────────────────────
  // Homeowner fetch
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchHomeowner = async () => {
      if (!agreement) return;
      const candidate = agreement.homeowner;

      if (
        agreement.homeowner_snapshot &&
        typeof agreement.homeowner_snapshot === "object"
      ) {
        setHomeownerObj(agreement.homeowner_snapshot);
        return;
      }

      if (!candidate) return;
      const idVal =
        typeof candidate === "number" ? candidate : parseInt(candidate, 10);
      if (!idVal || Number.isNaN(idVal)) return;

      setLoadingHomeowner(true);
      try {
        const { data } = await api.get(`/projects/homeowners/${idVal}/`);
        setHomeownerObj(data);
      } catch {
        // ignore
      } finally {
        setLoadingHomeowner(false);
      }
    };

    fetchHomeowner();
  }, [agreement]);

  // ─────────────────────────────────────────────────────────────
  // Totals / milestone key for preview refresh
  // ─────────────────────────────────────────────────────────────
  const totalAmount =
    totals?.totalAmt ??
    agreement?.display_milestone_total ??
    agreement?.total_cost ??
    agreement?.total ??
    0;

  const milestoneKey = useMemo(() => {
    const arr = Array.isArray(milestones) ? milestones : [];
    // Include amount + due + title to refresh fee preview on edits
    return arr
      .map((m, idx) => {
        const idPart = m?.id ?? m?.pk ?? m?.order ?? idx;
        const amt = m?.amount ?? "";
        const due = m?.due_date ?? m?.start_date ?? m?.end_date ?? m?.completion_date ?? "";
        const title = m?.title ?? "";
        return `${idPart}:${amt}:${due}:${title}`;
      })
      .join("|");
  }, [milestones]);

  const amendmentNumber =
    agreement?.amendment_number != null
      ? Number(agreement.amendment_number)
      : agreement?.amendment != null
      ? Number(agreement.amendment)
      : 0;

  // ─────────────────────────────────────────────────────────────
  // Funding preview fetch (REFRESH when milestones change)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchFundingPreview = async () => {
      if (!agreement?.id) {
        setFundingPreview(null);
        return;
      }
      setFundingLoading(true);
      setFundingError("");
      try {
        const { data } = await api.get(
          `/projects/agreements/${agreement.id}/funding_preview/`,
          {
            params: { _ts: Date.now() }, // cache bust
            headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          }
        );
        setFundingPreview(data);
      } catch (err) {
        console.error("funding_preview error:", err);
        const msg =
          err?.response?.data?.detail ||
          "Unable to load fee & escrow summary. Totals are still valid, but rate info is unavailable.";
        setFundingError(msg);
        setFundingPreview(null);
      } finally {
        setFundingLoading(false);
      }
    };

    fetchFundingPreview();
  }, [agreement?.id, amendmentNumber, milestoneKey, totalAmount]);

  const homeownerAddressDisplay = getHomeownerAddressFromAgreement(
    agreement,
    homeownerObj
  );
  const projectAddressDisplay = getProjectAddressFromAgreement(agreement);

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

  const status = agreement?.status || "DRAFT";
  const displayMilestones = milestones || agreement?.milestones || [];

  const amendmentLabel =
    amendmentNumber > 0 ? `Amendment ${amendmentNumber}` : "Original Agreement";

  const pdfVersion =
    agreement?.pdf_version != null ? Number(agreement.pdf_version) : null;

  // Signature truth (robust)
  const backendContractorSigned =
    !!agreement?.signed_by_contractor ||
    !!agreement?.contractor_signed ||
    !!agreement?.contractor_signature_name ||
    !!agreement?.signed_at_contractor ||
    !!agreement?.contractor_signed_at ||
    agreement?.is_fully_signed === true ||
    String(agreement?.status || "").toLowerCase() === "signed";

  const backendHomeownerSigned =
    !!agreement?.signed_by_homeowner ||
    !!agreement?.homeowner_signed ||
    !!agreement?.homeowner_signature_name ||
    !!agreement?.signed_at_homeowner ||
    !!agreement?.homeowner_signed_at ||
    agreement?.is_fully_signed === true ||
    String(agreement?.status || "").toLowerCase() === "signed";

  const signedByContractor = backendContractorSigned;
  const signedByHomeowner = backendHomeownerSigned;

  const fullySignedBackend = backendContractorSigned && backendHomeownerSigned;

  const isFullySigned = fullySignedBackend;

  // IMPORTANT: Prefer funding preview escrow flag if present
  const escrowFunded =
    fundingPreview?.escrow_funded != null
      ? !!fundingPreview.escrow_funded
      : !!agreement?.escrow_funded;

  const canUnsign = backendContractorSigned && !backendHomeownerSigned;

  const waitingOnHomeowner = signedByContractor && !signedByHomeowner;
  const waitingOnEscrow = isFullySigned && !escrowFunded;

  // Poll while waiting
  useEffect(() => {
    if (!agreement?.id) return;
    if (!waitingOnHomeowner && !waitingOnEscrow) return;

    let cancelled = false;

    const pollOnce = async () => {
      try {
        const { data } = await api.get(`/projects/agreements/${agreement.id}/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        if (cancelled) return;

        const newContractorSigned =
          !!data?.signed_by_contractor ||
          !!data?.contractor_signed ||
          !!data?.contractor_signature_name ||
          !!data?.signed_at_contractor ||
          !!data?.contractor_signed_at ||
          data?.is_fully_signed === true ||
          String(data?.status || "").toLowerCase() === "signed";

        const newHomeownerSigned =
          !!data?.signed_by_homeowner ||
          !!data?.homeowner_signed ||
          !!data?.homeowner_signature_name ||
          !!data?.signed_at_homeowner ||
          !!data?.homeowner_signed_at ||
          data?.is_fully_signed === true ||
          String(data?.status || "").toLowerCase() === "signed";

        const newEscrowFunded = !!data?.escrow_funded;

        if (waitingOnHomeowner && newHomeownerSigned) {
          toast.success("Homeowner signed — updating…");
          window.location.reload();
          return;
        }

        if (waitingOnEscrow && newEscrowFunded !== escrowFunded) {
          toast.success("Escrow status updated — updating…");
          window.location.reload();
          return;
        }

        if (newContractorSigned !== signedByContractor) {
          window.location.reload();
          return;
        }
      } catch {
        // ignore
      }
    };

    pollOnce();
    const intervalId = setInterval(pollOnce, 10000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [
    agreement?.id,
    waitingOnHomeowner,
    waitingOnEscrow,
    escrowFunded,
    signedByContractor,
  ]);

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
    window.location.reload();
  };

  const handleSendHomeownerLink = async () => {
    if (!agreement?.id) return;
    setSendingLink(true);
    setSendError(null);
    try {
      await api.post(`/projects/agreements/${agreement.id}/send_signature_request/`);
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

  const formatMoney = (v) =>
    `$${Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const rate = fundingPreview?.rate != null ? Number(fundingPreview.rate) : null;
  const ratePercent = rate != null ? (rate * 100).toFixed(2) : null;

  let tierLabel = "";
  if (fundingPreview) {
    if (fundingPreview.tier_label) {
      tierLabel = fundingPreview.tier_label;
    } else if (fundingPreview.tier_name) {
      tierLabel = `Current tier: ${String(fundingPreview.tier_name).toUpperCase()}`;
    }
  }

  // Prefer total_required (new backend). Fallback to project_amount/homeowner_escrow.
  const rawTotalRequired = Number(
    fundingPreview?.total_required ??
      fundingPreview?.project_amount ??
      fundingPreview?.homeowner_escrow ??
      0
  );

  // Prefer backend-required if it looks valid; else use current milestone total
  const projectAmount =
    rawTotalRequired > 0 ? rawTotalRequired : Number(totalAmount || 0);

  let platformFee =
    fundingPreview && fundingPreview.platform_fee != null
      ? Number(fundingPreview.platform_fee)
      : 0;

  if (!rawTotalRequired && rate != null) {
    platformFee = projectAmount * rate + 1;
  }

  let contractorPayout =
    fundingPreview && fundingPreview.contractor_payout != null
      ? Number(fundingPreview.contractor_payout)
      : null;

  if (!rawTotalRequired || contractorPayout == null) {
    contractorPayout = projectAmount - (platformFee || 0);
  }

  let homeownerEscrow =
    fundingPreview && fundingPreview.homeowner_escrow != null
      ? Number(fundingPreview.homeowner_escrow)
      : null;

  if (!homeownerEscrow) homeownerEscrow = projectAmount;

  // Prefer backend escrow numbers if present
  const escrowFundedAmountFromPreview = Number(
    fundingPreview?.escrow_funded_amount ??
      fundingPreview?.escrow_funded_so_far ??
      0
  );

  const escrowFundedAmountFromAgreement = Number(
    agreement?.escrow_funded_amount ??
      agreement?.escrow_funded_total ??
      agreement?.escrow_paid_amount ??
      agreement?.escrow_amount_funded ??
      agreement?.funded_amount ??
      0
  );

  const escrowFundedAmountSafe = Number.isFinite(escrowFundedAmountFromPreview)
    ? Math.max(0, Math.round(escrowFundedAmountFromPreview * 100) / 100)
    : Math.max(0, Math.round(escrowFundedAmountFromAgreement * 100) / 100);

  const escrowTotalRequiredSafe = Number.isFinite(homeownerEscrow)
    ? Math.max(0, Math.round(homeownerEscrow * 100) / 100)
    : Math.max(0, Math.round(projectAmount * 100) / 100);

  const remainingToFundFromPreview = Number(
    fundingPreview?.remaining_to_fund ?? fundingPreview?.remaining ?? NaN
  );

  const remainingToFund = Number.isFinite(remainingToFundFromPreview)
    ? Math.max(0, Math.round(remainingToFundFromPreview * 100) / 100)
    : Math.max(
        0,
        Math.round((escrowTotalRequiredSafe - escrowFundedAmountSafe) * 100) / 100
      );

  let previewButtonLabel = "Preview PDF";
  if (amendmentNumber > 0) previewButtonLabel += ` — Amendment ${amendmentNumber}`;
  if (!signedByContractor) previewButtonLabel += " (Required)";

  return (
    <div className="mt-4 space-y-6">
      {amendmentNumber > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="font-semibold">
            Amendment Mode — Amendment {amendmentNumber}
          </div>
          <div className="text-xs mt-1">
            You are editing an amended version of this agreement. Any changes to milestones,
            schedule, or warranty will be captured in Amendment {amendmentNumber}. After previewing
            the updated PDF, both you and the homeowner will need to sign again before escrow can be
            funded.
          </div>
        </div>
      )}

      {/* Top Summary Card */}
      <div className="rounded-lg border bg-white p-4 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Agreement &amp; Homeowner Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Project Title"
            value={agreement?.project_title || agreement?.title || "Untitled Project"}
          />
          <SummaryCard
            label="Agreement ID"
            value={
              agreement?.id
                ? amendmentNumber > 0
                  ? `#${agreement.id} — Amendment ${amendmentNumber}`
                  : `#${agreement.id}`
                : "New"
            }
          />
          <SummaryCard
            label="Project Type"
            value={agreement?.project_type || agreement?.project?.project_type || "—"}
          />
          <SummaryCard label="Status" value={status} />
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Agreement Version" value={amendmentLabel} />
          <SummaryCard
            label="PDF Version"
            value={pdfVersion != null ? `v${pdfVersion}` : "Will be generated on next preview/sign"}
          />
          <SummaryCard label="Escrow Funded?" value={escrowFunded ? "Yes" : "No"} />
          <SummaryCard label="Fully Signed?" value={isFullySigned ? "Yes" : "No"} />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <SummaryCard label="Homeowner Name" value={homeownerName} />
          <SummaryCard label="Homeowner Email" value={homeownerEmail} />
          <SummaryCard label="Homeowner Phone" value={formatPhone(homeownerPhone)} />
          <SummaryCard
            label="Agreement Version Note"
            value={
              amendmentNumber > 0
                ? `This agreement has been amended ${amendmentNumber} time(s). The PDF preview will show the original terms plus all current amendments.`
                : "This is the original version of the agreement."
            }
            className="md:col-span-2"
          />
        </div>
      </div>

      {/* Addresses */}
      <section className="rounded-lg border bg-white p-4 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Addresses</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-semibold text-sm text-gray-800 mb-1">Homeowner Address</h4>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">
              {homeownerAddressDisplay}
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm text-gray-800 mb-1">Project Address</h4>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">
              {projectAddressDisplay}
            </div>
          </div>
        </div>
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

      {/* Milestones & Totals */}
      <section className="rounded-lg border bg-white p-4 shadow">
        <div className="text-lg font-semibold mb-2">
          Milestones &amp; Total ({displayMilestones.length})
        </div>
        <div className="mb-3 text-sm font-medium text-gray-700">
          Total Project Cost: {formatMoney(totalAmount || 0)}
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
                    {toDateOnly(m.due_date || m.completion_date || m.end_date) || "—"}
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
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                    No milestones.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Fee summary */}
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-900">
              Project Totals &amp; Fee Summary (Contractor View)
            </div>
            {fundingPreview && (
              <div className="text-[11px] text-gray-500 text-right space-y-0.5">
                {tierLabel && <div>{tierLabel}</div>}
                {ratePercent && <div>Current platform rate: {ratePercent}% + $1</div>}
                {fundingPreview.high_risk_applied && (
                  <div className="text-[11px] text-amber-700">
                    High-risk surcharge applied for this project type.
                  </div>
                )}
              </div>
            )}
          </div>

          {fundingLoading ? (
            <div className="text-xs text-gray-500">Loading fee &amp; escrow summary…</div>
          ) : fundingError ? (
            <div className="text-xs text-red-600">{fundingError}</div>
          ) : fundingPreview ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <SummaryCard label="Project Price (Homeowner Pays)" value={formatMoney(projectAmount)} />
                <SummaryCard
                  label="MyHomeBro Platform Fee"
                  value={
                    ratePercent
                      ? `${formatMoney(platformFee)} @ ${ratePercent}% + $1`
                      : formatMoney(platformFee)
                  }
                />
                <SummaryCard
                  label="Your Estimated Take-Home (Before Stripe)"
                  value={formatMoney(contractorPayout)}
                />
                <SummaryCard label="Total Escrow Deposit" value={formatMoney(homeownerEscrow)} />
              </div>

              <p className="mt-2 text-[11px] text-gray-500">
                This summary shows your estimated take-home after the MyHomeBro platform fee. Stripe processing
                fees (card/ACH) may slightly adjust the final payout. If these numbers don't look right,
                update your milestone amounts or total project price before sending for signature.
              </p>
            </>
          ) : (
            <div className="text-xs text-gray-500">Fee summary not available yet.</div>
          )}
        </div>
      </section>

      {/* Signatures & Escrow */}
      <section className="rounded-lg border bg-white p-4 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Signatures &amp; Escrow</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contractor column */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-800">Contractor Signature</div>

            {signedByContractor ? (
              <div className="flex items-center gap-2 text-xs text-green-700">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white text-[10px]">
                  ✓
                </span>
                <span>Contractor signature on file.</span>
              </div>
            ) : (
              <div className="text-xs text-gray-600">
                You will sign this agreement electronically using your typed name plus a drawn signature.
              </div>
            )}

            {signedByContractor ? (
              <>
                {canUnsign ? (
                  <button
                    type="button"
                    onClick={unsignContractor}
                    className="mt-1 rounded bg-white border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Remove Contractor Signature
                  </button>
                ) : fullySignedBackend ? (
                  <div className="mt-2 text-[11px] text-gray-600 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                    This agreement has been signed by both you and the homeowner. To change scope, dates,
                    or amounts, use the <strong>Amend</strong> button on the Agreement List to create a new
                    Amendment version, then re-sign.
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-gray-600 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                    Contractor signature is locked by backend rules. If changes are required, create a new
                    Amendment or contact support.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2 mt-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    Type Your Full Legal Name
                  </label>
                  <input
                    type="text"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="e.g., Jane Contractor"
                  />
                </div>

                <div className="mt-2 space-y-1 text-xs text-gray-700">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ackReviewed}
                      onChange={(e) => setAckReviewed(e.target.checked)}
                    />
                    <span>
                      I have reviewed the agreement and confirm the scope, milestones, and totals (including any amendments).
                    </span>
                  </label>

                  <label className="inline-flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={ackTos}
                      onChange={(e) => setAckTos(e.target.checked)}
                      className="mt-[2px]"
                    />
                    <span>
                      I agree to the MyHomeBro{" "}
                      <a
                        href="/legal/terms-of-service/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 underline"
                      >
                        Terms of Service
                      </a>{" "}
                      &amp;{" "}
                      <a
                        href="/legal/privacy-policy/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 underline"
                      >
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>

                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ackEsign}
                      onChange={(e) => setAckEsign(e.target.checked)}
                    />
                    <span>
                      I consent to sign this agreement electronically and understand this is legally binding.
                    </span>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleOpenContractorModal}
                  disabled={signing}
                  className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {signing ? "Signing…" : "Sign as Contractor"}
                </button>
              </>
            )}
          </div>

          {/* Homeowner column */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-800">Homeowner Signature</div>

            {signedByHomeowner ? (
              <div className="flex items-center gap-2 text-xs text-green-700">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white text-[10px]">
                  ✓
                </span>
                <span>Homeowner signature on file.</span>
              </div>
            ) : (
              <div className="text-xs text-gray-600">
                MyHomeBro will email a secure signing link to the homeowner once you send the request.
                They can sign from any device, and we capture their typed name, IP, and timestamp.
              </div>
            )}

            {!signedByHomeowner && (
              <>
                <button
                  type="button"
                  onClick={handleSendHomeownerLink}
                  disabled={sendingLink}
                  className="mt-2 rounded bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {sendingLink ? "Sending link…" : "Send Homeowner Signing Link"}
                </button>

                {sendError && (
                  <div className="mt-1 text-[11px] text-red-600">{sendError}</div>
                )}
              </>
            )}

            <div className="mt-4 border-t pt-2">
              <div className="text-xs text-gray-700 mb-1">Escrow Funding</div>

              {isFullySigned ? (
                <div className="space-y-2">
                  <div className="text-[11px] text-gray-600">
                    Once both you and the homeowner have signed, MyHomeBro emails the homeowner a secure link to
                    fund escrow. For amendments, this will send only the remaining amount needed to top-up escrow.
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <SummaryCard label="Escrow Total Required" value={formatMoney(escrowTotalRequiredSafe)} />
                    <SummaryCard label="Escrow Funded So Far" value={formatMoney(escrowFundedAmountSafe)} />
                    <SummaryCard
                      label="Remaining to Fund"
                      value={formatMoney(remainingToFund)}
                      className={
                        remainingToFund > 0
                          ? "border-indigo-200 bg-indigo-50"
                          : "border-green-200 bg-green-50"
                      }
                    />
                  </div>

                  {remainingToFund > 0 ? (
                    <SendFundingLinkButton
                      agreementId={agreement?.id}
                      isFullySigned={isFullySigned}
                      amount={remainingToFund}
                      disabled={!isFullySigned}
                      variant="success"
                      label={`Send Escrow Funding Link (${formatMoney(remainingToFund)})`}
                    />
                  ) : (
                    <div className="text-[11px] text-green-700">
                      Escrow appears fully funded for this agreement version. No additional deposit is required.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-gray-500">
                  After both you and the homeowner have signed, MyHomeBro will email the homeowner a secure link to fund
                  escrow. If needed, you can later use the funding button that appears here once both signatures are in.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
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
            title={amendmentNumber > 0 ? "Open preview PDF for this amendment version" : "Open preview PDF"}
          >
            {previewButtonLabel}
          </button>
        </div>
      </div>

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
