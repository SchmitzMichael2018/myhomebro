import React from "react";

export default function NotificationList({ items = [], onClose }) {
  return (
    <div className="absolute top-14 right-4 w-80 bg-white rounded-lg shadow-xl border z-50">
      <div className="flex justify-between items-center p-3 border-b">
        <h4 className="font-bold text-gray-700">Notifications</h4>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700"
          aria-label="Close notifications"
        >
          ✖
        </button>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <li className="p-4 text-center text-gray-500">No new notifications</li>
        ) : (
          items.map((n, idx) => (
            <li
              key={idx}
              className="border-b last:border-none px-4 py-3 hover:bg-gray-50 text-sm"
            >
              <p className="text-gray-800 font-medium">{n.title}</p>
              <p className="text-gray-600">{n.message}</p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(n.timestamp).toLocaleString()}
              </p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}