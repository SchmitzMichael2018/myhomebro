// src/components/Sidebar.jsx
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import api from '../api';
import logo from '../assets/myhomebro_logo.png';

export default function Sidebar({ isOpen, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { onLogout } = useAuth();

  const [onboardingStatus, setOnboardingStatus] = useState('');

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { data } = await api.get('/projects/contractor-onboarding-status/');
        setOnboardingStatus(data.onboarding_status || '');
      } catch (err) {
        console.error('Failed to fetch onboarding status');
      }
    };
    fetchStatus();
  }, []);

  const menuItems = [
    { label: 'Dashboard',     icon: '🏠', path: '/dashboard' },
    { label: 'Agreements',    icon: '📄', path: '/agreements' },
    { label: 'Invoices',      icon: '💵', path: '/invoices' },
    { label: 'Earnings',      icon: '📈', path: '/earnings' },
    { label: 'Calendar',      icon: '📅', path: '/calendar' },
    { label: 'Customers',     icon: '👥', path: '/customers' },
    { label: 'Disputes',      icon: '⚖️', path: '/disputes' },
    { label: 'My Profile',    icon: '🙍‍♂️', path: '/profile' },
    { label: 'Send Message',  icon: '✉️', path: '/send-message' },
  ];

  if (onboardingStatus !== 'completed') {
    menuItems.push({
      label: 'Stripe Onboarding',
      icon: '💳',
      path: '/onboarding',
    });
  }

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleLogout = () => {
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    onLogout?.();
    navigate('/signin', { replace: true });
  };

  return (
    <aside
      className={`fixed md:static top-0 left-0 h-full w-64 bg-blue-900 text-white shadow-lg z-40 transform transition-transform duration-300
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      role="navigation"
      aria-label="Sidebar"
    >
      {/* Close button on mobile */}
      <div className="md:hidden flex justify-end p-2">
        <button onClick={onClose} className="text-white text-2xl">&times;</button>
      </div>

      <div className="text-center mb-6">
        <img
         src={logo}
         alt="MyHomeBro Logo"
         className="w-16 mx-auto mb-2 hover:scale-105 transition-transform"
        />

        <h2 className="text-2xl font-bold">MyHomeBro</h2>
      </div>

      <ul className="space-y-2 px-4">
        {menuItems.map((item) => (
          <li key={item.label}>
            <Link
              to={item.path}
              className={`flex items-center px-3 py-2 rounded-lg transition-colors duration-200
                ${isActive(item.path)
                  ? 'bg-blue-700 font-semibold'
                  : 'hover:bg-blue-800'}
              `}
              onClick={onClose}
            >
              <span className="mr-2">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="text-center mt-6 px-4">
        <Link
          to="/agreements/new"
          className="block bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg"
          onClick={onClose}
        >
          ➕ New Agreement
        </Link>

        <button
          onClick={handleLogout}
          className="mt-4 w-full bg-red-600 hover:bg-red-700 py-2 rounded-lg"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
