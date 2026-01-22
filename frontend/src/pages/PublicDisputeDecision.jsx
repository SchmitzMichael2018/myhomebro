// src/pages/PublicDisputeDecision.jsx
// v2026-01-16 — Lock decision UI when dispute is closed + auto-redirect after accept/reject
//
// Requires backend endpoints (token-based):
// GET  /api/projects/disputes/public/:id/?token=XYZ
// POST /api/projects/disputes/public/:id/accept/?token=XYZ
// POST /api/projects/disputes/public/:id/reject/?token=XYZ

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import toast from "react-hot-toast";

const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function fmt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function isClosedStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "resolved_contractor" || s === "resolved_homeowner" || s === "canceled";
}

function ProposalCard({ proposal, proposalSentAt }) {
  if (!proposal) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="text-sm font-extrabold text-amber-900">No proposal yet</div>
        <div className="mt-1 text-sm text-amber-800">
          A proposal has not been submitted. You can still review evidence in the dispute thread.
        </div>
      </div>
    );
  }

  const type = proposal?.proposal_type || proposal?.type || "—";
  const notes = proposal?.notes || proposal?.message || "";

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-extrabold text-emerald-900">Contractor Proposal</div>
          <div className="mt-1 text-sm text-emerald-900/80">
            Sent: <b>{fmt(proposalSentAt)}</b>
          </div>
        </div>
        <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800">
          {String(type).replaceAll("_", " ")}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-emerald-900 md:grid-cols-2">
        {proposal?.rework_by ? (
          <div>
            <span className="font-extrabold">Rework by:</span> {proposal.rework_by}
          </div>
        ) : null}

        {proposal?.refund_amount != null ? (
          <div>
            <span className="font-extrabold">Refund:</span> {money(proposal.refund_amount)}
          </div>
        ) : null}

        {proposal?.release_amount != null ? (
          <div>
            <span className="font-extrabold">Release:</span> {money(proposal.release_amount)}
          </div>
        ) : null}
      </div>

      {notes ? (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-emerald-200 bg-white p-3 text-sm text-emerald-900">
          {notes}
        </div>
      ) : null}
    </div>
  );
}

