import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getPublicCaptureQr, submitPublicCaptureQr } from "../api/captures.js";

export default function PublicCaptureQrPage() {
  const { token = "" } = useParams();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    getPublicCaptureQr(token)
      .then(setConfig)
      .catch(() => setError("This project form is unavailable."))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("form_token", config.form_token);
    setSubmitting(true);
    setError("");
    try {
      await submitPublicCaptureQr(token, data, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
          }
        },
      });
      setSuccess(true);
    } catch (requestError) {
      const payload = requestError?.response?.data;
      const message = payload && typeof payload === "object"
        ? Object.values(payload).flat().find(Boolean)
        : "";
      setError(String(message || "Your information could not be sent. Check the form and try again."));
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50 p-4" aria-busy="true">Loading project form…</main>;
  if (error && !config) return <main className="grid min-h-screen place-items-center bg-slate-50 p-4"><div role="alert" className="max-w-md rounded-2xl border bg-white p-6 text-slate-900">{error}</div></main>;
  if (success) return <main className="grid min-h-screen place-items-center bg-slate-50 p-4"><section className="max-w-lg rounded-3xl border bg-white p-8 text-center text-slate-950 shadow-sm"><h1 className="text-2xl font-black">Your project information has been sent.</h1><p className="mt-3">The contractor can review the information you provided. This submission does not form a contract.</p></section></main>;

  return (
    <main className="min-h-screen overflow-x-clip bg-slate-50 px-4 py-8 text-slate-950" data-testid="public-capture-qr">
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" style={{ borderTopColor: config.branding.primary_color, borderTopWidth: 6 }}>
        {config.branding.logo_url ? <img src={config.branding.logo_url} alt="" className="mb-4 h-12 max-w-full object-contain" /> : null}
        <p className="text-sm font-bold">{config.branding.business_name}</p>
        <h1 className="mt-2 text-3xl font-black">Tell us a little about your project.</h1>
        <p className="mt-2 text-sm text-slate-600">Your information will be sent to {config.branding.business_name}. No account or app is required.</p>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <label className="grid gap-1 text-sm font-bold">Name<input name="name" required maxLength={255} className="min-h-12 rounded-xl border border-slate-300 px-3" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-bold">Phone<input name="phone" type="tel" maxLength={40} className="min-h-12 rounded-xl border border-slate-300 px-3" /></label>
            <label className="grid gap-1 text-sm font-bold">Email<input name="email" type="email" maxLength={254} className="min-h-12 rounded-xl border border-slate-300 px-3" /></label>
          </div>
          <p className="text-xs text-slate-600">Add at least one way for the contractor to contact you.</p>
          <label className="grid gap-1 text-sm font-bold">Project description<textarea name="project_description" required minLength={10} maxLength={5000} rows={5} className="rounded-xl border border-slate-300 p-3" /></label>
          <label className="grid gap-1 text-sm font-bold">ZIP code <span className="font-normal">(optional)</span><input name="zip_code" inputMode="numeric" maxLength={20} className="min-h-12 rounded-xl border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">Preferred contact <span className="font-normal">(optional)</span><select name="preferred_contact_method" className="min-h-12 rounded-xl border border-slate-300 px-3"><option value="">No preference</option><option value="phone">Phone</option><option value="email">Email</option><option value="text">Text</option></select></label>
          <label className="grid gap-1 text-sm font-bold">Project photos <span className="font-normal">(optional, up to 3)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="min-h-12 rounded-xl border border-slate-300 p-2" /></label>
          <label className="hidden" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <label className="flex min-h-12 items-start gap-3 text-sm"><input name="contact_consent" type="checkbox" value="true" className="mt-1" />I agree that {config.branding.business_name} may contact me about this project.</label>
          {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div> : null}
          {submitting && uploadProgress > 0 ? (
            <div className="text-sm" role="status" aria-live="polite">
              Uploading {uploadProgress}%
              <progress className="ml-2 max-w-full" value={uploadProgress} max="100" />
            </div>
          ) : null}
          <button disabled={submitting} className="min-h-12 rounded-xl bg-slate-950 px-5 font-bold text-white disabled:opacity-60">{submitting ? "Sending…" : "Send project information"}</button>
          <p className="text-xs text-slate-600">Submitting does not form a contract or guarantee an estimate, response time, availability, or acceptance. <a className="underline" href={config.privacy_url}>Privacy Policy</a></p>
        </form>
      </section>
    </main>
  );
}
