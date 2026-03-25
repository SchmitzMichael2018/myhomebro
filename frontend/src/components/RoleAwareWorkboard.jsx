import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";

const TASK_SECTION_CAP = 5;

const TASK_SECTION_CONFIG = [
  { key: "needs_attention", title: "Needs Attention", testId: "role-workboard-needs-attention" },
  { key: "today", title: "Today", testId: "role-workboard-today" },
  { key: "tomorrow", title: "Tomorrow", testId: "role-workboard-tomorrow" },
  { key: "later_this_week", title: "Later This Week", testId: "role-workboard-this-week" },
];

const SECTION_PRIORITY = {
  needs_attention: 0,
  today: 1,
  tomorrow: 2,
  later_this_week: 3,
};

function formatDateTimeShort(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatDateShort(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function parseDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function taskDateForSort(item) {
  return (
    parseDateValue(item.completion_date)
    || parseDateValue(item.start_date)
    || parseDateValue(item.work_submitted_at)
    || null
  );
}

function stableTaskKey(item) {
  return [
    item.project_title || item.agreement_title || item.subtitle || "",
    item.milestone_title || item.title || "",
    String(item.id || ""),
  ].join("|");
}

function sortTaskItems(items) {
  return [...items].sort((left, right) => {
    const leftDate = taskDateForSort(left);
    const rightDate = taskDateForSort(right);
    const leftTime = leftDate ? leftDate.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = rightDate ? rightDate.getTime() : Number.MAX_SAFE_INTEGER;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return stableTaskKey(left).localeCompare(stableTaskKey(right));
  });
}

function sortAgreementRows(rows) {
  return [...rows].sort((left, right) => {
    const leftDate = taskDateForSort(left);
    const rightDate = taskDateForSort(right);
    const leftTime = leftDate ? leftDate.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = rightDate ? rightDate.getTime() : Number.MAX_SAFE_INTEGER;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return [
      left.title || "",
      String(left.agreement_id || ""),
      String(left.id || ""),
    ].join("|").localeCompare([
      right.title || "",
      String(right.agreement_id || ""),
      String(right.id || ""),
    ].join("|"));
  });
}

function pluralize(value, singular, plural = `${singular}s`) {
  return value === 1 ? singular : plural;
}

function sectionKeyForItem(item, sourceSection) {
  if (sourceSection === "today") {
    return item?.item_type === "overdue" ? "needs_attention" : "today";
  }
  if (sourceSection === "tomorrow") {
    return "tomorrow";
  }
  return "later_this_week";
}

function flattenTaskItems(payload) {
  return [
    ...(Array.isArray(payload?.today) ? payload.today : []).map((item) => ({
      ...item,
      task_section: sectionKeyForItem(item, "today"),
    })),
    ...(Array.isArray(payload?.tomorrow) ? payload.tomorrow : []).map((item) => ({
      ...item,
      task_section: sectionKeyForItem(item, "tomorrow"),
    })),
    ...(Array.isArray(payload?.this_week) ? payload.this_week : []).map((item) => ({
      ...item,
      task_section: sectionKeyForItem(item, "this_week"),
    })),
  ];
}

function summarizeAgreementGroup(sectionKey, totalCount, priorityCount) {
  if (sectionKey === "needs_attention") {
    if (priorityCount === totalCount) {
      return `${totalCount} overdue ${pluralize(totalCount, "milestone")}`;
    }
    return `${totalCount} ${pluralize(totalCount, "milestone")} - ${priorityCount} overdue`;
  }
  if (sectionKey === "today") {
    if (priorityCount === totalCount) {
      return `${totalCount} ${pluralize(totalCount, "task")} for today`;
    }
    return `${totalCount} ${pluralize(totalCount, "milestone")} - ${priorityCount} for today`;
  }
  if (sectionKey === "tomorrow") {
    if (priorityCount === totalCount) {
      return `${totalCount} ${pluralize(totalCount, "task")} for tomorrow`;
    }
    return `${totalCount} ${pluralize(totalCount, "milestone")} - ${priorityCount} for tomorrow`;
  }
  if (priorityCount === totalCount) {
    return `${totalCount} ${pluralize(totalCount, "task")} later this week`;
  }
  return `${totalCount} ${pluralize(totalCount, "milestone")} - ${priorityCount} later this week`;
}

function formatAgreementIdentity(agreementId, summary = "") {
  if (!agreementId) return summary || "";
  if (!summary) return `#${agreementId}`;
  return `#${agreementId} - ${summary}`;
}

function buildAgreementRows(payload) {
  const taskItems = sortTaskItems(flattenTaskItems(payload));
  const agreementGroups = new Map();
  const standaloneRows = [];

  taskItems.forEach((item) => {
    if (!item?.agreement_id) {
      standaloneRows.push({
        ...item,
        row_type: "single",
        identity_line: item.subtitle || "",
      });
      return;
    }

    const existing = agreementGroups.get(item.agreement_id) || [];
    existing.push(item);
    agreementGroups.set(item.agreement_id, existing);
  });

  const groupedRows = Array.from(agreementGroups.entries()).map(([agreementId, items]) => {
    const sortedItems = [...items].sort((left, right) => {
      const priorityDiff =
        SECTION_PRIORITY[left.task_section] - SECTION_PRIORITY[right.task_section];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const sortedPair = sortTaskItems([left, right]);
      return sortedPair[0].id === left.id ? -1 : 1;
    });

    const lead = sortedItems[0];
    const selectedSection = lead.task_section;

    if (sortedItems.length === 1) {
      return {
        ...lead,
        row_type: "single",
        identity_line: formatAgreementIdentity(
          agreementId,
          lead.project_title || lead.agreement_title || lead.subtitle || ""
        ),
      };
    }

    const selectedItems = sortTaskItems(
      sortedItems.filter((item) => item.task_section === selectedSection)
    );
    const earliestMember = selectedItems[0] || lead;
    const earliestDate = taskDateForSort(earliestMember);
    const agreementAction =
      sortedItems
        .flatMap((candidate) => candidate.actions || [])
        .find((action) => action?.label === "Open Agreement")
      || null;

    return {
      ...lead,
      id: `group-agreement-${agreementId}`,
      row_type: "group",
      task_section: selectedSection,
      title: lead.project_title || lead.agreement_title || lead.subtitle || "Agreement",
      identity_line: formatAgreementIdentity(
        agreementId,
        summarizeAgreementGroup(selectedSection, sortedItems.length, selectedItems.length)
      ),
      group_detail: earliestDate
        ? `Earliest: ${earliestMember.milestone_title || earliestMember.title} on ${formatDateShort(earliestDate)}`
        : "",
      actions: agreementAction ? [agreementAction] : lead.actions || [],
      grouped_items: sortedItems,
      grouped_count: sortedItems.length,
      status: "",
      agreement_id: agreementId,
    };
  });

  return [...groupedRows, ...standaloneRows];
}

function buildTaskSections(payload) {
  const rows = buildAgreementRows(payload);
  const rowsByAgreementId = new Map();

  rows.forEach((row) => {
    if (!row?.agreement_id) {
      rowsByAgreementId.set(`no-agreement-${row.id}`, row);
      return;
    }
    rowsByAgreementId.set(String(row.agreement_id), row);
  });

  const dedupedRows = Array.from(rowsByAgreementId.values());

  return TASK_SECTION_CONFIG.map((section) => {
    const sectionItems = sortAgreementRows(
      dedupedRows.filter((item) => item.task_section === section.key)
    );
    return {
      ...section,
      items: sectionItems,
    };
  }).filter((section) => section.items.length > 0);
}

function ItemCard({ item, onAction }) {
  const isGroup = item.row_type === "group";

  return (
    <div
      data-testid={`workboard-item-${item.id}`}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">{item.title}</div>
          <div
            className="mt-1 text-sm text-slate-600"
            data-testid={item.agreement_id ? `workboard-agreement-id-${item.id}` : undefined}
          >
            {item.identity_line || item.subtitle}
          </div>
          {isGroup ? (
            item.group_detail ? (
              <div className="mt-2 text-xs text-slate-500">{item.group_detail}</div>
            ) : null
          ) : (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {item.milestone_title ? <span>Milestone: {item.milestone_title}</span> : null}
              {item.assigned_worker_display ? <span>Worker: {item.assigned_worker_display}</span> : null}
              {item.reviewer_display ? <span>Reviewer: {item.reviewer_display}</span> : null}
              {item.work_submitted_at ? <span>Submitted: {formatDateTimeShort(item.work_submitted_at)}</span> : null}
              {item.completion_date ? <span>Due: {formatDateTimeShort(item.completion_date)}</span> : null}
              {item.start_date ? <span>Start: {formatDateTimeShort(item.start_date)}</span> : null}
              {item.occurred_at ? <span>Activity: {formatDateTimeShort(item.occurred_at)}</span> : null}
            </div>
          )}
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

function Section({ title, testId, items, expanded, onToggleExpanded, onAction }) {
  const visibleItems = expanded ? items : items.slice(0, TASK_SECTION_CAP);
  const showViewAll = items.length > TASK_SECTION_CAP;

  return (
    <div>
      <div className="mhb-kicker" style={{ marginTop: 18 }}>
        {title}
      </div>
      <div className="mhb-glass" data-testid={testId} style={{ padding: 12 }}>
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <ItemCard key={item.id} item={item} onAction={onAction} />
          ))}
          {showViewAll ? (
            <button
              type="button"
              data-testid={`${testId}-view-all`}
              onClick={onToggleExpanded}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {expanded ? "Show less" : `View all (${items.length})`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyTasksCard() {
  return (
    <div
      className="mhb-glass"
      data-testid="role-workboard-empty"
      style={{ padding: 12, marginTop: 18 }}
    >
      <div className="text-sm font-medium text-slate-700">No upcoming tasks right now.</div>
    </div>
  );
}

function RecentActivitySection({ items, emptyText, onAction }) {
  return (
    <div>
      <div className="mhb-kicker" style={{ marginTop: 18 }}>
        Recent Activity
      </div>
      <div
        className="mhb-glass"
        data-testid="role-workboard-recent-activity"
        style={{ padding: 12 }}
      >
        {items.length === 0 ? (
          <div
            data-testid="role-workboard-recent-activity-empty"
            className="text-sm text-gray-500"
          >
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
  const [expandedSections, setExpandedSections] = useState({});
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
        setExpandedSections({});
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
        setExpandedSections({});
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

  function toggleSection(sectionKey) {
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  }

  if (loading) {
    return (
      <div className="mhb-glass" data-testid="role-workboard-loading" style={{ padding: 12 }}>
        <div className="text-sm text-gray-500">Loading your workboard...</div>
      </div>
    );
  }

  const taskSections = buildTaskSections(payload);

  return (
    <div data-testid="role-workboard">
      {title ? (
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
      ) : null}

      {taskSections.length === 0 ? (
        <EmptyTasksCard />
      ) : (
        taskSections.map((section) => (
          <Section
            key={section.key}
            title={section.title}
            testId={section.testId}
            items={section.items}
            expanded={!!expandedSections[section.key]}
            onToggleExpanded={() => toggleSection(section.key)}
            onAction={onAction}
          />
        ))
      )}
      <RecentActivitySection
        items={payload.recent_activity}
        emptyText={payload.empty_states?.recent_activity || "No recent activity."}
        onAction={onAction}
      />
    </div>
  );
}
