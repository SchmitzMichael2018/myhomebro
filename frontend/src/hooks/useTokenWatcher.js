import { useEffect } from 'react';
import { jwtDecode } from 'jwt-decode'; // ✅ ESM-compatible import
import { useNavigate } from 'react-router-dom';

export default function useTokenWatcher(onLogout) {
  const navigate = useNavigate();

  useEffect(() => {
    const checkExpiration = () => {
      const token = localStorage.getItem('access');
      if (!token) return;
      try {
        const decoded = jwtDecode(token); // ✅ still works, just named import now
        const now = Date.now() / 1000;
        if (decoded.exp < now) {
          localStorage.removeItem('access');
          localStorage.removeItem('refresh');
          if (typeof onLogout === 'function') onLogout();
          navigate('/login');
        }
      } catch (err) {
        console.error("Invalid token:", err);
      }
    };

    const interval = setInterval(checkExpiration, 60_000); // check every minute
    checkExpiration(); // also check immediately
    return () => clearInterval(interval);
  }, [navigate, onLogout]);
}
