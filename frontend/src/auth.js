// src/auth.js

// Utility functions for authentication
export function clearSession() {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
}

export function getAccessToken() {
    return localStorage.getItem("access");
}

export function getRefreshToken() {
    return localStorage.getItem("refresh");
}

export function logout() {
    clearSession();
    window.location.href = "/login";
}
