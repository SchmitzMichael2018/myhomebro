// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";

import LandingPage from "./components/LandingPage.jsx";
import LoginModal from "./components/LoginModal.jsx";
import AgreementReview from "./pages/AgreementReview.jsx";

// No mobile chrome / no body classes — back to the simple shell
import "./styles/ui.css";
import "./styles/modal.css";

import { protectedRoutes } from "./routes/ProtectedRoutes.jsx";

console.log("App.jsx rollback: simple shell (no mobile.css)");

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/agreements/:id" element={<AgreementReview />} />

          {/* Auth-protected app sections */}
          {protectedRoutes()}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Global UI */}
        <LoginModal />
        <Toaster position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
