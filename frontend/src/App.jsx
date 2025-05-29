// src/App.jsx
import React, { useState, useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useLocation,
} from "react-router-dom";

import Sidebar from "./components/Sidebar";
import LandingPage from "./components/LandingPage";
import LoginForm from "./components/LoginForm";
import SignUpForm from "./components/SignUpForm";
import ForgotPassword from "./components/ForgotPassword";
import AIGuideWidget from "./components/AIGuideWidget";
import StripeOnboarding from "./components/StripeOnboarding";

import ContractorDashboard from "./components/ContractorDashboard";
import AgreementList from "./pages/AgreementList";
import AgreementForm from "./pages/AgreementForm";
import AgreementDetail from "./pages/AgreementDetail";
import InvoiceList from "./pages/InvoiceList";
import AgreementWizard from "./components/AgreementWizard";

import { getAccessToken, clearSession } from "./auth";

export default function App() {
  const [token, setToken] = useState(getAccessToken());
  const location = useLocation();
  const navigate = useNavigate();

  // Sync login state across tabs
  useEffect(() => {
    const onStorage = () => setToken(getAccessToken());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleLogin = (access) => {
    setToken(access);
    navigate("/dashboard", { replace: true });
  };

  const handleLogout = () => {
    clearSession();
    setToken(null);
    navigate("/", { replace: true });
  };

  return (
    <>
      {/* Always-on AI guide */}
      <AIGuideWidget section={location.pathname} />

      <Routes>
        {/* 1. Landing page always at root */}
        <Route path="/" element={<LandingPage />} />

        {/* 2. Public auth flows */}
        <Route
          path="/signin"
          element={
            token ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginForm onLogin={handleLogin} />
            )
          }
        />
        <Route
          path="/signup"
          element={
            token ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <SignUpForm onSignUp={handleLogin} />
            )
          }
        />
        <Route
          path="/forgot-password"
          element={
            token ? <Navigate to="/signin" replace /> : <ForgotPassword />
          }
        />

        {/* 3. Protected routes */}
        <Route
          element={
            <ProtectedLayout token={token} onLogout={handleLogout} />
          }
        >
          <Route path="/dashboard" element={<ContractorDashboard />} />
          <Route path="/agreements" element={<AgreementList />} />
          <Route path="/agreements/new" element={<AgreementForm />} />
          <Route path="/agreements/:id" element={<AgreementDetail />} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/wizard" element={<AgreementWizard />} />
          <Route path="/onboarding" element={<StripeOnboarding />} />
        </Route>

        {/* 4. Fallback → landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function ProtectedLayout({ token, onLogout }) {
  if (!token) {
    return <Navigate to="/signin" replace />;
  }

  return (
    <div className="flex min-h-screen">
      {/* Pass logout handler as Sidebar's setToken prop */}
      <Sidebar setToken={onLogout} />

      <div className="flex-1 flex flex-col">
        <header className="flex justify-between items-center p-4 bg-white shadow">
          <h1 className="text-xl font-bold">MyHomeBro</h1>
        </header>
        <main
          className="flex-1 overflow-auto p-6 bg-gray-100"
          role="main"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

































