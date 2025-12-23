// frontend/src/components/PublicSign.jsx
// v2025-12-22 — View-only mode for signed agreements
// - Route: /public-sign/:token
// - View-only if agreement already signed OR ?mode=final
// - Otherwise preserves existing signing flow exactly

import React, { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import api from "../api";
import SignatureModal from "./SignatureModal";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function PublicSign() {
  const { token } = useParams(); // /public-sign/:token
  const query = useQuery();

  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState("");
  const [isSignOpen, setIsSignOpen] = useState(false);

  // Used to force iframe reload when PDF changes
  const [pdfVersion, setPdfVersion] = useState(0);

  const modeFinal = (query.get("mode") || "").toLowerCase() === "final";

  useEffect(() => {
    const fetchAgreement = async () => {
      if (!token) {
        setError("Missing signing token.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
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

  const isFullySigned =
    agreement?.is_fully_signed === true ||
    String(agreement?.status || "").toLowerCase() === "signed";

  const viewOnly = isFullySigned || modeFinal;

  const pdfUrl = token
    ? `/api/projects/agreements/public_pdf/?token=${encodeURIComponent(
        token
      )}&stream=1&v=${pdfVersion}`
    : null;

  const handleSigned = (updated) => {
    setAgreement(updated);
    setPdfVersion((v) => v + 1);
    setIsSignOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col">
      <header className="px-5 py-3 border-b border-white/10 flex items-center bg-slate-950">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            MyHomeBro
          </div>
          <div className="text-sm font-semibold truncate max-w-xs">
            {agreement?.project_title ||
              agreement?.title ||
              (loading ? "Loading…" : "Agreement")}
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]">
        {/* PDF */}
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
              key={pdfUrl}
              title="Agreement PDF"
              src={pdfUrl}
              className="w-full h-full border-none"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-300">
              PDF not available.
            </div>
          )}
        </section>

        {/* Side panel */}
        <section className="bg-slate-900 px-6 py-5 flex flex-col gap-4">
          {loading ? (
            <div className="text-sm text-slate-300">
              Preparing agreement…
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
                  {viewOnly ? "Signed Agreement" : "Review & Sign Agreement"}
                </h1>
                <p className="text-sm text-slate-300">
                  {viewOnly
                    ? "This agreement has already been signed. You may view or download the final PDF for your records."
                    : "Please review the agreement on the left. When ready, click Open Signing Panel to sign."}
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

              {viewOnly ? (
                <div className="mt-3 text-sm text-emerald-300">
                  No further action is required.
                </div>
              ) : (
                <div className="mt-auto pt-2">
                  <button
                    type="button"
                    onClick={() => setIsSignOpen(true)}
                    className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-semibold"
                  >
                    Open Signing Panel
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Signature modal (disabled in view-only mode) */}
      {!viewOnly && (
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
      )}
    </div>
  );
}
