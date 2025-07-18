// src/components/Sidebar.jsx
import { useLocation, useNavigate, Link } from 'react-router-dom';

export default function Sidebar({ setToken }) {
  const location = useLocation();
  const navigate = useNavigate();

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
    { label: 'Stripe Onboarding', icon: '💳', path: '/onboarding' },
  ];

  // prefix-match so e.g. /agreements/123 stays “active”
  const isActive = (path) =>
    path === '/dashboard'
      ? location.pathname === '/dashboard'
      : location.pathname.startsWith(path);

  const handleLogout = () => {
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    if (setToken) setToken(null);
    navigate('/signin', { replace: true });
  };

  return (
    <nav
      className="bg-blue-900 text-white min-h-screen w-64 p-4 flex flex-col justify-between shadow-lg"
      role="navigation"
      aria-label="Main sidebar"
    >
      {/* Logo & Title */}
      <div className="text-center mb-6">
        <img
          src="/myhomebro_logo.png"
          alt="MyHomeBro Logo"
          className="w-16 mx-auto mb-2 hover:scale-105 transition-transform"
        />
        <h2 className="text-2xl font-bold">MyHomeBro</h2>
      </div>

      {/* Menu */}
      <ul className="space-y-2 flex-1">
        {menuItems.map((item) => (
          <li key={item.label}>
            <Link
              to={item.path}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors duration-200 ${
                isActive(item.path)
                  ? 'bg-blue-700 text-white font-semibold shadow-md'
                  : 'hover:bg-blue-800 text-white'
              }`}
              aria-label={item.label}
              aria-current={isActive(item.path) ? 'page' : undefined}
            >
              <span className="mr-2">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <hr className="my-4 border-blue-800" />

      {/* New Agreement CTA */}
      <div className="text-center mb-4">
        <Link
          to="/agreements/new"
          className="block bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition"
          aria-label="Create New Agreement"
        >
          ➕ New Agreement
        </Link>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="bg-red-600 hover:bg-red-700 p-3 rounded-lg text-center w-full mt-6 transition duration-200"
        aria-label="Logout"
      >
        Logout
      </button>
    </nav>
  );
}















