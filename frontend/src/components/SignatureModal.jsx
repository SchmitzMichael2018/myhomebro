// frontend/src/components/SignatureModal.jsx
// Clean signing modal without embedded PDF preview.

import React, { useCallback, useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import toast from "react-hot-toast";
import api from "../api";

const TOS_URL = "/legal/terms-of-service/";
const PRIVACY_URL = "/legal/privacy-policy/";

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

function FullscreenSignOverlay({ open, title, onClose, children, disableClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-slate-950 text-slate-50">
      <div className="absolute inset-0" />
      <div className="relative flex h-full w-full flex-col">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/80 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-400">Signature</div>
            <div className="max-w-[75vw] truncate text-sm font-semibold">{title}</div>
          </div>
          <button
            type="button"
            onClick={disableClose ? undefined : onClose}
            disabled={disableClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-sm text-slate-200 hover:bg-slate-800"
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
  agreementReviewed = false,
  onOpenAgreementPdf = null,
  onDownloadAgreementPdf = null,
  onSigned,
}) {
  const [typedName, setTypedName] = useState(defaultName || "");
  const [legalAcknowledged, setLegalAcknowledged] = useState(false);
  const [sigFile, setSigFile] = useState(null);
  const [sigPreview, setSigPreview] = useState(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [signFullscreen, setSignFullscreen] = useState(false);
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);

  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const sigPadRef = useRef(null);
  const fsCanvasRef = useRef(null);
  const fsWrapRef = useRef(null);
  const fsPadRef = useRef(null);
  const nameInputRef = useRef(null);

  const isMobile = vw < 768;
  const roleLabel = signingRole === "contractor" ? "Contractor" : "Customer";
  const title =
    agreement?.title ||
    agreement?.project_title ||
    (agreement?.id ? `Agreement #${agreement.id}` : "Agreement");

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

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

  useEffect(() => {
    if (!isOpen) {
      destroyPad(sigPadRef);
      destroyPad(fsPadRef);
      return;
    }

    setTypedName(defaultName || "");
    setLegalAcknowledged(false);
    setSigFile(null);
    if (sigPreview) {
      try {
        URL.revokeObjectURL(sigPreview);
      } catch {}
    }
    setSigPreview(null);
    setHasDrawn(false);
    setSubmitting(false);
    setExpanded(false);
    setSignFullscreen(false);

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

  const canSubmit =
    !!agreementReviewed &&
    typedName.trim().length > 1 &&
    legalAcknowledged &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      const signerRoleNormalized = signingRole === "homeowner" ? "homeowner" : "contractor";
      fd.append("signer_name", typedName.trim());
      fd.append("signer_role", signerRoleNormalized);
      fd.append("signature_text", typedName.trim());
      const drawn = getAnyDrawnDataUrl();
      if (drawn && dataUrlLooksValidPng(drawn)) {
        fd.append("signature_image_base64", drawn);
        fd.append("signature_data_url", drawn);
      }
      if (sigFile) {
        fd.append("signature_image", sigFile);
        fd.append("signature", sigFile);
      }
      fd.append("typed_name", typedName.trim());
      fd.append("consent_esign", legalAcknowledged ? "true" : "false");
      fd.append("consent_tos", legalAcknowledged ? "true" : "false");
      fd.append("consent_privacy", legalAcknowledged ? "true" : "false");

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
      const updatedAgreement = data?.agreement || data;
      toast.success("Signature captured.");
      if (typeof onSigned === "function") onSigned(updatedAgreement);
      if (typeof onClose === "function") onClose();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Unable to save your signature right now.");
      setSubmitting(false);
    }
  };

  const padHeightClass = expanded ? "h-[380px]" : "h-[320px]";

  return (
    <>
      <Overlay onClose={onClose} disableClose={submitting || signFullscreen} expanded={expanded}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/80 px-5 py-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600" />
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-400">{roleLabel} Signature</div>
                <div className="max-w-[60vw] truncate text-sm font-semibold">{title}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                disabled={submitting || signFullscreen}
                className="hidden rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800 md:inline-flex"
                title={expanded ? "Restore" : "Expand"}
              >
                {expanded ? "Restore" : "Expand"}
              </button>
              <a
                href={TOS_URL}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-sky-200 hover:bg-slate-800 sm:inline-flex"
              >
                Terms of Service
              </a>
              <a
                href={PRIVACY_URL}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-sky-200 hover:bg-slate-800 sm:inline-flex"
              >
                Privacy Policy
              </a>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || signFullscreen}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-sm text-slate-300 hover:bg-slate-800"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <form onSubmit={handleSubmit} className="flex h-full flex-col gap-4 bg-slate-950/90 px-4 py-4">
              <div className="rounded-xl border border-slate-200/20 bg-slate-900/70 px-4 py-3" data-testid="signature-modal-review-block">
                <div className="text-sm font-semibold text-slate-50">Review Agreement (Required)</div>
                <div className="mt-1 text-[11px] text-slate-300">
                  Open or download the agreement to review it before signing.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof onOpenAgreementPdf === "function") onOpenAgreementPdf();
                    }}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
                  >
                    Open PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof onDownloadAgreementPdf === "function") onDownloadAgreementPdf();
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Download PDF
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200/10 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-200">
                You must review the agreement before signing.
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-200">Type Your Full Legal Name</label>
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
                <div className="mb-1 flex items-center justify-between">
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
                  className={`w-full overflow-hidden rounded-md border border-white/20 bg-white ${padHeightClass}`}
                >
                  <canvas ref={canvasRef} className="h-full w-full" />
                </div>

                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Use your mouse or finger to sign.</span>
                  {hasDrawn ? <span className="text-emerald-300">✓ drawn</span> : null}
                </div>

                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setSignFullscreen(true)}
                    className="mt-2 w-full rounded-md border border-white/20 px-3 py-2 text-[13px] text-slate-200 hover:bg-slate-800"
                  >
                    Open Full-Screen Signature Pad
                  </button>
                ) : null}
              </div>

              <div className="border-t border-white/10 pt-2">
                <div className="mb-1 text-[11px] font-semibold text-slate-200">Or Upload Signature Image</div>

                <label className="mb-2 inline-flex cursor-pointer items-center text-[11px] text-sky-300 hover:text-sky-200">
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
                    <img src={sigPreview} alt="Uploaded signature preview" className="mx-auto max-h-44 object-contain" />
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    No image uploaded. If you prefer, just draw your signature above.
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-200">
                <input
                  data-testid="signature-modal-legal-ack-checkbox"
                  type="checkbox"
                  checked={legalAcknowledged}
                  onChange={(e) => setLegalAcknowledged(e.target.checked)}
                  className="mt-[2px]"
                />
                <span>
                  I consent to sign this Agreement electronically and confirm I have reviewed and agree to the{" "}
                  <a href={TOS_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                    Terms of Service
                  </a>
                  {" "}
                  and{" "}
                  <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting || signFullscreen}
                  className="rounded-md border border-white/20 px-3 py-2 text-[13px] text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`rounded-md px-4 py-2 text-[13px] font-semibold ${
                    canSubmit
                      ? "bg-sky-500 text-slate-900 hover:bg-sky-400"
                      : "cursor-not-allowed bg-slate-700 text-slate-400"
                  }`}
                >
                  {submitting ? "Saving…" : `Sign as ${roleLabel}`}
                </button>
              </div>
            </form>
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
          <div className="mb-2 text-sm font-semibold text-slate-100">Draw Your Signature</div>
          <div className="mb-3 text-[12px] text-slate-400">
            Use your finger. Tap <span className="font-semibold text-slate-200">Done</span> when finished.
          </div>

          <div
            ref={fsWrapRef}
            className="w-full rounded-xl border border-white/15 bg-white"
            style={{ height: "48vh", maxHeight: 520 }}
          >
            <canvas ref={fsCanvasRef} className="h-full w-full" />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={clearAllPads}
              className="rounded-md border border-white/20 px-4 py-2 text-slate-200 hover:bg-slate-800"
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
              className="rounded-md bg-sky-500 px-5 py-2 font-semibold text-slate-900 hover:bg-sky-400"
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
