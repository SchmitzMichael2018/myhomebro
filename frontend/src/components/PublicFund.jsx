// frontend/src/components/PublicFund.jsx
// v2025-12-02 — Public escrow funding page with Stripe PaymentElement
//
// Route: /public-fund/:token
// APIs:
//   GET  /api/projects/funding/public_fund/?token=...
//   POST /api/projects/funding/create_payment_intent/ { token }
//
// Uses Stripe TEST mode via VITE_STRIPE_PUBLISHABLE_KEY

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ""
);

function FundingPaymentForm({ clientSecret, amount, currency }) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          // You can customize a return_url in the future if you want.
        },
        redirect: "if_required",
      });

      if (error) {
        console.error("confirmPayment error:", error);
        toast.error(error.message || "Payment failed. Please try again.");
      } else {
        toast.success("Payment submitted. Thank you!");
        // In the future we can call a "mark escrow funded" endpoint here
        // or rely on Stripe webhooks to update the agreement.
      }
    } catch (err) {
      console.error("Payment error:", err);
      toast.error("Something went wrong while processing the payment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || submitting}
        className={`w-full rounded-md px-4 py-2 text-sm font-semibold ${
          !stripe || submitting
            ? "bg-slate-600 text-slate-300 cursor-not-allowed"
            : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
        }`}
      >
        {submitting
          ? "Processing payment…"
          : `Pay ${amount} ${(currency || "usd").toUpperCase()}`}
      </button>
      <p className="text-[11px] text-slate-500">
        Card payments are processed securely by Stripe in test mode. Use a test
        card (e.g., 4242 4242 4242 4242) while developing.
      </p>
    </form>
  );
}

export default function PublicFund() {
  const { token } = useParams(); // expect path /public-fund/:token
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  const [clientSecret, setClientSecret] = useState(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  useEffect(() => {
    const fetchInfo = async () => {
      if (!token) {
        setError("Missing funding token.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data } = await api.get(
          `/projects/funding/public_fund/?token=${encodeURIComponent(token)}`
        );
        setInfo(data);
        setError("");
      } catch (err) {
        console.error(err);
        const msg =
          err?.response?.data?.detail ||
          "Unable to load funding details. The link may have expired.";
        setError(msg);
        setInfo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [token]);

  useEffect(() => {
    const createPaymentIntent = async () => {
      if (!token) return;
      try {
        const { data } = await api.post(
          "/projects/funding/create_payment_intent/",
          { token }
        );

        if (data.already_paid) {
          setAlreadyPaid(true);
          setClientSecret(null);
          return;
        }

        if (data.client_secret) {
          setClientSecret(data.client_secret);
        } else {
          setError("Unable to start payment — no client secret returned.");
        }
      } catch (err) {
        console.error("create_payment_intent error:", err);
        const msg =
          err?.response?.data?.detail ||
          "Unable to start payment for this funding link.";
        setError(msg);
      }
    };

    // Only try to create PaymentIntent if we successfully loaded info
    if (info && !error) {
      createPaymentIntent();
    }
  }, [info, error, token]);

  const title = info?.project_title || "Project escrow funding";
  const amountDisplay = info ? `$${info.amount} ${(info.currency || "usd").toUpperCase()}` : "";

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col">
      <header className="px-5 py-3 border-b border-white/10 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-700" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">
              MyHomeBro — Secure Project Funding
            </div>
            <div className="text-sm font-semibold truncate max-w-xs">
              {title}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950 shadow-xl p-6 space-y-4">
          {loading ? (
            <div className="text-sm text-slate-200">Loading funding details…</div>
          ) : error ? (
            <div className="space-y-2">
              <div className="text-sm text-red-300">{error}</div>
              <p className="text-xs text-slate-400">
                If you believe this is a mistake, please contact your contractor
                directly and let them know this link is not working.
              </p>
            </div>
          ) : !info ? (
            <div className="text-sm text-slate-200">
              Funding details could not be loaded.
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-semibold mb-1">
                  Fund your project escrow
                </h1>
                <p className="text-sm text-slate-300">
                  You’re viewing a secure link to fund escrow for this project.
                  Funds will be held safely and released to your contractor only
                  when work is completed and approved.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/60 bg-emerald-900/20 p-4 space-y-2">
                <div className="text-xs uppercase tracking-wide text-emerald-300">
                  Project summary
                </div>
                <div className="text-sm text-slate-100">
                  <div>
                    <span className="text-slate-400 text-xs">
                      Project title:
                    </span>{" "}
                    {info.project_title || "Your project"}
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">
                      Contractor:
                    </span>{" "}
                    {info.contractor_name || "Your contractor"}
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">
                      Homeowner:
                    </span>{" "}
                    {info.homeowner_name || "You"}
                  </div>
                </div>

                <div className="pt-2 border-t border-emerald-500/40 mt-2">
                  <div className="text-xs text-slate-400">Amount to fund</div>
                  <div className="text-2xl font-bold text-emerald-300">
                    ${info.amount}{" "}
                    <span className="text-sm font-semibold">
                      {(info.currency || "usd").toUpperCase()}
                    </span>
                  </div>
                  {info.expires_at && (
                    <div className="text-[11px] text-emerald-200 mt-1">
                      Link expires:{" "}
                      {new Date(info.expires_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              {info.escrow_funded || alreadyPaid ? (
                <div className="rounded-lg border border-emerald-500/50 bg-emerald-900/30 p-3 text-sm text-emerald-100">
                  This escrow appears to already be funded. If you have any
                  questions, please contact your contractor directly.
                </div>
              ) : clientSecret ? (
                stripePromise ? (
                  <Elements
                    stripe={stripePromise}
                    options={{ clientSecret }}
                  >
                    <FundingPaymentForm
                      clientSecret={clientSecret}
                      amount={amountDisplay}
                      currency={info.currency}
                    />
                  </Elements>
                ) : (
                  <div className="text-sm text-red-300">
                    Stripe is not configured on this page (missing publishable
                    key). Please contact support.
                  </div>
                )
              ) : (
                <div className="text-sm text-slate-200">
                  Payment is not available for this funding link right now.
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
