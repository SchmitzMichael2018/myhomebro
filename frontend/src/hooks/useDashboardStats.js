// src/hooks/useDashboardStats.js

import { useMemo } from "react";

/**
 * Dashboard stats hook
 * - Normalizes invoices/milestones into consistent buckets
 * - Supports archived filtering and invoice search
 * - Works with DRF paginated and unpaginated responses (handled upstream)
 *
 * Exposed buckets:
 *   Milestones: all, incomplete, review, invoiced, disputed, approved
 *   Invoices:   submitted, pending, overdue, disputed, paid
 */

// ----- Config (labels shown on the cards) -----
const MILESTONE_STATS = [
  { key: "all",        label: "All Milestones" },
  { key: "incomplete", label: "Incomplete" },
  { key: "review",     label: "Completed (Not Invoiced)" },
  { key: "invoiced",   label: "Invoiced" },
  { key: "disputed",   label: "Disputed" },
  { key: "approved",   label: "Approved" },
];

const INVOICE_STATS = [
  { key: "submitted",  label: "Sent / Submitted" },
  { key: "pending",    label: "Pending Approval" },
  { key: "overdue",    label: "Overdue" },
  { key: "disputed",   label: "Disputed" },
  { key: "paid",       label: "Paid / Earned" },
];

// ----- Utils -----
const bool = (v) => v === true || v === "true";
const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const amountOfMilestone = (m) =>
  num(m.__amount ?? m.amount ?? m.total ?? m.price ?? m.total_amount ?? m.milestone_amount);

const amountOfInvoice = (inv) =>
  num(inv.__amount ?? inv.amount ?? inv.total ?? inv.total_amount ?? inv.balance ?? inv.invoice_amount);

const isArchivedInvoice = (inv) =>
  Boolean(inv.agreement_is_archived ?? inv.is_archived ?? inv?.agreement?.is_archived);

const isArchivedMilestone = (m) =>
  Boolean(m.agreement_is_archived ?? m.is_archived ?? m?.agreement?.is_archived ?? m?.project?.is_archived);

// Derive normalized milestone status key
const deriveMilestoneStatusKey = (m) => {
  const raw = (m.status || "").toString().toLowerCase();
  const completed =
    bool(m.completed) || bool(m.is_completed) || raw === "completed" || raw === "complete";
  const invoiced = bool(m.invoiced) || bool(m.is_invoiced) || raw === "invoiced";
  const approved =
    bool(m.approved) || bool(m.is_approved) || raw === "approved" || raw === "completed and approved";
  const disputed = bool(m.disputed) || bool(m.is_disputed) || raw === "disputed";

  if (disputed) return "disputed";
  if (approved) return "approved";
  if (invoiced) return "invoiced";
  if (completed) return "review"; // Completed (not invoiced)
  return "incomplete";
};

// Derive normalized invoice status key
const deriveInvoiceStatusKey = (inv) => {
  const raw = (inv.status || "").toString().toLowerCase();

  const paid =
    bool(inv.paid) || bool(inv.is_paid) || raw === "paid" || raw === "approved/paid" || raw === "complete/paid";

  const approved = bool(inv.approved) || bool(inv.is_approved) || raw === "approved";
  const disputed = bool(inv.disputed) || bool(inv.is_disputed) || raw === "disputed";
  const pending =
    raw === "pending_approval" || raw === "pending approval" || bool(inv.pending_approval);

  // overdue if has due date, not paid, and past
  const due = inv.due || inv.due_date || inv.invoice_due || null;
  let overdue = false;
  if (due && !paid) {
    try { overdue = new Date(due) < new Date(); } catch { overdue = false; }
  }

  if (disputed) return "disputed";
  if (paid) return "paid";
  if (pending) return "pending";
  if (overdue) return "overdue";
  return "submitted"; // default bucket
};

