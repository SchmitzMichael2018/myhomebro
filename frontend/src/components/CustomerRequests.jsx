import React, { useMemo, useState } from "react";
import AddressAutocomplete from "./AddressAutocomplete.jsx";

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

function HighlightBadge({ children }) {
  return (
    <span className="inline-flex rounded-full border border-amber-200/40 bg-amber-300/15 px-2.5 py-1 text-xs font-bold text-amber-100">
      {children}
    </span>
  );
}

function EmptyState({ title, children, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-300">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function parseMoney(value) {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function timelineScore(value) {
  const text = String(value || "").toLowerCase();
  const number = Number((text.match(/\d+/) || [])[0]);
  if (!Number.isFinite(number)) return Number.POSITIVE_INFINITY;
  if (text.includes("day")) return number;
  if (text.includes("week")) return number * 7;
  if (text.includes("month")) return number * 30;
  if (text.includes("q1") || text.includes("q2") || text.includes("q3") || text.includes("q4")) return 90;
  return number;
}

function comparisonHighlights(bids) {
  const prices = bids
    .map((bid) => ({ id: bid.id, value: parseMoney(bid.bid_amount ?? bid.bid_amount_label) }))
    .filter((row) => row.value != null && row.value > 0);
  const timelines = bids
    .map((bid) => ({ id: bid.id, value: timelineScore(bid.timeline) }))
    .filter((row) => Number.isFinite(row.value));
  const milestoneCounts = bids.map((bid) => ({
    id: bid.id,
    value: Number(bid.milestone_count || (Array.isArray(bid.milestone_preview) ? bid.milestone_preview.length : 0)),
  }));
  const lowestPrice = prices.length ? Math.min(...prices.map((row) => row.value)) : null;
  const shortestTimeline = timelines.length ? Math.min(...timelines.map((row) => row.value)) : null;
  const mostMilestones = milestoneCounts.length ? Math.max(...milestoneCounts.map((row) => row.value)) : 0;

  return bids.reduce((acc, bid) => {
    const badges = [];
    const price = parseMoney(bid.bid_amount ?? bid.bid_amount_label);
    const time = timelineScore(bid.timeline);
    const milestoneCount = Number(bid.milestone_count || (Array.isArray(bid.milestone_preview) ? bid.milestone_preview.length : 0));
    if (lowestPrice != null && price === lowestPrice) badges.push("Lowest price");
    if (Number.isFinite(shortestTimeline) && time === shortestTimeline) badges.push("Shortest timeline");
    if (mostMilestones > 0 && milestoneCount === mostMilestones) badges.push("Most detailed milestone plan");
    if (bid.contractor_preferred) badges.push("Preferred status reviewed");
    if (bid.contractor_verified) badges.push("Profile reviewed");
    acc[bid.id] = badges;
    return acc;
  }, {});
}

export default function CustomerRequests({
  requests = [],
  bids = [],
  propertyProfile = {},
  propertyProfiles = [],
  onCreateRequest,
  onAcceptBid,
  acceptingBidId = "",
  creating = false,
}) {
  const [pendingAwardBid, setPendingAwardBid] = useState(null);
  const [activeComparisonKey, setActiveComparisonKey] = useState("");
  const propertyOptions = propertyProfiles.length ? propertyProfiles : propertyProfile?.id ? [propertyProfile] : [];
  const [form, setForm] = useState({
    property_id: propertyProfile?.id || "",
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
  const bidsByComparisonKey = useMemo(() => {
    const grouped = {};
    bids.forEach((bid) => {
      const key = bid.comparison_key || "";
      if (!key) return;
      grouped[key] = grouped[key] || [];
      grouped[key].push(bid);
    });
    return grouped;
  }, [bids]);
  const comparisonRequests = useMemo(
    () => requests.filter((row) => row.comparison_key && (bidsByComparisonKey[row.comparison_key] || []).length),
    [bidsByComparisonKey, requests]
  );
  const activeComparisonRequest = useMemo(() => {
    if (activeComparisonKey) {
      return comparisonRequests.find((row) => row.comparison_key === activeComparisonKey) || null;
    }
    return comparisonRequests.find((row) => (bidsByComparisonKey[row.comparison_key] || []).length > 1) || comparisonRequests[0] || null;
  }, [activeComparisonKey, bidsByComparisonKey, comparisonRequests]);
  const activeComparisonBids = activeComparisonRequest
    ? bidsByComparisonKey[activeComparisonRequest.comparison_key] || []
    : [];
  const activeHighlights = useMemo(() => comparisonHighlights(activeComparisonBids), [activeComparisonBids]);
  const awardedBid = activeComparisonBids.find((bid) => bid.is_awarded || bid.linked_agreement_id);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const applyProperty = (propertyId) => {
    const selected = propertyOptions.find((property) => String(property.id) === String(propertyId));
    setForm((prev) => ({
      ...prev,
      property_id: propertyId || "",
      address_line1: selected?.address_line1 || prev.address_line1 || "",
      address_line2: selected?.address_line2 || "",
      city: selected?.city || prev.city || "",
      state: selected?.state || prev.state || "",
      postal_code: selected?.postal_code || prev.postal_code || "",
    }));
  };

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
      property_id: form.property_id,
    }));
  };

  return (
    <div data-testid="customer-requests" className="space-y-5">
      <form onSubmit={submit} data-testid="customer-request-create-panel" className="rounded-2xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_34%),rgba(15,23,42,0.78)] p-5 shadow-xl shadow-slate-950/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Create a Request</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Tell us what you need help with next</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              Save repairs, maintenance, inspections, new projects, or follow-up work here first. Requests stay private until you choose to send or route them.
            </p>
          </div>
          <Badge>Internal until routed</Badge>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3">
              <label className="block text-sm font-medium text-amber-100">
                Choose the property this request is for.
                {propertyOptions.length ? (
                  <select
                    data-testid="customer-request-property-selector"
                    value={form.property_id}
                    onChange={(event) => applyProperty(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  >
                    {propertyOptions.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.display_name || property.address || "Property"}{property.is_primary ? " - Primary Property" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="mt-2 text-sm text-amber-50">No saved property yet. Enter the address for this request below.</div>
                )}
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
                Timeline
                <input
                  value={form.preferred_timeline}
                  onChange={(event) => update("preferred_timeline", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="This week, next month..."
                />
              </label>
            </div>
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
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <label className="block text-sm font-medium text-slate-200">
              Address search
              <div className="mt-1">
                <AddressAutocomplete
                  value={form.address_line1}
                  onChangeText={(value) => update("address_line1", value)}
                  onSelect={(address) => {
                    setForm((prev) => ({
                      ...prev,
                      address_line1: address.line1 || prev.address_line1,
                      address_line2: address.line2 || "",
                      city: address.city || prev.city,
                      state: address.state || prev.state,
                      postal_code: address.postal_code || prev.postal_code,
                    }));
                  }}
                  placeholder="Search the request property address..."
                  testId="customer-request-address-autocomplete"
                />
              </div>
            </label>
            <label className="block text-sm font-medium text-slate-200">
              Street
              <input
                value={form.address_line1}
                onChange={(event) => update("address_line1", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-200">
                City
                <input
                  value={form.city}
                  onChange={(event) => update("city", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                State
                <input
                  value={form.state}
                  onChange={(event) => update("state", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-200">
              ZIP
              <input
                value={form.postal_code}
                onChange={(event) => update("postal_code", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              />
            </label>
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || !form.title.trim() || !form.description.trim()}
          className="mt-5 w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-44"
        >
          {creating ? "Saving..." : "Create Request"}
        </button>
      </form>

      <section data-testid="customer-portal-requests" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Project & Service Requests</h2>
            <p className="mt-1 text-sm text-slate-300">
              Use Requests to tell us what you need help with next. Saved requests stay private until you choose to send them to a contractor or, where available, up to 5 marketplace contractors.
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
                    {(bidsByComparisonKey[request.comparison_key] || []).length > 1 ? (
                      <button
                        type="button"
                        data-testid={`customer-portal-request-compare-${request.id}`}
                        onClick={() => setActiveComparisonKey(request.comparison_key)}
                        className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-amber-200"
                      >
                        Compare Bids
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No saved requests yet" testId="customer-requests-empty">
              Start with a repair, maintenance task, inspection, DIY help request, emergency, or new project idea. It stays private in your workspace until routing is needed.
            </EmptyState>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-sky-300/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          {internalRequests.length
            ? "New portal requests are saved internally first and are not broadcast to the marketplace unless routing is enabled and you choose that next step."
            : "Saved requests stay internal here first. They can later be prepared for contractor routing when you choose the next step."}
        </div>

        {activeComparisonRequest ? (
          <div
            data-testid="customer-bid-comparison"
            className="mt-6 rounded-2xl border border-amber-200/25 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.12),transparent_35%),rgba(15,23,42,0.92)] p-5"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">Bid Comparison</div>
                <h3 className="mt-1 text-xl font-extrabold text-white">{activeComparisonRequest.project_title || "Marketplace Request"}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Compare up to 5 contractor bids before selecting who should create the agreement draft.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{activeComparisonBids.length} bid{activeComparisonBids.length === 1 ? "" : "s"}</Badge>
                {awardedBid ? <HighlightBadge>Awarded Contractor: {awardedBid.contractor_name || "Selected"}</HighlightBadge> : null}
              </div>
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {activeComparisonBids.map((bid) => {
                const highlights = activeHighlights[bid.id] || [];
                const isAwarded = bid.is_awarded || Boolean(bid.linked_agreement_id);
                const canAward = bid.can_accept && !awardedBid;
                return (
                  <article
                    key={bid.id}
                    data-testid={`customer-bid-comparison-card-${bid.id}`}
                    className={`rounded-2xl border p-4 ${
                      isAwarded
                        ? "border-emerald-300/40 bg-emerald-400/10"
                        : "border-slate-700 bg-slate-950/65"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-extrabold text-white">{bid.contractor_business_name || bid.contractor_name || "Contractor"}</h4>
                        <p className="mt-1 text-xs text-slate-400">{bid.contractor_contact_name || bid.service_area || "Service area pending"}</p>
                      </div>
                      <Badge>{bid.status_label || "Submitted"}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {highlights.map((label) => <HighlightBadge key={label}>{label}</HighlightBadge>)}
                      {Number(bid.contractor_review_count || 0) > 0 ? (
                        <HighlightBadge>
                          {Number(bid.contractor_rating || 0).toFixed(2)} rating · {bid.contractor_review_count} review{Number(bid.contractor_review_count || 0) === 1 ? "" : "s"}
                        </HighlightBadge>
                      ) : null}
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Price</dt>
                        <dd className="mt-1 text-lg font-extrabold text-white">{bid.bid_amount_label || "Bid pending"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Timeline</dt>
                        <dd className="mt-1 font-semibold text-slate-100">{bid.timeline || "Timeline pending"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Milestones</dt>
                        <dd className="mt-1 font-semibold text-slate-100">
                          {Number(bid.milestone_count || 0) || (Array.isArray(bid.milestone_preview) ? bid.milestone_preview.length : 0) || "No plan yet"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Service Area</dt>
                        <dd className="mt-1 font-semibold text-slate-100">{bid.service_area || bid.request_address || "Not listed"}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Warranty</div>
                        <p className="mt-1 leading-6 text-slate-300">{bid.warranty_summary || "Warranty details not included yet."}</p>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Proposal Notes</div>
                        <p className="mt-1 leading-6 text-slate-300">{bid.proposal_summary || bid.notes || "No proposal notes yet."}</p>
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Milestone Structure</div>
                        <p className="mt-1 leading-6 text-slate-300">
                          {Array.isArray(bid.milestone_preview) && bid.milestone_preview.length ? bid.milestone_preview.join(" • ") : "No milestone preview yet."}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {bid.linked_agreement_token ? (
                        <a
                          data-testid={`customer-bid-comparison-open-${bid.id}`}
                          href={`/agreements/magic/${bid.linked_agreement_token}`}
                          className="rounded-lg border border-sky-300/40 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-400/10"
                        >
                          Open Agreement Draft
                        </a>
                      ) : canAward ? (
                        <button
                          type="button"
                          data-testid={`customer-bid-comparison-award-${bid.id}`}
                          onClick={() => setPendingAwardBid(bid)}
                          className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-200"
                        >
                          Award Contractor
                        </button>
                      ) : (
                        <span className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400">
                          {awardedBid ? "Not Selected" : "Award unavailable"}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        <div data-testid="customer-portal-bids" className="mt-6 border-t border-slate-700 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Contractor Responses</h3>
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
                          onClick={() => setPendingAwardBid(bid)}
                          disabled={acceptingBidId === bid.id}
                          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
                      >
                          {acceptingBidId === bid.id ? "Creating draft..." : "Award Bid"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No bids yet" testId="customer-bids-empty">
                Contractor bids will appear here after a request is routed or an agreement flow brings contractor proposals back to this portal.
              </EmptyState>
            )}
          </div>
        </div>
      </section>

      {pendingAwardBid ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-bid-award-title"
          data-testid="customer-portal-bid-award-modal"
        >
          <div className="w-full max-w-lg rounded-2xl border border-amber-200/30 bg-slate-950 p-6 shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">Award contractor</div>
            <h3 id="customer-bid-award-title" className="mt-2 text-xl font-extrabold text-white">
              Select this contractor?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-200">
              Selecting this contractor will create a project agreement draft.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              <div className="font-semibold text-white">{pendingAwardBid.contractor_name || "Selected contractor"}</div>
              <div>{pendingAwardBid.project_title || "Marketplace request"}</div>
              <div>{pendingAwardBid.bid_amount_label || "Bid amount pending"}</div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingAwardBid(null)}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="customer-portal-bid-award-confirm"
                disabled={acceptingBidId === pendingAwardBid.id}
                onClick={async () => {
                  const bid = pendingAwardBid;
                  setPendingAwardBid(null);
                  await onAcceptBid?.(bid);
                }}
                className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-200 disabled:opacity-60"
              >
                {acceptingBidId === pendingAwardBid.id ? "Creating draft..." : "Create agreement draft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
