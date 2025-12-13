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

function FundingPaymentForm({ clientSecret, amount }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  /** 🔒 Detect already-paid PI */
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
      if (
        error.code === "payment_intent_unexpected_state" &&
        error.message?.includes("already succeeded")
      ) {
        setAlreadyPaid(true);
        setSubmitting(false);
        return;
      }
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
      <div className="text-green-400 text-sm">
        ✅ This escrow has already been funded.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2 rounded bg-emerald-500 text-black"
      >
        {submitting ? "Processing…" : `Pay ${amount}`}
      </button>
    </form>
  );
}

export default function PublicFund() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/projects/funding/public_fund/?token=${token}`)
      .then(({ data }) => setInfo(data))
      .catch(() => setError("Invalid or expired funding link"));
  }, [token]);

  useEffect(() => {
    if (!info || info.escrow_funded) return;

    api
      .post("/projects/funding/create_payment_intent/", { token })
      .then(({ data }) => {
        if (data.already_paid) return;
        setClientSecret(data.client_secret);
      })
      .catch(() => setError("Unable to start payment"));
  }, [info, token]);

  if (error) return <div>{error}</div>;
  if (!info) return <div>Loading…</div>;

  if (info.escrow_funded) {
    return <div className="text-green-500">Escrow already funded.</div>;
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <FundingPaymentForm clientSecret={clientSecret} amount={`$${info.amount}`} />
    </Elements>
  );
}
