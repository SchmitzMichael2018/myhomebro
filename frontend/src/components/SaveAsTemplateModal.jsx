import React, { useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function SaveAsTemplateModal({
  agreementId,
  onClose,
  onSaved,
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const saveTemplate = async () => {
    if (!name.trim()) {
      toast.error("Template name required.");
      return;
    }

    try {
      setSaving(true);

      await api.post(
        `/projects/agreements/${agreementId}/save-as-template/`,
        {
          name,
          description,
          is_active: true,
        }
      );

      toast.success("Template saved.");
      if (onSaved) onSaved();
      onClose();

    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to save template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">

      <div className="bg-slate-800 p-6 rounded-xl w-full max-w-md">

        <div className="text-white font-semibold mb-4">
          Save Agreement as Template
        </div>

        <input
          className="w-full mb-3 p-2 rounded bg-slate-700 text-white"
          placeholder="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <textarea
          className="w-full mb-3 p-2 rounded bg-slate-700 text-white"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-gray-600 rounded text-white"
          >
            Cancel
          </button>

          <button
            onClick={saveTemplate}
            disabled={saving}
            className="px-3 py-1 bg-indigo-600 rounded text-white"
          >
            {saving ? "Saving..." : "Save Template"}
          </button>
        </div>

      </div>
    </div>
  );
}