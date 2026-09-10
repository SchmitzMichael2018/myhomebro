import { isMilestoneCompleted } from "./milestoneDisplay.js";

const invoiceIdFor = (milestone) => {
  const nested = milestone?.invoice;
  if (nested && typeof nested === "object") return nested.id ?? nested.invoice_id ?? nested.pk ?? null;
  return milestone?.invoice_id ?? milestone?.invoiceId ?? milestone?.invoice ?? null;
};

const isNonBillable = (milestone) =>
  Boolean(milestone?.rework_origin_milestone_id) ||
  String(milestone?.normalized_milestone_type || "").trim().toLowerCase() === "warranty_service" ||
  Number(milestone?.amount || 0) <= 0;

const isInvoicePaid = (invoice) => {
  const status = String(invoice?.status || invoice?.invoice_status || invoice?.state || "").trim().toLowerCase();
  return Boolean(
    invoice?.escrow_released ||
      invoice?.escrow_released_at ||
      invoice?.direct_pay_paid_at ||
      invoice?.paid_at ||
      ["paid", "released", "settled"].includes(status)
  );
};

export function getAgreementCompletionState(milestones = [], invoicesMap = {}) {
  const rows = Array.isArray(milestones) ? milestones : [];
  const allWorkComplete = rows.length > 0 && rows.every(isMilestoneCompleted);
  const billable = rows.filter((milestone) => !isNonBillable(milestone));
  const paidBillableCount = billable.filter((milestone) => {
    const nested = milestone?.invoice && typeof milestone.invoice === "object" ? milestone.invoice : null;
    const invoiceId = invoiceIdFor(milestone);
    return isInvoicePaid(nested || (invoiceId ? invoicesMap[String(invoiceId)] : null));
  }).length;
  const allBillablePaid = billable.length > 0 && paidBillableCount === billable.length;

  return {
    allWorkComplete,
    allBillablePaid,
    fullyCompletedAndPaid: allWorkComplete && allBillablePaid,
    paidBillableCount,
    billableCount: billable.length,
  };
}
