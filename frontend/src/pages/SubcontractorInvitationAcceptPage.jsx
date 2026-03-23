import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import api, { getAccessToken } from "../api";

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function SubcontractorInvitationAcceptPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [error, setError] = useState("");

  const isSignedIn = !!getAccessToken();

  const loadInvitation = async () => {
    if (!token) {
      setError("This invitation link is missing a token.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const { data } = await api.get(
        `/projects/subcontractor-invitations/accept/${encodeURIComponent(token)}/`
      );
      setInvitation(data);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        "This subcontractor invitation is invalid or no longer available.";
      setInvitation(null);
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvitation();
  }, [token]);

  const statusLabel = useMemo(() => {
    const status = String(invitation?.status || "").replaceAll("_", " ").trim();
    if (!status) return "";
    return status.charAt(0).toUpperCase() + status.slice(1);
  }, [invitation?.status]);

  const acceptInvitation = async () => {
    try {
      setAccepting(true);
      const { data } = await api.post(
        `/projects/subcontractor-invitations/accept/${encodeURIComponent(token)}/`,
        {}
      );
      setInvitation((prev) => ({
        ...(prev || {}),
        ...(data?.invitation ? { status: data.invitation.status, accepted_at: data.invitation.accepted_at } : {}),
      }));
      toast.success("Invitation accepted.");
      await loadInvitation();
    } catch (err) {
      const msg =
        err?.response?.data?.detail || "Unable to accept this invitation right now.";
      toast.error(String(msg));
    } finally {
      setAccepting(false);
    }
  };

  const loginHref = `/login?subcontractor_invite=${encodeURIComponent(token)}`;
  const signupHref = `/signup?subcontractor_invite=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1
              data-testid="subcontractor-invite-title"
              className="text-2xl font-bold text-slate-900"
            >
              Subcontractor Invitation
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Collaborate on a specific MyHomeBro agreement as an invited subcontractor.
            </p>
          </div>
          {statusLabel ? (
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {statusLabel}
            </span>
          ) : null}
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {loading ? (
            <div className="text-sm text-slate-600">Loading invitation…</div>
          ) : error ? (
            <div data-testid="subcontractor-invite-error" className="text-sm text-rose-700">
              {error}
            </div>
          ) : (
            <>
              <div className="grid gap-3 text-sm text-slate-700">
                <div>
                  <div className="font-semibold text-slate-900">Agreement</div>
                  <div>{invitation?.agreement?.title || "Agreement"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Invited Email</div>
                  <div>{invitation?.invite_email}</div>
                </div>
                {invitation?.invite_name ? (
                  <div>
                    <div className="font-semibold text-slate-900">Invited Name</div>
                    <div>{invitation.invite_name}</div>
                  </div>
                ) : null}
                {invitation?.invited_message ? (
                  <div>
                    <div className="font-semibold text-slate-900">Message</div>
                    <div className="whitespace-pre-wrap">{invitation.invited_message}</div>
                  </div>
                ) : null}
                <div className="text-xs text-slate-500">
                  Invited {formatDateTime(invitation?.invited_at)}
                </div>
              </div>

              {!isSignedIn ? (
                <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  Sign in or create an account with the invited email address to accept this invitation.
                </div>
              ) : invitation?.status === "pending" && invitation?.email_match === false ? (
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  You&apos;re signed in, but this account email does not match the invited email.
                </div>
              ) : null}

              {invitation?.status === "accepted" ? (
                <div
                  data-testid="subcontractor-invite-accepted"
                  className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                >
                  This invitation has been accepted{invitation?.accepted_at ? ` on ${formatDateTime(invitation.accepted_at)}` : ""}.
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Home
          </button>

          {!loading && !error && !isSignedIn ? (
            <>
              <Link
                to={loginHref}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-950"
              >
                Sign In
              </Link>
              <Link
                to={signupHref}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Sign Up
              </Link>
            </>
          ) : null}

          {!loading &&
          !error &&
          isSignedIn &&
          invitation?.status === "pending" &&
          invitation?.email_match !== false ? (
            <button
              data-testid="subcontractor-invite-accept-button"
              type="button"
              onClick={acceptInvitation}
              disabled={accepting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accepting ? "Accepting…" : "Accept Invitation"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
