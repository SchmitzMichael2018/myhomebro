import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../api";

function normalizeNotificationRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

export default function useNotifications({ limit = 10 } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const [itemsResponse, unreadResponse] = await Promise.all([
        api.get("/notifications/", { params: { limit } }),
        api.get("/notifications/unread-count/"),
      ]);
      setNotifications(normalizeNotificationRows(itemsResponse.data));
      setUnreadCount(Number(unreadResponse.data?.count || 0));
    } catch (error) {
      console.error("Failed to fetch notifications", error);
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (notificationId) => {
      if (!notificationId) return null;
      const previous = notifications;
      const target = previous.find((row) => row.id === notificationId);
      setNotifications((current) => current.map((row) => row.id === notificationId ? { ...row, is_read: true } : row));
      if (target && !target.is_read) setUnreadCount((current) => Math.max(0, current - 1));
      try {
        const { data } = await api.post(`/notifications/${notificationId}/read/`);
        return data;
      } catch (error) {
        setNotifications(previous);
        if (target && !target.is_read) setUnreadCount((current) => current + 1);
        throw error;
      }
    },
    [notifications]
  );

  const markAllRead = useCallback(async () => {
    const { data } = await api.post("/notifications/mark-all-read/");
    await fetchNotifications();
    return data;
  }, [fetchNotifications]);

  return useMemo(
    () => ({
      notifications,
      unreadCount,
      totalCount: notifications.length,
      loading,
      refresh: fetchNotifications,
      markRead,
      markAllRead,
    }),
    [notifications, unreadCount, loading, fetchNotifications, markRead, markAllRead]
  );
}
