import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function AttachmentSection({ agreementId, onChange }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("WARRANTY");
  const [visible, setVisible] = useState(true);
  const [ackReq, setAckReq] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  const categories = useMemo(() => ["WARRANTY", "ADDENDUM", "EXHIBIT", "OTHER"], []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/agreements/${agreementId}/attachments/`);
      setItems(Array.isArray(data) ? data : data?.results || []);
    } catch (err) {
      try {
        const { data } = await api.get(`/projects/attachments/`, { params: { agreement: agreementId } });
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
      const resp = await api.post(`/projects/agreements/${agreementId}/attachments/`, form);
      // Use refreshed list from server immediately
      const list = Array.isArray(resp?.data) ? resp.data : [];
      if (list.length) setItems(list); else await load();

      toast.success("Attachment uploaded.");
      setTitle(""); setCategory("WARRANTY"); setVisible(true); setAckReq(false); setFile(null);
    } catch (err) {
      console.error(err);
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.delete(`/projects/agreements/${agreementId}/attachments/${id}/`);
      await load();
      toast.success("Attachment deleted.");
    } catch (err) {
      console.error(err);
      toast.error("Delete failed.");
    }
  };

  return (
    <div className="card mb-6">
      <div className="card-header">
        <h3 className="card-title">Attachments &amp; Addenda</h3>
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <p className="text-muted">None yet.</p>
        ) : (
          <div className="table-responsive mb-4">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>File</th>
                  <th>Visible</th>
                  <th>Ack Req.</th>
                  <th>Uploaded</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title || <em>(untitled)</em>}</td>
                    <td>{a.category}</td>
                    <td>
                      {a.file_url ? (
                        <>
                          <a href={a.file_url} target="_blank" rel="noreferrer">
                            {a.file_name || "Open"}
                          </a>
                          <a className="ms-3" href={a.file_url} download={a.file_name || true}>
                            Download
                          </a>
                        </>
                      ) : (
                        <span className="text-muted">no file</span>
                      )}
                    </td>
                    <td>{a.visible_to_homeowner ? "Yes" : "No"}</td>
                    <td>{a.ack_required ? "Yes" : "No"}</td>
                    <td>{new Date(a.uploaded_at).toLocaleString()}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(a.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={onUpload}>
          <div className="row g-3 align-items-end">
            <div className="col-md-6">
              <label className="form-label">Title</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g., 12-Month Workmanship Warranty"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">Category</label>
              <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="col-md-12">
              <label className="form-label">File</label>
              <input className="form-control" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="col-md-12 d-flex gap-4 pt-2">
              <label className="form-check">
                <input className="form-check-input" type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
                <span className="form-check-label">Visible to Homeowner</span>
              </label>
              <label className="form-check">
                <input className="form-check-input" type="checkbox" checked={ackReq} onChange={(e) => setAckReq(e.target.checked)} />
                <span className="form-check-label">Acknowledgement Required</span>
              </label>
            </div>
            <div className="col-md-12 pt-2">
              <button className="btn btn-primary" type="submit" disabled={uploading}>
                {uploading ? "Uploading…" : "Upload Attachment"}
              </button>
            </div>
          </div>
        </form>

        {loading && <div className="mt-3 text-muted">Loading…</div>}
      </div>
    </div>
  );
}
