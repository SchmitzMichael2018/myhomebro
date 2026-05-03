import React, { useMemo, useState } from "react";

function complianceLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "compliant") return "Compliant";
  if (normalized === "pending_license") return "Pending License";
  if (normalized === "overridden") return "Overridden";
  if (normalized === "missing_license") return "Missing License";
  if (normalized === "missing_insurance") return "Missing Insurance";
  if (normalized === "not_required") return "Not Required";
  if (normalized === "unknown") return "Unknown";
  return "Unreviewed";
}

function complianceClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "compliant" || normalized === "not_required") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "pending_license" || normalized === "overridden") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (normalized === "missing_license" || normalized === "missing_insurance") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function AssignSubcontractorInline({
  acceptedSubcontractors = [],
  currentAssignment = null,
  currentCompliance = null,
  currentAgreement = null,
  milestoneAmount = null,
  onAssign,
  onUnassign,
  disabled = false,
}) {
  const [selected, setSelected] = useState("");
  const [agreedPay, setAgreedPay] = useState("");
  const [paymentReleaseMode, setPaymentReleaseMode] = useState("manual_release");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [decision, setDecision] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverpayWarning, setShowOverpayWarning] = useState(false);

  const options = useMemo(
    () =>
      (Array.isArray(acceptedSubcontractors) ? acceptedSubcontractors : []).map((item) => ({
        id: item.id,
        label:
          item.accepted_name ||
          item.invite_name ||
          item.invite_email ||
          "Subcontractor",
        email: item.invite_email || "",
      })),
    [acceptedSubcontractors]
  );

  const currentMilestoneAmount = Number(milestoneAmount ?? currentAgreement?.customer_milestone_amount ?? currentAgreement?.milestone_amount ?? currentAgreement?.amount ?? NaN);
  const agreedPayNumber = Number(agreedPay);
  const overpayWarningNeeded =
    Number.isFinite(currentMilestoneAmount) &&
    Number.isFinite(agreedPayNumber) &&
    currentMilestoneAmount > 0 &&
    agreedPayNumber > currentMilestoneAmount &&
    !String(overrideReason || "").trim();

  async function runAssign(complianceAction = "", overrideReasonValue = overrideReason) {
    setErr("");
    if (!selected) {
      setErr("Select a subcontractor first.");
      return;
    }
    if (!onAssign) return;

    setBusy(true);
    try {
      await onAssign(Number(selected), {
        complianceAction,
        overrideReason: overrideReasonValue,
        agreedPay,
        paymentReleaseMode,
        sendAgreement: true,
      });
      setSelected("");
      setAgreedPay("");
      setPaymentReleaseMode("manual_release");
      setDecision(null);
      setOverrideReason("");
      setShowOverpayWarning(false);
    } catch (e) {
      console.error(e);
      const payload = e?.response?.data;
      if (e?.response?.status === 409 && payload?.compliance_decision_required) {
        setDecision(payload);
        return;
      }
      setErr(
        payload?.assigned_subcontractor_invitation?.[0] ||
          payload?.detail ||
          "Assign failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign() {
    if (overpayWarningNeeded) {
      setShowOverpayWarning(true);
      return;
    }
    await runAssign("");
  }

  async function handleDecision(action) {
    if (action === "choose_another") {
      setDecision(null);
      setSelected("");
      return;
    }
    await runAssign(action);
  }

  async function handleContinueAnyway() {
    const fallbackReason =
      String(overrideReason || "").trim() ||
      "Subcontractor pay exceeds this milestone's customer price. You may lose money on this milestone.";
    setOverrideReason(fallbackReason);
    setShowOverpayWarning(false);
    await runAssign("", fallbackReason);
  }

  async function handleUnassign() {
    setErr("");
    if (!onUnassign) return;

    setBusy(true);
    try {
      await onUnassign();
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || "Unassign failed.");
    } finally {
      setBusy(false);
    }
  }

  const complianceSnapshot = currentCompliance || {};
  const currentWarning = complianceSnapshot?.warning_snapshot || {};
  const decisionEvaluation = decision?.compliance_evaluation || {};
  const currentPayout = currentAgreement?.payout_orchestration || {};

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="font-bold">Assigned Subcontractor</div>
      <div className="mt-1 text-sm text-gray-500">
        Only accepted subcontractors for this agreement can be assigned.
      </div>

      <div className="mt-3 text-sm">
        <span className="font-semibold text-gray-900">Current:</span>{" "}
        {currentAssignment?.display_name || currentAssignment?.email || "Unassigned"}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-gray-900">Compliance:</span>
        <span
          data-testid="subcontractor-assignment-compliance-chip"
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${complianceClass(
            complianceSnapshot?.status
          )}`}
        >
          {complianceLabel(complianceSnapshot?.status)}
        </span>
      </div>
      {currentWarning?.warning_message ? (
        <div
          data-testid="subcontractor-assignment-current-warning"
          className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          {currentWarning.warning_message}
        </div>
      ) : null}

      {currentAgreement ? (
        <div
          data-testid="subcontractor-assignment-current-agreement"
          className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
        >
          <div className="font-semibold text-slate-900">Current milestone agreement</div>
          <div className="mt-1">
            Pay {currentAgreement.agreed_pay ? `$${Number(currentAgreement.agreed_pay).toFixed(2)}` : "—"}
          </div>
          <div className="mt-1">
            Release: {currentAgreement.payment_release_mode_label || currentAgreement.payment_release_mode || "Manual Release"}
          </div>
          <div className="mt-1">
            Status: {currentAgreement.agreement_acceptance_status_label || currentAgreement.agreement_acceptance_status || "not_sent"}
          </div>
          {currentPayout?.payout_state || currentPayout?.safe_summary ? (
            <div className="mt-1">
              Payment: {currentPayout.safe_summary || currentPayout.payout_state}
            </div>
          ) : null}
        </div>
      ) : null}

      {err ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {showOverpayWarning ? (
        <div
          data-testid="subcontractor-overpay-warning"
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <div className="font-semibold">
            Subcontractor pay exceeds this milestone&apos;s customer price. You may lose money on this milestone.
          </div>
          <div className="mt-2 text-xs text-amber-800">
            Add an override reason before saving or adjust the amount to keep the milestone profitable.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowOverpayWarning(false)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              Adjust Amount
            </button>
            <button
              type="button"
              onClick={handleContinueAnyway}
              className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800"
              data-testid="subcontractor-overpay-continue"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        <select
          data-testid="subcontractor-assignment-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled || busy}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">
            {options.length === 0 ? "No accepted subcontractors" : "Select subcontractor"}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} {option.email ? `- ${option.email}` : ""}
            </option>
          ))}
        </select>

        <input
          data-testid="subcontractor-agreed-pay-input"
          type="number"
          min="0.01"
          step="0.01"
          value={agreedPay}
          onChange={(e) => setAgreedPay(e.target.value)}
          disabled={disabled || busy}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm md:w-40"
          placeholder="Agreed pay"
        />

        <select
          data-testid="subcontractor-payment-release-mode-select"
          value={paymentReleaseMode}
          onChange={(e) => setPaymentReleaseMode(e.target.value)}
          disabled={disabled || busy}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm md:w-56"
        >
          <option value="manual_release">Manual Release</option>
          <option value="auto_after_customer_approval">Auto-Release After Customer Approval</option>
        </select>

        <button
          data-testid="subcontractor-assign-button"
          type="button"
          onClick={handleAssign}
          disabled={disabled || busy || !selected}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Working..." : "Assign"}
        </button>

        <button
          data-testid="subcontractor-unassign-button"
          type="button"
          onClick={handleUnassign}
          disabled={disabled || busy || !currentAssignment}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"
        >
          {busy ? "Working..." : "Remove"}
        </button>
      </div>

      {decision ? (
        <div
          data-testid="subcontractor-assignment-compliance-decision"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
        >
          <div className="text-sm font-semibold text-slate-900">
            Compliance review needed
          </div>
          <div className="mt-2 text-sm text-slate-700">
              {decisionEvaluation.warning_message ||
              "This assignment typically requires licensing or insurance context."}
          </div>
          <div className="mt-2 text-xs text-slate-600">
            {decisionEvaluation.trade_label || decisionEvaluation.trade_key || "Trade"} in{" "}
            {decisionEvaluation.state_code || "the selected state"}
            {decisionEvaluation.issuing_authority_name
              ? ` - ${decisionEvaluation.issuing_authority_name}`
              : ""}
          </div>
          <textarea
            data-testid="subcontractor-assignment-override-reason"
            rows={2}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            className="mt-3 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm"
            placeholder="Optional note for assigning anyway"
          />
          <div className="mt-2 text-xs text-slate-600">
            Payment terms apply to the selected milestone assignment and are stored separately from the customer agreement amount.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="subcontractor-assignment-assign-anyway"
              onClick={() => handleDecision("assign_anyway")}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Assign anyway
            </button>
            <button
              type="button"
              data-testid="subcontractor-assignment-request-license"
              onClick={() => handleDecision("request_license")}
              disabled={busy}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              Request license
            </button>
            <button
              type="button"
              data-testid="subcontractor-assignment-choose-another"
              onClick={() => handleDecision("choose_another")}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Choose another
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
