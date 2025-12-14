// frontend/src/components/PublicFund.jsx
// v2025-12-14 — MyHomeBro themed Public Fund page + defensive rendering
// - MyHomeBro theme: primary blue (#1E3A8A), accent green (#22C55E), Inter font
// - Prevents Stripe Elements mounting without a clientSecret
// - Uses remaining_to_fund from backend as truth
// - Shows clear loading/error states (no blank page)

import React, { useEffect, useMemo, useState } from "react";
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

function FundingPaymentForm({ clientSecret, amountLabel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  useEffect(() => {
    if (!stripe || !clientSecret) return;
    stripe.retrievePaymentIntent(clientSecret).then((res) => {
      if (res?.paymentIntent?.status === "succeeded") {
        setAlreadyPaid(true);
      }
    });
  }, [stripe, clientSecret]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      toast.error(error.message || "Payment failed");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      toast.success("Payment completed");
      setAlreadyPaid(true);
    }

    setSubmitting(false);
  };

  if (alreadyPaid) {
    return (
      <div className="p-6 text-green-700 bg-green-50 border border-green-200 rounded-2xl">
        ✅ This escrow payment has already been processed.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-2xl bg-accent text-white font-semibold hover:opacity-95 disabled:opacity-60"
      >
        {submitting ? "Processing…" : `Pay ${amountLabel}`}
      </button>

      <div className="text-xs text-gray-500">
        Payments are processed securely by Stripe.
      </div>
    </form>
  );
}

export default function PublicFund() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [error, setError] = useState("");

  // Load link info
  useEffect(() => {
    const t = encodeURIComponent(token || "");
    if (!t) {
      setError("Missing funding link token.");
      return;
    }

    setError("");
    setInfo(null);
    setClientSecret(null);

    api
      .get(`/projects/funding/public_fund/?token=${t}`)
      .then(({ data }) => setInfo(data))
      .catch((err) => {
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          "Invalid or expired funding link.";
        setError(String(msg));
      });
  }, [token]);

  const remaining =
    info?.remaining_to_fund != null ? Number(info.remaining_to_fund) : NaN;

  // Create PI if needed
  useEffect(() => {
    if (!info) return;
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) return;

    api
      .post("/projects/funding/create_payment_intent/", { token })
      .then(({ data }) => {
        if (data?.already_paid) return;
        setClientSecret(data?.client_secret || null);
      })
      .catch((err) => {
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          "Unable to start payment.";
        setError(String(msg));
      });
  }, [info, token, remaining]);

  // Stripe appearance: match MyHomeBro Tailwind theme
  const elementsOptions = useMemo(() => {
    if (!clientSecret) return null;

    return {
      clientSecret,
      appearance: {
        theme: "stripe",
        variables: {
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
          fontSizeBase: "15px",
          colorPrimary: "#22C55E",   // accent
          colorText: "#1F2937",      // dark
          colorDanger: "#DC2626",
          colorBackground: "#FFFFFF",
          borderRadius: "16px",
          spacingUnit: "6px",
        },
        rules: {
          ".Label": {
            fontWeight: "600",
            color: "#1E3A8A", // primary blue
          },
          ".Input": {
            border: "1px solid rgba(30,58,138,0.25)",
            boxShadow: "none",
          },
          ".Input:focus": {
            border: "1px solid #22C55E",
            boxShadow: "0 0 0 3px rgba(34,197,94,0.20)",
          },
          ".Tab": {
            border: "1px solid rgba(30,58,138,0.25)",
          },
          ".Tab--selected": {
            border: "1px solid #22C55E",
          },
          ".Block": {
            borderRadius: "16px",
          },
        },
      },
    };
  }, [clientSecret]);

  const Shell = ({ children }) => (
    <div className="min-h-[80vh] bg-light flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl space-y-4">{children}</div>
    </div>
  );

  if (error) {
    return (
      <Shell>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-bold text-danger">
            Unable to load funding link
          </div>
          <div className="mt-2 text-sm text-danger">{error}</div>
        </div>
      </Shell>
    );
  }

  if (!info) {
    return (
      <Shell>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">Loading…</div>
      </Shell>
    );
  }

  if (!Number.isFinite(remaining)) {
    return (
      <Shell>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          Preparing payment…
        </div>
      </Shell>
    );
  }

  if (remaining <= 0) {
    return (
      <Shell>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-bold text-accent">Escrow is fully funded</div>
          <div className="mt-2 text-sm text-accent">
            ✅ No additional payment is required.
          </div>
        </div>
      </Shell>
    );
  }

  if (!clientSecret || !elementsOptions) {
    return (
      <Shell>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          Initializing secure payment…
        </div>
      </Shell>
    );
  }

  const projectTitle = info.project_title || "Your project";
  const fundedSoFar = Number(info.escrow_funded_amount || 0);
  const totalRequired = Number(info.total_required || 0);

  return (
    <Shell>
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-xl font-extrabold text-primary">Fund Escrow</div>
        <div className="mt-1 text-sm text-gray-600">{projectTitle}</div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border bg-light p-3">
            <div className="text-xs text-gray-500">Amount due now</div>
            <div className="text-lg font-bold text-dark">
              ${remaining.toFixed(2)}
            </div>
          </div>

          <div className="rounded-2xl border bg-light p-3">
            <div className="text-xs text-gray-500">Funded so far</div>
            <div className="text-lg font-bold text-dark">
              ${fundedSoFar.toFixed(2)}
            </div>
          </div>

          <div className="rounded-2xl border bg-light p-3">
            <div className="text-xs text-gray-500">Total required</div>
            <div className="text-lg font-bold text-dark">
              ${totalRequired.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <Elements stripe={stripePromise} options={elementsOptions}>
          <FundingPaymentForm
            clientSecret={clientSecret}
            amountLabel={`$${remaining.toFixed(2)}`}
          />
        </Elements>
      </div>

      <div className="text-center text-xs text-gray-500">
        © {new Date().getFullYear()} MyHomeBro
      </div>
    </Shell>
  );
}
