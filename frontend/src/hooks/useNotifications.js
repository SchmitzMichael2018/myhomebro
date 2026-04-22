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
      const { data } = await api.post(`/notifications/${notificationId}/read/`);
      await fetchNotifications();
      return data;
    },
    [fetchNotifications]
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

