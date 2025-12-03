// frontend/src/components/SignatureModal.jsx
// v2025-12-01-stable-pdf-fix
// Shared signature component for contractor + homeowner
// - Typed name field does NOT lose focus
// - SignaturePad works (mouse/finger)
// - Uses static/legal/*.txt for TOS & Privacy
// - Contractor -> /api/projects/agreements/:id/preview_pdf/
// - Homeowner  -> /api/projects/agreements/public_pdf/

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

const TOS_URL = "/static/legal/terms_of_service.txt";
const PRIVACY_URL = "/static/legal/privacy_policy.txt";

/**
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - agreement: { id, title, project_title, pdf_url? }
 * - signingRole: "contractor" | "homeowner"
 * - token?: string (required for homeowner/public)
 * - defaultName?: string
 * - onSigned?: (updatedAgreement) => void
 */
export default function SignatureModal({
  isOpen,
  onClose,
  agreement,
  signingRole,
  token = null,
  defaultName = "",
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

  const [submitting, setSubmitting] = useState(false);

  const [attachments, setAttachments] = useState([]);
  const [loadingAtts, setLoadingAtts] = useState(false);

  const nameInputRef = useRef(null);

  const roleLabel = signingRole === "contractor" ? "Contractor" : "Homeowner";

  // 🔹 IMPORTANT: point to API endpoints, not front-end routes
  const pdfUrl = (() => {
    if (!agreement) return null;
    if (agreement.pdf_url) return agreement.pdf_url;

    if (signingRole === "homeowner" && token) {
      // public PDF via token — API endpoint
      return `/api/projects/agreements/public_pdf/?token=${encodeURIComponent(
        token
      )}&stream=1`;
    }
    if (agreement.id) {
      // authenticated preview PDF — API endpoint
      return `/api/projects/agreements/${agreement.id}/preview_pdf/?stream=1`;
    }
    return null;
  })();

  // Load attachments once when modal opens (non-blocking)
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

  // Init state + SignaturePad when modal opens
  useEffect(() => {
    if (!isOpen) {
      // cleanup when closed
      if (sigPadRef.current) {
        sigPadRef.current.off();
        sigPadRef.current = null;
      }
      return;
    }

    // reset form state
    setTypedName(defaultName || "");
    setConsentEsign(false);
    setAcceptTos(false);
    setAcceptPrivacy(false);
    setSigFile(null);
    setSigPreview(null);
    setHasDrawn(false);
    setSubmitting(false);

    // init signature pad a tiny bit after open so canvas is in DOM
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
        if (!pad.isEmpty()) {
          setHasDrawn(true);
        }
      };

      sigPadRef.current = pad;
    }, 150);

    // focus the input once after opening (not on every render)
    const focusTimer = setTimeout(() => {
      if (nameInputRef.current) {
        nameInputRef.current.focus();
      }
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
    if (sigPadRef.current) {
      sigPadRef.current.clear();
    }
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

        {/* Body: PDF left, form right */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr] min-h-[60vh]"
        >
          {/* PDF preview */}
          <div className="bg-slate-950 border-b md:border-b-0 md:border-r border-white/10">
            <div className="w-full h-full">
              {pdfUrl ? (
                <iframe
                  title="Agreement PDF"
                  src={pdfUrl}
                  className="w-full h-full border-none"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-slate-300">
                  PDF preview not available.
                </div>
              )}
            </div>
          </div>

          {/* Sign panel */}
          <div className="bg-slate-950 overflow-y-auto px-5 py-4 space-y-4">
            {/* Attachments summary */}
            <section className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
              <div className="text-xs font-semibold mb-1">
                Attachments &amp; Addenda
              </div>
              {loadingAtts ? (
                <div className="text-xs text-slate-300">Loading…</div>
              ) : attachments.length === 0 ? (
                <div className="text-xs text-slate-300">None.</div>
              ) : (
                <ul className="text-xs text-slate-200 list-disc pl-4 space-y-1">
                  {attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={a.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-300 hover:underline"
                      >
                        {a.title || a.file_name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* E-SIGN */}
            <section className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
              <div className="text-xs font-semibold mb-1">
                Electronic Records &amp; Signatures (E-SIGN)
              </div>
              <p className="text-[11px] text-slate-300 mb-2">
                By checking the box below and clicking{" "}
                <b>Sign Agreement</b>, you consent to use electronic records and
                signatures. Your typed name has the same legal effect as a
                handwritten signature.
              </p>
              <label className="flex items-start gap-2 text-xs text-slate-100">
                <input
                  type="checkbox"
                  className="mt-[2px]"
                  checked={consentEsign}
                  onChange={(e) => setConsentEsign(e.target.checked)}
                />
                <span>I consent to use electronic records and signatures.</span>
              </label>
            </section>

            {/* Terms & Privacy */}
            <section className="rounded-xl border border-white/10 bg-slate-900/80 p-3 space-y-2">
              <label className="flex items-start gap-2 text-xs text-slate-100">
                <input
                  type="checkbox"
                  className="mt-[2px]"
                  checked={acceptTos}
                  onChange={(e) => setAcceptTos(e.target.checked)}
                />
                <span>
                  I have reviewed and agree to the{" "}
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
              <label className="flex items-start gap-2 text-xs text-slate-100">
                <input
                  type="checkbox"
                  className="mt-[2px]"
                  checked={acceptPrivacy}
                  onChange={(e) => setAcceptPrivacy(e.target.checked)}
                />
                <span>
                  I have reviewed and agree to the{" "}
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
            </section>

            {/* Role label */}
            <section className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
              <div className="text-xs font-semibold mb-1">I am signing as</div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-xs">
                <span className="font-semibold text-sky-100">
                  {roleLabel}
                </span>
                <span className="text-slate-300 text-[11px]">
                  (Role is fixed to prevent accidental mis-signing.)
                </span>
              </div>
            </section>

            {/* Typed name + signature inputs */}
            <section className="rounded-xl border border-white/10 bg-slate-900/80 p-3 space-y-4">
              <div>
                <div className="text-xs font-semibold mb-1">
                  Type your full name (electronic signature)
                </div>
                <input
                  ref={nameInputRef}
                  type="text"
                  className="w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="Full legal name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  autoComplete="off"
                />
                <div className="mt-1 text-[11px] text-slate-400">
                  Your IP address and timestamp will be recorded.
                </div>
              </div>

              {/* Finger/mouse signature */}
              <div>
                <div className="text-xs font-semibold mb-1">
                  Optional: Sign with your finger or mouse
                </div>
                <div className="border border-dashed border-white/25 rounded-lg bg-slate-950 p-2 max-w-xs">
                  <canvas
                    ref={canvasRef}
                    width={420}
                    height={160}
                    className="w-full h-auto bg-white rounded-md"
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                  <span>
                    Use your finger (mobile) or mouse (desktop) to draw your
                    signature.
                  </span>
                  <button
                    type="button"
                    onClick={clearDrawnSignature}
                    className="text-sky-300 underline"
                  >
                    Clear
                  </button>
                  {hasDrawn && (
                    <span className="text-emerald-300">
                      Signature captured
                    </span>
                  )}
                </div>
              </div>

              {/* Upload image */}
              <div>
                <div className="text-xs font-semibold mb-1">
                  Optional: Upload handwritten (wet) signature
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="text-[11px]"
                />
                {sigPreview && (
                  <div className="mt-2 border border-dashed border-white/25 rounded-lg bg-slate-950 p-2 max-w-xs">
                    <img
                      src={sigPreview}
                      alt="Signature preview"
                      className="w-full h-auto bg-white rounded-md"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Footer buttons */}
            <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-400 max-w-xs">
                By clicking <b>Sign Agreement</b>, you agree that your
                electronic signature has the same legal effect as a handwritten
                signature.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-md border border-white/20 text-xs text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold ${
                    canSubmit
                      ? "bg-sky-500 hover:bg-sky-400 text-slate-950"
                      : "bg-slate-600 text-slate-300 cursor-not-allowed"
                  }`}
                >
                  {submitting ? "Saving…" : "Sign Agreement"}
                </button>
              </div>
            </section>
          </div>
        </form>
      </div>
    </Overlay>
  );
}
