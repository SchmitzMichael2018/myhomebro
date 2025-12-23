// src/routes/ProtectedRoutes.jsx
import React from "react";
import { Route, Navigate } from "react-router-dom";

import RequireAuth from "./RequireAuth.jsx";
import AuthenticatedLayout from "../layouts/AuthenticatedLayout.jsx";

/* Dashboard */
import ContractorDashboard from "../components/ContractorDashboard.jsx";

/* Agreements */
import AgreementWizard from "../components/AgreementWizard.jsx";
import AgreementEdit from "../components/AgreementEdit.jsx";
import AgreementDetail from "../pages/AgreementDetail.jsx";
import AgreementList from "../pages/AgreementList.jsx";

/* Milestones */
import MilestoneList from "../components/MilestoneList.jsx";
import MilestoneDetail from "../pages/MilestoneDetail.jsx";

/* Invoices */
import Invoices from "../pages/Invoices.jsx";
import InvoiceDetail from "../components/InvoiceDetail.jsx";

/* Customers */
import Customers from "../components/Customers.jsx";
import CustomerForm from "../components/CustomerForm.jsx";
import CustomerEdit from "../components/CustomerEdit.jsx";

/* Other sections */
import ContractorProfile from "../components/ContractorProfile.jsx";
import StripeOnboarding from "../components/Stripe/StripeOnboarding.jsx";
import BusinessDashboard from "../components/BusinessDashboard.jsx";
import Calendar from "../components/Calendar.jsx";
import Expenses from "../pages/ExpensesPage.jsx";
import Disputes from "../pages/DisputesPages.jsx";

/**
 * Protected application routes (requires auth)
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
        <Route path="/dashboard" element={<ContractorDashboard />} />

        <Route path="/agreements" element={<AgreementList />} />
        <Route path="/agreements/new" element={<AgreementWizard />} />
        <Route path="/agreements/:id" element={<AgreementDetail />} />
        <Route path="/agreements/:id/edit" element={<AgreementEdit />} />
        <Route path="/agreements/:id/wizard" element={<AgreementWizard />} />

        <Route path="/milestones" element={<MilestoneList />} />
        <Route path="/milestones/:id" element={<MilestoneDetail />} />

        {/* Contractor list */}
        <Route path="/invoices" element={<Invoices />} />
        {/* ✅ Contractor detail lives under /app/invoices/:id to avoid collision with public /invoices/:id */}
        <Route path="/app/invoices/:id" element={<InvoiceDetail />} />

        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/customers/:id/edit" element={<CustomerEdit />} />

        <Route path="/calendar" element={<Calendar />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/disputes" element={<Disputes />} />
        <Route path="/business-analysis" element={<BusinessDashboard />} />

        <Route path="/profile" element={<ContractorProfile />} />
        <Route path="/onboarding" element={<StripeOnboarding />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </>
  );
}
