// src/components/AttachmentManager.jsx
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

const CATEGORIES = [
  { value: "WARRANTY", label: "Warranty" },
  { value: "ADDENDUM", label: "Addendum" },
  { value: "EXHIBIT", label: "Exhibit" },
  { value: "OTHER", label: "Other" },
];

export default function AttachmentManager({ agreementId, canEdit = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("WARRANTY");
  const [visible, setVisible] = useState(true);
  const [ackReq, setAckReq] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/projects/agreements/${agreementId}/attachments/`);
      setItems(data || []);
    } catch {
      toast.error("Failed to load attachments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [agreementId]);

  const onUpload = async (e) => {
    e.preventDefault();
    if (!file) return toast.error("Please choose a file.");
    try {
      setSubmitting(true);
      const form = new FormData();
      if (title.trim()) form.append("title", title.trim());
      form.append("category", category);
      form.append("file", file);
      form.append("visible_to_homeowner", visible ? "true" : "false");
      form.append("ack_required", ackReq ? "true" : "false");

      await api.post(`/projects/agreements/${agreementId}/attachments/`, form);
      setFile(null); setTitle(""); setCategory("WARRANTY"); setVisible(true); setAckReq(true);
      toast.success("Attachment uploaded.");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.delete(`/projects/agreements/${agreementId}/attachments/${id}/`);
      toast.success("Attachment deleted.");
      load();
    } catch {
      toast.error("Delete failed.");
    }
  };

  return (
    <div className="bg-white rounded shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Attachments & Addenda</h3>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500">None yet.</div>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="min-w-full text-sm border rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border text-left">Title</th>
                <th className="p-2 border text-left">Category</th>
                <th className="p-2 border text-left">File</th>
                <th className="p-2 border text-left">Visible</th>
                <th className="p-2 border text-left">Ack Req</th>
                <th className="p-2 border text-left">Uploaded</th>
                {canEdit && <th className="p-2 border text-left">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 border">{it.title}</td>
                  <td className="p-2 border">{it.category}</td>
                  <td className="p-2 border">
                    <a className="text-blue-600 hover:underline" href={it.file_url} target="_blank" rel="noreferrer">
                      {it.file_name}
                    </a>
                    {typeof it.size_bytes === "number" && (
                      <span className="text-gray-500 ml-2">({Math.ceil(it.size_bytes / 1024)} KB)</span>
                    )}
                  </td>
                  <td className="p-2 border">{it.visible_to_homeowner ? "Yes" : "No"}</td>
                  <td className="p-2 border">{it.ack_required ? "Yes" : "No"}</td>
                  <td className="p-2 border">{new Date(it.uploaded_at).toLocaleString()}</td>
                  {canEdit && (
                    <td className="p-2 border">
                      <button
                        onClick={() => onDelete(it.id)}
                        className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={onUpload} className="grid md:grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-sm font-medium">Title</label>
            <input
              type="text"
              className="mt-1 w-full border rounded px-3 py-2"
              placeholder="e.g., 12-Month Workmanship Warranty"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Category</label>
            <select
              className="mt-1 w-full border rounded px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">File</label>
            <input
              type="file"
              className="mt-1 w-full"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept=".pdf,image/*"
            />
          </div>
          <div className="flex gap-4">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
              <span>Visible to Homeowner</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={ackReq} onChange={(e) => setAckReq(e.target.checked)} />
              <span>Acknowledgement Required</span>
            </label>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={submitting || !file}
              className="px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting ? "Uploading…" : "Upload Attachment"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
