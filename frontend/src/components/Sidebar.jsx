// src/components/Sidebar.jsx
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import api from '../api';
import logo from '../assets/myhomebro_logo.png';

/**
 * Reorder by editing MENU_ORDER:
 * "Stripe Onboarding" renders only if onboarding isn't completed.
 */
const MENU_ORDER = [
  'My Profile',
  'Dashboard',
  'Customers',
  'Agreements',
  'Invoices',
  'Earnings',
  'Calendar',
  'Send Message',
  'Disputes',
  'Stripe Onboarding',
];

const BASE_ITEMS = {
  'Dashboard':     { icon: '🏠', path: '/dashboard' },
  'Agreements':    { icon: '📄', path: '/agreements' },
  'Invoices':      { icon: '💵', path: '/invoices' },
  'Earnings':      { icon: '📈', path: '/earnings' },
  'Calendar':      { icon: '📅', path: '/calendar' },
  'Customers':     { icon: '👥', path: '/customers' },
  'Disputes':      { icon: '⚖️', path: '/disputes' },
  'My Profile':    { icon: '🙍‍♂️', path: '/profile' },
  'Send Message':  { icon: '✉️', path: '/send-message' },
};

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

  // Build the menu exactly in MENU_ORDER
  const menuItems = MENU_ORDER
    .filter((label) => {
      if (label === 'Stripe Onboarding') return onboardingStatus !== 'completed';
      return Boolean(BASE_ITEMS[label]);
    })
    .map((label) => {
      if (label === 'Stripe Onboarding') return { label, icon: '💳', path: '/onboarding' };
      const def = BASE_ITEMS[label];
      return { label, ...def };
    });

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleLogout = () => {
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    onLogout?.();
    // land on homepage and pop login if needed
    navigate('/?login=1', { replace: true });
  };

  return (
    // Content only — the <aside> wrapper lives in AuthenticatedLayout
    <div className="min-h-screen flex flex-col" role="navigation" aria-label="Sidebar">
      {/* Close button on mobile (layout shows overlay) */}
      <div className="md:hidden flex justify-end p-2">
        <button onClick={onClose} className="text-white text-2xl" aria-label="Close menu">
          &times;
        </button>
      </div>

      <div className="text-center mb-6">
        <img
          src={logo}
          alt="MyHomeBro Logo"
          className="w-16 mx-auto mb-2 hover:scale-105 transition-transform"
        />
        <h2 className="text-2xl font-bold">MyHomeBro</h2>
      </div>

      <ul className="space-y-2 px-4 flex-1">
        {menuItems.map((item) => (
          <li key={item.label}>
            <Link
              to={item.path}
              className={`flex items-center px-3 py-2 rounded-lg transition-colors duration-200 ${
                isActive(item.path) ? 'bg-blue-700 font-semibold' : 'hover:bg-blue-800'
              }`}
              onClick={onClose}
            >
              <span className="mr-2">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="text-center mt-6 px-4 pb-4">
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
    </div>
  );
}
