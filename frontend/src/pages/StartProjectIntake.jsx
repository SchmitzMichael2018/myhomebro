import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { LockKeyhole } from "lucide-react";
import api, { debugAxiosError, extractApiErrorMessage } from "../api";
import logo from "../assets/myhomebro_logo.png";

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
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [contact, setContact] = useState({
    name: (searchParams.get("name") || "").trim(),
    email: (searchParams.get("email") || "").trim(),
    phone: (searchParams.get("phone") || "").trim(),
  });

  const canStart = useMemo(
    () => Boolean(contact.name.trim() && contact.email.trim() && contact.phone.trim()),
    [contact]
  );

  async function startIntake(event) {
    event?.preventDefault();
    if (!canStart) {
      toast.error("Add your full name, email, and phone to start.");
      return;
    }

    try {
      setStarting(true);
      setStartError("");
      resetPublicIntakeWizardState();

      const payload = {
        customer_name: contact.name.trim(),
        customer_email: contact.email.trim(),
        customer_phone: contact.phone.trim(),
        contractor_slug:
          (searchParams.get("contractor_slug") ||
            searchParams.get("contractor") ||
            searchParams.get("slug") ||
            "").trim(),
        source: (searchParams.get("source") || "landing_page").trim(),
      };

      const { data } = await api.post("/projects/public-intake/start/", payload);
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
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#020617_0%,#062856_52%,#0f172a_100%)] text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="hidden w-[21rem] shrink-0 border-r border-white/10 bg-slate-950/35 px-7 py-8 lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-blue-300/15 bg-blue-950/45 p-1.5 shadow-lg shadow-blue-950/30">
              <img src={logo} alt="MyHomeBro" className="h-11 w-auto" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-white">
              MyHome<span className="text-amber-300">Bro</span>
            </div>
          </div>
          <div className="mt-12">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Start Your Project</h1>
            <p className="mt-6 text-base font-medium leading-7 text-sky-50">
              We&apos;re preparing your secure intake workspace.
            </p>
          </div>
          <div className="mt-9 rounded-2xl border border-blue-300/15 bg-blue-950/30 p-6 shadow-xl shadow-blue-950/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/35 bg-amber-300/10 text-amber-200">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="text-base font-semibold text-white">Secure &amp; Private</div>
            </div>
            <p className="mt-4 text-sm leading-6 text-sky-50/85">
              Your intake link keeps your project details connected to the right contractor workflow.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-2xl rounded-3xl border border-white/15 bg-white/10 p-2 shadow-2xl shadow-slate-950/35 backdrop-blur">
            <div className="rounded-[1.35rem] border border-slate-200/80 bg-white p-6 text-slate-900 shadow-xl">
              <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Customer Portal
              </div>
              <h1 className="mt-3 text-2xl font-bold text-gray-900">Start your project request</h1>
              <p className="mt-2 text-sm text-gray-600">
                Add your contact details first. If you already have an account, we&apos;ll link this request to it.
              </p>
              <form className="mt-5 space-y-4" onSubmit={startIntake} data-testid="start-project-contact-form">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="start-project-name">
                    Full name
                  </label>
                  <input
                    id="start-project-name"
                    data-testid="start-project-contact-name"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    value={contact.name}
                    onChange={(event) => setContact((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Your full name"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="start-project-email">
                    Email
                  </label>
                  <input
                    id="start-project-email"
                    data-testid="start-project-contact-email"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    value={contact.email}
                    onChange={(event) => setContact((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="you@example.com"
                    autoComplete="email"
                    type="email"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="start-project-phone">
                    Phone
                  </label>
                  <input
                    id="start-project-phone"
                    data-testid="start-project-contact-phone"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    value={contact.phone}
                    onChange={(event) => setContact((prev) => ({ ...prev, phone: event.target.value }))}
                    placeholder="(555) 555-5555"
                    autoComplete="tel"
                  />
                </div>
                {startError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {startError}
                  </div>
                ) : null}
                <button
                  type="submit"
                  data-testid="start-project-contact-submit"
                  disabled={starting || !canStart}
                  className="w-full rounded-2xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {starting ? "Opening your request..." : "Continue to project details"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