export default function PublicDisputeDecision() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [dispute, setDispute] = useState(null);

  // After decision, we show a confirmation panel + redirect.
  const [decisionJustMade, setDecisionJustMade] = useState(null); // "accepted" | "rejected" | null
  const redirectTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const apiGet = useCallback(async (path) => {
    const res = await fetch(path, { method: "GET" });
    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }, []);

  const apiPostJson = useCallback(async (path, bodyObj) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj || {}),
    });
    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }, []);

  const fetchDispute = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");

    try {
      const url =
        `/api/projects/disputes/public/${encodeURIComponent(id)}/` +
        (token ? `?token=${encodeURIComponent(token)}` : "");

      const data = await apiGet(url);
      setDispute(data);
    } catch (e) {
      setError(e.message || "Unable to load dispute.");
    } finally {
      setLoading(false);
    }
  }, [apiGet, id, token]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  const statusRaw = dispute?.status || "";
  const status = useMemo(() => String(statusRaw).replaceAll("_", " "), [statusRaw]);
  const isClosed = useMemo(() => isClosedStatus(statusRaw), [statusRaw]);

  const proposal = dispute?.proposal || null;
  const attachments = Array.isArray(dispute?.attachments) ? dispute.attachments : [];

  const showDecisionButtons = Boolean(proposal) && !busy && !isClosed && !decisionJustMade;

  const redirectToThread = () => {
    // send them to the thread view so they can see details/evidence
    navigate(`/disputes/${encodeURIComponent(String(id))}?token=${encodeURIComponent(token)}`, { replace: true });
  };

  const scheduleRedirect = () => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = setTimeout(() => {
      redirectToThread();
    }, 2000);
  };

  const acceptProposal = async () => {
    if (!proposal) {
      toast.error("No proposal available to accept yet.");
      return;
    }
    if (isClosed) {
      toast("This dispute is already closed.");
      return;
    }
    if (!window.confirm("Accept this proposal? This will close the dispute based on platform rules.")) return;

    const note = window.prompt("Optional note (visible in the case record):", "") ?? "";

    setBusy(true);
    try {
      const url =
        `/api/projects/disputes/public/${encodeURIComponent(id)}/accept/` +
        (token ? `?token=${encodeURIComponent(token)}` : "");

      const data = await apiPostJson(url, { note });
      setDispute(data);

      setDecisionJustMade("accepted");
      toast.success("Accepted. Thank you.");
      scheduleRedirect();
    } catch (e) {
      toast.error(e.message || "Accept failed.");
    } finally {
      setBusy(false);
    }
  };

  const rejectProposal = async () => {
    if (!proposal) {
      toast.error("No proposal available to reject yet.");
      return;
    }
    if (isClosed) {
      toast("This dispute is already closed.");
      return;
    }
    if (!window.confirm("Reject this proposal? The dispute will remain under review.")) return;

    const note = window.prompt("Tell us why you’re rejecting (recommended):", "") ?? "";

    setBusy(true);
    try {
      const url =
        `/api/projects/disputes/public/${encodeURIComponent(id)}/reject/` +
        (token ? `?token=${encodeURIComponent(token)}` : "");

      const data = await apiPostJson(url, { note });
      setDispute(data);

      setDecisionJustMade("rejected");
      toast.success("Rejected. We’ll continue review.");
      scheduleRedirect();
    } catch (e) {
      toast.error(e.message || "Reject failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
          <h1 className="text-2xl font-extrabold text-slate-900">Decision Link Missing Token</h1>
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
            This page requires a secure token. Please use the link from your email.
          </div>
          <div className="mt-6">
            <button
              className="rounded-xl bg-slate-900 px-5 py-2 font-extrabold text-white hover:bg-slate-800"
              onClick={() => navigate("/")}
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-center text-slate-600">Loading Decision…</div>;

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
          <h1 className="text-2xl font-extrabold text-slate-900">Decision</h1>
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
            <div className="font-extrabold">Could not load this dispute.</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-slate-900 px-5 py-2 font-extrabold text-white hover:bg-slate-800"
              onClick={() => navigate("/")}
            >
              Return Home
            </button>
            <button
              className="rounded-xl bg-slate-100 px-5 py-2 font-extrabold text-slate-900 hover:bg-slate-200"
              onClick={fetchDispute}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!dispute) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-500">Dispute Decision</div>
            <h1 className="text-3xl font-extrabold text-slate-900">Dispute #{dispute.id}</h1>
            <div className="mt-1 text-sm text-slate-600">
              Status: <b>{status || "—"}</b>
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Agreement: <b>{dispute.agreement_number || "—"}</b>
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Milestone: <b>{dispute.milestone_title || "—"}</b>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-slate-900 px-5 py-2 font-extrabold text-white hover:bg-slate-800"
              onClick={() => navigate("/")}
            >
              Home
            </button>

            <Link
              to={`/disputes/${encodeURIComponent(String(id))}?token=${encodeURIComponent(token)}`}
              className="rounded-xl bg-slate-100 px-5 py-2 font-extrabold text-slate-900 hover:bg-slate-200"
              title="Open the dispute thread"
            >
              View Thread
            </Link>
          </div>
        </div>

        {/* ✅ Closed banner */}
        {isClosed ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-extrabold text-slate-900">Decision already recorded</div>
            <div className="mt-1 text-sm text-slate-700">
              This dispute is closed, so the decision buttons are disabled.
            </div>
            <div className="mt-3">
              <button
                className="rounded-xl bg-slate-900 px-5 py-2 font-extrabold text-white hover:bg-slate-800"
                onClick={redirectToThread}
              >
                Go to Dispute Thread
              </button>
            </div>
          </div>
        ) : null}

        {/* ✅ Just decided banner */}
        {decisionJustMade ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-extrabold text-emerald-900">
              {decisionJustMade === "accepted" ? "✅ Proposal accepted" : "✅ Proposal rejected"}
            </div>
            <div className="mt-1 text-sm text-emerald-900/80">
              Redirecting you to the dispute thread…
            </div>
            <div className="mt-3">
              <button
                className="rounded-xl bg-emerald-600 px-5 py-2 font-extrabold text-white hover:bg-emerald-700"
                onClick={redirectToThread}
              >
                Continue now
              </button>
            </div>
          </div>
        ) : null}

        {/* Issue summary */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-extrabold text-slate-800">Issue</div>
          <div className="mt-1 text-base font-extrabold text-slate-900">
            {dispute.reason || dispute.reason_code || "—"}
          </div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {dispute.description || dispute.narrative || "—"}
          </div>
          <div className="mt-2 text-xs text-slate-500">Created: {fmt(dispute.created_at)}</div>
        </div>

        {/* Proposal */}
        <div className="mt-6">
          <ProposalCard proposal={proposal} proposalSentAt={dispute.proposal_sent_at} />
        </div>

        {/* Decision buttons (hidden/disabled when closed) */}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="rounded-xl bg-emerald-600 px-6 py-3 font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={acceptProposal}
            disabled={!showDecisionButtons}
            title={!proposal ? "Waiting for a proposal" : (isClosed ? "Dispute already closed" : "Accept this proposal")}
          >
            {busy ? "Working…" : "Accept Proposal"}
          </button>

          <button
            className="rounded-xl bg-rose-600 px-6 py-3 font-extrabold text-white hover:bg-rose-700 disabled:opacity-60"
            onClick={rejectProposal}
            disabled={!showDecisionButtons}
            title={!proposal ? "Waiting for a proposal" : (isClosed ? "Dispute already closed" : "Reject this proposal")}
          >
            {busy ? "Working…" : "Reject Proposal"}
          </button>
        </div>

        <div className="mt-2 text-xs text-slate-600">
          Accepting closes the dispute based on platform rules. Rejecting keeps it under review for admin or mediation.
        </div>

        {/* Evidence preview */}
        <div className="mt-8">
          <div className="text-sm font-extrabold text-slate-800">Evidence</div>
          {attachments.length === 0 ? (
            <div className="mt-2 text-sm text-slate-600">—</div>
          ) : (
            <div className="mt-2 space-y-2">
              {attachments.map((a, idx) => {
                const name = a?.name || a?.filename || `Attachment ${idx + 1}`;
                const url = a?.url || a?.file_url || a?.file || "";
                return (
                  <div
                    key={`${a?.id || idx}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{name}</div>
                      <div className="text-xs text-slate-500">
                        Uploaded: {fmt(a?.created_at || a?.uploaded_at)}
                      </div>
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
                      >
                        Open
                      </a>
                    ) : (
                      <div className="text-xs text-slate-400">No URL</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 text-xs text-slate-500">
          If you need help, reply to your invoice email with “Dispute #{dispute.id}”.
        </div>
      </div>
    </div>
  );
}
