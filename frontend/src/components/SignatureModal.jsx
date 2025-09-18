// src/components/SignatureModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import Modal from "react-modal";
import toast from "react-hot-toast";
import api from "../api";

Modal.setAppElement("#root");

export default function SignatureModal({
  isOpen,
  onClose,
  agreement,
  signingRole,   // "contractor" | "homeowner" (LOCKED)
  onSigned,
}) {
  const [typedName, setTypedName] = useState("");
  const [consentEsign, setConsentEsign] = useState(true);
  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [ackAddenda, setAckAddenda] = useState(false);

  const [sigFile, setSigFile] = useState(null);
  const [sigPreview, setSigPreview] = useState(null);

  const [attachments, setAttachments] = useState([]);
  const [loadingAtts, setLoadingAtts] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("preview"); // preview | sign

  const pdfUrl = useMemo(() => {
    if (!agreement) return null;
    if (agreement.pdf_url) return agreement.pdf_url;
    return `/api/projects/agreements/${agreement.id}/pdf/preview/`;
  }, [agreement]);

  const TOS_PDF = "/static/legal/terms_of_service.pdf";
  const PRIVACY_PDF = "/static/legal/privacy_policy.pdf";

  const loadAttachments = async () => {
    if (!agreement?.id) return;
    try {
      setLoadingAtts(true);
      const { data } = await api.get(`/projects/agreements/${agreement.id}/attachments/`);
      setAttachments(Array.isArray(data) ? data : []);
    } catch {
      // non-fatal
    } finally {
      setLoadingAtts(false);
    }
  };

  useEffect(() => {
    if (isOpen) loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agreement?.id]);

  useEffect(() => {
    if (!isOpen) {
      setTypedName("");
      setConsentEsign(true);
      setAcceptTos(false);
      setAcceptPrivacy(false);
      setAckAddenda(false);
      setSigFile(null);
      setSigPreview(null);
      setSubmitting(false);
      setActiveTab("preview");
    }
  }, [isOpen]);

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) {
      setSigFile(null); setSigPreview(null);
      return;
    }
    if (!f.type.startsWith("image/")) {
      toast.error("Please upload an image (PNG/JPG).");
      return;
    }
    setSigFile(f);
    setSigPreview(URL.createObjectURL(f));
  };

  const requireAck = attachments.some((a) => a.ack_required && a.visible_to_homeowner);
  const canSign =
    !!agreement &&
    !!signingRole &&
    consentEsign &&
    acceptTos &&
    acceptPrivacy &&
    (!requireAck || ackAddenda) &&
    typedName.trim().length > 1 &&
    !submitting;

  const handleSign = async () => {
    if (!canSign) return;
    setSubmitting(true);
    try {
      // Your existing AgreementSignSerializer fields:
      // signer_name, signer_role, agree_tos, agree_privacy, signature_text (+ optional signature_image)
      const form = new FormData();
      form.append("signer_name", typedName.trim());
      form.append("signer_role", signingRole);
      form.append("agree_tos", acceptTos ? "true" : "false");
      form.append("agree_privacy", acceptPrivacy ? "true" : "false");
      form.append("signature_text", typedName.trim());
      if (sigFile) form.append("signature_image", sigFile);
      // NOTE: we do NOT send ackAddenda to keep serializer unchanged; it is enforced client-side.

      const { data } = await api.post(
        `/projects/agreements/${agreement.id}/sign/`,
        form
      );

      toast.success("Signature captured.");
      onSigned?.(data);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to sign right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => (!submitting ? onClose() : null)}
      contentLabel="Sign Agreement"
      style={{
        overlay: { zIndex: 1000, backgroundColor: "rgba(0,0,0,0.55)" },
        content: {
          inset: "4% 6%", borderRadius: 14, padding: 0,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(180deg, #0f172a 0%, #111827 40%, #0b1220 100%)",
          color: "#e5e7eb",
        },
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base">Sign Agreement</div>
          <div className="opacity-80 text-xs truncate" title={agreement?.title || `Agreement #${agreement?.id ?? ""}`}>
            {agreement?.title || `Agreement #${agreement?.id ?? ""}`}
          </div>
        </div>
        <button onClick={onClose} disabled={submitting} className="text-gray-400 text-xl px-1">✕</button>
      </div>

      {/* Tabs + legal links */}
      <div className="flex gap-2 px-4 py-2 border-b border-white/10">
        {["preview", "sign"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 rounded-lg border ${activeTab===tab ? "bg-blue-500/20 text-white border-white/20" : "bg-white/5 text-slate-300 border-white/10"}`}
          >
            {tab === "preview" ? "Agreement Preview" : "Sign"}
          </button>
        ))}
        <div className="flex-1" />
        <a href={TOS_PDF} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-white/10 text-blue-200">
          Terms of Service
        </a>
        <a href={PRIVACY_PDF} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-white/10 text-blue-200">
          Privacy Policy
        </a>
      </div>

      {/* Body */}
      <div className={`grid ${activeTab==="preview" ? "grid-cols-1" : "grid-cols-[1.1fr_0.9fr]"} min-h-[60vh] max-h-[calc(92vh-110px)]`}>
        {/* Preview */}
        <div className={`bg-[#0b1220] ${activeTab==="sign" ? "border-r border-white/10" : ""} p-2`}>
          <div className="h-full rounded-xl overflow-hidden border border-white/10">
            {pdfUrl ? (
              <iframe title="Agreement Preview" src={pdfUrl} className="w-full h-full border-0" />
            ) : (
              <div className="p-5 text-slate-300">Agreement preview unavailable.</div>
            )}
          </div>
        </div>

        {/* Sign form */}
        {activeTab === "sign" && (
          <div className="p-4 overflow-y-auto">
            {/* Attachments viewer + acknowledgement if any */}
            <div className="mb-4 p-3 rounded-xl border border-white/10 bg-white/5">
              <div className="font-semibold mb-2">Attachments & Addenda</div>
              {loadingAtts ? (
                <div className="text-sm text-slate-300">Loading…</div>
              ) : attachments.length === 0 ? (
                <div className="text-sm text-slate-300">None.</div>
              ) : (
                <ul className="text-sm list-disc pl-5 space-y-1">
                  {attachments.map((a) => (
                    <li key={a.id}>
                      <a href={a.file_url} target="_blank" rel="noreferrer" className="text-blue-200 hover:underline">
                        {a.title} [{a.category}] ({a.file_name})
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {attachments.some((a) => a.ack_required && a.visible_to_homeowner) && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={ackAddenda} onChange={(e)=>setAckAddenda(e.target.checked)} />
                  <span>I have reviewed the attachments/addenda.</span>
                </label>
              )}
            </div>

            {/* E-SIGN consent */}
            <div className="mb-4 p-3 rounded-xl border border-white/10 bg-white/5">
              <div className="font-semibold mb-2">Electronic Records & Signatures (E-SIGN)</div>
              <div className="text-sm opacity-90">
                By checking the box below and clicking <b>Sign Agreement</b>, you consent to use electronic
                records and signatures. Your typed name has the same legal effect as a handwritten signature.
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={consentEsign} onChange={(e)=>setConsentEsign(e.target.checked)} />
                <span>I consent to use electronic records and signatures.</span>
              </label>
            </div>

            {/* Accept legal docs */}
            <div className="mb-4 p-3 rounded-xl border border-white/10 bg-white/5">
              <label className="flex items-center gap-2 text-sm mb-2">
                <input type="checkbox" checked={acceptTos} onChange={(e)=>setAcceptTos(e.target.checked)} />
                <span>I have reviewed and agree to the <a href={TOS_PDF} target="_blank" rel="noreferrer" className="text-blue-200 underline">Terms of Service</a>.</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={acceptPrivacy} onChange={(e)=>setAcceptPrivacy(e.target.checked)} />
                <span>I have reviewed and agree to the <a href={PRIVACY_PDF} target="_blank" rel="noreferrer" className="text-blue-200 underline">Privacy Policy</a>.</span>
              </label>
            </div>

            {/* Role (locked) */}
            <div className="mb-4 p-3 rounded-xl border border-white/10 bg-white/5">
              <div className="font-semibold mb-1">I am signing as</div>
              <div className="inline-block px-3 py-2 rounded-lg border border-white/10 bg-blue-500/20 font-bold">
                {signingRole === "contractor" ? "Contractor" : "Homeowner"}
              </div>
              <div className="text-xs opacity-70 mt-1">(Role is fixed to prevent accidental mis-signing.)</div>
            </div>

            {/* Typed name + optional wet signature */}
            <div className="mb-4 p-3 rounded-xl border border-white/10 bg-white/5">
              <label className="block font-semibold">Type your full name (electronic signature)</label>
              <input
                type="text"
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 outline-none text-white"
                placeholder="e.g., John Q. Public"
                value={typedName}
                onChange={(e)=>setTypedName(e.target.value)}
              />
              <div className="text-xs opacity-70 mt-1">Your IP address and timestamp will be recorded.</div>

              <div className="mt-4">
                <div className="font-semibold mb-1">Optional: Upload handwritten (wet) signature</div>
                <input type="file" accept="image/*" onChange={onFileChange} />
                {sigPreview && (
                  <div className="mt-2 border border-dashed border-white/20 rounded-lg p-2 max-w-xs bg-white/5">
                    <img src={sigPreview} alt="Signature preview" className="w-full h-auto bg-white rounded" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded border border-white/20 text-slate-200">
                Cancel
              </button>
              <button
                onClick={handleSign}
                disabled={!canSign}
                className={`px-4 py-2 rounded font-bold text-white ${canSign ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-600 cursor-not-allowed"}`}
              >
                {submitting ? "Signing…" : "Sign Agreement"}
              </button>
            </div>
          </div>
        )}
      </div>

      {activeTab === "preview" && (
        <div className="px-4 py-3 border-t border-white/10 flex justify-end">
          <button
            onClick={() => setActiveTab("sign")}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold"
          >
            Continue to Sign
          </button>
        </div>
      )}
    </Modal>
  );
}
