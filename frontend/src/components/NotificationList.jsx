import React from "react";

export default function NotificationList({
  items = [],
  onClose,
  className = "",
  title = "Notifications",
  emptyLabel = "No notifications yet.",
  "data-testid": testId = "notifications-panel",
}) {
  return (
    <div
      data-testid={testId}
      className={`absolute top-14 right-0 z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${
        className || ""
      }`.trim()}
    >
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        <h4 className="font-bold text-slate-800">{title}</h4>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-800"
          aria-label="Close notifications"
          type="button"
        >
          ×
        </button>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <li
            className="p-4 text-center text-sm text-slate-500"
            data-testid="notifications-empty-state"
          >
            {emptyLabel}
          </li>
        ) : (
          items.map((n, idx) => (
            <li
              key={n.id ?? idx}
              data-testid={`notification-item-${n.id ?? idx}`}
              className="border-b border-slate-100 px-4 py-3 text-sm last:border-none hover:bg-slate-50"
            >
              <p className="font-semibold text-slate-800">{n.title}</p>
              <p className="mt-0.5 text-slate-600">{n.message}</p>
              {n.project_title || n.draw_request_id ? (
                <p className="mt-1 text-xs text-slate-500">
                  {[n.project_title, n.draw_request_id ? `Draw #${n.draw_request_id}` : null]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              ) : null}
              {n.action_url ? (
                <a
                  href={n.action_url}
                  onClick={onClose}
                  data-testid={`notification-action-${n.id ?? idx}`}
                  className="mt-2 inline-flex text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                >
                  {n.action_label || "View"}
                </a>
              ) : null}
              <p className="mt-1 text-xs text-slate-400">
                {new Date(n.created_at || n.timestamp).toLocaleString()}
              </p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
