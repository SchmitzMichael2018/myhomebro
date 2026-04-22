import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCheck } from "lucide-react";

import NotificationItem from "./NotificationItem.jsx";

export default function NotificationDropdown({
  items = [],
  unreadCount = 0,
  onClose,
  onMarkRead,
  onMarkAllRead,
  loading = false,
  className = "",
  title = "Notifications",
  emptyLabel = "No notifications yet.",
  compact = true,
  "data-testid": testId = "notifications-panel",
}) {
  const navigate = useNavigate();

  const openNotification = async (notification) => {
    const target = notification?.action_url || notification?.link || "";
    try {
      if (onMarkRead && notification?.id) {
        await onMarkRead(notification.id);
      }
    } finally {
      onClose?.();
      if (target) {
        navigate(target);
      }
    }
  };

  const markAll = async () => {
    if (typeof onMarkAllRead === "function") {
      await onMarkAllRead();
    }
    onClose?.();
  };

  return (
    <div
      data-testid={testId}
      className={`absolute right-0 top-14 z-50 w-[22rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${className}`.trim()}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h4 className="font-bold text-slate-900">{title}</h4>
          <div className="text-xs text-slate-500">
            {loading ? "Loading..." : `${unreadCount} unread`}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-full px-2 py-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close notifications"
          type="button"
        >
          ×
        </button>
      </div>

      <div className="max-h-[32rem] overflow-y-auto p-2">
        {items.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500"
            data-testid="notifications-empty-state"
          >
            {emptyLabel}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                unread={!notification.is_read}
                actionNeeded={Boolean(notification.action_needed)}
                onOpen={openNotification}
                compact={compact}
                data-testid={`notification-item-${notification.id}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
        <Link
          to="/app/notifications"
          onClick={onClose}
          className="text-sm font-semibold text-indigo-700 transition hover:text-indigo-900"
          data-testid="notifications-dropdown-view-all"
        >
          View all notifications
        </Link>
        <button
          type="button"
          onClick={markAll}
          disabled={!unreadCount}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="notifications-dropdown-mark-all"
        >
          <CheckCheck size={14} />
          Mark all read
        </button>
      </div>
    </div>
  );
}

