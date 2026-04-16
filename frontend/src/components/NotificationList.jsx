import React from "react";

export default function NotificationList({ items = [], onClose }) {
  return (
    <div className="absolute top-14 right-4 z-50 w-80 rounded-lg border bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-3">
        <h4 className="font-bold text-gray-700">Notifications</h4>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700"
          aria-label="Close notifications"
        >
          X
        </button>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <li className="p-4 text-center text-gray-500">No new notifications</li>
        ) : (
          items.map((n, idx) => (
            <li key={idx} className="border-b px-4 py-3 text-sm last:border-none hover:bg-gray-50">
              <p className="font-medium text-gray-800">{n.title}</p>
              <p className="text-gray-600">{n.message}</p>
              {n.project_title || n.draw_request_id ? (
                <p className="mt-1 text-xs text-slate-500">
                  {[n.project_title, n.draw_request_id ? `Draw #${n.draw_request_id}` : null]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              ) : null}
              {n.action_url ? (
                <a href={n.action_url} className="mt-2 inline-flex text-xs font-semibold text-indigo-700 hover:text-indigo-900">
                  {n.action_label || "View"}
                </a>
              ) : null}
              <p className="mt-1 text-xs text-gray-400">
                {new Date(n.created_at || n.timestamp).toLocaleString()}
              </p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
