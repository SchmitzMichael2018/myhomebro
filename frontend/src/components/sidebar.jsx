// src/components/Sidebar.jsx
import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';

export default function Sidebar() {
  const location = useLocation();

  const menuItems = [
    { label: 'Dashboard', icon: '🏠', path: '/' },
    { label: 'Agreements', icon: '📄', path: '/agreements' },
    { label: 'Invoices', icon: '💵', path: '/invoices' },
    { label: 'Earnings', icon: '📈', path: '/earnings' },
    { label: 'Calendar', icon: '📅', path: '/calendar' },
    { label: 'Customers', icon: '👥', path: '/customers' },
    { label: 'Disputes', icon: '⚖️', path: '/disputes' },
    { label: 'My Profile', icon: '🙍‍♂️', path: '/profile' },
    { label: 'Send Message', icon: '✉️', path: '/send-message' },
  ];

  return (
    <div className="bg-blue-900 text-white min-h-screen w-60 p-4 flex flex-col justify-between">
      <div>
        <h2 className="text-2xl font-bold mb-6 text-center">MyHomeBro</h2>
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.label}>
              <Link
                to={item.path}
                className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                  location.pathname === item.path
                    ? 'bg-blue-700'
                    : 'hover:bg-blue-800'
                }`}
              >
                <span className="mr-2">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}

          {/* New Agreement Link */}
          <li className="mt-4">
            <Link
              to="/create-agreement"
              className="block text-center bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg"
            >
              ➕ New Agreement
            </Link>
          </li>
        </ul>
      </div>

      <button
        onClick={() => {
          localStorage.removeItem('access');
          window.location.reload();
        }}
        className="bg-red-600 hover:bg-red-700 p-2 rounded-lg text-center w-full mt-6"
      >
        Logout
      </button>
    </div>
  );
}






