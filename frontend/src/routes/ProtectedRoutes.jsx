// src/routes/ProtectedRoutes.jsx
import React from "react";
import { Route, Navigate } from "react-router-dom";

import RequireAuth from "./RequireAuth.jsx";
import AuthenticatedLayout from "../layouts/AuthenticatedLayout.jsx";

/* Synchronous imports for stability */
import ContractorDashboard from "../components/ContractorDashboard.jsx";

/* Agreements */
import AgreementWizard   from "../components/AgreementWizard.jsx";
import AgreementEdit     from "../components/AgreementEdit.jsx";
import AgreementDetail   from "../pages/AgreementDetail.jsx";
import AgreementList     from "../pages/AgreementList.jsx";

/* Milestones */
import MilestoneList     from "../components/MilestoneList.jsx";
import MilestoneDetail   from "../pages/MilestoneDetail.jsx";

/* Invoices */
import InvoiceList       from "../pages/InvoiceList.jsx";
import InvoiceDetail     from "../components/InvoiceDetail.jsx";

/* Customers */
import Customers         from "../components/Customers.jsx";
import CustomerForm      from "../components/CustomerForm.jsx";
import CustomerEdit      from "../components/CustomerEdit.jsx";

/* Other sections */
import ContractorProfile from "../components/ContractorProfile.jsx";
import StripeOnboarding  from "../components/Stripe/StripeOnboarding.jsx";
import BusinessDashboard from "../components/BusinessDashboard.jsx";
import Calendar          from "../components/Calendar.jsx";
import Expenses          from "../pages/ExpensesPage.jsx";
import Disputes          from "../pages/DisputesPages.jsx";

/**
 * Return a fragment of <Route> definitions wrapped by the authed layout.
 * Use by calling: {protectedRoutes()}
 */
export function protectedRoutes() {
  return (
    <>
      <Route
        element={
          <RequireAuth>
            <AuthenticatedLayout />
          </RequireAuth>
        }
      >
        {/* Dashboard */}
        <Route path="/dashboard" element={<ContractorDashboard />} />

        {/* Agreements */}
        <Route path="/agreements" element={<AgreementList />} />
        <Route path="/agreements/new" element={<AgreementWizard />} />
        <Route path="/agreements/:id" element={<AgreementDetail />} />
        <Route path="/agreements/:id/edit" element={<AgreementEdit />} />
        {/* NEW: open the wizard for existing draft agreements (supports ?step=1..4) */}
        <Route path="/agreements/:id/wizard" element={<AgreementWizard />} />

        {/* Milestones */}
        <Route path="/milestones" element={<MilestoneList />} />
        <Route path="/milestones/:id" element={<MilestoneDetail />} />

        {/* Invoices */}
        <Route path="/invoices" element={<InvoiceList />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />

        {/* Customers */}
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/customers/:id/edit" element={<CustomerEdit />} />

        {/* Calendar / Expenses / Disputes / Business */}
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/disputes" element={<Disputes />} />
        <Route path="/business-analysis" element={<BusinessDashboard />} />

        {/* Profile & Onboarding */}
        <Route path="/profile" element={<ContractorProfile />} />
        <Route path="/onboarding" element={<StripeOnboarding />} />

        {/* Fallback for unknown protected routes */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </>
  );
}
