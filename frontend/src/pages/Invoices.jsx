// src/pages/Invoices.jsx
// v2025-12-18-app-invoice-detail-route
// - Lists invoices from /projects/invoices/ (authoritative for contractor dashboard)
// - Falls back to /invoices/ if needed
// - Auto-create from milestone navigates to /app/invoices/:id (protected)
// v2026-01-19 — NEW: supports ?filter=disputed to show ONLY disputed invoices
// v2026-02-15 — ✅ Direct Pay aware:
// - supports ?filter=direct (or direct_pay) to show ONLY Direct Pay invoices
// - supports ?filter=escrow to show ONLY escrow invoices
// Note: InvoiceList already renders Direct Pay actions (Create/Copy Link) when payment_mode is direct.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import InvoiceList from "../components/InvoiceList";

function useQuery() {
  const { search } = useLocation();
  return React.useMemo(() => new URLSearchParams(search), [search]);
}

async function createInvoiceForMilestone({ milestoneId, agreementId }) {
  const payloads = [
    { milestone: milestoneId, agreement: agreementId || undefined },
    { milestone_id: milestoneId, agreement_id: agreementId || undefined },
    { milestoneId: milestoneId, agreementId: agreementId || undefined },
  ];

  const endpoints = ["/projects/invoices/", "/invoices/"];

  let lastErr = null;

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const res = await api.post(endpoint, payload);
        return res.data;
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        if (status === 404) break;
        continue;
      }
    }
  }

  throw lastErr || new Error("Invoice creation failed");
}

function isDisputedInvoice(inv) {
  const s = String(
    inv?.display_status ?? inv?.status_label ?? inv?.status ?? ""
  ).toLowerCase();
  return s.includes("dispute");
}

function isDirectPayInvoice(inv) {
  const mode =
    inv?.agreement?.payment_mode ??
    inv?.agreement?.paymentMode ??
    inv?.payment_mode ??
    inv?.paymentMode ??
    inv?.agreement_payment_mode ??
    "";
  return String(mode || "").toLowerCase().includes("direct");
}

function isEscrowInvoice(inv) {
  const mode =
    inv?.agreement?.payment_mode ??
    inv?.agreement?.paymentMode ??
    inv?.payment_mode ??
    inv?.paymentMode ??
    inv?.agreement_payment_mode ??
    "";
  const s = String(mode || "").toLowerCase();
  if (!s) return true; // default to escrow when missing
  return s.includes("escrow") || !s.includes("direct");
}

export default function Invoices() {
  const query = useQuery();
  const navigate = useNavigate();

  const milestoneId = query.get("milestone");
  const agreementId = query.get("agreement");

  // filter support
  const filterKey = query.get("filter") || "";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoCreateState, setAutoCreateState] = useState({
    running: false,
    error: "",
  });

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const res = await api.get("/projects/invoices/");
        setItems(Array.isArray(res.data) ? res.data : []);
        return;
      } catch {
        const res2 = await api.get("/invoices/");
        setItems(Array.isArray(res2.data) ? res2.data : []);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load invoices.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    const run = async () => {
      if (!milestoneId) return;

      setAutoCreateState({ running: true, error: "" });

      try {
        const created = await createInvoiceForMilestone({ milestoneId, agreementId });
        const newId = created?.id || created?.invoice_id || created?.pk;
        if (!newId) throw new Error("Invoice created but no ID returned.");

        toast.success("Invoice created. Opening…");

        // ✅ Contractor invoice detail lives at /app/invoices/:id
        navigate(`/app/invoices/${newId}`, { replace: true });
      } catch (err) {
        console.error(err);
        const detail =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          (typeof err?.response?.data === "string" ? err.response.data : null) ||
          err?.message ||
          "Invoice could not be created.";

        setAutoCreateState({ running: false, error: detail });
        toast.error("Could not auto-create invoice. See banner for details.");
      } finally {
        setAutoCreateState((s) => ({ ...s, running: false }));
      }
    };

    run();
  }, [milestoneId, agreementId, navigate]);

  // Existing milestone scope
  const scopedInvoices = useMemo(() => {
    if (!milestoneId) return items;

    return items.filter((inv) => {
      const m = inv.milestone || inv.milestone_id || inv.milestoneId;
      return String(m || "") === String(milestoneId);
    });
  }, [items, milestoneId]);

  // Filter support (applies when no milestone auto-scope)
  const finalInvoices = useMemo(() => {
    // If milestone scope is active, keep that behavior exactly.
    if (milestoneId) return scopedInvoices;

    const fk = String(filterKey || "").toLowerCase();

    if (fk === "disputed") {
      return items.filter(isDisputedInvoice);
    }

    if (fk === "direct" || fk === "direct_pay" || fk === "directpay") {
      return items.filter(isDirectPayInvoice);
    }

    if (fk === "escrow") {
      return items.filter(isEscrowInvoice);
    }

    return items;
  }, [items, filterKey, milestoneId, scopedInvoices]);

  const filterBanner = useMemo(() => {
    const fk = String(filterKey || "").toLowerCase();
    if (milestoneId) return null;
    if (fk === "disputed") {
      return { title: "Filtered: Disputed Invoices", text: "Showing only invoices currently in dispute." };
    }
    if (fk === "direct" || fk === "direct_pay" || fk === "directpay") {
      return { title: "Filtered: Direct Pay Invoices", text: "Showing only invoices for Direct Pay agreements." };
    }
    if (fk === "escrow") {
      return { title: "Filtered: Escrow Invoices", text: "Showing only invoices for Escrow (Protected) agreements." };
    }
    return null;
  }, [filterKey, milestoneId]);

  return (
    <div className="p-0">
      {milestoneId && (
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 text-purple-900 p-4">
          <div className="font-semibold">Invoice creation requested for Milestone #{milestoneId}</div>
          <div className="text-sm mt-1 opacity-90">
            {autoCreateState.running
              ? "Creating invoice…"
              : autoCreateState.error
              ? `Auto-create failed: ${autoCreateState.error}`
              : "If an invoice already exists, it will appear below."}
          </div>
        </div>
      )}

      {filterBanner && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-900 p-4">
          <div className="font-semibold">{filterBanner.title}</div>
          <div className="text-sm mt-1 opacity-90">{filterBanner.text}</div>
        </div>
      )}

      <InvoiceList initialData={finalInvoices} loadingOverride={loading} onRefresh={fetchInvoices} />
    </div>
  );
}
