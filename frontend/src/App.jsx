// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";

/* Components */
import Sidebar from "./components/Sidebar.jsx";
import LandingPage from "./components/LandingPage.jsx";
import LoginModal from "./components/LoginModal.jsx";
import ContractorDashboard from "./components/ContractorDashboard.jsx";
import CalendarPage from "./components/Calendar.jsx";         // already uses PageShell
import MilestoneList from "./components/MilestoneList.jsx";   // already uses PageShell
import InvoiceDetail from "./components/InvoiceDetail.jsx";

/* Pages */
import AgreementList from "./pages/AgreementList.jsx";
import AgreementDetail from "./pages/AgreementDetail.jsx";
import InvoiceList from "./pages/InvoiceList.jsx";
import DisputesPages from "./pages/DisputesPages.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import PublicProfile from "./pages/PublicProfile.jsx";
import StripeOnboarding from "./pages/StripeOnboarding.jsx";
import OnboardingRedirect from "./pages/OnboardingRedirect.jsx";
import MilestoneDetail from "./pages/MilestoneDetail.jsx";
import Customers from "./components/Customers.jsx";

/* Global styles / toasts */
import { Toaster } from "react-hot-toast";
import "./styles/ui.css";     // theme (logo/typography/gradient/glass)
import "./styles/modal.css";  // modal z-index

console.log("App.jsx v2025-09-13-07:55");

/** Base layout — now ALWAYS uses the gradient background on every page */
function ProtectedLayout({ children }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main className="mhb-gradient-bg" style={{ flex: 1, minHeight: "100vh" }}>
        {children}
      </main>
    </div>
  );
}

/** Small helper to wrap any page with PageShell header + a glass content panel */
import PageShell from "./components/PageShell.jsx";
function Wrap({ title, subtitle, children }) {
  return (
    <ProtectedLayout>
      <PageShell title={title} subtitle={subtitle} showLogo>
        <div className="mhb-glass" style={{ padding: 16 }}>{children}</div>
      </PageShell>
    </ProtectedLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public landing */}
          <Route path="/" element={<LandingPage />} />

          {/* Dashboard (already uses PageShell internally) */}
          <Route
            path="/dashboard"
            element={
              <ProtectedLayout>
                <ContractorDashboard />
              </ProtectedLayout>
            }
          />

          {/* Agreements */}
          <Route
            path="/agreements"
            element={
              <Wrap title="Agreements" subtitle="Create, edit, and manage agreements.">
                <AgreementList />
              </Wrap>
            }
          />
          <Route
            path="/agreements/:id"
            element={
              <Wrap title="Agreement Details" subtitle="View terms, milestones, signatures, and history.">
                <AgreementDetail />
              </Wrap>
            }
          />

          {/* Milestones (already styled internally) */}
          <Route
            path="/milestones"
            element={
              <ProtectedLayout>
                <MilestoneList />
              </ProtectedLayout>
            }
          />
          <Route
            path="/milestones/:id"
            element={
              <Wrap title="Milestone Details" subtitle="Review progress, expenses, photos, and invoice status.">
                <MilestoneDetail />
              </Wrap>
            }
          />

          {/* Calendar */}
          <Route
            path="/calendar"
            element={
              <ProtectedLayout>
                <CalendarPage />
              </ProtectedLayout>
            }
          />

          {/* Invoices */}
          <Route
            path="/invoices"
            element={
              <Wrap title="Invoices" subtitle="Track pending approvals, approved payouts, and earnings.">
                <InvoiceList />
              </Wrap>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <Wrap title="Invoice Details" subtitle="Milestone charges, approvals, and payout history.">
                <InvoiceDetail />
              </Wrap>
            }
          />

          {/* Customers */}
          <Route
            path="/customers"
            element={
              <Wrap title="Customers" subtitle="View and manage your client list and contacts.">
                <Customers />
              </Wrap>
            }
          />

          {/* Disputes */}
          <Route
            path="/disputes"
            element={
              <Wrap title="Disputes" subtitle="Open issues, status, evidence, and resolution steps.">
                <DisputesPages />
              </Wrap>
            }
          />

          {/* Profiles */}
          <Route
            path="/profile"
            element={
              <Wrap title="My Profile" subtitle="Business info, license, brand assets, and preferences.">
                <ProfilePage />
              </Wrap>
            }
          />
          <Route
            path="/public-profile/:id"
            element={
              <Wrap title="Public Profile" subtitle="What homeowners see on your public page.">
                <PublicProfile />
              </Wrap>
            }
          />

          {/* Stripe onboarding */}
          <Route
            path="/stripe-onboarding"
            element={
              <Wrap title="Stripe Onboarding" subtitle="Connect your account for secure payouts.">
                <StripeOnboarding />
              </Wrap>
            }
          />
          <Route
            path="/onboarding-redirect"
            element={
              <Wrap title="Onboarding Redirect" subtitle="Finishing setup and syncing your account.">
                <OnboardingRedirect />
              </Wrap>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>

        {/* Global overlays */}
        <LoginModal />
        <Toaster position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
