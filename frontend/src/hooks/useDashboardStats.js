// src/hooks/useDashboardStats.js

import { useMemo } from 'react';

// It's good practice to define constants outside the component
const MILESTONE_STATS = [
  { key: "total", label: "All Milestones" },
  { key: "incomplete", label: "Incomplete" },
  { key: "review", label: "For Review" },
  { key: "invoiced", label: "Invoiced" },
];

const INVOICE_STATS = [
  { key: "pending", label: "Pending Approval" },
  { key: "disputed", label: "Disputed" },
  { key: "approved", label: "Approved & Funded" },
  { key: "paid", label: "Paid Out" },
];

export const useDashboardStats = (invoices, milestones, showArchived, searchTerm) => {
  // Memoize the base filtered lists
  const visibleInvoices = useMemo(() => 
    invoices.filter(inv => showArchived || !inv.agreement_is_archived),
    [invoices, showArchived]
  );

  const visibleMilestones = useMemo(() =>
    milestones.filter(m => showArchived || !m.agreement_is_archived),
    [milestones, showArchived]
  );

  // Memoize the searched list of invoices
  const searchedInvoices = useMemo(() => {
    if (!searchTerm) return visibleInvoices;
    const q = searchTerm.toLowerCase();
    return visibleInvoices.filter(inv => 
      inv.project_title?.toLowerCase().includes(q) ||
      inv.homeowner_name?.toLowerCase().includes(q) ||
      String(inv.invoice_number).includes(q)
    );
  }, [visibleInvoices, searchTerm]);

  // Memoize calculated totals
  const totalEarned = useMemo(() => 
    visibleInvoices
      .filter(inv => inv.status === "paid")
      .reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0),
    [visibleInvoices]
  );
  
  // Memoize stats for the cards
  const milestoneStatCards = useMemo(() => {
    return MILESTONE_STATS.map(stat => {
      const items = visibleMilestones.filter(m => {
        if (stat.key === "incomplete") return !m.completed;
        if (stat.key === "review") return m.completed && !m.is_invoiced;
        if (stat.key === "invoiced") return m.is_invoiced;
        return true; // "total" case
      });
      return {
        ...stat,
        count: items.length,
        total: items.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0),
      };
    });
  }, [visibleMilestones]);

  const invoiceStatCards = useMemo(() => {
    return INVOICE_STATS.map(stat => {
      const items = visibleInvoices.filter(inv => inv.status === stat.key);
      return {
        ...stat,
        count: items.length,
        total: items.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0),
      };
    });
  }, [visibleInvoices]);


  return { 
    searchedInvoices, 
    totalEarned, 
    milestoneStatCards, 
    invoiceStatCards 
  };
};