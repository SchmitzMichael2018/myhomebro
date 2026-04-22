import React, { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { BellRing, CheckCheck, Filter } from "lucide-react";

import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import NotificationItem from "../components/NotificationItem.jsx";
import useNotifications from "../hooks/useNotifications.js";

const ACTION_NEEDED_CATEGORIES = new Set(["quote_request_received", "milestone_pending_approval"]);

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function groupNotifications(rows) {
  const today = startOfDay(new Date());
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);

  const buckets = {
    today: [],
    this_week: [],
    older: [],
  };

  rows.forEach((notification) => {
    const createdAt = notification?.created_at ? new Date(notification.created_at) : new Date(0);
    if (createdAt >= today) {
      buckets.today.push(notification);
    } else if (createdAt >= weekStart) {
      buckets.this_week.push(notification);
    } else {
      buckets.older.push(notification);
    }
  });

  return buckets;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFilter = String(searchParams.get("filter") || "all").toLowerCase();
  const normalizedFilter = ["all", "unread", "action-needed"].includes(currentFilter) ? currentFilter : "all";
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications({ limit: 100 });

  const filteredNotifications = useMemo(() => {
    if (normalizedFilter === "unread") {
      return notifications.filter((notification) => !notification.is_read);
    }
    if (normalizedFilter === "action-needed") {
      return notifications.filter((notification) => {
        const category = String(notification?.category || notification?.event_type || "").toLowerCase();
        return notification.action_needed || ACTION_NEEDED_CATEGORIES.has(category);
      });
    }
    return notifications;
  }, [notifications, normalizedFilter]);

  const counts = useMemo(() => {
    const all = notifications.length;
    const unread = notifications.filter((notification) => !notification.is_read).length;
    const actionNeeded = notifications.filter((notification) => {
      const category = String(notification?.category || notification?.event_type || "").toLowerCase();
      return notification.action_needed || ACTION_NEEDED_CATEGORIES.has(category);
    }).length;
    return { all, unread, actionNeeded };
  }, [notifications]);

  const groups = useMemo(() => groupNotifications(filteredNotifications), [filteredNotifications]);

  const updateFilter = (value) => {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") params.delete("filter");
    else params.set("filter", value);
    setSearchParams(params, { replace: true });
  };

  const openNotification = async (notification) => {
    const target = notification?.action_url || notification?.link || "";
    try {
      if (notification?.id) {
        await markRead(notification.id);
      }
    } catch (error) {
      console.error(error);
      toast.error("Unable to open that notification.");
    } finally {
      if (target) {
        navigate(target);
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead();
      toast.success("All notifications marked read.");
    } catch (error) {
      console.error(error);
      toast.error("Unable to mark notifications read.");
    }
  };

  return (
    <div data-testid="notifications-page">
      <ContractorPageSurface
        eyebrow="Activity"
        title="Notifications"
        subtitle="Keep up with quote requests, approvals, funding updates, and completed work."
        className="max-w-[1320px]"
        actions={
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={!unreadCount}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="notifications-mark-all-read"
          >
            <CheckCheck size={15} />
            Mark all read
          </button>
        }
      >
      <div className="flex flex-wrap items-center gap-2" data-testid="notifications-filter-bar">
        <button
          type="button"
          onClick={() => updateFilter("all")}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            normalizedFilter === "all"
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          }`}
          data-testid="notifications-filter-all"
        >
          <Filter size={14} />
          All
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">{counts.all}</span>
        </button>
        <button
          type="button"
          onClick={() => updateFilter("unread")}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            normalizedFilter === "unread"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          }`}
          data-testid="notifications-filter-unread"
        >
          Unread
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold text-slate-700">{counts.unread}</span>
        </button>
        <button
          type="button"
          onClick={() => updateFilter("action-needed")}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            normalizedFilter === "action-needed"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          }`}
          data-testid="notifications-filter-action-needed"
        >
          Action Needed
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold text-slate-700">{counts.actionNeeded}</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white/90 px-6 py-10 text-center text-sm text-slate-700 shadow-sm">
          Loading notifications...
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div
          data-testid="notifications-empty-state"
          className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center shadow-sm"
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
            <BellRing size={20} />
          </div>
          <div className="text-base font-semibold text-slate-900">No notifications yet.</div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-700">
            Notifications will appear here when quotes arrive, agreements get signed, work is approved, and payments move.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.today.length > 0 ? (
            <section className="space-y-3" data-testid="notifications-group-today">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Today</div>
              <div className="space-y-2">
                {groups.today.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    unread={!notification.is_read}
                    actionNeeded={Boolean(notification.action_needed)}
                    onOpen={openNotification}
                    data-testid={`notification-item-${notification.id}`}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {groups.this_week.length > 0 ? (
            <section className="space-y-3" data-testid="notifications-group-earlier-this-week">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Earlier this week</div>
              <div className="space-y-2">
                {groups.this_week.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    unread={!notification.is_read}
                    actionNeeded={Boolean(notification.action_needed)}
                    onOpen={openNotification}
                    data-testid={`notification-item-${notification.id}`}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {groups.older.length > 0 ? (
            <section className="space-y-3" data-testid="notifications-group-older">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Older</div>
              <div className="space-y-2">
                {groups.older.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    unread={!notification.is_read}
                    actionNeeded={Boolean(notification.action_needed)}
                    onOpen={openNotification}
                    data-testid={`notification-item-${notification.id}`}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
      </ContractorPageSurface>
    </div>
  );
}
