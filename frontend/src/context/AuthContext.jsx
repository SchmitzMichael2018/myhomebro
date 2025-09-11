// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import api, { getAccessToken, setTokens, clearAuth } from "../api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  // ---- Auth state ----
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // ---- Global Login Modal state ----
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const openLogin = () => setIsLoginOpen(true);
  const closeLogin = () => setIsLoginOpen(false);

  useEffect(() => {
    const tok = getAccessToken();
    if (tok) {
      setUser((u) => u || { email: null });
      // ensure axios global default also has the header (covers stray axios usage)
      axios.defaults.headers.common.Authorization = `Bearer ${tok}`;
    }
    setReady(true);
  }, []);

  const login = async ({ email, password, remember }) => {
    const endpoints = ["/auth/login/", "/token/"]; // supports either style
    let data;

    for (let i = 0; i < endpoints.length; i++) {
      try {
        const resp = await api.post(endpoints[i], { email, username: email, password });
        data = resp.data;
        break;
      } catch (e) {
        if (i === endpoints.length - 1) throw e;
      }
    }

    const access = data.access || data.access_token;
    const refresh = data.refresh || data.refresh_token;
    if (!access || !refresh) throw new Error("Login did not return tokens.");

    setTokens(access, refresh, !!remember);
    // set both our instance and global axios header (defensive)
    axios.defaults.headers.common.Authorization = `Bearer ${access}`;
    setUser({ email });
    return true;
  };

  const logout = async () => {
    clearAuth();
    delete axios.defaults.headers.common.Authorization;
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      setUser,
      isAuthed: !!getAccessToken(),
      ready,
      login,
      logout,
      isLoginOpen,
      openLogin,
      closeLogin,
    }),
    [user, ready, isLoginOpen]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
