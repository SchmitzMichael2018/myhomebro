import { useEffect, useState } from "react";
import api from "../api";

export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [visible, setVisible] = useState(false);

  const fetchNotifications = async () => {
    try {
      const { data } = await api.get("/projects/notifications/");
      setNotifications(data);
    } catch (err) {
      console.error("Failed to fetch notifications", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  return {
    notifications,
    count: notifications.length,
    visible,
    setVisible,
    refresh: fetchNotifications,
  };
}