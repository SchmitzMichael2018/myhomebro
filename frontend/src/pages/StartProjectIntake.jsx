import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api, { debugAxiosError, extractApiErrorMessage } from "../api";

const PUBLIC_INTAKE_STORAGE_PATTERNS = [
  /^public[-_:]?intake/i,
  /^start[-_:]?project/i,
  /^myhomebro[-_:]?public[-_:]?intake/i,
  /^mhb[-_:]?public[-_:]?intake/i,
];

export function resetPublicIntakeWizardState() {
  if (typeof window === "undefined") return;
  const clearMatchingKeys = (storage) => {
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key && PUBLIC_INTAKE_STORAGE_PATTERNS.some((pattern) => pattern.test(key))) {
        storage.removeItem(key);
      }
    }
  };
  clearMatchingKeys(window.localStorage);
  clearMatchingKeys(window.sessionStorage);
}

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
        resetPublicIntakeWizardState();

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

        try {
          window.sessionStorage.setItem("mhb-public-intake-fresh-token", token);
        } catch {
          // Non-critical; navigation state also marks this as a new project start.
        }
        navigate(`/start-project/${token}`, { replace: true, state: { publicIntakeFreshStart: true } });
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
    <div className="min-h-screen bg-[linear-gradient(135deg,#020617_0%,#082f63_52%,#0f172a_100%)] px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/15 bg-white/10 p-2 shadow-2xl shadow-slate-950/35 backdrop-blur">
        <div className="rounded-[1.35rem] border border-slate-200/80 bg-white p-6 text-slate-900 shadow-xl">
          <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            MyHomeBro Records
          </div>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">Starting your project request</h1>
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
    </div>
  );
}
