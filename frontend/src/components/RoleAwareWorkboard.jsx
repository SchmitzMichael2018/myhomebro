import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";

const TASK_SECTION_CAP = 5;
const ID_SEPARATOR = "\u00b7";

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

const ACTION_HINTS = {
  "Open Agreement": "Review the full agreement and take the next project step.",
  "Open Milestone": "Open this milestone to review details and update progress.",
  "View Milestone": "Open this milestone to review details and update progress.",
  "Open Draft": "Continue editing this draft before sending it out.",
};

function ActionHintButton({ itemId, idx, action, onAction }) {
  const hint = ACTION_HINTS[action.label];
  const tooltipId = hint ? `workboard-action-hint-${itemId}-${idx}` : undefined;

  return (
    <div className="group relative">
      <button
        type="button"
        data-testid={`workboard-action-${itemId}-${idx}`}
        onClick={() => onAction(action)}
        title={hint || action.label}
        aria-describedby={tooltipId}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 sm:min-w-[108px]"
      >
        {action.label}
      </button>
      {hint ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-52 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-600 opacity-0 shadow-lg transition duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

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

    return [left.title || "", String(left.agreement_id || ""), String(left.id || "")]
      .join("|")
      .localeCompare([right.title || "", String(right.agreement_id || ""), String(right.id || "")].join("|"));
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
    return `${totalCount} ${pluralize(totalCount, "milestone")} ${ID_SEPARATOR} ${priorityCount} overdue`;
  }
  if (sectionKey === "today") {
    return `${totalCount} ${pluralize(totalCount, "milestone")} due today`;
  }
  if (sectionKey === "tomorrow") {
    return `${totalCount} ${pluralize(totalCount, "milestone")} due tomorrow`;
  }
  return `${totalCount} ${pluralize(totalCount, "milestone")} due later this week`;
}

function formatAgreementIdentity(agreementId, summary, { includeAgreementWord = true } = {}) {
  const prefix = includeAgreementWord ? `Agreement #${agreementId}` : `#${agreementId}`;
  return summary ? `${prefix} ${ID_SEPARATOR} ${summary}` : prefix;
}

function buildAgreementRows(payload) {
  const taskItems = sortTaskItems(flattenTaskItems(payload));
  const groupedByAgreement = new Map();
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

    const existing = groupedByAgreement.get(item.agreement_id) || [];
    existing.push(item);
    groupedByAgreement.set(item.agreement_id, existing);
  });

  const agreementRows = Array.from(groupedByAgreement.entries()).map(([agreementId, items]) => {
    const sortedItems = [...items].sort((left, right) => {
      const priorityDiff = SECTION_PRIORITY[left.task_section] - SECTION_PRIORITY[right.task_section];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return sortTaskItems([left, right])[0].id === left.id ? -1 : 1;
    });

    const lead = sortedItems[0];
    const selectedSection = lead.task_section;

    if (sortedItems.length === 1) {
      return {
        ...lead,
        row_type: "single",
        task_section: selectedSection,
        identity_line: formatAgreementIdentity(
          agreementId,
          lead.project_title || lead.agreement_title || lead.subtitle || "Agreement",
          { includeAgreementWord: false }
        ),
      };
    }

    const selectedItems = sortTaskItems(sortedItems.filter((item) => item.task_section === selectedSection));
    const earliestMember = selectedItems[0] || lead;
    const earliestDate = taskDateForSort(earliestMember);
    const agreementAction =
      sortedItems.flatMap((candidate) => candidate.actions || []).find((action) => action?.label === "Open Agreement")
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
      agreement_id: agreementId,
      status: "",
    };
  });

  return [...agreementRows, ...standaloneRows];
}

