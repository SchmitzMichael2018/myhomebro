import { useMemo } from "react";

/**
 * Dashboard stats hook (FIXED)
 *
 * Milestones (authoritative fields):
 *   - completed (bool)
 *   - is_invoiced (bool)
 *
 * Invoices:
 *   - status string (pending_approval, paid, disputed, etc.)
 */

// ----- Config (labels shown on the cards) -----
const MILESTONE_STATS = [
  { key: "all", label: "All Milestones" },
  { key: "incomplete", label: "Incomplete" },
  { key: "review", label: "Completed (Not Invoiced)" },
  { key: "invoiced", label: "Invoiced" },
];

const INVOICE_STATS = [
  { key: "pending", label: "Pending Approval" },
  { key: "overdue", label: "Overdue" },
  { key: "disputed", label: "Disputed" },
  { key: "paid", label: "Paid / Earned" },
];

// ----- Utils -----
const bool = (v) => v === true || v === "true";
const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const amountOfMilestone = (m) => num(m.amount ?? m.total ?? 0);
const amountOfInvoice = (i) => num(i.amount ?? i.total ?? i.balance ?? 0);

// ----- Canonical milestone status (FIXED) -----
const deriveMilestoneStatusKey = (m) => {
  const completed = bool(m.completed);
  const invoiced = bool(m.is_invoiced);

  if (!completed) return "incomplete";
  if (completed && !invoiced) return "review"; // Completed (Not Invoiced)
  return "invoiced";
};

// ----- Canonical invoice status -----
const deriveInvoiceStatusKey = (inv) => {
  const raw = String(inv.status || "").toLowerCase();

  const paid =
    raw === "paid" ||
    raw === "earned" ||
    bool(inv.is_paid);

  const disputed =
    raw === "disputed" ||
    bool(inv.is_disputed);

  const pending =
    raw === "pending" ||
    raw === "pending_approval" ||
    raw === "awaiting_approval";

  const due = inv.due_date || inv.due || null;
  let overdue = false;
  if (due && !paid) {
    try {
      overdue = new Date(due) < new Date();
    } catch {
      overdue = false;
    }
  }

  if (disputed) return "disputed";
  if (paid) return "paid";
  if (overdue) return "overdue";
  if (pending) return "pending";
  return "pending";
};

// ----- Main hook -----
export const useDashboardStats = (
  invoices = [],
  milestones = [],
  showArchived = false
) => {
  const normMilestones = useMemo(
    () =>
      (milestones || []).map((m) => ({
        ...m,
        __statusKey: deriveMilestoneStatusKey(m),
        __amount: amountOfMilestone(m),
      })),
    [milestones]
  );

  const normInvoices = useMemo(
    () =>
      (invoices || []).map((i) => ({
        ...i,
        __statusKey: deriveInvoiceStatusKey(i),
        __amount: amountOfInvoice(i),
      })),
    [invoices]
  );

  // ---- Milestone stat cards ----
  const milestoneStatCards = useMemo(() => {
    const bucket = {
      all: normMilestones,
      incomplete: normMilestones.filter((m) => m.__statusKey === "incomplete"),
      review: normMilestones.filter((m) => m.__statusKey === "review"),
      invoiced: normMilestones.filter((m) => m.__statusKey === "invoiced"),
    };

    return MILESTONE_STATS.map((stat) => {
      const items = bucket[stat.key] || [];
      const total = items.reduce((sum, m) => sum + m.__amount, 0);
      return { ...stat, count: items.length, total };
    });
  }, [normMilestones]);

  // ---- Invoice stat cards ----
  const invoiceStatCards = useMemo(() => {
    const bucket = {
      pending: normInvoices.filter((i) => i.__statusKey === "pending"),
      overdue: normInvoices.filter((i) => i.__statusKey === "overdue"),
      disputed: normInvoices.filter((i) => i.__statusKey === "disputed"),
      paid: normInvoices.filter((i) => i.__statusKey === "paid"),
    };

    return INVOICE_STATS.map((stat) => {
      const items = bucket[stat.key] || [];
      const total = items.reduce((sum, i) => sum + i.__amount, 0);
      return { ...stat, count: items.length, total };
    });
  }, [normInvoices]);

  const totalEarned = useMemo(
    () =>
      normInvoices
        .filter((i) => i.__statusKey === "paid")
        .reduce((sum, i) => sum + i.__amount, 0),
    [normInvoices]
  );

  return {
    milestoneStatCards,
    invoiceStatCards,
    totalEarned,
  };
};

export default useDashboardStats;
