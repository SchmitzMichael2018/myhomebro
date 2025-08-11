import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function OnboardingRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const startRedirect = async () => {
      try {
        const token = localStorage.getItem("access");
        const res = await api.post("/projects/contractors/onboard/", {}, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const url = res.data?.onboarding_url;
        if (url) {
          window.location.href = url;
        } else {
          navigate("/dashboard");
        }
      } catch (err) {
        console.error("Stripe onboarding error:", err);
        navigate("/dashboard");
      }
    };

    setTimeout(startRedirect, 1200); // Show spinner briefly before redirect
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white text-center">
      <div>
        <h2 className="text-xl font-bold text-blue-700 mb-4">Preparing Stripe Onboarding...</h2>
        <p className="text-gray-600">Please wait while we generate your secure Stripe link.</p>
        <div className="mt-6">
          <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-8 8z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
