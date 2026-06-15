import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import logo from "../assets/myhomebro_logo.png";

const DOCUMENT_TYPES = ["Equipment Label", "Receipt", "Invoice", "Warranty", "Manual", "Service Record", "Other"];

function confidenceClass(confidence) {
  if (confidence === "high") return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  if (confidence === "medium") return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  return "border-slate-600 bg-slate-900 text-slate-200";
}

export default function CustomerPortalUploadSessionPage() {
  const { sessionToken = "" } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState("Equipment Label");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function loadSession() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/projects/customer-portal/upload-sessions/${encodeURIComponent(sessionToken)}/`);
        if (!mounted) return;
        setSession(data);
        setDocumentType(data?.document_type || "Equipment Label");
      } catch (err) {
        const message = err?.response?.data?.detail || "This upload link is not available.";
        if (mounted) setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadSession();
    return () => {
      mounted = false;
    };
  }, [sessionToken]);

  const upload = async () => {
    if (!file) {
      toast.error("Choose a photo or file first.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("document_type", documentType);
      const { data } = await api.post(
        `/projects/customer-portal/upload-sessions/${encodeURIComponent(sessionToken)}/`,
        formData
      );
      setResult(data);
      toast.success("File saved.");
    } catch (err) {
      const message = err?.response?.data?.detail || "Could not upload that file.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const suggestions = result?.extraction?.suggested_fields || {};

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <main className="mx-auto max-w-xl rounded-3xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl">
        <img src={logo} alt="MyHomeBro" className="h-9 w-auto" />
        <div className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Customer Portal</div>
        <h1 className="mt-2 text-2xl font-black">Upload Home System Document</h1>
        {loading ? <p className="mt-4 text-sm text-slate-300">Opening secure upload link...</p> : null}
        {error ? (
          <div data-testid="portal-upload-session-error" className="mt-4 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
        {session && !result ? (
          <section data-testid="portal-upload-session-page" className="mt-5 space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
              {session.home_system_name ? (
                <p><span className="font-bold text-white">Saving to:</span> {session.home_system_name}</p>
              ) : (
                <p>This file will be saved to your property records.</p>
              )}
              <p className="mt-2 text-xs text-slate-400">Link expires {session.expires_at ? new Date(session.expires_at).toLocaleString() : "soon"}.</p>
            </div>
            <label className="block text-sm font-semibold text-slate-200">
              Document type
              <select
                data-testid="portal-upload-session-document-type"
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-base text-white"
              >
                {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Take photo or upload file
              <input
                data-testid="portal-upload-session-file"
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm text-slate-200"
              />
            </label>
            <button
              type="button"
              data-testid="portal-upload-session-submit"
              onClick={upload}
              disabled={uploading}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Save File"}
            </button>
          </section>
        ) : null}
        {result ? (
          <section data-testid="portal-upload-session-result" className="mt-5 space-y-4">
            <div className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              File saved. Review and apply suggestions in your Customer Portal.
            </div>
            {Object.keys(suggestions).length ? (
              <div className="space-y-2">
                <h2 className="text-base font-bold">Document Analysis Results</h2>
                {Object.entries(suggestions).map(([field, suggestion]) => (
                  <div key={field} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-sm">
                    <div className="font-bold capitalize text-white">{field.replaceAll("_", " ")}</div>
                    <div className="mt-1 text-slate-300">{suggestion.value}</div>
                    <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs font-bold ${confidenceClass(suggestion.confidence)}`}>
                      {suggestion.confidence || "low"} confidence
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-300">No structured fields were found yet. The file is still saved to your Home System records.</p>
            )}
            <Link to="/portal" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-100">
              Back to Customer Portal
            </Link>
          </section>
        ) : null}
      </main>
    </div>
  );
}
