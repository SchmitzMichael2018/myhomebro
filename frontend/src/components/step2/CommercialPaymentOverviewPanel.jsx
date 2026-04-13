import React, { useMemo } from "react";
import { normalizeProjectClass } from "../../utils/projectClass.js";

const MONEY_COMPARISON_TOLERANCE = 0.01;
const MONEY_COMPARISON_EPSILON = 1e-9;

function amountsApproximatelyMatch(left, right, tolerance = MONEY_COMPARISON_TOLERANCE) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance + MONEY_COMPARISON_EPSILON;
}

function safeStr(v) {
  return (v == null ? "" : String(v)).trim();
}

function formatCurrency(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function paymentStructureLabel(value, { commercial = false } = {}) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "progress") return "Progress Payments";
  if (normalized === "escrow") return "Escrow";
  if (normalized === "direct") return "Direct Pay";
  if (commercial) return "Commercial Milestones";
  return "Simple Milestones";
}

function statusToneClasses(tone = "neutral") {
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function nextBillableToneClasses(tone = "neutral") {
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function CommercialPaymentOverviewPanel({
  agreementMeta,
  effectiveMilestones,
  paymentStructure,
}) {
  const commercialPaymentOverview = useMemo(() => {
    if (normalizeProjectClass(agreementMeta?.project_class) !== "commercial") return null;

    const agreementTotalRaw = agreementMeta?.total_cost ?? 0;
    const contractValue = Number(agreementTotalRaw || 0);
    const safeContractValue = Number.isFinite(contractValue) && contractValue > 0 ? contractValue : 0;
    const milestoneRows = Array.isArray(effectiveMilestones) ? effectiveMilestones : [];
    const allocatedValue = milestoneRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row?.amount || 0)),
      0
    );
    const unallocatedValue = Math.max(safeContractValue - allocatedValue, 0);
    const overAllocatedValue = Math.max(allocatedValue - safeContractValue, 0);
    const retainagePercent = Number(agreementMeta?.retainage_percent ?? 0);
    const retainageEnabled = Number.isFinite(retainagePercent) && retainagePercent > 0;
    const structureLabel = paymentStructureLabel(paymentStructure, { commercial: true });
    const isProgressPayments = paymentStructure === "progress";

    const fullyAllocated = safeContractValue > 0 && amountsApproximatelyMatch(safeContractValue, allocatedValue);
    const underAllocated =
      safeContractValue > 0 &&
      allocatedValue + MONEY_COMPARISON_TOLERANCE < safeContractValue - MONEY_COMPARISON_EPSILON;
    const overAllocated =
      safeContractValue > 0 &&
      allocatedValue - MONEY_COMPARISON_TOLERANCE > safeContractValue + MONEY_COMPARISON_EPSILON;
    const scheduleReadyForProgress =
      isProgressPayments && fullyAllocated && allocatedValue > 0 && milestoneRows.length > 0;
    const scheduleReadyForStructuredBilling =
      fullyAllocated && allocatedValue > 0 && milestoneRows.length > 0;

    let allocationLabel = "Contract value missing";
    let allocationTone = "warn";
    if (safeContractValue > 0) {
      if (fullyAllocated) {
        allocationLabel = "Fully Allocated";
        allocationTone = "good";
      } else if (overAllocated) {
        allocationLabel = "Over Allocated";
        allocationTone = "warn";
      } else if (underAllocated) {
        allocationLabel = "Under Allocated";
        allocationTone = "warn";
      }
    }

    const allocationMessage =
      safeContractValue <= 0
        ? "Add the contract total to compare milestone values against the full agreement."
        : fullyAllocated
        ? "Milestone values are aligned with the current contract total."
        : overAllocated
        ? `${formatCurrency(overAllocatedValue)} is assigned above the current contract total.`
        : `${formatCurrency(unallocatedValue)} is still available to assign across the remaining schedule.`;

    const readinessMessage =
      isProgressPayments
        ? scheduleReadyForProgress
          ? "The payment plan is balanced and ready to support future draw requests."
          : "A little more allocation detail will make this schedule ready for draw-based billing."
        : scheduleReadyForStructuredBilling
        ? "The commercial payment plan is taking shape with a balanced schedule."
        : "As milestone values are filled in, this will become a clearer commercial payment plan.";

    let futureWorkflowLabel = "Commercial schedule taking shape";
    let futureWorkflowTone = "neutral";
    if (isProgressPayments) {
      if (scheduleReadyForProgress) {
        futureWorkflowLabel = "Ready for structured billing";
        futureWorkflowTone = "good";
      } else if (overAllocated) {
        futureWorkflowLabel = "Needs review before draw planning";
        futureWorkflowTone = "warn";
      } else {
        futureWorkflowLabel = "Needs more allocation before draw planning";
        futureWorkflowTone = "neutral";
      }
    } else if (scheduleReadyForStructuredBilling) {
      futureWorkflowLabel = "Ready for structured billing";
      futureWorkflowTone = "good";
    }

    const retainageMessage = retainageEnabled
      ? `Retainage is enabled at ${retainagePercent.toFixed(
          2
        )}%. Final released amounts may differ from scheduled values until retainage is released.`
      : "No retainage is currently built into this payment plan.";

    const rawNextBillableStage =
      agreementMeta?.next_billable_stage &&
      typeof agreementMeta.next_billable_stage === "object" &&
      !Array.isArray(agreementMeta.next_billable_stage)
        ? agreementMeta.next_billable_stage
        : null;

    const nextBillableStage =
      rawNextBillableStage && (rawNextBillableStage.available || rawNextBillableStage.status)
        ? {
            available: rawNextBillableStage.available !== false,
            title: safeStr(rawNextBillableStage.title) || "Next billable stage",
            order: rawNextBillableStage.order,
            amount: Number(rawNextBillableStage.amount),
            status: safeStr(rawNextBillableStage.status).toLowerCase(),
            statusLabel: safeStr(rawNextBillableStage.status_label) || "Commercial billing update",
            tone: safeStr(rawNextBillableStage.tone).toLowerCase() || "neutral",
            message:
              safeStr(rawNextBillableStage.message) ||
              "This is the next commercial stage the system is watching for future billing workflows.",
          }
        : null;

    return {
      contractValue: safeContractValue,
      allocatedValue,
      unallocatedValue,
      overAllocatedValue,
      retainagePercent,
      retainageEnabled,
      structureLabel,
      fullyAllocated,
      hasContractValue: safeContractValue > 0,
      allocationMessage,
      readinessMessage,
      futureWorkflowLabel,
      futureWorkflowTone,
      retainageMessage,
      isProgressPayments,
      nextBillableStage,
      statusItems: [
        {
          key: "allocation",
          label: allocationLabel,
          tone: allocationTone,
        },
        ...(retainageEnabled
          ? [
              {
                key: "retainage",
                label: `Retainage Enabled${retainagePercent > 0 ? ` ${retainagePercent.toFixed(2)}%` : ""}`,
                tone: "good",
              },
            ]
          : []),
        {
          key: "readiness",
          label: futureWorkflowLabel,
          tone: futureWorkflowTone,
        },
      ],
    };
  }, [agreementMeta, effectiveMilestones, paymentStructure]);

  if (!commercialPaymentOverview) return null;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/60 px-4 py-4 shadow-sm"
      data-testid="step2-commercial-payment-overview"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Payment overview
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">Commercial Payment Planning</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            A compact view of how much value is already assigned, what is left to place, and whether
            the commercial payment plan is starting to take shape.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 xl:max-w-[340px] xl:justify-end">
          {commercialPaymentOverview.statusItems.map((item) => (
            <span
              key={item.key}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm ${statusToneClasses(
                item.tone
              )}`}
              data-testid={`step2-commercial-status-${item.key}`}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Schedule snapshot
              </div>
              <div
                className="mt-2 text-3xl font-semibold tracking-tight text-slate-950"
                data-testid="step2-commercial-allocated-value"
              >
                {formatCurrency(commercialPaymentOverview.allocatedValue)}
              </div>
              <div className="mt-1 text-sm text-slate-600">assigned across current milestone values</div>
            </div>
            <div className="min-w-[180px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Remaining to Allocate
              </div>
              <div
                className="mt-1 text-xl font-semibold text-slate-900"
                data-testid="step2-commercial-unallocated-value"
              >
                {commercialPaymentOverview.hasContractValue
                  ? formatCurrency(commercialPaymentOverview.unallocatedValue)
                  : "--"}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-600">
                {commercialPaymentOverview.overAllocatedValue > 0
                  ? `Currently over by ${formatCurrency(commercialPaymentOverview.overAllocatedValue)}.`
                  : commercialPaymentOverview.fullyAllocated
                  ? "The schedule is aligned with the contract value."
                  : "Value that still needs to be assigned to milestones."}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Allocation status
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  {commercialPaymentOverview.allocationMessage}
                </div>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${statusToneClasses(
                  commercialPaymentOverview.futureWorkflowTone
                )}`}
                data-testid="step2-commercial-future-status"
              >
                {commercialPaymentOverview.futureWorkflowLabel}
              </span>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              {commercialPaymentOverview.readinessMessage}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Total Contract Value
            </div>
            <div
              className="mt-1 text-lg font-semibold text-slate-900"
              data-testid="step2-commercial-contract-value"
            >
              {commercialPaymentOverview.hasContractValue
                ? formatCurrency(commercialPaymentOverview.contractValue)
                : "--"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Payment Structure
            </div>
            <div
              className="mt-1 text-sm font-semibold text-slate-900"
              data-testid="step2-commercial-payment-structure"
            >
              {commercialPaymentOverview.structureLabel}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-600">
              {commercialPaymentOverview.isProgressPayments
                ? "Supports progress and draw-style billing after signing."
                : "Keeps the commercial schedule clear without extra billing overhead."}
            </div>
          </div>

          <div
            className={`rounded-xl border px-4 py-3 shadow-sm ${
              commercialPaymentOverview.retainageEnabled
                ? "border-blue-200 bg-blue-50/70"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Retainage
                </div>
                <div
                  className="mt-1 text-sm font-semibold text-slate-900"
                  data-testid="step2-commercial-retainage-status"
                >
                  {commercialPaymentOverview.retainageEnabled
                    ? `Enabled at ${commercialPaymentOverview.retainagePercent.toFixed(2)}%`
                    : "Disabled"}
                </div>
              </div>
              {commercialPaymentOverview.retainageEnabled ? (
                <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                  Active
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-600">
              {commercialPaymentOverview.retainageMessage}
            </div>
          </div>
        </div>
      </div>

      {commercialPaymentOverview.nextBillableStage ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Next billable stage
              </div>
              <div
                className="mt-1 text-base font-semibold text-slate-950"
                data-testid="step2-commercial-next-billable-title"
              >
                {commercialPaymentOverview.nextBillableStage.available &&
                commercialPaymentOverview.nextBillableStage.order != null
                  ? `Stage ${commercialPaymentOverview.nextBillableStage.order}: ${commercialPaymentOverview.nextBillableStage.title}`
                  : commercialPaymentOverview.nextBillableStage.title}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                {commercialPaymentOverview.nextBillableStage.message}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${nextBillableToneClasses(
                  commercialPaymentOverview.nextBillableStage.tone
                )}`}
                data-testid="step2-commercial-next-billable-status"
              >
                {commercialPaymentOverview.nextBillableStage.statusLabel}
              </span>
              {commercialPaymentOverview.nextBillableStage.available &&
              Number.isFinite(commercialPaymentOverview.nextBillableStage.amount) &&
              commercialPaymentOverview.nextBillableStage.amount > 0 ? (
                <span
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700"
                  data-testid="step2-commercial-next-billable-amount"
                >
                  {formatCurrency(commercialPaymentOverview.nextBillableStage.amount)}
                </span>
              ) : null}
            </div>
          </div>

          {commercialPaymentOverview.retainageEnabled ? (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs leading-5 text-blue-900">
              Retainage is enabled at {commercialPaymentOverview.retainagePercent.toFixed(2)}%. Final
              released amounts for this stage may differ from its scheduled value until retainage is
              released.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
          <div className="font-semibold text-slate-800">Total Contract Value</div>
          <div className="mt-1">Use the agreement total as the anchor for milestone planning.</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
          <div className="font-semibold text-slate-800">Scheduled Value Allocated</div>
          <div className="mt-1">
            Shows how much of the contract has already been distributed across milestones.
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
          <div className="font-semibold text-slate-800">Commercial plan health</div>
          <div className="mt-1">
            Helps you see whether the payment plan is taking shape without slowing down milestone
            editing.
          </div>
        </div>
      </div>
    </section>
  );
}
