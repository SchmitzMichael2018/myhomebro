import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Protects a route: only renders children if logged in.
 * Redirects to /login (or /signin) if not authenticated.
 */
export default function PrivateRoute({ children }) {
  const token = localStorage.getItem('access');
  const location = useLocation();

  // You can add a token expiration check here if needed (for extra security).

  return token
    ? children
    : <Navigate to="/login" state={{ from: location }} replace />;
}

