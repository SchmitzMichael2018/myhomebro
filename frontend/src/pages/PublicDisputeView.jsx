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
  const [actionBusy, setActionBusy] = useState("");
  const [qualification, setQualification] = useState({});
  const [externalFile, setExternalFile] = useState(null);
  const [externalType, setExternalType] = useState("external_decision");
  const [externalTitle, setExternalTitle] = useState("");
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

  const apiJson = useCallback(async (path, method, body) => {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `Request failed: ${res.status}`);
    return data;
  }, []);

  const runAction = async (key, path, body, success, method = "POST") => {
    setActionBusy(key);
    try {
      const data = await apiJson(path, method, body);
      setDispute(data);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setAttachments(Array.isArray(data?.attachments) ? data.attachments : []);
      toast.success(success);
    } catch (err) {
      toast.error(err.message || "The action could not be saved.");
    } finally {
      setActionBusy("");
    }
  };

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

  const uploadExternalDocument = async () => {
    if (!externalFile) return;
    setActionBusy("external-document");
    try {
      const form = new FormData();
      form.append("file", externalFile);
      form.append("document_type", externalType);
      form.append("title", externalTitle || externalFile.name);
      const data = await apiPostForm(`/api/projects/disputes/public/${encodeURIComponent(id)}/external-documents/?token=${encodeURIComponent(token)}`, form);
      setDispute(data); setExternalFile(null); setExternalTitle("");
      toast.success("Outside documentation added to the case record.");
    } catch (err) { toast.error(err.message || "Could not upload the document."); }
    finally { setActionBusy(""); }
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

        {/* Qualification */}
        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-extrabold text-blue-950">Claim qualification</div>
              <div className="mt-1 text-sm text-blue-900">
                Status: <b>{String(dispute.qualification_status || "pending").replaceAll("_", " ")}</b>
                {dispute.qualification_due_at ? <> · Information due {fmt(dispute.qualification_due_at)}</> : null}
              </div>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-900">
              {dispute.payment_hold?.is_active ? "Selected payment temporarily held" : "No active platform payment hold"}
            </div>
          </div>
          {dispute.qualification_explanation ? <p className="mt-2 text-sm text-blue-900">{dispute.qualification_explanation}</p> : null}
          {Array.isArray(dispute.missing_information) && dispute.missing_information.length ? (
            <div className="mt-4 rounded-lg bg-white p-3">
              <div className="text-sm font-extrabold text-slate-900">Information still needed</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {dispute.missing_information.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
              </ul>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <textarea className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 md:col-span-2" rows={3} placeholder="Describe the specific problem so the contractor can understand and respond" value={qualification.description || ""} onChange={(e) => setQualification((v) => ({ ...v, description: e.target.value }))} />
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" placeholder="What result did the agreement require?" value={qualification.expected_result || ""} onChange={(e) => setQualification((v) => ({ ...v, expected_result: e.target.value }))} />
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" placeholder="What correction are you requesting?" value={qualification.requested_resolution || ""} onChange={(e) => setQualification((v) => ({ ...v, requested_resolution: e.target.value }))} />
                <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" value={qualification.contractor_notified ?? ""} onChange={(e) => setQualification((v) => ({ ...v, contractor_notified: e.target.value === "" ? null : e.target.value === "yes" }))}>
                  <option value="">Did you notify the contractor?</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" placeholder="If evidence is unavailable, explain why" value={qualification.evidence_unavailable_reason || ""} onChange={(e) => setQualification((v) => ({ ...v, evidence_unavailable_reason: e.target.value }))} />
              </div>
              <button type="button" disabled={actionBusy === "qualification"} onClick={() => runAction("qualification", `/api/projects/disputes/public/${encodeURIComponent(id)}/qualification/?token=${encodeURIComponent(token)}`, qualification, "Information saved and claim reassessed.", "PATCH")} className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60">Save qualification details</button>
            </div>
          ) : null}
        </div>

        {Array.isArray(dispute.claims) && dispute.claims.length ? (
          <div className="mt-6">
            <div className="text-sm font-extrabold text-slate-800">Claims being reviewed</div>
            <div className="mt-3 space-y-3">
              {dispute.claims.map((claim) => (
                <div key={claim.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <b className="text-slate-900">Claim {claim.sequence}</b>
                    <span className="font-bold text-slate-600">{String(claim.status || "pending").replaceAll("_", " ")} · {String(claim.evidence_status || "evidence pending").replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{claim.description}</p>
                  {claim.contractor_response ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><b>Contractor response:</b> {claim.contractor_response}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {Array.isArray(dispute.claims) && dispute.claims.some((claim) => claim.access_required && claim.customer_access_response == null) ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="font-extrabold text-amber-950">Site access requested</div>
            {dispute.claims.filter((claim) => claim.access_required && claim.customer_access_response == null).map((claim) => (
              <div key={claim.id} className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-800">
                <p>{claim.description}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => runAction(`access-${claim.id}`, `/api/projects/disputes/public/${id}/claims/${claim.id}/access/?token=${encodeURIComponent(token)}`, { access_permitted: true, notes: "Access permitted for inspection or correction." }, "Access decision saved.")} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white">Permit access</button>
                  <button type="button" onClick={() => runAction(`access-${claim.id}`, `/api/projects/disputes/public/${id}/claims/${claim.id}/access/?token=${encodeURIComponent(token)}`, { access_permitted: false, notes: "Access is not permitted at this time." }, "Access decision saved.")} className="rounded-lg bg-white px-3 py-2 font-bold text-rose-700 ring-1 ring-rose-300">Decline</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {Array.isArray(dispute.work_pause_requests) && dispute.work_pause_requests.some((pause) => pause.status === "requested") ? (
          <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="font-extrabold text-violet-950">Work-pause request</div>
            <p className="mt-1 text-sm text-violet-900">A work pause is separate from the selected payment hold.</p>
            {dispute.work_pause_requests.filter((pause) => pause.status === "requested").map((pause) => (
              <div key={pause.id} className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-800">
                <b>{String(pause.reason_type).replaceAll("_", " ")}</b>: {pause.explanation} {pause.scope ? `Scope: ${pause.scope}` : ""}
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => runAction(`pause-${pause.id}`, `/api/projects/disputes/public/${id}/work-pauses/${pause.id}/respond/?token=${encodeURIComponent(token)}`, { decision: "accept", reason: "Customer accepted the documented pause." }, "Work pause accepted.")} className="rounded-lg bg-violet-700 px-3 py-2 font-bold text-white">Accept pause</button>
                  <button type="button" onClick={() => runAction(`pause-${pause.id}`, `/api/projects/disputes/public/${id}/work-pauses/${pause.id}/respond/?token=${encodeURIComponent(token)}`, { decision: "decline", reason: "Customer declined the requested pause." }, "Work pause declined.")} className="rounded-lg bg-white px-3 py-2 font-bold text-slate-900 ring-1 ring-slate-300">Decline</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {Array.isArray(dispute.escrow_allocations) && dispute.escrow_allocations.some((allocation) => allocation.status === "awaiting_authorization" && !allocation.homeowner_authorized_at) ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="font-extrabold text-emerald-950">Proposed escrow allocation</div>
            {dispute.escrow_allocations.filter((allocation) => allocation.status === "awaiting_authorization" && !allocation.homeowner_authorized_at).map((allocation) => (
              <div key={allocation.id} className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-800">
                <div className="grid gap-2 sm:grid-cols-3"><span>Held: <b>${(allocation.source_amount_cents / 100).toFixed(2)}</b></span><span>Contractor: <b>${(allocation.contractor_amount_cents / 100).toFixed(2)}</b></span><span>Return to customer: <b>${(allocation.homeowner_amount_cents / 100).toFixed(2)}</b></span></div>
                <p className="mt-2">{allocation.explanation}</p>
                <p className="mt-2 text-xs text-slate-600">Authorization records your agreement to these exact amounts. It does not by itself move money.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => runAction(`allocation-${allocation.id}`, `/api/projects/disputes/public/${id}/escrow-allocations/${allocation.id}/authorize/?token=${encodeURIComponent(token)}`, { authorization: "authorize", attestation: true }, "Allocation authorized.")} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white">Authorize exact amounts</button>
                  <button type="button" onClick={() => runAction(`allocation-${allocation.id}`, `/api/projects/disputes/public/${id}/escrow-allocations/${allocation.id}/authorize/?token=${encodeURIComponent(token)}`, { authorization: "reject", attestation: true }, "Allocation rejected.")} className="rounded-lg bg-white px-3 py-2 font-bold text-rose-700 ring-1 ring-rose-300">Reject</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="font-extrabold text-slate-900">Outside documentation</div>
          <p className="mt-1 text-sm text-slate-600">If you arranged an inspection or other outside process, upload its written report or directive. MyHomeBro records the document but does not interpret its legal effect.</p>
          {Array.isArray(dispute.resolution_documents) && dispute.resolution_documents.length ? <div className="mt-3 space-y-2">{dispute.resolution_documents.map((doc) => <div key={doc.id} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm"><span>{doc.title}</span>{doc.file_url ? <a className="font-bold text-blue-700" href={doc.file_url} target="_blank" rel="noreferrer">Open</a> : null}</div>)}</div> : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select value={externalType} onChange={(e) => setExternalType(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"><option value="external_decision">Outside decision or order</option><option value="mutual_instructions">Mutual written instructions</option><option value="inspection_report">Inspection report</option><option value="other">Other record</option></select>
            <input value={externalTitle} onChange={(e) => setExternalTitle(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" placeholder="Document title" />
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setExternalFile(e.target.files?.[0] || null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
            <button type="button" disabled={!externalFile || actionBusy === "external-document"} onClick={uploadExternalDocument} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60">{actionBusy === "external-document" ? "Uploading…" : "Add to case record"}</button>
          </div>
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
          This record is shared with your contractor. MyHomeBro provides workflow and recordkeeping, not mediation or a legal decision. Any outside decision-maker is arranged by the parties and their written directive can be uploaded to the record.
        </div>
      </div>
    </div>
  );
}
