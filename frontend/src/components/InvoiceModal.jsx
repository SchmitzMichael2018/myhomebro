// src/components/InvoiceModal.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import api from "../api";

// Map your invoice statuses to friendly text
function getStatusText(status) {
  if (status === "paid") return "Paid";
  if (status === "approved") return "Approved";
  if (status === "completed" || status === "complete") return "Completed";
  if (status === "pending") return "Incomplete";
  if (status === "disputed") return "Disputed";
  return status ?? "—";
}

/**
 * A self-contained modal that renders via portal into document.body.
 * - All hooks are declared unconditionally at the top (prevents hook-order errors).
 * - No dependency on an external <Modal /> wrapper (avoids removeChild DOM issues).
 * - Locks body scroll while open and closes on overlay click or Escape key.
 * - ⬇️ PDF libs are loaded lazily inside handleDownloadPDF()
 */
export default function InvoiceModal({
  visible = false,
  onClose = () => {},
  invoices = [],
  category = "Invoices",
}) {
  // ✅ Hooks always run in the same order
  const [isOpen, setIsOpen] = useState(Boolean(visible));
  const [loadingId, setLoadingId] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Keep local visibility in sync with prop
  useEffect(() => {
    setIsOpen(Boolean(visible));
  }, [visible]);

  // Prevent background scroll while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const list = useMemo(() => (Array.isArray(invoices) ? invoices : []), [invoices]);

  const handleOverlayClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const handleAction = useCallback(
    async (id, action) => {
      setLoadingId(id);
      setErrorMessage("");
      try {
        const res = await api.patch(`/projects/invoices/${id}/${action}/`);
        if (res.status === 200) {
          alert(`Invoice ${action.replace("_", " ")} successfully.`);
          onClose(); // close so parent can refetch if needed
        } else {
          setErrorMessage(`Failed to ${action} invoice. Please try again.`);
        }
      } catch (err) {
        console.error("Error updating invoice:", err);
        setErrorMessage("An error occurred. Please try again.");
      } finally {
        setLoadingId(null);
      }
    },
    [onClose]
  );

  // ⬇️ LAZY import of heavy PDF libs (no top-level imports!)
  const handleDownloadPDF = useCallback(async () => {
    setPdfLoading(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = autoTableMod.default || autoTableMod;

      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`${category} Invoices - ${new Date().toLocaleDateString()}`, 14, 18);

      const rows = list.map((inv) => {
        const amt = Number(inv.amount_due ?? inv.amount ?? 0);
        return [
          inv.id ?? "—",
          inv.project_title || inv.project_name || "—",
          amt.toLocaleString("en-US", { style: "currency", currency: "USD" }),
          getStatusText(inv.status),
        ];
      });

      const total = list.reduce(
        (acc, inv) => acc + Number(inv.amount_due ?? inv.amount ?? 0),
        0
      );

      autoTable(doc, {
        startY: 24,
        head: [["ID", "Project", "Amount", "Status"]],
        body: rows,
        foot: [["", "Total", total.toLocaleString("en-US", { style: "currency", currency: "USD" }), ""]],
      });

      const fname = `${String(category)
        .toLowerCase()
        .replace(/\s+/g, "_")}_invoices_${new Date()
        .toLocaleDateString()
        .replace(/\//g, "-")}.pdf`;

      doc.save(fname);
    } finally {
      setPdfLoading(false);
    }
  }, [category, list]);

  // Render nothing when closed (hooks already ran safely)
  if (!isOpen) return null;

  const modal = (
    <div
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      aria-modal="true"
      role="dialog"
    >
      <div className="mx-4 w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-lg font-semibold text-gray-800">
            {category} Milestone Invoices
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <section className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {errorMessage && (
            <p className="mb-4 text-center text-red-500">{errorMessage}</p>
          )}

          {list.length === 0 ? (
            <p className="py-8 text-center text-gray-500">
              No invoices found in this category.
            </p>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {list.length} item{list.length === 1 ? "" : "s"}
                </div>
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className="flex items-center rounded bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  disabled={pdfLoading}
                >
                  {pdfLoading ? (
                    <>
                      <svg
                        className="mr-2 h-5 w-5 animate-spin"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                      </svg>
                      Generating PDF…
                    </>
                  ) : (
                    "Download PDF"
                  )}
                </button>
              </div>

              <table className="min-w-full text-sm text-gray-700">
                <thead className="bg-gray-100 text-left">
                  <tr>
                    <th className="px-4 py-2">ID</th>
                    <th className="px-4 py-2">Project</th>
                    <th className="px-4 py-2">Amount</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="border-t">
                  {list.map((inv) => {
                    const id = inv.id ?? inv.milestone_id ?? String(inv.title ?? "row");
                    const amount = Number(inv.amount_due ?? inv.amount ?? 0);
                    return (
                      <tr key={id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono">#{inv.id ?? "—"}</td>
                        <td className="px-4 py-2">
                          {inv.project_title || inv.project_name || "—"}
                        </td>
                        <td className="px-4 py-2">
                          {amount.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                          })}
                        </td>
                        <td className="px-4 py-2">{getStatusText(inv.status)}</td>
                        <td className="px-4 py-2 space-x-2">
                          {inv.status === "pending" && (
                            <button
                              type="button"
                              onClick={() => handleAction(inv.id, "mark_complete")}
                              className="rounded bg-blue-500 px-3 py-1 text-white hover:bg-blue-600 disabled:opacity-50"
                              disabled={loadingId === inv.id || pdfLoading}
                            >
                              {loadingId === inv.id ? "…" : "Mark Complete"}
                            </button>
                          )}
                          {inv.status === "completed" && (
                            <button
                              type="button"
                              onClick={() => handleAction(inv.id, "approve")}
                              className="rounded bg-green-500 px-3 py-1 text-white hover:bg-green-600 disabled:opacity-50"
                              disabled={loadingId === inv.id || pdfLoading}
                            >
                              {loadingId === inv.id ? "…" : "Approve"}
                            </button>
                          )}
                          {inv.status !== "paid" && (
                            <button
                              type="button"
                              onClick={() => handleAction(inv.id, "dispute")}
                              className="rounded bg-red-500 px-3 py-1 text-white hover:bg-red-600 disabled:opacity-50"
                              disabled={loadingId === inv.id || pdfLoading}
                            >
                              {loadingId === inv.id ? "…" : "Dispute"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Footer */}
        <footer className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
