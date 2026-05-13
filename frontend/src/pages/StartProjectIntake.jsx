import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api, { debugAxiosError, extractApiErrorMessage } from "../api";

function resolveStartToken(data) {
  const token =
    data?.token ||
    data?.share_token ||
    data?.intake_token ||
    data?.public_token ||
    "";
  if (token) return String(token).trim();

  const publicUrl = String(data?.public_url || data?.url || "").trim();
  if (!publicUrl) return "";

  try {
    const path = new URL(publicUrl, window.location.origin).pathname.replace(/\/+$/, "");
    const match = path.match(/\/(?:start-project|public-intake)\/([^/]+)$/i);
    return match?.[1] ? String(match[1]).trim() : "";
  } catch {
    return "";
  }
}

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
          contractor_slug:
            (searchParams.get("contractor_slug") ||
              searchParams.get("contractor") ||
              searchParams.get("slug") ||
              "").trim(),
          source: (searchParams.get("source") || "landing_page").trim(),
        };

        const { data } = await api.post("/projects/public-intake/start/", payload);
        if (cancelled) return;

        const token = resolveStartToken(data);
        if (!token) {
          console.error("Could not start project intake: missing token in response", {
            responseData: data,
            payload,
          });
          setStartError("Could not start project intake.");
          return;
        }

        navigate(`/start-project/${token}`, { replace: true });
      } catch (e) {
        if (cancelled) return;
        debugAxiosError(e, "Public intake start");
        const message =
          extractApiErrorMessage(e) ||
          e?.response?.data?.detail ||
          "Could not start your project intake.";
        console.error("Could not start project intake", {
          message,
          status: e?.response?.status,
          responseData: e?.response?.data,
        });
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
        <h1 className="text-2xl font-bold text-gray-900">Starting your project request</h1>
        {starting ? (
          <p className="mt-2 text-sm text-gray-600">
            Opening your single project request form...
          </p>
        ) : startError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {startError}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            Redirecting to your project request...
          </p>
        )}
      </div>
    </div>
  );
}
