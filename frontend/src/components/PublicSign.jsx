// frontend/src/components/PublicSign.jsx
// v2025-12-01-stable-pdf-autorefresh
// Public homeowner signing page
// - Route: /public-sign/:token
// - Fetches agreement via /api/projects/agreements/public_sign/?token=...
// - Shows PDF + "Open Signing Panel" button
// - Uses SignatureModal with signingRole="homeowner"
// - After signature, bumps pdfVersion so the PDF iframe reloads with the signed version.

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import SignatureModal from "./SignatureModal";

export default function PublicSign() {
  const { token } = useParams(); // expect path /public-sign/:token
  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState("");
  const [isSignOpen, setIsSignOpen] = useState(false);

  // 👇 Used to force the PDF iframe to reload after signing
  const [pdfVersion, setPdfVersion] = useState(0);

  useEffect(() => {
    const fetchAgreement = async () => {
      if (!token) {
        setError("Missing signing token.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        // NOTE: api.js baseURL is /api, so this hits /api/projects/agreements/public_sign/
        const { data } = await api.get(
          `/projects/agreements/public_sign/?token=${encodeURIComponent(
            token
          )}`
        );
        setAgreement(data);
        setError("");
      } catch (err) {
        console.error(err);
        const msg =
          err?.response?.data?.detail ||
          "Unable to load this agreement. The link may have expired.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchAgreement();
  }, [token]);

  // 🔹 IMPORTANT: point the iframe at the API endpoint, and include pdfVersion
  const pdfUrl = (() => {
    if (!token) return null;
    // /api/projects/agreements/public_pdf/?token=...&stream=1&v=<pdfVersion>
    return `/api/projects/agreements/public_pdf/?token=${encodeURIComponent(
      token
    )}&stream=1&v=${pdfVersion}`;
  })();

  const handleSigned = (updated) => {
    // Update agreement state with the server response
    setAgreement(updated);
    // Bump version so the iframe URL changes and browser reloads the PDF
    setPdfVersion((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col">
      <header className="px-5 py-3 border-b border-white/10 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">
              MyHomeBro — Homeowner Signature
            </div>
            <div className="text-sm font-semibold truncate max-w-xs">
              {agreement?.project_title ||
                agreement?.title ||
                (loading ? "Loading agreement…" : "Sign Agreement")}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Left: PDF preview / status */}
        <section className="border-b lg:border-b-0 lg:border-r border-white/10 bg-slate-950">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-300">
              Loading agreement…
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center px-6 text-sm text-red-200">
              {error}
            </div>
          ) : pdfUrl ? (
            <iframe
              key={pdfUrl} // ensure React remounts iframe when URL changes
              title="Agreement PDF"
              src={pdfUrl}
              className="w-full h-full border-none"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-300">
              PDF preview not available.
            </div>
          )}
        </section>

        {/* Right: instructions + sign button */}
        <section className="bg-slate-900 px-6 py-5 flex flex-col gap-4">
          {loading ? (
            <div className="text-sm text-slate-300">
              Please wait while we prepare your agreement…
            </div>
          ) : error ? (
            <div className="text-sm text-red-200">{error}</div>
          ) : !agreement ? (
            <div className="text-sm text-slate-300">
              Agreement could not be loaded.
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-lg font-semibold mb-1">
                  Review &amp; Sign Agreement
                </h1>
                <p className="text-sm text-slate-300">
                  Please review the agreement on the left. When you are ready,
                  click <b>Open Signing Panel</b> to type your name and
                  optionally sign with your finger or mouse.
                </p>
              </div>

              <div className="text-sm bg-slate-800/80 border border-white/10 rounded-xl p-3">
                <div className="font-semibold text-slate-100">
                  Agreement details
                </div>
                <div className="mt-1 text-slate-200">
                  <div>
                    <span className="text-slate-400 text-xs">
                      Project title:
                    </span>{" "}
                    {agreement.project_title || agreement.title || "—"}
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">
                      Contractor:
                    </span>{" "}
                    {agreement.contractor_name || "Your contractor"}
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">
                      Homeowner:
                    </span>{" "}
                    {agreement.homeowner_name || "You"}
                  </div>
                </div>
              </div>

              {agreement.is_fully_signed ? (
                <div className="mt-2 text-sm text-emerald-300">
                  This agreement is already fully signed. You may download the
                  PDF from the preview panel on the left.
                </div>
              ) : (
                <>
                  <div className="mt-2 text-xs text-slate-300">
                    You will be able to:
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>Consent to electronic records &amp; signatures.</li>
                      <li>
                        Review the Terms of Service and Privacy Policy before
                        signing.
                      </li>
                      <li>
                        Type your full name and optionally draw or upload a
                        signature image.
                      </li>
                    </ul>
                  </div>

                  <div className="mt-auto pt-2 flex items-center justify-start gap-3">
                    <button
                      type="button"
                      onClick={() => setIsSignOpen(true)}
                      className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-semibold"
                    >
                      Open Signing Panel
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </main>

      {/* Shared Signature Modal */}
      <SignatureModal
        isOpen={isSignOpen}
        onClose={() => setIsSignOpen(false)}
        agreement={
          agreement || {
            id: null,
            title: "Agreement",
            project_title: "Agreement",
          }
        }
        signingRole="homeowner"
        token={token}
        defaultName={agreement?.homeowner_name || ""}
        onSigned={handleSigned}
      />
    </div>
  );
}
