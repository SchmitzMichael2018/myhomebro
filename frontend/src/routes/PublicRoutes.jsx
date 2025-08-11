// src/routes/publicRoutes.jsx
import React from 'react';
import { Route, Navigate } from 'react-router-dom';

import LandingPage      from '../components/LandingPage.jsx';
import LoginForm        from '../components/LoginForm.jsx';
import SignUpForm       from '../components/SignUpForm.jsx';
import ForgotPassword   from '../components/ForgotPassword.jsx';

export function publicRoutes(openLogin, handleLogin) {
  return (
    <>
      <Route
        path="/"
        element={<LandingPage onLoginClick={openLogin} />}
      />
      <Route
        path="/login"
        element={<LoginForm onLogin={handleLogin} />}
      />
      <Route path="/signup" element={<SignUpForm />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      {/* catch-all for unauthenticated users */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </>
  );
}
