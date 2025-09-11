import React, { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";

/**
 * Publishable key source:
 *  - Vite: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
 *  - or set window.STRIPE_PK = "pk_live_..." before your app loads.
 */
const STRIPE_PK =
  (typeof import.meta !== "undefined" &&
    import.meta?.env?.VITE_STRIPE_PUBLISHABLE_KEY) ||
  (typeof window !== "undefined" && window.STRIPE_PK) ||
  "";

// Lazily created once
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

/** Internal guard so we don't double-wrap <Elements> */
function ElementsFlag({ children }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      const prev = window.__MHB_ELEMENTS_ACTIVE__;
      window.__MHB_ELEMENTS_ACTIVE__ = true;
      return () => {
        window.__MHB_ELEMENTS_ACTIVE__ = prev;
      };
    }
  }, []);
  return children;
}

/** The inner modal that actually calls useStripe/useElements */
function EscrowInner({ onClose, stripeClientSecret, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [ok, setOk] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrMsg("");

    if (!stripe || !elements) {
      setErrMsg(
        "Payment UI is not ready yet. Please wait a moment and try again."
      );
      return;
    }
    if (!stripeClientSecret) {
      setErrMsg("Missing payment client secret.");
      return;
    }

    setSubmitting(true);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setErrMsg(error.message || "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    const status = paymentIntent?.status;
    if (status === "succeeded" || status === "processing") {
      setOk(true);
      setSubmitting(false);
      try {
        onSuccess?.();
      } catch {}
      // Optional: auto-close after a short delay
      // setTimeout(onClose, 1200);
    } else {
      setErrMsg(`Payment is ${status || "incomplete"}. You can try again.`);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-xl"
          aria-label="Close"
          type="button"
        >
          ✖
        </button>

        <h3 className="text-xl font-bold mb-2">Fund Project Escrow</h3>
        <p className="text-sm text-gray-700 mb-4">
          Your agreement is ready. To activate and enforce it, please fund the
          escrow now.
        </p>

        {!ok ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <PaymentElement />

            {errMsg && <div className="text-red-600 text-sm">{errMsg}</div>}

            <button
              type="submit"
              disabled={submitting || !stripe || !elements}
              className={`w-full py-2 rounded text-white font-semibold ${
                submitting || !stripe || !elements
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {submitting ? "Processing…" : "Fund Escrow"}
            </button>
          </form>
        ) : (
          <div className="text-green-600 font-semibold text-center my-4">
            ✅ Escrow payment successful. Thank you!
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Self-wrapping Escrow modal:
 * - If already inside <Elements>, we render the inner modal directly.
 * - If not, we wrap with <Elements> using the provided client_secret.
 *
 * Props:
 *  - visible: boolean
 *  - onClose: () => void
 *  - stripeClientSecret: string (from /fund_escrow/)
 *  - onSuccess?: () => void (optional)
 *  - elementsProvided?: boolean (optional hint from parent to skip wrapping)
 */
export default function EscrowPromptModal(props) {
  const {
    visible,
    onClose,
    stripeClientSecret,
    onSuccess,
    elementsProvided = false,
  } = props;

  if (!visible) return null;

  // If a parent already wrapped with <Elements>, render inner directly.
  const parentElementsActive =
    (typeof window !== "undefined" && window.__MHB_ELEMENTS_ACTIVE__) ||
    elementsProvided;

  if (parentElementsActive) {
    return (
      <EscrowInner
        onClose={onClose}
        stripeClientSecret={stripeClientSecret}
        onSuccess={onSuccess}
      />
    );
  }

  // Otherwise, self-wrap if we have config & client secret.
  if (!STRIPE_PK) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded shadow max-w-md w-full text-center">
          <h4 className="text-lg font-semibold mb-2">Stripe not configured</h4>
          <p className="text-sm text-gray-600">
            Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> and rebuild, or define{" "}
            <code>window.STRIPE_PK</code> before loading the app.
          </p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!stripePromise || !stripeClientSecret) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded shadow max-w-md w-full text-center">
          <h4 className="text-lg font-semibold mb-2">Escrow not ready</h4>
          <p className="text-sm text-gray-600">
            Missing Stripe client secret. Try starting escrow again.
          </p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Self-wrapped <Elements> context
  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret: stripeClientSecret, appearance: { theme: "stripe" } }}
    >
      <ElementsFlag>
        <EscrowInner
          onClose={onClose}
          stripeClientSecret={stripeClientSecret}
          onSuccess={onSuccess}
        />
      </ElementsFlag>
    </Elements>
  );
}
