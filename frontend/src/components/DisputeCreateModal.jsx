import React, { useEffect, useMemo, useState } from "react";
import Modal from "react-modal";
import toast from "react-hot-toast";
import api from "../api";

if (typeof document !== "undefined") {
  Modal.setAppElement("#root");
}

/**
 * DisputeCreateModal
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - context: { invoice?: object, agreement?: object|id }
 * - role: "contractor" | "customer"
 * - onCreated?: (dispute) => void
 */
export default function DisputeCreateModal({
  isOpen,
  onClose,
  context = {},
  role = "contractor",
  onCreated,
}) {
  const invoice = context?.invoice || null;
  const agreementObj = context?.agreement || null;

  const agreementId = useMemo(() => {
    if (!agreementObj && invoice) {
      const ag = invoice.agreement;
      if (ag && typeof ag === "object") return ag.id ?? ag.pk ?? null;
      return ag ?? null;
    }
    if (typeof agreementObj === "object") return agreementObj?.id ?? agreementObj?.pk ?? null;
    return agreementObj ?? null;
  }, [agreementObj, invoice]);

  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setDescription("");
      setSubmitting(false);
    }
  }, [isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!agreementId) {
      toast.error("Missing agreement reference for dispute.");
      return;
    }
    if (!reason) {
      toast.error("Please select a reason.");
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        agreement: agreementId,
        invoice: invoice ? invoice.id : null,
        raised_by_role: role, // "contractor" | "customer"
        reason,
        description,
      };
      // If your endpoint lives elsewhere, update this path:
      const res = await api.post("/projects/disputes/", payload);
      toast.success("Dispute submitted.");
      onCreated?.(res.data);
      onClose();
    } catch (err) {
      console.error("Create dispute error:", err);
      toast.error("Could not submit dispute.");
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    role === "customer" ? "Create Dispute (Customer)" : "Create Dispute (Contractor)";

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => !submitting && onClose()}
      className="p-6 max-w-2xl mx-auto bg-white rounded-2xl shadow-xl outline-none"
      overlayClassName="fixed inset-0 bg-black/50 flex justify-center items-center z-50"
      aria-modal="true"
      role="dialog"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">{title}</h2>
        <button
          className="rounded-md bg-gray-800 text-white px-3 py-1 text-sm hover:bg-gray-700 disabled:opacity-50"
          onClick={onClose}
          disabled={submitting}
        >
          Close
        </button>
      </div>

      <div className="space-y-3 mb-4 text-sm text-gray-700">
        {invoice ? (
          <>
            <div>
              <span className="font-semibold">Invoice:</span>{" "}
              {invoice.invoice_number || `#${invoice.id}`}
            </div>
            <div>
              <span className="font-semibold">Agreement:</span>{" "}
              {invoice.agreement_title || invoice.project_title || `#${agreementId || "-"}`}
            </div>
            <div>
              <span className="font-semibold">Amount:</span>{" "}
              ${Number(invoice.amount_due ?? invoice.amount ?? 0).toLocaleString()}
            </div>
            <div>
              <span className="font-semibold">Status:</span>{" "}
              {(invoice.status || "-").replace("_", " ")}
            </div>
          </>
        ) : (
          <div>
            <span className="font-semibold">Agreement:</span> #{agreementId}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Reason</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
          >
            <option value="">Select a reason…</option>
            <option value="quality_issue">Quality issue</option>
            <option value="scope_disagreement">Scope disagreement</option>
            <option value="delay">Delay / missed deadline</option>
            <option value="billing_error">Billing error</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Description</label>
          <textarea
            className="w-full border rounded px-3 py-2 min-h-[120px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue, proposed resolution, and any relevant details…"
            disabled={submitting}
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border bg-white hover:bg-gray-50"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit Dispute"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
