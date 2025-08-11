import React from "react";

export default function NotificationBell({ count, onClick }) {
  return (
    <button
      onClick={onClick}
      className="relative p-2 rounded-full hover:bg-blue-100"
      aria-label="Notifications"
    >
      <span className="text-2xl">🔔</span>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}