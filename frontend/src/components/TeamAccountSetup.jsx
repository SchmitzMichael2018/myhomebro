import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api";

export default function TeamAccountSetup() {
  const navigate = useNavigate();
  const { uid, token } = useParams();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let mounted = true;
    async function validateLink() {
      try {
        const { data } = await api.get(`/accounts/auth/team-account-setup/${uid}/${token}/`);
        if (mounted) setAccount(data || null);
      } catch (err) {
        if (mounted) setErrorMsg(err?.response?.data?.detail || "This setup link is invalid or expired.");
      } finally {
        if (mounted) setChecking(false);
      }
    }
    validateLink();
    return () => {
      mounted = false;
    };
  }, [uid, token]);

  const handleSetup = async (event) => {
    event.preventDefault();
    setSuccessMsg("");
    setErrorMsg("");
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setErrorMsg("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/accounts/auth/team-account-setup/confirm/", {
        uid,
        token,
        new_password: password,
      });
      setSuccessMsg("Your team account is ready. Redirecting to sign in...");
      setTimeout(() => navigate("/?login=1"), 1500);
    } catch (err) {
      const message =
        err?.response?.data?.detail ||
        err?.response?.data?.new_password?.[0] ||
        "This setup link is invalid or expired.";
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-100 to-blue-300 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-blue-700">Set up your team account</h1>
        <p className="mt-3 text-sm text-slate-600">
          {account?.contractor_business_name
            ? `${account.contractor_business_name} invited you to MyHomeBro. Choose a password to activate access.`
            : "Choose a password to activate your MyHomeBro team access."}
        </p>
        {account?.email ? <p className="mt-2 text-sm font-semibold text-slate-800">{account.email}</p> : null}

        {checking ? (
          <div className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            Checking setup link...
          </div>
        ) : errorMsg && !account ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errorMsg}
          </div>
        ) : (
          <form className="mt-6 space-y-4 text-left" onSubmit={handleSetup}>
            <input
              type={showPw ? "text" : "password"}
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              className="w-full rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type={showPw ? "text" : "password"}
              placeholder="Confirm new password"
              value={password2}
              onChange={(event) => setPassword2(event.target.value)}
              minLength={8}
              required
              className="w-full rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showPw} onChange={() => setShowPw((value) => !value)} />
              Show passwords
            </label>
            <button
              type="submit"
              disabled={loading}
              className={`flex w-full items-center justify-center rounded-lg py-2 text-white transition ${
                loading ? "cursor-not-allowed bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {loading ? "Activating..." : "Activate Team Account"}
            </button>
          </form>
        )}

        {successMsg ? <div className="mt-4 text-sm font-semibold text-green-700">{successMsg}</div> : null}
        {errorMsg && account ? <div className="mt-4 text-sm font-semibold text-red-700">{errorMsg}</div> : null}
      </div>
    </div>
  );
}
