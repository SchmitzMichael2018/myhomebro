import React, { useState } from 'react';
import Sidebar from '../components/Sidebar';
import { Outlet } from 'react-router-dom';
import NotificationBell from '../components/NotificationBell';
import NotificationList from '../components/NotificationList';
import useNotifications from '../hooks/useNotifications';

export default function AuthenticatedLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { notifications, unreadCount, markAllAsRead } = useNotifications();

  const toggleNotifications = () => {
    setShowNotifications((prev) => !prev);
    if (!showNotifications) {
      markAllAsRead();
    }
  };

  return (
    <div className="flex min-h-screen relative">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        ></div>
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 bg-gray-50 overflow-auto relative">
        {/* Top bar with Menu + Notifications */}
        <div className="fixed top-0 left-0 right-0 bg-white shadow z-20 flex items-center justify-between px-4 py-3 md:py-2 md:px-6">
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="md:hidden text-blue-600 px-3 py-2 rounded hover:bg-blue-100"
          >
            ☰ Menu
          </button>

          <div className="flex items-center space-x-4 ml-auto">
            <NotificationBell count={unreadCount} onClick={toggleNotifications} />
          </div>
        </div>

        {/* Notification dropdown */}
        {showNotifications && (
          <div className="absolute top-16 right-6 z-40">
            <NotificationList notifications={notifications} />
          </div>
        )}

        {/* Main content below top nav */}
        <div className="p-4 pt-20 md:pt-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
