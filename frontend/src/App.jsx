// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import LandingPage from "./components/LandingPage";
import { protectedRoutes } from "./routes/ProtectedRoutes";
import LoginModal from "./components/LoginModal";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public landing */}
          <Route path="/" element={<LandingPage />} />
          {/* Protected routes are wrapped by RequireAuth inside ProtectedRoutes.jsx */}
          {protectedRoutes()}
          {/* Fallback */}
          <Route path="*" element={<LandingPage />} />
        </Routes>

        {/* Global login modal controlled by AuthContext (no props) */}
        <LoginModal />
      </BrowserRouter>
    </AuthProvider>
  );
}
