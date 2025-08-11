// src/context/AuthContext.jsx

import React, { createContext, useContext, useState } from 'react';
import {
  getAccessToken,
  setAccessToken,
  setRefreshToken,
  clearSession,
} from '../auth.js';
import useTokenWatcher from '../hooks/useTokenWatcher'; // 👈 NEW
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext({
  token: null,
  onLogin: () => {},
  onLogout: () => {},
});

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getAccessToken());
  const navigate = useNavigate();

  const onLogin = ({ access, refresh }) => {
    setAccessToken(access);
    setRefreshToken(refresh);
    setToken(access);
  };

  const onLogout = () => {
    clearSession();
    setToken(null);
    navigate('/login');
    // Optional: toast('Session expired. Please log in again.');
  };

  useTokenWatcher(onLogout); // 👈 Auto-logout if expired

  return (
    <AuthContext.Provider value={{ token, onLogin, onLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