function buildTaskSections(payload) {
  const rows = buildAgreementRows(payload);
  const dedupedRows = new Map();

  rows.forEach((row) => {
    const key = row?.agreement_id ? `agreement-${row.agreement_id}` : `row-${row.id}`;
    dedupedRows.set(key, row);
  });

  return TASK_SECTION_CONFIG.map((section) => ({
    ...section,
    items: sortAgreementRows(Array.from(dedupedRows.values()).filter((row) => row.task_section === section.key)),
  })).filter((section) => section.items.length > 0);
}

function buildSingleRowMeta(item) {
  if (item.completion_date) return `Due: ${formatDateShort(item.completion_date)}`;
  if (item.start_date) return `Starts: ${formatDateShort(item.start_date)}`;
  if (item.work_submitted_at) return `Submitted: ${formatDateShort(item.work_submitted_at)}`;
  if (item.occurred_at) return `Updated: ${formatDateShort(item.occurred_at)}`;
  return "";
}

function ItemCard({ item, onAction }) {
  const isGroup = item.row_type === "group";
  const isOverdue = item.task_section === "needs_attention";
  const cardClassName = isOverdue
    ? "rounded-lg border border-amber-200 bg-amber-50/30 px-3 py-2"
    : "rounded-lg border border-slate-200 bg-white px-3 py-2";
  const summaryLine = item.identity_line || item.subtitle;
  const tertiaryLine = isGroup ? item.group_detail : buildSingleRowMeta(item);

  return (
    <div data-testid={`workboard-item-${item.id}`} className={cardClassName}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-0 text-[14px] font-semibold leading-5 text-slate-900 sm:text-[15px]">
              {item.title}
            </div>
            {isOverdue ? (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                Overdue
              </span>
            ) : null}
          </div>
          <div
            className="mt-0.5 text-[13px] leading-4 text-slate-600 sm:text-sm"
            data-testid={item.agreement_id ? `workboard-agreement-id-${item.id}` : undefined}
          >
            {summaryLine}
          </div>
          {tertiaryLine ? (
            <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{tertiaryLine}</div>
          ) : null}
          {item.work_submission_note ? (
            <div className="mt-1 text-xs leading-4 text-slate-600">Note: {item.work_submission_note}</div>
          ) : null}
          {item.review_response_note ? (
            <div className="mt-1 text-xs leading-4 text-amber-700">
              Response: {item.review_response_note}
            </div>
          ) : null}
        </div>
        {(item.actions || []).length ? (
          <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
            {(item.actions || []).map((action, idx) => (
              <ActionHintButton
                key={`${item.id}-${idx}`}
                itemId={item.id}
                idx={idx}
                action={action}
                onAction={onAction}
              />
            ))}
          </div>
        ) : null}
      </div>

      {!isGroup && (item.assigned_worker_display || item.reviewer_display) ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-slate-400">
          {item.assigned_worker_display ? <span>Worker: {item.assigned_worker_display}</span> : null}
          {item.reviewer_display ? <span>Reviewer: {item.reviewer_display}</span> : null}
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
      <div className="mhb-glass" data-testid={testId} style={{ padding: 10 }}>
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <ItemCard key={item.id} item={item} onAction={onAction} />
          ))}
          {showViewAll ? (
            <button
              type="button"
              data-testid={`${testId}-view-all`}
              onClick={onToggleExpanded}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
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
      style={{ padding: 10, marginTop: 12 }}
    >
      <div className="text-sm font-medium text-slate-700">No upcoming tasks right now.</div>
    </div>
  );
}

function RecentActivitySection({ items, emptyText, onAction }) {
  return (
    <div>
      <div className="mhb-kicker" style={{ marginTop: 12, marginBottom: 8 }}>
        Recent Activity
      </div>
      <div
        className="mhb-glass"
        data-testid="role-workboard-recent-activity"
        style={{ padding: 10 }}
      >
        {items.length === 0 ? (
          <div
            data-testid="role-workboard-recent-activity-empty"
            className="text-sm text-slate-600"
          >
            {emptyText}
          </div>
        ) : (
          <div className="space-y-2">
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
