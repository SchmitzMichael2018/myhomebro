import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function AttachmentSection({ agreementId, onChange }) {
  // form state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("WARRANTY");
  const [visible, setVisible] = useState(true);
  const [ackReq, setAckReq] = useState(false);
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // io state
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  const fileInputRef = useRef(null);

  const categories = useMemo(
    () => ["WARRANTY", "ADDENDUM", "EXHIBIT", "PHOTO", "SPEC", "OTHER"],
    []
  );

  const fmtDateTime = (v) => {
    if (!v) return "—";
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
    } catch {
      return String(v);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      // Primary: nested agreement endpoint (returns the refreshed list on POST)
      const { data } = await api.get(
        `/projects/agreements/${agreementId}/attachments/`,
        { params: { _ts: Date.now() }, headers: { "Cache-Control": "no-cache" } }
      );
      setItems(Array.isArray(data) ? data : data?.results || []);
    } catch (err) {
      try {
        // Fallback: flat collection with filter param
        const { data } = await api.get(`/projects/attachments/`, {
          params: { agreement: agreementId, _ts: Date.now() },
          headers: { "Cache-Control": "no-cache" },
        });
        setItems(Array.isArray(data) ? data : data?.results || []);
      } catch (e2) {
        console.error(e2);
        toast.error("Failed to load attachments.");
      }
    } finally {
      setLoading(false);
      onChange && onChange();
    }
  };

  useEffect(() => {
    if (agreementId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId]);

  const resetForm = () => {
    setTitle("");
    setCategory("WARRANTY");
    setVisible(true);
    setAckReq(false);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onUpload = async (e) => {
    e.preventDefault();
    if (!file) return toast.error("Choose a file first.");
    setUploading(true);

    const form = new FormData();
    form.append("title", title || file.name);
    form.append("category", category);
    form.append("visible_to_homeowner", visible ? "true" : "false");
    form.append("ack_required", ackReq ? "true" : "false");
    form.append("file", file);

    try {
      const resp = await api.post(
        `/projects/agreements/${agreementId}/attachments/`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const list = Array.isArray(resp?.data) ? resp.data : [];
      if (list.length) setItems(list);
      else await load();
      toast.success("Attachment uploaded.");
      resetForm();
    } catch (err) {
      console.error(err);
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Upload failed.";
      toast.error(String(msg));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.delete(
        `/projects/agreements/${agreementId}/attachments/${id}/`
      );
      await load();
      toast.success("Attachment deleted.");
    } catch (err) {
      console.error(err);
      toast.error("Delete failed.");
    }
  };

  // drag & drop
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  // pill badge
  const Badge = ({ children, tone = "slate" }) => {
    const tones = {
      slate: "badge text-bg-secondary",
      blue: "badge text-bg-primary",
      green: "badge text-bg-success",
      amber: "badge text-bg-warning",
      violet: "badge text-bg-info",
      red: "badge text-bg-danger",
    };
    return <span className={tones[tone] || tones.slate}>{children}</span>;
  };

  return (
    <div className="card mb-6">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h3 className="card-title m-0">Attachments &amp; Addenda</h3>
        {!loading && (
          <span className="text-muted small">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="card-body">
        {/* Upload panel: two columns */}
        <form onSubmit={onUpload} className="mb-4">
          <div className="row g-3">
            {/* Left column - fields */}
            <div className="col-12 col-md-6">
              <div className="mb-2">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g., 12-Month Workmanship Warranty"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="row g-2">
                <div className="col-6">
                  <label className="form-label">Category</label>
                  <select
                    className="form-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-6 d-flex align-items-end gap-3">
                  <label className="form-check mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => setVisible(e.target.checked)}
                    />
                    <span className="form-check-label">Visible to Homeowner</span>
                  </label>
                  <label className="form-check mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={ackReq}
                      onChange={(e) => setAckReq(e.target.checked)}
                    />
                    <span className="form-check-label">Acknowledgement Required</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right column - drag & drop zone */}
            <div className="col-12 col-md-6">
              <label className="form-label">File</label>
              <div
                className={`p-4 border rounded text-center ${
                  dragOver ? "border-primary bg-light" : "border-secondary"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                {file ? (
                  <div>
                    <div className="fw-semibold">{file.name}</div>
                    <div className="text-muted small">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary mt-2"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="text-muted">
                    Drag &amp; drop a file here
                    <div className="my-2">or</div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose File
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="d-none"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="d-flex justify-content-end mt-3">
                <button className="btn btn-primary" type="submit" disabled={uploading}>
                  {uploading ? "Uploading…" : "Upload Attachment"}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* List */}
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted">None yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th style={{ width: "28%" }}>Title</th>
                  <th style={{ width: "12%" }}>Category</th>
                  <th style={{ width: "22%" }}>Flags</th>
                  <th style={{ width: "16%" }}>Uploaded</th>
                  <th style={{ width: "14%" }}>File</th>
                  <th className="text-end" style={{ width: "8%" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const catTone =
                    a.category === "WARRANTY"
                      ? "blue"
                      : a.category === "ADDENDUM"
                      ? "violet"
                      : a.category === "PHOTO"
                      ? "amber"
                      : a.category === "SPEC"
                      ? "slate"
                      : "slate";

                  const flags = [];
                  if (a.visible_to_homeowner) flags.push(<Badge key="v" tone="green">Visible</Badge>);
                  if (a.ack_required) flags.push(<Badge key="a" tone="amber">Acknowledgement Required</Badge>);
                  if (flags.length === 0) flags.push(<span key="none" className="text-muted small">—</span>);

                  const fileName = a.file_name || a.filename || (a.file_url ? "Open" : null);

                  return (
                    <tr key={a.id}>
                      <td className="text-truncate" title={a.title || ""}>
                        {a.title || <em>(untitled)</em>}
                      </td>
                      <td>
                        <Badge tone={catTone}>{(a.category || "").toLowerCase() || "other"}</Badge>
                      </td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">{flags}</div>
                      </td>
                      <td className="text-muted small">{fmtDateTime(a.uploaded_at)}</td>
                      <td>
                        {a.file_url ? (
                          <>
                            <a href={a.file_url} target="_blank" rel="noreferrer">
                              {fileName}
                            </a>
                            <a
                              className="ms-3"
                              href={a.file_url}
                              download={a.file_name || true}
                            >
                              Download
                            </a>
                          </>
                        ) : (
                          <span className="text-muted small">no file</span>
                        )}
                      </td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => onDelete(a.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
