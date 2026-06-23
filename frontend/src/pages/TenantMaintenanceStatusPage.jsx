import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import logo from "../assets/myhomebro_logo.png";

function formatDate(value) {
  if (!value) return "Not available";
  try {
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export default function TenantMaintenanceStatusPage() {
  const { token = "" } = useParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .get(`/projects/maintenance-request/status/${encodeURIComponent(token)}/`)
      .then(({ data }) => {
        if (alive) setStatus(data);
      })
      .catch((err) => {
        if (alive) setError(err?.response?.data?.detail || "We could not open that maintenance request status link.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <main className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-3">
            <img src={logo} alt="MyHomeBro" className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
            <span className="text-sm font-black uppercase tracking-[0.2em] text-amber-100">MyHomeBro</span>
          </Link>
        </div>

        <section data-testid="tenant-maintenance-status-page" className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-100">Maintenance Request Status</div>
          <h1 className="mt-2 text-2xl font-black text-white">{status?.reference || "Request Status"}</h1>

          {loading ? (
            <div data-testid="tenant-maintenance-status-loading" className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
              Loading request status...
            </div>
          ) : error ? (
            <div data-testid="tenant-maintenance-status-error" className="mt-5 rounded-xl border border-rose-300/35 bg-rose-400/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-emerald-300/35 bg-emerald-400/10 p-4">
                <div className="text-sm font-bold text-emerald-100">Current Status</div>
                <div data-testid="tenant-maintenance-status-label" className="mt-1 text-xl font-black text-white">
                  {status?.status_label || "Submitted"}
                </div>
                <div className="mt-2 text-sm text-slate-300">Submitted {formatDate(status?.submitted_at)}</div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="font-semibold text-white">{status?.title || "Maintenance request"}</div>
                <div className="mt-2">{status?.property?.display_name || "Managed property"}</div>
                {status?.property?.address ? <div className="mt-1">{status.property.address}</div> : null}
                <div className="mt-1">{status?.unit?.display || "Whole property residence"}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-slate-600 px-2.5 py-1">{status?.category_label || "Maintenance"}</span>
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-amber-100">{status?.urgency_label || "Normal"}</span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
                <h2 className="text-sm font-bold text-white">Timeline</h2>
                <div className="mt-4 space-y-3">
                  {(status?.timeline || []).map((item, index) => (
                    <div key={`${item.status}-${index}`} data-testid={`tenant-maintenance-status-timeline-${index}`} className="border-l border-slate-700 pl-4 text-sm">
                      <div className="font-semibold text-slate-100">{item.label}</div>
                      <div className="mt-1 text-slate-400">{item.description}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
