// frontend/src/components/MilestoneEditModal.jsx
import React, { useEffect, useState } from "react";
import Modal from "react-modal";
import toast from "react-hot-toast";
import api from "../api";

Modal.setAppElement("#root");

export default function MilestoneEditModal({ milestone, isOpen, onClose }) {
  const [form, setForm] = useState({ title: "", amount: "", start_date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (milestone) {
      setForm({
        title: milestone.title || "",
        amount: milestone.amount ?? "",
        start_date: milestone.start_date || milestone.start || "",
      });
    }
  }, [milestone]);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = {
        title: form.title,
        amount: form.amount,
        start_date: form.start_date || null,
      };
      await api.patch(`/projects/milestones/${milestone.id}/`, payload);
      toast.success("Milestone updated.");
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => onClose(false)}
      className="max-w-lg w-[90vw] bg-white rounded-xl shadow-2xl p-6 mx-auto mt-24 outline-none"
      overlayClassName="fixed inset-0 bg-black/50 flex items-start justify-center"
    >
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-lg font-semibold">Edit Milestone</h2>
        <button onClick={() => onClose(false)} className="px-3 py-1.5 rounded-lg border">Close</button>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1">Title</label>
          <input name="title" value={form.title} onChange={onChange} className="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Amount</label>
          <input name="amount" type="number" step="0.01" value={form.amount} onChange={onChange} className="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Scheduled Date</label>
          <input name="start_date" type="date" value={form.start_date || ""} onChange={onChange} className="w-full border rounded-lg px-3 py-2" />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} className="px-4 py-2 rounded-lg border">Cancel</button>
          <button type="submit" disabled={saving} className={`px-4 py-2 rounded-lg text-white font-semibold ${saving ? "bg-gray-500" : "bg-blue-600 hover:bg-blue-700"}`}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
