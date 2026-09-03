import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";
import { Button } from "./ui/Button.jsx";
import { Card } from "./ui/surfaces.jsx";

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
      setItems(Array.isArray(data) ? data : data?.results || []);
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

      const resp = await api.post(`/projects/agreements/${agreementId}/attachments/`, form);
      // Use server’s refreshed list immediately (expected from backend action)
      const list = Array.isArray(resp?.data) ? resp.data : [];
      if (list.length) setItems(list); else await load();

      setFile(null); setTitle(""); setCategory("WARRANTY"); setVisible(true); setAckReq(true);
      toast.success("Attachment uploaded.");
    } catch (err) {
      const d = err?.response?.data;
      toast.error(d?.detail || Object.values(d || {})?.[0] || "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.delete(`/projects/agreements/${agreementId}/attachments/${id}/`);
      await load();
      toast.success("Attachment deleted.");
    } catch {
      toast.error("Delete failed.");
    }
  };

  return (
    <Card theme="operational" data-testid="agreement-attachment-manager">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Attachments & Addenda</h3>
      </div>

      {loading ? (
        <div className="text-sky-100/65">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sky-100/65">None yet.</div>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="min-w-full rounded border border-white/10 text-sm">
            <thead className="bg-white/10 text-sky-100/75">
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
                <tr key={it.id} className="border-t border-white/10 odd:bg-white/5 even:bg-white/10">
                  <td className="p-2 border">{it.title || "—"}</td>
                  <td className="p-2 border">{it.category}</td>
                  <td className="p-2 border">
                    {it.file_url ? (
                      <>
                        <a
                          className="text-sky-300 hover:underline"
                          href={it.file_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {it.file_name || "Open"}
                        </a>
                        <a
                          className="ml-3 text-sky-300 hover:underline"
                          href={it.file_url}
                          download={it.file_name || true}
                        >
                          Download
                        </a>
                      </>
                    ) : (
                      <span className="text-sky-100/60">no file</span>
                    )}
                    {typeof it.size_bytes === "number" && (
                      <span className="ml-2 text-sky-100/60">({Math.ceil(it.size_bytes / 1024)} KB)</span>
                    )}
                  </td>
                  <td className="p-2 border">{it.visible_to_homeowner ? "Yes" : "No"}</td>
                  <td className="p-2 border">{it.ack_required ? "Yes" : "No"}</td>
                  <td className="p-2 border">{new Date(it.uploaded_at).toLocaleString()}</td>
                  {canEdit && (
                    <td className="p-2 border">
                      <Button
                        variant="danger"
                        theme="operational"
                        size="sm"
                        onClick={() => onDelete(it.id)}
                      >
                        Delete
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={onUpload} className="grid items-end gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="mhb-attachmentmanager-155" className="block text-sm font-medium">Title</label>
            <input id="mhb-attachmentmanager-155"
              type="text"
              className="mhb-operational-control mt-1 w-full rounded-lg px-3 py-2"
              placeholder="e.g., 12-Month Workmanship Warranty"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="mhb-attachmentmanager-165" className="block text-sm font-medium">Category</label>
            <select id="mhb-attachmentmanager-165"
              className="mhb-operational-control mt-1 w-full rounded-lg px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mhb-attachmentmanager-175" className="block text-sm font-medium">File</label>
            <input id="mhb-attachmentmanager-175"
              type="file"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-sky-100 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:font-semibold file:text-white"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept=".pdf,image/*"
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-sky-100/80">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
              <span>Visible to Customer</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={ackReq} onChange={(e) => setAckReq(e.target.checked)} />
              <span>Acknowledgement Required</span>
            </label>
          </div>
          <div className="md:col-span-2">
            <Button
              type="submit"
              theme="operational"
              disabled={submitting || !file}
            >
              {submitting ? "Uploading…" : "Upload Attachment"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
