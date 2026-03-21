import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

export default function StartProjectIntake() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [starting, setStarting] = useState(true);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function startIntake() {
      try {
        setStarting(true);
        setStartError("");

        const payload = {
          customer_name: (searchParams.get("name") || "").trim(),
          customer_email: (searchParams.get("email") || "").trim(),
          customer_phone: (searchParams.get("phone") || "").trim(),
        };

        const { data } = await api.post("/projects/public-intake/start/", payload);
        if (cancelled) return;

        const token = data?.token;
        if (!token) {
          setStartError("Could not start project intake.");
          return;
        }

        navigate(`/start-project/${token}`, { replace: true });
      } catch (e) {
        if (cancelled) return;
        const message =
          e?.response?.data?.detail || "Could not start your project intake.";
        setStartError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    startIntake();
    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Start Project Intake</h1>
        {starting ? (
          <p className="mt-2 text-sm text-gray-600">
            Opening your project intake form…
          </p>
        ) : startError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {startError}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            Redirecting to your intake form…
          </p>
        )}
      </div>
    </div>
  );
}
