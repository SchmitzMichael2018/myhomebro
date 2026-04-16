import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";

import useNotifications from "../hooks/useNotifications.js";
import NotificationList from "./NotificationList.jsx";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const { notifications, count, loading, refresh } = useNotifications();

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.is_read).length,
    [notifications]
  );

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleNotifications = () => {
    if (!open) {
      void refresh();
    }
    setOpen((current) => !current);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        data-testid="notifications-bell-button"
        aria-label="Open notifications"
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={toggleNotifications}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            data-testid="notifications-unread-badge"
            className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <NotificationList
            data-testid="notifications-panel"
            items={notifications}
            onClose={() => setOpen(false)}
            emptyLabel={loading ? "Loading notifications..." : "No notifications yet."}
          />
          <div className="sr-only" data-testid="notifications-total-count">
            {count}
          </div>
        </>
      ) : null}
    </div>
  );
}
