import React from "react";
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileSignature,
  HandCoins,
  MessageSquareWarning,
  Sparkles,
} from "lucide-react";

function formatTimestamp(value) {
  if (!value) return "Just now";
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function normalizeCategory(notification) {
  return String(notification?.category || notification?.event_type || "").trim().toLowerCase();
}

function iconForCategory(notification) {
  const category = normalizeCategory(notification);
  const size = 16;
  if (category === "quote_request_received") return <MessageSquareWarning size={size} strokeWidth={2} />;
  if (category === "agreement_signed") return <FileSignature size={size} strokeWidth={2} />;
  if (category === "escrow_funded") return <HandCoins size={size} strokeWidth={2} />;
  if (category === "milestone_pending_approval") return <ClipboardList size={size} strokeWidth={2} />;
  if (category === "payment_released") return <CreditCard size={size} strokeWidth={2} />;
  if (category === "invoice_approved") return <CheckCircle2 size={size} strokeWidth={2} />;
  if (category === "bid_awarded") return <Sparkles size={size} strokeWidth={2} />;
  return <Bell size={size} strokeWidth={2} />;
}

export default function NotificationItem({
  notification,
  unread = false,
  actionNeeded = false,
  onOpen,
  onMarkRead,
  compact = false,
  className = "",
  "data-testid": testId,
}) {
  const title = notification?.title || "Notification";
  const body = notification?.body || notification?.message || "";
  const categoryLabel = notification?.category_label || String(notification?.category || notification?.event_type || "").replaceAll("_", " ");
  const timestamp = formatTimestamp(notification?.created_at || notification?.timestamp);

  const toneClass = actionNeeded
    ? "border-amber-200 bg-amber-50/90"
    : unread
      ? "border-slate-200 bg-slate-50/90"
      : "border-slate-100 bg-white";

  const handleClick = async () => {
    if (typeof onOpen === "function") {
      await onOpen(notification);
    }
  };

  const markReadOnly = async (event) => {
    event.stopPropagation();
    if (typeof onMarkRead === "function") await onMarkRead(notification);
  };

  return (
    <div
      data-testid={testId}
      className={`group w-full rounded-2xl border text-left transition hover:border-slate-300 hover:bg-slate-50 ${toneClass} ${className}`.trim()}
    >
      <button type="button" onClick={handleClick} className="flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label={`${title}. ${notification?.action_label || "Open notification"}`}>
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
            actionNeeded
              ? "border-amber-200 bg-amber-100 text-amber-800"
              : unread
                ? "border-slate-200 bg-slate-100 text-slate-700"
                : "border-slate-200 bg-white text-slate-500"
          }`}
        >
          {iconForCategory(notification)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`truncate font-semibold ${unread ? "text-slate-950" : "text-slate-800"}`}>{title}</div>
            {actionNeeded ? (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">
                Action Needed
              </span>
            ) : null}
            {categoryLabel ? (
              <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {categoryLabel}
              </span>
            ) : null}
          </div>
          {body ? (
            <div className={`mt-1 text-sm leading-6 ${unread ? "text-slate-700" : "text-slate-600"} ${compact ? "line-clamp-2" : ""}`.trim()}>
              {body}
            </div>
          ) : null}
          {notification?.action_label ? (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              {notification.action_label}
              <ChevronRight size={12} />
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{timestamp}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-slate-600 group-hover:text-slate-900">
              Open <ChevronRight size={12} />
            </span>
          </div>
        </div>
      </button>
      {unread && typeof onMarkRead === "function" ? <div className="border-t border-slate-200/70 px-4 py-2 text-right"><button type="button" onClick={markReadOnly} className="min-h-9 rounded-lg px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label={`Mark ${title} as read`} data-testid={`${testId}-mark-read`}>Mark as read</button></div> : null}
    </div>
  );
}
