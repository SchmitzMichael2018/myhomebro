import React, { useState, useEffect } from "react";
import api from "../api";

export default function StripeOnboarding() {
  const [loading, setLoading] = useState(true);
  const [onboardingUrl, setOnboardingUrl] = useState("");
  const [onboardingStatus, setOnboardingStatus] = useState("");
  const [error, setError] = useState("");

  // Fetch onboarding status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/projects/contractor-onboarding-status/");
        setOnboardingStatus(data.onboarding_status || "incomplete");
        setOnboardingUrl(data.onboarding_url || "");
      } catch (err) {
        setError("Failed to fetch onboarding status.");
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const handleStartOnboarding = async () => {
    setLoading(true);
    setError("");
    try {
      // This should hit your backend endpoint that creates a new onboarding link
      const { data } = await api.post("/projects/contractor-onboarding/");
      if (data.onboarding_url) {
        window.location.href = data.onboarding_url; // Redirect to Stripe onboarding
      } else {
        setError("Onboarding URL not returned from server.");
      }
    } catch (err) {
      setError("Failed to start onboarding.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-16 bg-white rounded shadow p-8 text-center">
      <h2 className="text-2xl font-bold mb-4 text-blue-700">Stripe Connect Onboarding</h2>

      {loading ? (
        <div>Loading status...</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : (
        <>
          <p className="mb-4">
            <span className="font-semibold">Onboarding Status:</span>{" "}
            <span
              className={
                onboardingStatus === "completed"
                  ? "text-green-600"
                  : "text-yellow-600"
              }
            >
              {onboardingStatus.charAt(0).toUpperCase() + onboardingStatus.slice(1)}
            </span>
          </p>

          {onboardingStatus !== "completed" ? (
            <button
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-semibold"
              onClick={handleStartOnboarding}
              disabled={loading}
            >
              {onboardingUrl ? "Continue Onboarding" : "Start Onboarding"}
            </button>
          ) : (
            <div className="text-green-700 font-semibold">
              Onboarding Complete! <br />
              Your Stripe account is ready to accept payouts.
            </div>
          )}
        </>
      )}
    </div>
  );
}

