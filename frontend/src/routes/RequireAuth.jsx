// src/routes/RequireAuth.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAuth({ children }) {
  const { isAuthed, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null; // or a tiny splash

  if (!isAuthed) {
    // not signed in → back to landing
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return children;
}
