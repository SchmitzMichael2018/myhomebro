// src/context/AuthContext.jsx
// v2026-01-24 — single-source-of-truth auth (api.js owns headers + refresh)

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
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

  // Boot: do NOT set axios.defaults here; api.js handles it.
  useEffect(() => {
    const tok = getAccessToken();
    if (tok) {
      // We may not have user profile yet; keep minimal placeholder.
      setUser((u) => u || { email: null });
    } else {
      setUser(null);
    }
    setReady(true);
  }, []);

  const login = async ({ email, password, remember }) => {
    // Your backend uses /api/token/ (you already confirmed this is working)
    const resp = await api.post("/token/", { email, password });

    const access = resp.data?.access || resp.data?.access_token;
    const refresh = resp.data?.refresh || resp.data?.refresh_token;

    if (!access || !refresh) {
      throw new Error("Login did not return tokens.");
    }

    // api.js stores tokens + applies Authorization
    setTokens(access, refresh, !!remember);

    // Minimal user object. (Optional: call a /whoami endpoint later)
    setUser({ email });
    return true;
  };

  const logout = async () => {
    // clearAuth already clears tokens; we do NOT touch axios.defaults here.
    clearAuth(true);
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
