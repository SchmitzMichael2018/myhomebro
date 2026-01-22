// src/pages/PublicDisputeView.jsx
// v2026-01-14a — public, token-based dispute thread view
//
// Expected backend endpoints (recommended; adjust later if your URLs differ):
// GET  /api/projects/disputes/public/:id/?token=XYZ
// POST /api/projects/disputes/public/:id/messages/?token=XYZ   (multipart optional)
// Optional: POST /api/projects/disputes/public/:id/accept/?token=XYZ
// Optional: POST /api/projects/disputes/public/:id/reject/?token=XYZ
//
// This page is intentionally defensive: it shows clear errors if endpoints are not live yet.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

function fmt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export default function PublicDisputeView() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dispute, setDispute] = useState(null);
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);

  const [reply, setReply] = useState("");
  const [files, setFiles] = useState([]);
  const [posting, setPosting] = useState(false);

  const apiGet = useCallback(async (path) => {
    const res = await fetch(path, { method: "GET" });
    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }, []);

  const apiPostForm = useCallback(async (path, formData) => {
    const res = await fetch(path, { method: "POST", body: formData });
    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }, []);

  const fetchDispute = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError("");

    try {
      // Recommended endpoint format
      const url = `/api/projects/disputes/public/${encodeURIComponent(id)}/${
        token ? `?token=${encodeURIComponent(token)}` : ""
      }`;

      const data = await apiGet(url);
      setDispute(data);

      const ms = Array.isArray(data?.messages) ? data.messages : data?.messages?.results || [];
      const at = Array.isArray(data?.attachments) ? data.attachments : data?.attachments?.results || [];

      setMessages(ms);
      setAttachments(at);
    } catch (e) {
      setError(e.message || "Unable to load dispute.");
    } finally {
      setLoading(false);
    }
  }, [apiGet, id, token]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  const header = useMemo(() => {
    const num = dispute?.dispute_number || `#${id}`;
    const status = dispute?.status || "—";
    const agreementNum = dispute?.agreement_number || dispute?.agreement || dispute?.agreement_id || "";
    const title = dispute?.agreement_title || dispute?.project_title || "";
    return { num, status, agreementNum, title };
  }, [dispute, id]);

  const postReply = async (e) => {
    e.preventDefault();
    if (!reply.trim() && files.length === 0) return;

    setPosting(true);
    try {
      const fd = new FormData();
      fd.append("body", reply || "");
      fd.append("message_type", "comment");
      files.forEach((f) => fd.append("files[]", f));

      const url = `/api/projects/disputes/public/${encodeURIComponent(id)}/messages/${
        token ? `?token=${encodeURIComponent(token)}` : ""
      }`;

      const data = await apiPostForm(url, fd);

      // Backend can return new message or full dispute. Handle both.
      if (Array.isArray(data?.messages)) {
        setMessages(data.messages);
      } else if (data?.id) {
        setMessages((prev) => [...prev, data]);
      } else {
        await fetchDispute();
      }

      setReply("");
      setFiles([]);
      toast.success("Message sent.");
    } catch (e2) {
      toast.error(e2.message || "Failed to send message.");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-600">Loading Dispute…</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
          <h1 className="text-2xl font-extrabold text-slate-900">Dispute</h1>
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
            <div className="font-extrabold">Could not load this dispute.</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-slate-900 px-5 py-2 font-extrabold text-white hover:bg-slate-800"
              onClick={() => navigate("/")}
            >
              Return Home
            </button>
            <button
              className="rounded-xl bg-slate-100 px-5 py-2 font-extrabold text-slate-900 hover:bg-slate-200"
              onClick={fetchDispute}
            >
              Retry
            </button>
          </div>

          <div className="mt-6 text-xs text-slate-500">
            If this was opened from an invoice dispute, your contractor can also view it inside their Dispute Center.
          </div>
        </div>
      </div>
    );
  }

  if (!dispute) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-500">Dispute</div>
            <h1 className="text-3xl font-extrabold text-slate-900">{header.num}</h1>
            <div className="mt-1 text-sm text-slate-600">
              Status: <b>{String(header.status).replaceAll("_", " ")}</b>
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Agreement: <b>{header.agreementNum ? `#${header.agreementNum}` : "—"}</b>
              {header.title ? <span> — <b>{header.title}</b></span> : null}
            </div>
          </div>

          <button
            className="mt-2 rounded-xl bg-slate-800 px-5 py-2 font-extrabold text-white hover:bg-slate-900 md:mt-0"
            onClick={() => navigate("/")}
          >
            Home
          </button>
        </div>

        {/* Summary */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-extrabold text-slate-800">Summary</div>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-bold text-slate-500">Reason</div>
              <div className="font-extrabold text-slate-900">{dispute.reason || dispute.reason_code || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500">Scope</div>
              <div className="font-extrabold text-slate-900">{dispute.scope_type || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500">Created</div>
              <div className="font-extrabold text-slate-900">{fmt(dispute.created_at)}</div>
            </div>
          </div>

          {dispute.description || dispute.narrative ? (
            <div className="mt-4">
              <div className="text-xs font-bold text-slate-500">Initial Description</div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                {dispute.description || dispute.narrative}
              </div>
            </div>
          ) : null}
        </div>

        {/* Attachments */}
        <div className="mt-6">
          <div className="text-sm font-extrabold text-slate-800">Attachments</div>
          {attachments.length === 0 ? (
            <div className="mt-2 text-sm text-slate-600">—</div>
          ) : (
            <div className="mt-3 space-y-2">
              {attachments.map((a, idx) => {
                const name = a?.name || a?.filename || `Attachment ${idx + 1}`;
                const url = a?.url || a?.file_url || a?.file || "";
                return (
                  <div
                    key={`${a?.id || idx}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{name}</div>
                      <div className="text-xs text-slate-500">Uploaded: {fmt(a?.created_at || a?.uploaded_at)}</div>
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
                      >
                        Open
                      </a>
                    ) : (
                      <div className="text-xs text-slate-400">No URL</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversation */}
        <div className="mt-6">
          <div className="text-sm font-extrabold text-slate-800">Conversation</div>
          {messages.length === 0 ? (
            <div className="mt-2 text-sm text-slate-600">No messages yet.</div>
          ) : (
            <div className="mt-3 space-y-3">
              {messages.map((m, idx) => {
                const mid = m?.id || idx;
                const role = m?.author_role || m?.role || "user";
                const when = fmt(m?.created_at);
                const body = m?.body || m?.message || "";
                const type = m?.message_type || "";
                return (
                  <div key={mid} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-extrabold capitalize text-slate-900">
                        {role}{" "}
                        {type ? <span className="text-xs font-bold text-slate-500">— {type}</span> : null}
                      </div>
                      <div className="text-xs text-slate-500">{when}</div>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{body}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reply */}
        <div className="mt-6">
          <div className="text-sm font-extrabold text-slate-800">Send a Message</div>
          <form onSubmit={postReply} className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
            <textarea
              className="min-h-[110px] w-full rounded border border-slate-200 bg-white px-3 py-2"
              placeholder="Add details, propose a resolution, or upload supporting evidence…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={posting}
            />
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  disabled={posting}
                />
                {files.length ? (
                  <div className="mt-1 text-xs text-slate-500">{files.length} file(s) selected</div>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={posting}
                className="rounded-xl bg-emerald-600 px-5 py-2 font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {posting ? "Sending…" : "Send"}
              </button>
            </div>

            {!token ? (
              <div className="mt-3 text-xs text-amber-700">
                Tip: If this page was opened from an email link, it should include a <b>?token=</b> parameter.
              </div>
            ) : null}
          </form>
        </div>

        <div className="mt-6 text-xs text-slate-500">
          This dispute thread is shared with your contractor and may be reviewed by a third-party mediator if escalated.
        </div>
      </div>
    </div>
  );
}
