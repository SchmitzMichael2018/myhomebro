import React, { useState } from "react";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";

export default function EscrowPromptModal({ visible, onClose, stripeClientSecret, onSuccess }) {
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const stripe = useStripe();
  const elements = useElements();

  if (!visible) return null;

  const handlePayment = async (e) => {
    e.preventDefault();
    setPaymentLoading(true);
    setError("");
    if (!stripe || !elements) {
      setError("Stripe is not loaded yet.");
      setPaymentLoading(false);
      return;
    }
    const cardElement = elements.getElement(CardElement);

    const { error, paymentIntent } = await stripe.confirmCardPayment(stripeClientSecret, {
      payment_method: {
        card: cardElement,
      },
    });

    if (error) {
      setError(error.message);
      setPaymentLoading(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      setPaymentSuccess(true);
      setPaymentLoading(false);
      onSuccess?.();
      // Optionally, call onClose() after a delay
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-xl"
          aria-label="Close"
        >
          ✖
        </button>
        <h3 className="text-xl font-bold mb-2">Escrow Funding Required</h3>
        <p className="mb-4">
          Agreement signed! To activate and enforce this agreement, please fund the escrow account using a secure card payment.
        </p>
        {!paymentSuccess ? (
          <form onSubmit={handlePayment} className="space-y-4">
            <CardElement className="border rounded p-2" options={{ hidePostalCode: true }} />
            {error && <div className="text-red-500">{error}</div>}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700"
              disabled={paymentLoading || !stripe}
            >
              {paymentLoading ? "Processing..." : "Fund Escrow"}
            </button>
          </form>
        ) : (
          <div className="text-green-600 font-bold text-center my-4">
            ✅ Escrow payment successful! Thank you.
          </div>
        )}
      </div>
    </div>
  );
}
