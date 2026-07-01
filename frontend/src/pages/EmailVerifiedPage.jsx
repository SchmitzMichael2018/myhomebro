import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";

import logo from "../assets/myhomebro_logo.png";

export default function EmailVerifiedPage() {
  const [searchParams] = useSearchParams();
  const success = searchParams.get("status") !== "failure";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_50%_10%,rgba(37,99,235,0.24),transparent_30%),linear-gradient(135deg,#020617_0%,#082044_50%,#0f172a_100%)] px-4 py-8 text-white">
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl flex-col items-center justify-center text-center">
        <Link to="/" className="mb-8 flex items-center gap-3">
          <img src={logo} alt="MyHomeBro" className="h-11 w-11 rounded-xl object-cover" />
          <div className="text-2xl font-bold">MyHome<span className="text-amber-300">Bro</span></div>
        </Link>
        <div className="w-full rounded-3xl border border-white/12 bg-slate-950/62 p-7 shadow-2xl shadow-slate-950/35">
          {success ? (
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />
          ) : (
            <XCircle className="mx-auto h-12 w-12 text-rose-300" />
          )}
          <h1 className="mt-5 text-3xl font-semibold">
            {success ? "Email verified" : "Verification link expired"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-sky-50/74">
            {success
              ? "Your account is ready. Sign in to add your first property and open your customer dashboard."
              : "That verification link could not be used. Try signing in or request a fresh portal link."}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link
              to="/create-account?verified=1"
              className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-950/25 hover:from-blue-500 hover:to-indigo-500"
            >
              Continue Setup
            </Link>
            <Link
              to="/portal"
              className="rounded-xl border border-white/16 px-5 py-3 font-semibold text-sky-50 hover:bg-white/8"
            >
              Customer Log In
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
