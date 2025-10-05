// frontend/src/components/AttachmentSection.jsx
import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function AttachmentSection({ agreementId, onChange }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [visible, setVisible] = useState(true);
  const [ackReq, setAckReq] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [lastError, setLastError] = useState("");

  const categories = useMemo(() => ["WARRANTY", "ADDENDUM", "EXHIBIT", "OTHER"], []);
  const listUrl = `/projects/agreements/${agreementId}/attachments/`;

  const load = async () => {
    setLoading(true);
    setLastError("");
    try {
      const { data } = await api.get(listUrl);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agreementId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId]);

  const pickFile = (e) => setFile(e.target.files?.[0] || null);
  const onDrop = (e) => {
    e.preventDefault();
    setFile(e.dataTransfer?.files?.[0] || null);
  };

  const b = (v) => (v ? "true" : "false");

  const buildForm = ({ fileKey, visibleKey, ackKey }) => {
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("category", category);
    fd.append(visibleKey, b(visible));
    fd.append(ackKey, b(ackReq));
    fd.append(fileKey, file);
    // some serializers require the FK even on nested routes
    fd.append("agreement", String(agreementId));
    return fd;
  };

  // progressive fallbacks for different serializer field names
  const attempts = [
    { fileKey: "file",            visibleKey: "visible",              ackKey: "ack_required" },
    { fileKey: "attachment",      visibleKey: "visible",              ackKey: "acknowledgement_required" },
    { fileKey: "attachment_file", visibleKey: "is_visible",           ackKey: "requires_acknowledgement" },
    { fileKey: "document",        visibleKey: "visible_to_homeowner", ackKey: "acknowledgement_required" },
    { fileKey: "upload",          visibleKey: "visible",              ackKey: "ack_required" },
  ];

  const upload = async () => {
    setLastError("");
    if (!file) return toast.error("Please choose a file.");
    if (!title.trim()) return toast.error("Please enter a title.");

    setUploading(true);
    let success = false;
    let lastMsg = "Upload failed.";

    try {
      for (const map of attempts) {
        try {
          const fd = buildForm(map);
          const res = await api.post(listUrl, fd); // let browser set multipart boundary
          if (res && res.status >= 200 && res.status < 300) {
            success = true;
            break;
          }
        } catch (e) {
          const data = e?.response?.data;
          if (data) {
            if (typeof data === "string") lastMsg = data;
            else if (data?.detail) lastMsg = data.detail;
            else if (typeof data === "object") {
              lastMsg = Object.entries(data)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
                .join(" | ");
            }
          }
        }
      }

      if (!success) {
        setLastError(lastMsg);
        toast.error(lastMsg);
        return;
      }

      toast.success("Attachment uploaded.");
      setTitle("");
      setCategory("OTHER");
      setVisible(true);
      setAckReq(false);
      setFile(null);
      await load();
      onChange && onChange();
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/projects/attachments/${id}/`);
      toast.success("Attachment removed.");
      await load();
      onChange && onChange();
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete attachment.");
    }
  };

  // Extract a download URL & display name from a variety of API shapes
  const getFileUrl = (it) => {
    // common flat fields
    const direct = it.file_url || it.url || it.download_url || it.file_path || it.path;
    if (direct && typeof direct === "string") return direct;

    // nested object like {file: {url: "...", name: "..."}} or string
    if (it.file) {
      if (typeof it.file === "string") return it.file;
      if (typeof it.file === "object" && (it.file.url || it.file.download_url)) {
        return it.file.url || it.file.download_url;
      }
    }
    return "";
  };

  const getFileName = (it) => {
    const explicit =
      it.filename || it.file_name || it.original_name || it.original_filename || it.name;
    if (explicit) return String(explicit);
    // nested file object name
    if (it.file && typeof it.file === "object" && (it.file.name || it.file.filename)) {
      return String(it.file.name || it.file.filename);
    }
    // last fallback: title (not ideal, but better than blank)
    return it.title || "file";
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">
        Attachments & Addenda
        <span className="ml-2 text-gray-400">
          {loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Manufacturer Warranty PDF"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          <span>Visible to Homeowner</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ackReq} onChange={(e) => setAckReq(e.target.checked)} />
          <span>Acknowledgement Required</span>
        </label>
      </div>
      <div className="text-xs text-gray-500 -mt-2">
        “Visible to Homeowner” means the homeowner can see and download this file in their portal. If unchecked, the
        file is private to the contractor.
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="border rounded p-4 text-center text-sm"
        style={{ minHeight: 120 }}
      >
        <div>Drag &amp; drop a file here</div>
        <div className="my-2">or</div>
        {/* BLUE "Choose File" */}
        <label className="cursor-pointer inline-block" title="Choose a file to upload">
          <span className="px-3 py-2 rounded bg-blue-600 text-white inline-block">Choose File</span>
          <input type="file" className="hidden" onChange={pickFile} />
        </label>
        <div className="mt-2 text-gray-600">{file ? file.name : "No file chosen"}</div>
      </div>

      {lastError ? <div className="text-xs text-rose-600">{lastError}</div> : null}

      <div className="flex gap-2">
        {/* BLUE buttons */}
        <button className="px-4 py-2 rounded bg-blue-600 text-white" disabled={uploading} onClick={upload}>
          {uploading ? "Uploading…" : "Upload Attachment"}
        </button>
        <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Visible</th>
              <th className="text-left px-3 py-2">Ack Required</th>
              <th className="text-left px-3 py-2">File</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td className="px-3 py-3" colSpan={6}>None yet.</td></tr>
            ) : (
              items.map((it) => {
                const url = getFileUrl(it);
                const name = getFileName(it);
                return (
                  <tr key={it.id}>
                    <td className="px-3 py-2">{it.title}</td>
                    <td className="px-3 py-2">{it.category}</td>
                    <td className="px-3 py-2">{String(it.visible)}</td>
                    <td className="px-3 py-2">{String(it.ack_required ?? it.acknowledgement_required ?? false)}</td>
                    <td className="px-3 py-2">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                          title="Open file in new tab"
                        >
                          {name}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {/* RED delete */}
                      <button
                        className="px-2 py-1 rounded bg-rose-600 text-white"
                        onClick={() => remove(it.id)}
                        title="Delete attachment"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