// ----- Main hook -----
export const useDashboardStats = (
  invoices = [],
  milestones = [],
  showArchived = false,
  searchTerm = ""
) => {
  // Filter archived
  const visibleInvoices = useMemo(
    () => (Array.isArray(invoices) ? invoices : []).filter((inv) => showArchived || !isArchivedInvoice(inv)),
    [invoices, showArchived]
  );

  const visibleMilestones = useMemo(
    () => (Array.isArray(milestones) ? milestones : []).filter((m) => showArchived || !isArchivedMilestone(m)),
    [milestones, showArchived]
  );

  // Normalize status keys and amounts (non-destructive)
  const normInvoices = useMemo(
    () =>
      visibleInvoices.map((inv) => ({
        ...inv,
        __statusKey: inv.statusKey || deriveInvoiceStatusKey(inv),
        __amount: amountOfInvoice(inv),
      })),
    [visibleInvoices]
  );

  const normMilestones = useMemo(
    () =>
      visibleMilestones.map((m) => ({
        ...m,
        __statusKey: m.statusKey || deriveMilestoneStatusKey(m),
        __amount: amountOfMilestone(m),
      })),
    [visibleMilestones]
  );

  // Invoice search (project title, customer/homeowner name, invoice number, title)
  const searchedInvoices = useMemo(() => {
    const list = normInvoices;
    const q = (searchTerm || "").trim().toLowerCase();
    if (!q) return list;

    const text = (v) => (v ? String(v).toLowerCase() : "");

    return list.filter((inv) => {
      const candidates = [
        inv.project_title,
        inv.homeowner_name,
        inv.customer_name,
        inv.title,
        inv.invoice_title,
        inv.agreement?.title,
        inv.agreement?.name,
        inv.customer?.name,
      ];
      const matchText = candidates.some((c) => text(c).includes(q));
      const matchNumber = String(inv.invoice_number || inv.id || "").includes(q);
      return matchText || matchNumber;
    });
  }, [normInvoices, searchTerm]);

  // Totals
  const totalEarned = useMemo(
    () => normInvoices.filter((i) => i.__statusKey === "paid")
                      .reduce((sum, i) => sum + amountOfInvoice(i), 0),
    [normInvoices]
  );

  // Milestone stat cards
  const milestoneStatCards = useMemo(() => {
    const bucket = {
      all:        normMilestones,
      incomplete: normMilestones.filter((m) => m.__statusKey === "incomplete"),
      review:     normMilestones.filter((m) => m.__statusKey === "review"),
      invoiced:   normMilestones.filter((m) => m.__statusKey === "invoiced"),
      disputed:   normMilestones.filter((m) => m.__statusKey === "disputed"),
      approved:   normMilestones.filter((m) => m.__statusKey === "approved"),
    };

    return MILESTONE_STATS.map((stat) => {
      const items = stat.key === "all" ? bucket.all : bucket[stat.key] || [];
      const total = items.reduce((acc, m) => acc + amountOfMilestone(m), 0);
      return { ...stat, count: items.length, total };
    });
  }, [normMilestones]);

  // Invoice stat cards
  const invoiceStatCards = useMemo(() => {
    const bucket = {
      submitted: normInvoices.filter((i) => i.__statusKey === "submitted"),
      pending:   normInvoices.filter((i) => i.__statusKey === "pending"),
      overdue:   normInvoices.filter((i) => i.__statusKey === "overdue"),
      disputed:  normInvoices.filter((i) => i.__statusKey === "disputed"),
      paid:      normInvoices.filter((i) => i.__statusKey === "paid"),
    };

    return INVOICE_STATS.map((stat) => {
      const items = bucket[stat.key] || [];
      const total = items.reduce((acc, i) => acc + amountOfInvoice(i), 0);
      return { ...stat, count: items.length, total };
    });
  }, [normInvoices]);

  return {
    searchedInvoices,
    totalEarned,
    milestoneStatCards,
    invoiceStatCards,
  };
};

export default useDashboardStats;
