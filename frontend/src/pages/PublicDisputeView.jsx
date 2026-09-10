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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const photoInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  const addSelectedFiles = (selectedFiles) => {
    const incoming = Array.from(selectedFiles || []);
    setFiles((current) => [...current, ...incoming]);
  };

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraReady(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!cameraOpen || !cameraVideoRef.current || !cameraStreamRef.current) return;
    const video = cameraVideoRef.current;
    video.srcObject = cameraStreamRef.current;
    video.play().catch(() => {
      setCameraError("Tap the camera preview to start it, or use the device camera option below.");
    });
  }, [cameraOpen]);

  const openCamera = async () => {
    setCameraError("");
    setCameraReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setCameraError("Camera access was unavailable. Opening your device camera instead.");
      cameraInputRef.current?.click();
    }
  };

  const capturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("The camera is not ready yet. Wait for the picture to appear, then try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError("The photo could not be captured. Please use the device camera option.");
        return;
      }
      const file = new File([blob], `dispute-photo-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      addSelectedFiles([file]);
      stopCamera();
      toast.success("Photo captured. Review it below before sending.");
    }, "image/jpeg", 0.9);
  };

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
      fd.append("kind", "photo");
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
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      toast.success("Response sent to your contractor.");
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
            <h1
              data-testid="public-dispute-heading"
              className="text-3xl font-extrabold text-slate-900"
            >
              {header.num}
            </h1>
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

        {/* Customer response */}
        <div className="mt-6">
          <div className="text-lg font-extrabold text-slate-900">Respond to Your Contractor</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Add comments and photos in one response. Include an overview and close-up photos when your contractor asks for visual details.
          </p>
          <form onSubmit={postReply} className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
            <label htmlFor="customer-dispute-comment" className="text-sm font-extrabold text-slate-800">
              Comments
            </label>
            <textarea
              id="customer-dispute-comment"
              data-testid="public-dispute-reply-input"
              className="mt-2 min-h-[110px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              placeholder="Describe the issue, answer the contractor's questions, or explain what each photo shows…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={posting}
            />
            <div className="mt-4">
              <div className="text-sm font-extrabold text-slate-800">Photos</div>
              <div className="mt-1 text-xs text-slate-500">Take new photos or select multiple photos from your device.</div>
              <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openCamera}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-700"
                disabled={posting}
              >
                Take Photo
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                onChange={(e) => addSelectedFiles(e.target.files)}
                disabled={posting}
              />
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-100">
                Choose Photos
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => addSelectedFiles(e.target.files)}
                  disabled={posting}
                />
              </label>
              </div>
              {cameraError ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                  {cameraError}
                </div>
              ) : null}
              {files.length ? (
                <div className="mt-3 space-y-2" data-testid="public-dispute-selected-photos">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="min-w-0 truncate text-sm text-slate-700">{file.name}</span>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-extrabold text-rose-700"
                        onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                        disabled={posting}
                        aria-label={`Remove ${file.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                data-testid="public-dispute-send-button"
                type="submit"
                disabled={posting || (!reply.trim() && files.length === 0)}
                className="rounded-xl bg-emerald-600 px-5 py-2 font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {posting ? "Sending…" : "Send Response to Contractor"}
              </button>
            </div>

            {!token ? (
              <div className="mt-3 text-xs text-amber-700">
                Tip: If this page was opened from an email link, it should include a <b>?token=</b> parameter.
              </div>
            ) : null}
          </form>
        </div>

        {cameraOpen ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-3" role="dialog" aria-modal="true" aria-label="Take a dispute photo">
            <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
                <div>
                  <div className="font-extrabold">Take Photo</div>
                  <div className="text-xs text-slate-300">Center the problem area and wait for a clear picture.</div>
                </div>
                <button type="button" onClick={stopCamera} className="rounded-lg border border-white/30 px-3 py-2 text-sm font-bold">Close</button>
              </div>
              <div className="relative aspect-[3/4] bg-black sm:aspect-[4/3]">
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  muted
                  playsInline
                  onCanPlay={() => setCameraReady(true)}
                  onClick={(event) => event.currentTarget.play().catch(() => {})}
                  className="h-full w-full object-cover"
                />
                {!cameraReady ? (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm font-semibold text-white">Starting camera…</div>
                ) : null}
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-2">
                <button type="button" onClick={capturePhoto} disabled={!cameraReady} className="min-h-12 rounded-xl bg-emerald-500 px-4 font-extrabold text-slate-950 disabled:opacity-50">Capture Photo</button>
                <button type="button" onClick={() => { stopCamera(); window.setTimeout(() => cameraInputRef.current?.click(), 0); }} className="min-h-12 rounded-xl border border-white/30 px-4 font-extrabold text-white">Use Device Camera</button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 text-xs text-slate-500">
          This dispute thread is shared with your contractor and may be reviewed by a third-party mediator if escalated.
        </div>
      </div>
    </div>
  );
}
