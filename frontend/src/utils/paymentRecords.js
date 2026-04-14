import { normalizeProjectClass } from "./projectClass";

const money = (value) => Number(value || 0);
const norm = (value) => String(value || "").trim().toLowerCase();

function invoiceMode(invoice) {
  return norm(
    invoice?.agreement?.payment_mode ??
      invoice?.agreement?.paymentMode ??
      invoice?.payment_mode ??
      invoice?.paymentMode ??
      invoice?.agreement_payment_mode
  );
}

function invoiceProjectClass(invoice) {
  return normalizeProjectClass(
    invoice?.agreement?.project_class ??
      invoice?.agreement?.projectClass ??
      invoice?.project_class ??
      invoice?.projectClass ??
      invoice?.agreement_project_class
  );
}

function drawProjectClass(draw) {
  return normalizeProjectClass(
    draw?.agreement?.project_class ??
      draw?.agreement?.projectClass ??
      draw?.project_class ??
      draw?.projectClass ??
      draw?.agreement_project_class
  );
}

function invoiceIsDisputed(invoice) {
  const status = norm(invoice?.status);
  const display = norm(invoice?.display_status ?? invoice?.status_label);
  const disputeStatus = norm(
    invoice?.dispute_status ??
      invoice?.dispute_state ??
      invoice?.latest_dispute_status ??
      invoice?.open_dispute_status ??
      invoice?.dispute?.status ??
      invoice?.dispute?.state
  );
  const openFlag = invoice?.dispute_is_open ?? invoice?.has_open_dispute ?? invoice?.dispute_open ?? null;
  if (openFlag === false) return false;
  if (disputeStatus.includes("resolved") || disputeStatus.includes("closed") || disputeStatus.includes("dismiss")) {
    return false;
  }
  return status.includes("dispute") || display.includes("dispute") || disputeStatus.includes("dispute");
}

function invoiceMoneyStatus(invoice) {
  if (invoiceIsDisputed(invoice)) return "issues";

  const status = norm(invoice?.status);
  const display = norm(invoice?.display_status ?? invoice?.status_label);
  const escrowReleased =
    invoice?.escrow_released === true ||
    invoice?.escrow_released === 1 ||
    invoice?.escrow_released === "true" ||
    !!invoice?.escrow_released_at;
  const directPaid =
    !!invoice?.direct_pay_paid_at ||
    !!invoice?.directPayPaidAt ||
    !!invoice?.paid_at;

  if (escrowReleased || directPaid || display === "paid" || status.includes("paid") || status === "released") {
    return "paid";
  }

  if (["approved", "ready_to_pay"].includes(status) || display === "approved") {
    return "payment_pending";
  }

  if (
    ["pending", "pending_approval", "sent", "awaiting_approval", "unpaid"].includes(status) ||
    display.includes("pending") ||
    display.includes("sent")
  ) {
    return "awaiting_customer_approval";
  }

  if (status.includes("reject") || status.includes("fail")) return "issues";
  return "awaiting_customer_approval";
}

function drawMoneyStatus(draw) {
  const status = norm(draw?.workflow_status ?? draw?.status);
  if (status === "submitted") return "awaiting_customer_approval";
  if (status === "payment_pending" || status === "approved") return "payment_pending";
  if (status === "paid") return "paid";
  if (["changes_requested", "rejected", "disputed"].includes(status)) return "issues";
  return "awaiting_customer_approval";
}

export function moneyStatusLabel(status) {
  if (status === "awaiting_customer_approval") return "Awaiting Customer Approval";
  if (status === "payment_pending") return "Payment Pending";
  if (status === "paid") return "Paid";
  if (status === "issues") return "Issues / Disputes";
  return "Other";
}

export function projectClassLabel(projectClass) {
  return normalizeProjectClass(projectClass) === "commercial" ? "Commercial" : "Residential";
}

