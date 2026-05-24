import React, { useMemo, useState } from "react";

const REQUEST_TYPES = [
  ["repair", "Repair"],
  ["maintenance", "Maintenance"],
  ["new_project", "New Project"],
  ["diy_assistance", "DIY Assistance"],
  ["inspection", "Inspection"],
  ["emergency", "Emergency"],
];

function Badge({ children }) {
  return (
    <span className="inline-flex rounded-full border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200">
      {children}
    </span>
  );
}

export default function CustomerRequests({
  requests = [],
  bids = [],
  propertyProfile = {},
  onCreateRequest,
  onAcceptBid,
  acceptingBidId = "",
  creating = false,
}) {
  const [form, setForm] = useState({
    request_type: "repair",
    title: "",
    description: "",
    urgency: "normal",
    preferred_timeline: "",
    address_line1: propertyProfile?.address_line1 || "",
    address_line2: propertyProfile?.address_line2 || "",
    city: propertyProfile?.city || "",
    state: propertyProfile?.state || "",
    postal_code: propertyProfile?.postal_code || "",
  });

  const internalRequests = useMemo(
    () => requests.filter((row) => row.source_kind === "customer_request"),
    [requests]
  );

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    await onCreateRequest?.(form);
    setForm((prev) => ({
      ...prev,
      title: "",
      description: "",
      preferred_timeline: "",
      urgency: "normal",
    }));
  };

  return (
    <div data-testid="customer-requests" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section data-testid="customer-portal-requests" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Requests</h2>
            <p className="mt-1 text-sm text-slate-300">
              Repair, maintenance, new project, DIY assistance, inspection, and emergency requests stay internal until MyHomeBro routes them.
            </p>
          </div>
          <Badge>{requests.length} total</Badge>
        </div>

        <div className="mt-4 space-y-3">
          {requests.length ? (
            requests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">{request.project_title}</div>
                    <div className="mt-1 text-sm text-slate-400">{request.notes || request.project_address || "Request details pending."}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{request.request_type_label || request.project_class_label || "Request"}</Badge>
                    <Badge>{request.status_label || "Submitted"}</Badge>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-400">
              Requests you submit through this portal will appear here.
            </div>
          )}
        </div>

        {internalRequests.length ? (
          <div className="mt-4 rounded-xl border border-sky-300/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            New portal requests are saved internally and are not published to the marketplace yet.
          </div>
        ) : null}

        <div data-testid="customer-portal-bids" className="mt-6 border-t border-slate-700 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Bids received</h3>
            <Badge>{bids.length} bids</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {bids.length ? (
              bids.map((bid) => (
                <div key={bid.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">{bid.project_title}</div>
                      <div className="mt-1 text-sm text-slate-400">{bid.contractor_name || "Contractor"} - {bid.bid_amount_label || "Bid pending"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{bid.status_label || "Submitted"}</Badge>
                      {bid.linked_agreement_token ? (
                        <a
                          data-testid={`customer-portal-bid-open-${bid.id}`}
                          href={`/agreements/magic/${bid.linked_agreement_token}`}
                          className="rounded-lg border border-sky-300/40 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/10"
                        >
                          Open agreement
                        </a>
                      ) : bid.can_accept ? (
                        <button
                          type="button"
                          data-testid={`customer-portal-bid-accept-${bid.id}`}
                          onClick={() => onAcceptBid?.(bid)}
                          disabled={acceptingBidId === bid.id}
                          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
                      >
                          {acceptingBidId === bid.id ? "Accepting..." : "Accept"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-400">
                Bids from contractors will appear here when available.
              </div>
            )}
          </div>
        </div>
      </section>

      <form onSubmit={submit} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-5">
        <h3 className="text-lg font-semibold text-white">New request</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-200">
            Type
            <select
              value={form.request_type}
              onChange={(event) => update("request_type", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              {REQUEST_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Title
            <input
              value={form.title}
              onChange={(event) => update("title", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              placeholder="Leaking sink, spring maintenance, deck inspection..."
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Details
            <textarea
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              placeholder="Describe what is happening, where it is located, and what help you need."
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-200">
              Urgency
              <select
                value={form.urgency}
                onChange={(event) => update("urgency", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              >
                <option value="normal">Normal</option>
                <option value="soon">Soon</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-200">
              Timeline
              <input
                value={form.preferred_timeline}
                onChange={(event) => update("preferred_timeline", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                placeholder="This week, next month..."
              />
            </label>
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || !form.title.trim() || !form.description.trim()}
          className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Saving..." : "Save request"}
        </button>
      </form>
    </div>
  );
}
