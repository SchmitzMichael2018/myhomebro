import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";

function formatDateTimeShort(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function ItemCard({ item, onAction }) {
  return (
    <div
      data-testid={`workboard-item-${item.id}`}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">{item.title}</div>
          <div className="mt-1 text-sm text-slate-600">{item.subtitle}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {item.milestone_title ? <span>Milestone: {item.milestone_title}</span> : null}
            {item.assigned_worker_display ? <span>Worker: {item.assigned_worker_display}</span> : null}
            {item.reviewer_display ? <span>Reviewer: {item.reviewer_display}</span> : null}
            {item.work_submitted_at ? <span>Submitted: {formatDateTimeShort(item.work_submitted_at)}</span> : null}
            {item.completion_date ? <span>Due: {formatDateTimeShort(item.completion_date)}</span> : null}
            {item.start_date ? <span>Start: {formatDateTimeShort(item.start_date)}</span> : null}
            {item.occurred_at ? <span>Activity: {formatDateTimeShort(item.occurred_at)}</span> : null}
          </div>
          {item.work_submission_note ? (
            <div className="mt-2 text-sm text-slate-700">
              Note: {item.work_submission_note}
            </div>
          ) : null}
          {item.review_response_note ? (
            <div className="mt-2 text-sm text-amber-700">
              Response: {item.review_response_note}
            </div>
          ) : null}
        </div>
        {item.status ? (
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
            {String(item.status).replaceAll("_", " ")}
          </span>
        ) : null}
      </div>

      {(item.actions || []).length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(item.actions || []).map((action, idx) => (
            <button
              key={`${item.id}-${idx}`}
              type="button"
              data-testid={`workboard-action-${item.id}-${idx}`}
              onClick={() => onAction(action)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, testId, items, emptyText, onAction }) {
  return (
    <div>
      <div className="mhb-kicker" style={{ marginTop: 18 }}>
        {title}
      </div>
      <div className="mhb-glass" data-testid={testId} style={{ padding: 12 }}>
        {items.length === 0 ? (
          <div data-testid={`${testId}-empty`} className="text-sm text-gray-500">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} onAction={onAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RoleAwareWorkboard({ title = null, subtitle = null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState({
    identity_type: "",
    today: [],
    tomorrow: [],
    this_week: [],
    recent_activity: [],
    empty_states: {},
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/dashboard/operations/");
        if (!active) return;
        setPayload({
          identity_type: data?.identity_type || "",
          today: Array.isArray(data?.today) ? data.today : [],
          tomorrow: Array.isArray(data?.tomorrow) ? data.tomorrow : [],
          this_week: Array.isArray(data?.this_week) ? data.this_week : [],
          recent_activity: Array.isArray(data?.recent_activity) ? data.recent_activity : [],
          empty_states: data?.empty_states || {},
        });
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error("Failed to load your workboard.");
        setPayload({
          identity_type: "",
          today: [],
          tomorrow: [],
          this_week: [],
          recent_activity: [],
          empty_states: {},
        });
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  async function onAction(action) {
    if (!action?.target) return;
    if (action.type === "copy") {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${action.target}`);
        toast.success("Link copied.");
      } catch (err) {
        console.error(err);
        toast.error("Failed to copy link.");
      }
      return;
    }
    navigate(action.target);
  }

  if (loading) {
    return (
      <div className="mhb-glass" data-testid="role-workboard-loading" style={{ padding: 12 }}>
        <div className="text-sm text-gray-500">Loading your workboard...</div>
      </div>
    );
  }

  return (
    <div data-testid="role-workboard">
      {title ? (
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
      ) : null}

      <Section
        title="Today"
        testId="role-workboard-today"
        items={payload.today}
        emptyText={payload.empty_states?.today || "No items for today."}
        onAction={onAction}
      />
      <Section
        title="Tomorrow"
        testId="role-workboard-tomorrow"
        items={payload.tomorrow}
        emptyText={payload.empty_states?.tomorrow || "Nothing for tomorrow."}
        onAction={onAction}
      />
      <Section
        title="Later This Week"
        testId="role-workboard-this-week"
        items={payload.this_week}
        emptyText={payload.empty_states?.this_week || "Nothing later this week."}
        onAction={onAction}
      />
      <Section
        title="Recent Activity"
        testId="role-workboard-recent-activity"
        items={payload.recent_activity}
        emptyText={payload.empty_states?.recent_activity || "No recent activity."}
        onAction={onAction}
      />
    </div>
  );
}
