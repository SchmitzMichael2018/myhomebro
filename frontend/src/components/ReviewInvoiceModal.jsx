import React, { useState } from "react";
import toast from "react-hot-toast";
import Modal from "./Modal";
import api from "../api";

/**
 * A modal for reviewing a completed milestone before sending a final invoice.
 * Includes optional photo/file upload, and optional final expense entry.
 */
export default function ReviewInvoiceModal({ visible, onClose, milestoneId }) {
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [expense, setExpense] = useState("");
  const [loading, setLoading] = useState(false);

  if (!visible) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!milestoneId) return;
    setLoading(true);
    const formData = new FormData();
    if (file) formData.append("file", file);
    if (note) formData.append("note", note);
    if (expense) formData.append("expense", expense);

    try {
      await api.post(`/milestones/${milestoneId}/finalize_and_invoice/`, formData);
      toast.success("Invoice sent and review recorded.");
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not send invoice.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} title="Finalize Milestone & Send Invoice" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Optionally add a file or receipt and a short note before finalizing this milestone and sending the invoice to the homeowner.
        </p>

        <div>
          <label className="block text-sm font-medium mb-1">Upload File or Photo</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files[0])}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add any context or details here..."
            className="w-full border rounded px-3 py-2 h-24"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Final Expense (optional)</label>
          <input
            type="number"
            step="0.01"
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="Enter $ amount if needed"
          />
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded font-semibold hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? "Sending..." : "Send Invoice"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
