// src/auth.js

const ACCESS_TOKEN_KEY = "access";
const REFRESH_TOKEN_KEY = "refresh";

// --- Getters ---
export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

// --- Setters ---
export function setAccessToken(token) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function setRefreshToken(token) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

// --- Clear tokens ---
export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// --- Refresh access token using refresh token ---
export async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token found.");

  const resp = await fetch("/api/auth/refresh/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh }),
  });

  if (!resp.ok) {
    throw new Error("Failed to refresh access token.");
  }

  const data = await resp.json();
  const newAccess = data.access;
  setAccessToken(newAccess);
  return newAccess;
}

// --- Logout ---
export function logout() {
  clearSession();
  window.location.href = "/signin";
}
