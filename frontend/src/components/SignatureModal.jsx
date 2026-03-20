// frontend/src/components/SignatureModal.jsx
// v2026-03-01-sign-payload — FIX: send signature fields compatible with backend/projects/views/signing.py
// - Adds signer_name / signer_role / signature_text
// - Sends drawn dataURL as signature_image_base64 (data URL) for backend base64 decode
// - Sends uploaded file as signature_image (multipart)
// - Preserves legacy fields for existing endpoints (typed_name, consent_*, signature_data_url, signature)
// - onSigned now passes data.agreement when present (new backend), else passes raw data
//
// v2026-02-27-pdf-guard — detect non-PDF responses (HTML/JSON/redirect) before blob URL
// - responseType: "arraybuffer"
// - Validates Content-Type + PDF magic header "%PDF"
// - Extracts readable error text when server returns landing page HTML or JSON error
// - Keeps: mobile full-screen signer, larger default modal, upload below pad, existing sign endpoints

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import SignaturePad from "signature_pad";
import toast from "react-hot-toast";
import api from "../api";

const TOS_URL = "/legal/terms-of-service/";
const PRIVACY_URL = "/legal/privacy-policy/";

/* ---------- Overlay (larger by default) ---------- */
function Overlay({ children, onClose, disableClose, expanded }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="absolute inset-0" onClick={disableClose ? undefined : onClose} />
      <div
        className={[
          "relative rounded-2xl border border-white/15 bg-slate-950 text-slate-50 shadow-2xl overflow-hidden",
          expanded
            ? "w-[98vw] max-w-[1800px] h-[96vh]"
            : "w-[98vw] max-w-[1400px] h-[92vh] max-h-[92vh]",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- Fullscreen mobile signer ---------- */
function FullscreenSignOverlay({ open, title, onClose, children, disableClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-slate-950 text-slate-50">
      <div className="absolute inset-0" />
      <div className="relative h-full w-full flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 bg-slate-900/80 backdrop-blur flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-400">Signature</div>
            <div className="text-sm font-semibold truncate max-w-[75vw]">{title}</div>
          </div>
          <button
            type="button"
            onClick={disableClose ? undefined : onClose}
            disabled={disableClose}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/20 text-slate-200 hover:bg-slate-800 text-sm"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------- helpers: decode & detect ---------- */
function safeLower(s) {
  return (s || "").toString().toLowerCase();
}

function arrayBufferStartsWithPdfMagic(buf) {
  try {
    const u8 = new Uint8Array(buf);
    if (u8.length < 4) return false;
    // "%PDF"
    return u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
  } catch {
    return false;
  }
}

async function arrayBufferToText(buf) {
  try {
    const dec = new TextDecoder("utf-8", { fatal: false });
    return dec.decode(new Uint8Array(buf));
  } catch {
    try {
      let str = "";
      const u8 = new Uint8Array(buf);
      const n = Math.min(u8.length, 20000);
      for (let i = 0; i < n; i++) str += String.fromCharCode(u8[i]);
      return str;
    } catch {
      return "";
    }
  }
}

function extractJsonDetailMaybe(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object") {
      return obj.detail || obj.error || obj.message || null;
    }
  } catch {}
  return null;
}

function looksLikeLandingHtml(text) {
  const t = safeLower(text);
  return (
    t.includes("<!doctype html") ||
    t.includes("<html") ||
    t.includes('id="root"') ||
    t.includes("myhomebro") ||
    t.includes("landing")
  );
}

function dataUrlLooksValidPng(dataUrl) {
  const s = (dataUrl || "").toString();
  return s.startsWith("data:image/png;base64,") || s.startsWith("data:image/");
}

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
  const canvasWrapRef = useRef(null);
  const sigPadRef = useRef(null);

  const fsCanvasRef = useRef(null);
  const fsWrapRef = useRef(null);
  const fsPadRef = useRef(null);

  const nameInputRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);

  // responsive
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const isMobile = vw < 768;

  const [expanded, setExpanded] = useState(false);
  const [signFullscreen, setSignFullscreen] = useState(false);

  // PDF preview
  const [pdfUrl, setPdfUrl] = useState(null); // blob URL
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const roleLabel = signingRole === "contractor" ? "Contractor" : "Customer";
  const title =
    agreement?.title ||
    agreement?.project_title ||
    (agreement?.id ? `Agreement #${agreement.id}` : "Agreement");

  const serverPdfHref = useMemo(() => {
    if (!agreement?.id) return null;

    if (signingRole === "homeowner") {
      if (!token) return null;
      return `/api/projects/agreements/public_pdf/?token=${encodeURIComponent(token)}&stream=1`;
    }
    return `/api/projects/agreements/${agreement.id}/preview_pdf/?stream=1`;
  }, [agreement?.id, signingRole, token]);

  /* ---------- viewport watcher ---------- */
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  /* ---------- signature pad helpers ---------- */
  const destroyPad = useCallback((ref) => {
    const pad = ref?.current;
    if (pad) {
      try {
        pad.off();
      } catch {}
      ref.current = null;
    }
  }, []);

  const initPad = useCallback((padRef, canvasEl) => {
    if (!canvasEl) return null;
    const pad = new SignaturePad(canvasEl, {
      penColor: "black",
      backgroundColor: "rgba(255,255,255,1)",
      minWidth: 1.5,
      maxWidth: 2.5,
    });
    pad.onEnd = () => {
      try {
        if (!pad.isEmpty()) setHasDrawn(true);
      } catch {}
    };
    padRef.current = pad;
    return pad;
  }, []);

  const resizePad = useCallback((padRef, canvasEl, wrapEl) => {
    const pad = padRef.current;
    if (!pad || !canvasEl || !wrapEl) return;

    let data = null;
    try {
      if (!pad.isEmpty()) data = pad.toData();
    } catch {
      data = null;
    }

    const rect = wrapEl.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width));
    const cssH = Math.max(180, Math.floor(rect.height));

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.floor(cssW * dpr);
    canvasEl.height = Math.floor(cssH * dpr);
    canvasEl.style.width = `${cssW}px`;
    canvasEl.style.height = `${cssH}px`;

    const ctx = canvasEl.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    try {
      pad.clear();
      if (data && data.length) pad.fromData(data);
    } catch {}
  }, []);

  const clearAllPads = useCallback(() => {
    try {
      sigPadRef.current?.clear();
    } catch {}
    try {
      fsPadRef.current?.clear();
    } catch {}
    setHasDrawn(false);
  }, []);

  const getAnyDrawnDataUrl = useCallback(() => {
    const fs = fsPadRef.current;
    const main = sigPadRef.current;
    const pad = fs && !fs.isEmpty() ? fs : main;
    if (!pad || pad.isEmpty()) return null;
    try {
      return pad.toDataURL("image/png");
    } catch {
      return null;
    }
  }, []);

  /* ---------- PDF fetch (guarded) ---------- */
  const cleanupPdfBlob = useCallback(() => {
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    } catch {}
  }, [pdfUrl]);

  const fetchPdf = useCallback(async () => {
    if (!isOpen) return;
    if (!agreement?.id) return;

    cleanupPdfBlob();
    setPdfUrl(null);
    setPdfError("");
    setPdfLoading(true);

    try {
      const timeout = 120000;

      let url;
      let config = {
        params: { stream: 1, _ts: Date.now() },
        responseType: "arraybuffer",
        timeout,
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        validateStatus: (s) => s >= 200 && s < 500,
      };

      if (signingRole === "homeowner") {
        if (!token) throw new Error("Missing signing token.");
        url = `/projects/agreements/public_pdf/`;
        config = { ...config, params: { token, stream: 1, _ts: Date.now() } };
      } else {
        url = `/projects/agreements/${agreement.id}/preview_pdf/`;
      }

      const resp = await api.get(url, config);
      const statusCode = resp?.status;
      const contentType = safeLower(resp?.headers?.["content-type"] || "");
      const buf = resp?.data;

      if (!(statusCode >= 200 && statusCode < 300)) {
        const text = await arrayBufferToText(buf);
        const jsonDetail = extractJsonDetailMaybe(text);
        const msg =
          jsonDetail ||
          (looksLikeLandingHtml(text)
            ? "Server returned the app/landing HTML instead of a PDF (likely auth/redirect or routing)."
            : `Server returned status ${statusCode}.`);
        setPdfError(`Unable to load PDF preview. ${msg}`);
        return;
      }

      const isPdfByHeader = contentType.includes("application/pdf");
      const isPdfByMagic = arrayBufferStartsWithPdfMagic(buf);

      if (!isPdfByHeader || !isPdfByMagic) {
        const text = await arrayBufferToText(buf);
        const jsonDetail = extractJsonDetailMaybe(text);

        let msg = "";
        if (jsonDetail) {
          msg = `Server responded with JSON: ${jsonDetail}`;
        } else if (looksLikeLandingHtml(text)) {
          msg =
            "Server responded with HTML (landing/app page) instead of PDF. This usually means the request is being redirected or served by the SPA router (auth or URL mismatch).";
        } else {
          msg =
            "Server response was not a valid PDF (wrong Content-Type or missing %PDF header).";
        }

        setPdfError(`Unable to load PDF preview. ${msg}`);
        return;
      }

      const blob = new Blob([buf], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      setPdfUrl(objectUrl);
    } catch (err) {
      console.error("SignatureModal PDF preview error:", err);
      const status = err?.response?.status;

      if (status === 401) {
        setPdfError("Unable to load PDF preview (authentication required). Please sign in again.");
      } else if (err?.code === "ECONNABORTED") {
        setPdfError("PDF preview timed out. Use Retry, or open the server PDF link.");
      } else {
        setPdfError("Unable to load PDF preview.");
      }
    } finally {
      setPdfLoading(false);
    }
  }, [isOpen, agreement?.id, signingRole, token, cleanupPdfBlob]);

  /* ---------- init/reset on open ---------- */
  useEffect(() => {
    if (!isOpen) {
      destroyPad(sigPadRef);
      destroyPad(fsPadRef);
      cleanupPdfBlob();
      setPdfUrl(null);
      setPdfError("");
      setPdfLoading(false);
      return;
    }

    setTypedName(defaultName || "");
    setConsentEsign(false);
    setAcceptTos(false);
    setAcceptPrivacy(false);
    setSigFile(null);

    if (sigPreview) {
      try {
        URL.revokeObjectURL(sigPreview);
      } catch {}
    }
    setSigPreview(null);

    setHasDrawn(false);
    setSubmitting(false);
    setSignFullscreen(false);
    setExpanded(false);

    const t = setTimeout(() => {
      if (canvasRef.current) {
        destroyPad(sigPadRef);
        initPad(sigPadRef, canvasRef.current);
        if (canvasWrapRef.current) {
          resizePad(sigPadRef, canvasRef.current, canvasWrapRef.current);
        }
      }
    }, 120);

    const focusTimer = setTimeout(() => {
      if (nameInputRef.current) nameInputRef.current.focus();
    }, 220);

    fetchPdf();

    return () => {
      clearTimeout(t);
      clearTimeout(focusTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agreement?.id, defaultName]);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => {
      if (sigPadRef.current && canvasRef.current && canvasWrapRef.current) {
        resizePad(sigPadRef, canvasRef.current, canvasWrapRef.current);
      }
    }, 140);
  }, [expanded, isOpen, resizePad]);

  useEffect(() => {
    if (!signFullscreen) {
      destroyPad(fsPadRef);
      return;
    }

    const t = setTimeout(() => {
      if (!fsCanvasRef.current) return;

      destroyPad(fsPadRef);
      const fsPad = initPad(fsPadRef, fsCanvasRef.current);

      if (fsWrapRef.current) {
        resizePad(fsPadRef, fsCanvasRef.current, fsWrapRef.current);
      }

      try {
        const main = sigPadRef.current;
        if (main && !main.isEmpty()) {
          const data = main.toData();
          fsPad.clear();
          fsPad.fromData(data);
          setHasDrawn(true);
        }
      } catch {}
    }, 80);

    return () => clearTimeout(t);
  }, [signFullscreen, destroyPad, initPad, resizePad]);

  const closeFullscreenAndSync = useCallback(() => {
    try {
      const fs = fsPadRef.current;
      const main = sigPadRef.current;
      if (fs && main && !fs.isEmpty()) {
        const data = fs.toData();
        main.clear();
        main.fromData(data);
        setHasDrawn(true);
      }
    } catch {}
    setSignFullscreen(false);

    setTimeout(() => {
      if (sigPadRef.current && canvasRef.current && canvasWrapRef.current) {
        resizePad(sigPadRef, canvasRef.current, canvasWrapRef.current);
      }
    }, 120);
  }, [resizePad]);

  if (!isOpen || !agreement) return null;

  const requireLegalChecks = true;
  const canSubmit =
    typedName.trim().length > 1 &&
    (!requireLegalChecks || (consentEsign && acceptTos && acceptPrivacy)) &&
    !submitting;

  const downloadBlobPdf = () => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `agreement-${agreement?.id || "preview"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openBlobPdf = () => {
    if (!pdfUrl) return;
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  };

  const openServerPdf = () => {
    if (!serverPdfHref) {
      toast.error("Server PDF link unavailable.");
      return;
    }
    window.open(serverPdfHref, "_blank", "noopener,noreferrer");
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

      // ----- New backend signing fields (backend/projects/views/signing.py expects these) -----
      const signerRoleNormalized = signingRole === "homeowner" ? "homeowner" : "contractor";
      fd.append("signer_name", typedName.trim());
      fd.append("signer_role", signerRoleNormalized);

      // Keep signature_text (optional). Prefer typed name as signature text fallback
      fd.append("signature_text", typedName.trim());

      // If drawn, send base64 dataURL (backend now supports signature_image_base64 OR signature_image string)
      const drawn = getAnyDrawnDataUrl();
      if (drawn && dataUrlLooksValidPng(drawn)) {
        fd.append("signature_image_base64", drawn);
        // Also include legacy key in case any endpoint expects it
        fd.append("signature_data_url", drawn);
      }

      // If uploaded, send as multipart file under signature_image (new backend)
      if (sigFile) {
        fd.append("signature_image", sigFile);
        // Legacy key
        fd.append("signature", sigFile);
      }

      // ----- Legacy consent fields (kept for compatibility / audit note) -----
      fd.append("typed_name", typedName.trim());
      fd.append("consent_esign", consentEsign ? "true" : "false");
      fd.append("consent_tos", acceptTos ? "true" : "false");
      fd.append("consent_privacy", acceptPrivacy ? "true" : "false");

      // Decide endpoint (keep current app behavior)
      let url;

      if (signingRole === "contractor") {
        // Existing endpoint in your app
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

      // New backend returns { ok, version, agreement: {...} }
      const updatedAgreement = data?.agreement || data;

      toast.success("Signature captured.");
      if (onSigned) onSigned(updatedAgreement);
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
      const msg = err?.response?.data?.detail || "Unable to save your signature right now.";
      toast.error(msg);
      setSubmitting(false);
    }
  };

  const layoutClass = compact ? "md:grid-cols-[1.2fr_1fr]" : "md:grid-cols-2";
  const padHeightClass = expanded ? "h-[380px]" : "h-[320px]";

  return (
    <>
      <Overlay onClose={onClose} disableClose={submitting || signFullscreen} expanded={expanded}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-slate-900/80 backdrop-blur">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600" />
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  {roleLabel} Signature
                </div>
                <div className="text-sm font-semibold truncate max-w-[60vw]">{title}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                disabled={submitting || signFullscreen}
                className="hidden md:inline-flex text-[11px] px-3 py-1.5 rounded-full border border-white/15 text-slate-200 hover:bg-slate-800"
                title={expanded ? "Restore" : "Expand"}
              >
                {expanded ? "Restore" : "Expand"}
              </button>

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
                disabled={submitting || signFullscreen}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-white/20 text-slate-300 hover:bg-slate-800 text-sm"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto">
            <div className={`grid grid-cols-1 ${layoutClass} gap-0 md:gap-4 min-h-full`}>
              {/* LEFT: PDF preview */}
              <div className="order-2 md:order-1 border-t md:border-t-0 md:border-r border-white/10 bg-slate-950/80 min-w-0">
                <div className="px-4 py-2 flex items-center justify-between border-b border-white/10 min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">
                    Agreement Preview (Read Before Signing)
                  </div>

                  <div className="flex items-center gap-2">
                    {pdfUrl ? (
                      <>
                        <button
                          type="button"
                          onClick={openBlobPdf}
                          className="text-[11px] px-2 py-1 rounded border border-white/15 text-sky-200 hover:bg-slate-800 whitespace-nowrap"
                        >
                          Open PDF
                        </button>
                        <button
                          type="button"
                          onClick={downloadBlobPdf}
                          className="text-[11px] px-2 py-1 rounded border border-white/15 text-sky-200 hover:bg-slate-800 whitespace-nowrap"
                        >
                          Download
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={fetchPdf}
                          disabled={pdfLoading}
                          className={`text-[11px] px-2 py-1 rounded border border-white/15 whitespace-nowrap ${
                            pdfLoading
                              ? "text-slate-400 cursor-not-allowed"
                              : "text-sky-200 hover:bg-slate-800"
                          }`}
                        >
                          {pdfLoading ? "Loading…" : "Retry PDF"}
                        </button>
                        {serverPdfHref ? (
                          <button
                            type="button"
                            onClick={openServerPdf}
                            className="text-[11px] px-2 py-1 rounded border border-white/15 text-sky-200 hover:bg-slate-800 whitespace-nowrap"
                          >
                            Open Server PDF
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                <div className="h-[260px] sm:h-[320px] md:h-full bg-black/40 flex items-center justify-center">
                  {pdfLoading ? (
                    <div className="text-xs text-slate-300 px-4 text-center">
                      Loading PDF preview…
                      <div className="mt-1 text-[11px] text-slate-400">
                        (This can take up to ~2 minutes for large PDFs.)
                      </div>
                    </div>
                  ) : pdfError ? (
                    <div className="text-xs text-red-300 px-4 text-center">
                      {pdfError}
                      <div className="mt-2 text-[11px] text-slate-400">
                        Try “Retry PDF” or “Open Server PDF”.
                      </div>
                    </div>
                  ) : pdfUrl ? (
                    <iframe title="Agreement PDF Preview" src={pdfUrl} className="w-full h-full border-0" />
                  ) : (
                    <div className="text-xs text-slate-400 px-4 text-center">No preview loaded.</div>
                  )}
                </div>
              </div>

              {/* RIGHT: signing */}
              <div className="order-1 md:order-2 bg-slate-950/90 flex flex-col min-w-0">
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col px-4 py-3 gap-3 min-w-0">
                  {/* Mobile-only: big PDF open */}
                  {isMobile && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={pdfUrl ? openBlobPdf : openServerPdf}
                        disabled={!pdfUrl && !serverPdfHref}
                        className={`flex-1 px-4 py-3 rounded-xl text-[14px] font-semibold border ${
                          pdfUrl || serverPdfHref
                            ? "bg-sky-500 hover:bg-sky-400 text-slate-950 border-transparent"
                            : "bg-slate-800 text-slate-400 border-white/10 cursor-not-allowed"
                        }`}
                      >
                        Open Agreement PDF
                      </button>
                      <button
                        type="button"
                        onClick={fetchPdf}
                        disabled={pdfLoading}
                        className={`px-4 py-3 rounded-xl text-[14px] font-semibold border ${
                          pdfLoading
                            ? "bg-slate-800 text-slate-400 border-white/10 cursor-not-allowed"
                            : "bg-slate-900 text-slate-100 border-white/10 hover:bg-slate-800"
                        }`}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] font-semibold text-slate-200">
                      Type Your Full Legal Name
                    </label>
                    <input
                      ref={nameInputRef}
                      type="text"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-900/80 px-2.5 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
                      placeholder="e.g., Jane Contractor"
                      autoComplete="off"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] font-semibold text-slate-200">Draw Signature</div>
                      <button
                        type="button"
                        onClick={clearAllPads}
                        className="text-[11px] text-sky-300 hover:text-sky-200"
                      >
                        Clear
                      </button>
                    </div>

                    <div
                      ref={canvasWrapRef}
                      className={`rounded-md border border-white/20 bg-white w-full overflow-hidden ${padHeightClass}`}
                    >
                      <canvas ref={canvasRef} className="w-full h-full" />
                    </div>

                    <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Use your mouse or finger to sign.</span>
                      {hasDrawn ? <span className="text-emerald-300">✓ drawn</span> : null}
                    </div>

                    {isMobile && (
                      <button
                        type="button"
                        onClick={() => setSignFullscreen(true)}
                        className="mt-2 w-full px-3 py-2 rounded-md border border-white/20 text-[13px] text-slate-200 hover:bg-slate-800"
                      >
                        Open Full-Screen Signature Pad
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-white/10">
                    <div className="text-[11px] font-semibold text-slate-200 mb-1">
                      Or Upload Signature Image
                    </div>

                    <label className="inline-flex items-center text-[11px] text-sky-300 hover:text-sky-200 cursor-pointer mb-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) {
                            setSigFile(null);
                            if (sigPreview) {
                              try {
                                URL.revokeObjectURL(sigPreview);
                              } catch {}
                            }
                            setSigPreview(null);
                            return;
                          }
                          if (!f.type.startsWith("image/")) {
                            toast.error("Please upload an image (PNG/JPG).");
                            return;
                          }
                          setSigFile(f);
                          if (sigPreview) {
                            try {
                              URL.revokeObjectURL(sigPreview);
                            } catch {}
                          }
                          setSigPreview(URL.createObjectURL(f));
                        }}
                        className="hidden"
                      />
                      <span>Choose image (PNG/JPG)</span>
                    </label>

                    {sigPreview ? (
                      <div className="rounded-md border border-white/20 bg-slate-900/80 p-2">
                        <img
                          src={sigPreview}
                          alt="Uploaded signature preview"
                          className="max-h-44 object-contain mx-auto"
                        />
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">
                        No image uploaded. If you prefer, just draw your signature above.
                      </div>
                    )}
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
                        I consent to sign this Agreement electronically and understand that my electronic signature is legally binding.
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
                        <a href={TOS_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">
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
                        <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">
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
                      disabled={submitting || signFullscreen}
                      className="px-3 py-2 rounded-md border border-white/20 text-[13px] text-slate-200 hover:bg-slate-800"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className={`px-4 py-2 rounded-md text-[13px] font-semibold ${
                        canSubmit
                          ? "bg-sky-500 hover:bg-sky-400 text-slate-900"
                          : "bg-slate-700 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      {submitting ? `Saving…` : `Sign as ${roleLabel}`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </Overlay>

      <FullscreenSignOverlay
        open={signFullscreen}
        title={title}
        onClose={closeFullscreenAndSync}
        disableClose={submitting}
      >
        <div className="p-4">
          <div className="text-sm font-semibold text-slate-100 mb-2">Draw Your Signature</div>
          <div className="text-[12px] text-slate-400 mb-3">
            Use your finger. Tap <span className="text-slate-200 font-semibold">Done</span> when finished.
          </div>

          <div
            ref={fsWrapRef}
            className="rounded-xl border border-white/15 bg-white w-full"
            style={{ height: "48vh", maxHeight: 520 }}
          >
            <canvas ref={fsCanvasRef} className="w-full h-full" />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={clearAllPads}
              className="px-4 py-2 rounded-md border border-white/20 text-slate-200 hover:bg-slate-800"
            >
              Clear
            </button>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => {
                setTimeout(() => {
                  if (fsPadRef.current && fsCanvasRef.current && fsWrapRef.current) {
                    resizePad(fsPadRef, fsCanvasRef.current, fsWrapRef.current);
                  }
                  closeFullscreenAndSync();
                }, 40);
              }}
              className="px-5 py-2 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-900 font-semibold"
            >
              Done
            </button>
          </div>

          <div className="mt-3 text-[12px] text-slate-500">Tip: rotate landscape for more room.</div>
        </div>
      </FullscreenSignOverlay>
    </>
  );
}
