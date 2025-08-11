// src/App.jsx
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './context/AuthContext';

import { publicRoutes } from './routes/PublicRoutes.jsx';
import { protectedRoutes } from './routes/ProtectedRoutes.jsx';
import LoginModal from './components/LoginModal.jsx';

export default function App() {
  const [showLogin, setShowLogin] = useState(false);
  const { token, onLogin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // If redirected from a protected route, open modal
  useEffect(() => {
    if (location.state?.from && !token) {
      setShowLogin(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, token, navigate, location.pathname]);

  const handleLoginSuccess = (data) => {
    onLogin(data);
    setShowLogin(false);
    navigate('/dashboard');
  };

  const openLogin = () => setShowLogin(true);

  return (
    <>
      <Toaster position="top-center" />

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      <Routes>
        {publicRoutes(openLogin, handleLoginSuccess)}
        {token && protectedRoutes()}
        {/* if not authenticated and tries protected, redirect home */}
        {!token && <Route path="*" element={<Navigate to="/" replace />} />}
      </Routes>
    </>
  );
}
