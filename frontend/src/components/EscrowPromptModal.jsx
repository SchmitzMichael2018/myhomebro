import React, { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { getStripePublishableKey } from "../lib/runtimeConfig";

const STRIPE_PK =
  getStripePublishableKey() ||
  (typeof window !== "undefined" && window.STRIPE_PK) ||
  "";

const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

function EscrowInner({ onClose, stripeClientSecret, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [status, setStatus] = useState("ready"); // ready | success | already_paid

  /** 🔒 Guard: detect already-succeeded PI */
  useEffect(() => {
    if (!stripe || !stripeClientSecret) return;

    stripe.retrievePaymentIntent(stripeClientSecret).then((res) => {
      if (res?.paymentIntent?.status === "succeeded") {
        setStatus("already_paid");
      }
    });
  }, [stripe, stripeClientSecret]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setErrMsg("");

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      if (
        error.code === "payment_intent_unexpected_state" &&
        error.message?.includes("already succeeded")
      ) {
        setStatus("already_paid");
        setSubmitting(false);
        return;
      }

      setErrMsg(error.message || "Payment failed.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      setStatus("success");
      setSubmitting(false);
      onSuccess?.();
      return;
    }

    setErrMsg(`Payment status: ${paymentIntent?.status}`);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500"
        >
          ✖
        </button>

        <h3 className="text-xl font-bold mb-2">Fund Project Escrow</h3>

        {status === "already_paid" && (
          <div className="text-green-700 text-sm">
            ✅ This escrow payment has already been completed.
          </div>
        )}

        {status === "success" && (
          <div className="text-green-700 text-sm">
            ✅ Payment successful. You may close this window.
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <PaymentElement />
            {errMsg && <div className="text-red-600 text-sm">{errMsg}</div>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 rounded bg-emerald-600 text-white"
            >
              {submitting ? "Processing…" : "Fund Escrow"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function EscrowPromptModal({
  visible,
  onClose,
  stripeClientSecret,
  onSuccess,
}) {
  if (!visible) return null;

  if (!stripePromise || !stripeClientSecret) {
    return null;
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: stripeClientSecret }}>
      <EscrowInner
        onClose={onClose}
        stripeClientSecret={stripeClientSecret}
        onSuccess={onSuccess}
      />
    </Elements>
  );
}