export function normalizeInvoicePaymentRecord(invoice) {
  const moneyStatus = invoiceMoneyStatus(invoice);
  const projectClass = invoiceProjectClass(invoice);
  const amount = money(invoice?.amount ?? invoice?.amount_due ?? invoice?.total ?? invoice?.total_amount);
  const agreementId =
    invoice?.agreement?.id ??
    invoice?.agreement_id ??
    invoice?.agreementId ??
    (typeof invoice?.agreement === "number" ? invoice.agreement : null) ??
    null;
  const agreementTitle =
    invoice?.agreement?.title ??
    invoice?.agreement_title ??
    invoice?.project_title ??
    "Untitled Agreement";
  const milestoneTitle =
    invoice?.milestone_title ??
    invoice?.milestone?.title ??
    invoice?.milestoneName ??
    invoice?.title ??
    "Milestone";
  return {
    id: invoice?.id ?? invoice?.invoice_id ?? invoice?.pk,
    recordType: "invoice",
    recordTypeLabel: "Invoice",
    projectClass,
    paymentMode: invoiceMode(invoice),
    moneyStatus,
    moneyStatusLabel: moneyStatusLabel(moneyStatus),
    amount,
    agreementId,
    agreementTitle,
    title: milestoneTitle,
    subtitle: invoice?.invoice_number ? `Invoice #${invoice.invoice_number}` : "Invoice",
    raw: invoice,
    rawStatus: invoice?.display_status ?? invoice?.status ?? "",
    sortDate:
      invoice?.updated_at ??
      invoice?.paid_at ??
      invoice?.direct_pay_paid_at ??
      invoice?.escrow_released_at ??
      invoice?.email_sent_at ??
      invoice?.created_at ??
      null,
  };
}

export function normalizeDrawPaymentRecord(draw) {
  const moneyStatus = drawMoneyStatus(draw);
  const projectClass = drawProjectClass(draw);
  const amount = money(draw?.net_amount ?? draw?.current_requested_amount ?? draw?.gross_amount);
  const lineItems = Array.isArray(draw?.line_items) ? draw.line_items : [];
  const firstLine = lineItems[0];
  const title =
    firstLine?.milestone_title ??
    firstLine?.description ??
    draw?.title ??
    `Draw ${draw?.draw_number || ""}`.trim();
  return {
    id: draw?.id,
    recordType: "draw_request",
    recordTypeLabel: "Draw Request",
    projectClass,
    paymentMode: norm(draw?.payment_mode),
    moneyStatus,
    moneyStatusLabel: moneyStatusLabel(moneyStatus),
    amount,
    agreementId: draw?.agreement_id ?? draw?.agreement?.id ?? null,
    agreementTitle: draw?.agreement_title ?? draw?.agreement?.title ?? "Untitled Agreement",
    title,
    subtitle: draw?.draw_number ? `Draw ${draw.draw_number}` : "Draw Request",
    raw: draw,
    rawStatus: draw?.workflow_status_label ?? draw?.workflow_status ?? draw?.status ?? "",
    sortDate: draw?.updated_at ?? draw?.released_at ?? draw?.paid_at ?? draw?.submitted_at ?? draw?.created_at ?? null,
  };
}

export function buildUnifiedPaymentRecords({ invoices = [], drawRequests = [] }) {
  const invoiceRecords = (Array.isArray(invoices) ? invoices : [])
    .map(normalizeInvoicePaymentRecord)
    .filter((record) => record.id != null);
  const drawRecords = (Array.isArray(drawRequests) ? drawRequests : [])
    .map(normalizeDrawPaymentRecord)
    .filter((record) => record.id != null);
  return [...invoiceRecords, ...drawRecords];
}

export function summarizePaymentRecords(records) {
  const base = {
    awaiting_customer_approval: { count: 0, amount: 0 },
    payment_pending: { count: 0, amount: 0 },
    paid: { count: 0, amount: 0 },
    issues: { count: 0, amount: 0 },
  };

  for (const record of Array.isArray(records) ? records : []) {
    const key = record?.moneyStatus;
    if (!base[key]) continue;
    base[key].count += 1;
    base[key].amount += money(record?.amount);
  }

  return base;
}
