import { useEffect, useState } from "react";
import api from "../api";

export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/projects/notifications/");
      setNotifications(data);
    } catch (err) {
      console.error("Failed to fetch notifications", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  return {
    notifications,
    count: notifications.length,
    loading,
    visible,
    setVisible,
    refresh: fetchNotifications,
  };
}
