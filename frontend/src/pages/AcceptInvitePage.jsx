import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import toast from "react-hot-toast";

/**
 * AcceptInvitePage
 *
 * Expected backend endpoints (you can adjust):
 * GET  {apiBaseUrl}/invites/{token}/   -> returns basic invite info
 * POST {apiBaseUrl}/invites/{token}/accept/ -> marks accepted (optional; can be done after login too)
 *
 * Behavior:
 * - Shows invite context (homeowner name + message) if available
 * - Accept button:
 *    - calls accept endpoint (optional)
 *    - redirects to /signup?invite=token (or /login?invite=token)
 */
export default function AcceptInvitePage({ apiBaseUrl = "/api" }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [accepting, setAccepting] = useState(false);

  const token = useMemo(() => {
    // Prefer /invite/:token
    if (params?.token) return params.token;

    // Support /invite?token=...
    const sp = new URLSearchParams(location.search);
    return sp.get("token") || "";
  }, [params, location.search]);

  useEffect(() => {
    async function loadInvite() {
      if (!token) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const url = `${apiBaseUrl}/invites/${token}/`;
        const res = await fetch(url, { method: "GET" });
        let data = null;
        try {
          data = await res.json();
        } catch {
          // ignore
        }

        if (!res.ok) {
          const msg =
            data?.detail ||
            data?.error ||
            "Invite link is invalid or has expired.";
          throw new Error(msg);
        }

        setInvite(data);
      } catch (err) {
        toast.error(err?.message || "Invite link error.");
        setInvite(null);
      } finally {
        setLoading(false);
      }
    }

    loadInvite();
  }, [token, apiBaseUrl]);

  async function acceptInvite() {
    if (!token) return;
    setAccepting(true);
    try {
      // Optional "accept" ping (works even without auth, or you can later require auth)
      const url = `${apiBaseUrl}/invites/${token}/accept/`;
      const res = await fetch(url, { method: "POST" });

      // if backend doesn't have this yet, it may 404 — we can still proceed to signup/login
      if (!res.ok && res.status !== 404) {
        let data = null;
        try {
          data = await res.json();
        } catch {}
        const msg =
          data?.detail ||
          data?.error ||
          "Could not accept invite right now, but you can still sign up.";
        throw new Error(msg);
      }

      toast.success("Invite accepted. Please create or sign in to your contractor account.");

      // Choose your preference:
      // - If you have separate contractor signup route:
      // navigate(`/signup?invite=${encodeURIComponent(token)}`);
      // - Or send to login (then they can go to signup):
      navigate(`/login?invite=${encodeURIComponent(token)}`);
    } catch (err) {
      toast.error(err?.message || "Accept failed.");
      // Still allow progression:
      navigate(`/login?invite=${encodeURIComponent(token)}`);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900">You’ve been invited</h1>
        <p className="text-sm text-gray-600 mt-2">
          A homeowner wants to use MyHomeBro for secure escrow payments and milestone approvals.
        </p>

        <div className="mt-5 border rounded-xl p-4 bg-gray-50">
          {loading ? (
            <div className="text-sm text-gray-600">Loading invite details…</div>
          ) : !token ? (
            <div className="text-sm text-red-600">
              This invite link is missing a token.
            </div>
          ) : !invite ? (
            <div className="text-sm text-red-600">
              This invite link is invalid or expired.
            </div>
          ) : (
            <>
              <div className="text-sm text-gray-800">
                <div className="font-semibold">Homeowner</div>
                <div className="mt-1">{invite.homeowner_name || "Homeowner"}</div>
              </div>

              {invite.message ? (
                <div className="mt-4 text-sm text-gray-800">
                  <div className="font-semibold">Message</div>
                  <div className="mt-1 whitespace-pre-wrap">{invite.message}</div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
          >
            Back to Home
          </button>

          <button
            type="button"
            onClick={acceptInvite}
            disabled={!token || accepting}
            className={`px-4 py-2 rounded-lg font-semibold ${
              token && !accepting
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
          >
            {accepting ? "Accepting…" : "Accept Invite"}
          </button>
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Contractors stay in control — homeowners don’t need accounts.
        </div>
      </div>
    </div>
  );
}
