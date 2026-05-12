import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

export default function ContractorClaimPage() {
  const { token = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadInvite() {
      try {
        setLoading(true);
        setError("");
        const { data } = await api.get(`/projects/contractors/claim/${token}/`);
        if (!active) return;
        setInvite(data);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.detail || "Could not load this claim link.");
      } finally {
        if (active) setLoading(false);
      }
    }
    if (token) loadInvite();
    else {
      setError("Missing claim token.");
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [token]);

  async function handleClaim() {
    try {
      setSubmitting(true);
      const { data } = await api.post(`/projects/contractors/claim/${token}/`);
      setInvite((prev) => ({ ...(prev || {}), claimed: true, status: "claimed", ...data }));
      toast.success("Your listing has been claimed.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not claim this listing.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-slate-500" data-testid="contractor-claim-page-loading">
        Loading claim details…
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="contractor-claim-page">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Contractor claim</div>
          <p className="mt-2 text-sm text-rose-700">{error || "This claim link could not be found."}</p>
          <div className="mt-4">
            <Link to="/login" className="text-sm font-semibold text-indigo-700 hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12" data-testid="contractor-claim-page">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
          Contractor claim
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          {invite.business_name || "Local Business Listing"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          A homeowner selected this listing to review a {invite.project_mode ? `${invite.project_mode.replace(/_/g, " ")} ` : ""}project.
        </p>
        <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <div><span className="font-semibold text-slate-900">City:</span> {invite.city || "Not listed"}</div>
          <div><span className="font-semibold text-slate-900">State:</span> {invite.state || "Not listed"}</div>
          <div><span className="font-semibold text-slate-900">Project summary:</span> {invite.project_summary || "No summary available."}</div>
          <div><span className="font-semibold text-slate-900">Status:</span> {String(invite.status || "pending")}</div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleClaim}
            disabled={submitting || invite.claimed}
            className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            data-testid="contractor-claim-listing"
          >
            {invite.claimed ? "Listing Claimed" : submitting ? "Claiming..." : "Claim Profile"}
          </button>
          <Link to="/login" className="text-sm font-semibold text-slate-700 hover:underline">
            Sign in to claim
          </Link>
        </div>

        {invite.claim_url ? (
          <p className="mt-4 text-xs text-slate-500">
            Claim link path: <span className="font-mono">{invite.claim_url}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
