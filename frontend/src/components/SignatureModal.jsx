// frontend/src/components/SignatureModal.jsx
// v2025-12-10 — Shared signature modal for contractor + homeowner
// - Typed name field does NOT lose focus
// - SignaturePad supports mouse + touch drawing
// - Uses /legal/* HTML pages for TOS & Privacy
// - Contractor PDF preview is fetched via axios (JWT) as a blob & shown in iframe
// - Homeowner/public PDF preview uses token-based public endpoint

import React, { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import toast from "react-hot-toast";
import api from "../api";

// Simple full-screen overlay modal (no external modal lib)
function Overlay({ children, onClose, disableClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="absolute inset-0"
        onClick={disableClose ? undefined : onClose}
      />
      <div className="relative max-h-[95vh] w-[98vw] max-w-5xl rounded-2xl border border-white/15 bg-slate-950 text-slate-50 shadow-2xl overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// Legal links now point to Django /legal/* routes
const TOS_URL = "/legal/terms-of-service/";
const PRIVACY_URL = "/legal/privacy-policy/";

/**
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - agreement: { id, title, project_title, pdf_url? }
 * - signingRole: "contractor" | "homeowner"
 * - token?: string (required for homeowner/public)
 * - defaultName?: string
 * - compact?: boolean (optional UI tweak)
 * - onSigned?: (updatedAgreement) => void
 */
export default function SignatureModal({
  isOpen,
  onClose,
  agreement,
  signingRole,
  token = null,
  defaultName = "",
  compact = false,
  onSigned,
}) {
  const [typedName, setTypedName] = useState(defaultName || "");
  const [consentEsign, setConsentEsign] = useState(false);
  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);

  const [sigFile, setSigFile] = useState(null);
  const [sigPreview, setSigPreview] = useState(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const canvasRef = useRef(null);
  const sigPadRef = useRef(null);
  const nameInputRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);

  const [attachments, setAttachments] = useState([]);
  const [loadingAtts, setLoadingAtts] = useState(false);

  const [pdfUrl, setPdfUrl] = useState(null); // blob URL for iframe
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const roleLabel = signingRole === "contractor" ? "Contractor" : "Homeowner";

  // Load attachments (non-blocking)
  useEffect(() => {
    const loadAttachments = async () => {
      if (!agreement?.id) return;
      try {
        setLoadingAtts(true);
        const { data } = await api.get(
          `/projects/agreements/${agreement.id}/attachments/`
        );
        setAttachments(Array.isArray(data) ? data : []);
      } catch {
        // not fatal
      } finally {
        setLoadingAtts(false);
      }
    };

    if (isOpen) {
      loadAttachments();
    } else {
      setAttachments([]);
    }
  }, [isOpen, agreement?.id]);

  // Fetch PDF preview as blob when modal opens
  useEffect(() => {
    let objectUrl = null;

    const fetchPdf = async () => {
      if (!isOpen) return;
      if (!agreement?.id) return;

      setPdfLoading(true);
      setPdfError("");
      setPdfUrl(null);

      try {
        let url;
        let config = {
          params: { stream: 1 },
          responseType: "blob",
        };

        if (signingRole === "homeowner" && token) {
          // homeowner/public signing — use token-based endpoint
          url = `/projects/agreements/public_pdf/`;
          config = {
            params: { token, stream: 1 },
            responseType: "blob",
          };
        } else {
          // contractor (authenticated) preview endpoint
          url = `/projects/agreements/${agreement.id}/preview_pdf/`;
        }

        const resp = await api.get(url, config);
        const blob = new Blob([resp.data], { type: "application/pdf" });
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      } catch (err) {
        console.error("SignatureModal PDF preview error:", err);
        const status = err?.response?.status;
        if (status === 401) {
          setPdfError(
            "Unable to load PDF preview (authentication required). Please sign in again."
          );
        } else {
          setPdfError("Unable to load PDF preview.");
        }
      } finally {
        setPdfLoading(false);
      }
    };

    fetchPdf();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isOpen, agreement?.id, signingRole, token]);

  // Initialize/reset signature state when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      if (sigPadRef.current) {
        sigPadRef.current.off();
        sigPadRef.current = null;
      }
      return;
    }

    setTypedName(defaultName || "");
    setConsentEsign(false);
    setAcceptTos(false);
    setAcceptPrivacy(false);
    setSigFile(null);
    setSigPreview(null);
    setHasDrawn(false);
    setSubmitting(false);

    const timer = setTimeout(() => {
      if (!canvasRef.current) return;

      if (sigPadRef.current) {
        sigPadRef.current.off();
        sigPadRef.current = null;
      }

      const pad = new SignaturePad(canvasRef.current, {
        penColor: "black",
        backgroundColor: "rgba(255,255,255,1)",
        minWidth: 1.5,
        maxWidth: 2.5,
      });

      pad.onEnd = () => {
        if (!pad.isEmpty()) setHasDrawn(true);
      };

      sigPadRef.current = pad;
    }, 150);

    const focusTimer = setTimeout(() => {
      if (nameInputRef.current) nameInputRef.current.focus();
    }, 250);

    return () => {
      clearTimeout(timer);
      clearTimeout(focusTimer);
    };
  }, [isOpen, agreement?.id, defaultName]);

  if (!isOpen || !agreement) return null;

  const requireLegalChecks = true;

  const canSubmit =
    typedName.trim().length > 1 &&
    (!requireLegalChecks ||
      (consentEsign && acceptTos && acceptPrivacy)) &&
    !submitting;

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) {
      setSigFile(null);
      setSigPreview(null);
      return;
    }
    if (!f.type.startsWith("image/")) {
      toast.error("Please upload an image (PNG/JPG).");
      return;
    }
    setSigFile(f);
    setSigPreview(URL.createObjectURL(f));
  };

  const clearDrawnSignature = () => {
    if (sigPadRef.current) sigPadRef.current.clear();
    setHasDrawn(false);
  };

  const getDrawnDataUrl = () => {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) return null;
    return sigPadRef.current.toDataURL("image/png");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (!agreement?.id) {
      toast.error("Agreement is missing.");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("typed_name", typedName.trim());
      fd.append("consent_esign", consentEsign ? "true" : "false");
      fd.append("consent_tos", acceptTos ? "true" : "false");
      fd.append("consent_privacy", acceptPrivacy ? "true" : "false");

      const drawn = getDrawnDataUrl();
      if (drawn) {
        fd.append("signature_data_url", drawn);
      } else if (sigFile) {
        fd.append("signature", sigFile);
      }

      let url;

      if (signingRole === "contractor") {
        url = `/projects/agreements/${agreement.id}/contractor_sign/`;
      } else if (signingRole === "homeowner") {
        if (!token) {
          toast.error("Missing signing token.");
          setSubmitting(false);
          return;
        }
        url = `/projects/agreements/public_sign/`;
        fd.append("token", token);
      } else {
        toast.error("Unsupported signing role.");
        setSubmitting(false);
        return;
      }

      const { data } = await api.post(url, fd);
      toast.success("Signature captured.");
      if (onSigned) onSigned(data);
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
      const msg =
        err?.response?.data?.detail ||
        "Unable to save your signature right now.";
      toast.error(msg);
      setSubmitting(false);
    }
  };

  const layoutClass = compact ? "md:grid-cols-[1.2fr_1fr]" : "md:grid-cols-2";

  return (
    <Overlay onClose={onClose} disableClose={submitting}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-slate-900/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600" />
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">
                {roleLabel} Signature
              </div>
              <div className="text-sm font-semibold truncate max-w-xs">
                {agreement.title ||
                  agreement.project_title ||
                  `Agreement #${agreement.id}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={TOS_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex text-[11px] px-3 py-1.5 rounded-full border border-white/15 text-sky-200 hover:bg-slate-800"
            >
              Terms of Service
            </a>
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex text-[11px] px-3 py-1.5 rounded-full border border-white/15 text-sky-200 hover:bg-slate-800"
            >
              Privacy Policy
            </a>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-white/20 text-slate-300 hover:bg-slate-800 text-sm"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className={`flex-1 grid grid-cols-1 ${layoutClass} gap-0 md:gap-4`}
        >
          {/* Left: PDF preview + attachments */}
          <div className="border-b md:border-b-0 md:border-r border-white/10 bg-slate-950/80">
            <div className="px-4 py-2 flex items-center justify-between border-b border-white/10">
              <div className="text-xs font-semibold text-slate-200">
                Agreement Preview (Read Before Signing)
              </div>
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-sky-300 hover:text-sky-200"
                >
                  Open PDF in new tab
                </a>
              )}
            </div>
            <div className="h-[260px] sm:h-[320px] md:h-full bg-black/40">
              {pdfLoading ? (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-300">
                  Loading PDF preview…
                </div>
              ) : pdfError ? (
                <div className="w-full h-full flex items-center justify-center text-xs text-red-300 px-4 text-center">
                  {pdfError}
                </div>
              ) : pdfUrl ? (
                <iframe
                  title="Agreement PDF Preview"
                  src={pdfUrl}
                  className="w-full h-full border-0"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                  PDF preview is not available for this Agreement.
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-white/10 text-[11px] text-slate-300">
              <div className="font-semibold mb-1">Attachments</div>
              {loadingAtts ? (
                <div>Loading attachments…</div>
              ) : attachments?.length ? (
                <ul className="space-y-1">
                  {attachments.map((a) => {
                    const url =
                      a.file ||
                      a.url ||
                      a.file_url ||
                      a.download_url ||
                      a.download ||
                      a.absolute_url ||
                      null;
                    return (
                      <li key={a.id || a.title || a.filename}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-300 hover:text-sky-200"
                          >
                            {a.title || a.filename || "Attachment"}
                          </a>
                        ) : (
                          <span className="text-slate-400">
                            {a.title || a.filename || "Attachment"}
                          </span>
                        )}
                        {a.category ? (
                          <span className="ml-2 text-slate-500">
                            ({String(a.category).toUpperCase()})
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-slate-500">No attachments added.</div>
              )}
            </div>
          </div>

          {/* Right: Typed name + signature controls */}
          <div className="bg-slate-950/90 flex flex-col">
            <form
              onSubmit={handleSubmit}
              className="flex-1 flex flex-col px-4 py-3 gap-3"
            >
              <div>
                <label className="text-[11px] font-semibold text-slate-200">
                  Type Your Full Legal Name
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-white/15 bg-slate-900/80 px-2.5 py-1.5 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  placeholder="e.g., Jane Contractor"
                  autoComplete="off"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] font-semibold text-slate-200">
                      Draw Signature
                    </div>
                    <button
                      type="button"
                      onClick={clearDrawnSignature}
                      className="text-[11px] text-sky-300 hover:text-sky-200"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="rounded-md border border-white/20 bg-white">
                    <canvas
                      ref={canvasRef}
                      className="w-full h-32 sm:h-40"
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Use your mouse or finger to sign.
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-200 mb-1">
                    Or Upload Signature Image
                  </div>
                  <label className="inline-flex items-center text-[11px] text-sky-300 hover:text-sky-200 cursor-pointer mb-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <span>Choose image (PNG/JPG)</span>
                  </label>
                  {sigPreview ? (
                    <div className="mt-1 rounded-md border border-white/20 bg-slate-900/80 p-1">
                      <img
                        src={sigPreview}
                        alt="Uploaded signature preview"
                        className="max-h-24 object-contain mx-auto"
                      />
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-500">
                      No image uploaded. If you prefer, just draw your signature
                      on the left.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-1 space-y-1.5 text-[11px] text-slate-200">
                <label className="inline-flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={consentEsign}
                    onChange={(e) => setConsentEsign(e.target.checked)}
                    className="mt-[2px]"
                  />
                  <span>
                    I consent to sign this Agreement electronically and
                    understand that my electronic signature is legally binding.
                  </span>
                </label>
                <label className="inline-flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={acceptTos}
                    onChange={(e) => setAcceptTos(e.target.checked)}
                    className="mt-[2px]"
                  />
                  <span>
                    I have read and agree to the MyHomeBro{" "}
                    <a
                      href={TOS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 underline"
                    >
                      Terms of Service
                    </a>
                    .
                  </span>
                </label>
                <label className="inline-flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={acceptPrivacy}
                    onChange={(e) => setAcceptPrivacy(e.target.checked)}
                    className="mt-[2px]"
                  />
                  <span>
                    I have read and agree to the MyHomeBro{" "}
                    <a
                      href={PRIVACY_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 underline"
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded-md border border-white/20 text-[13px] text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`px-4 py-1.5 rounded-md text-[13px] font-semibold ${
                    canSubmit
                      ? "bg-sky-500 hover:bg-sky-400 text-slate-900"
                      : "bg-slate-700 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  {submitting ? "Saving…" : `Sign as ${roleLabel}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
