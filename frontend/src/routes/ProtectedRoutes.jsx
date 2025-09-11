// src/routes/ProtectedRoutes.jsx
import React, { lazy, Suspense } from "react";
import { Route, Navigate } from "react-router-dom";

import RequireAuth from "./RequireAuth.jsx";
import AuthenticatedLayout from "../layouts/AuthenticatedLayout.jsx";
import ContractorDashboard from "../components/ContractorDashboard.jsx";
import AgreementWizard     from "../components/AgreementWizard.jsx";
import AgreementEdit       from "../components/AgreementEdit";
import AgreementDetail     from "../pages/AgreementDetail.jsx";
import InvoiceDetail       from "../components/InvoiceDetail.jsx";
import Customers           from "../components/Customers.jsx";
import CustomerForm        from "../components/CustomerForm.jsx";
import CustomerEdit        from "../components/CustomerEdit.jsx";
import ContractorProfile   from "../components/ContractorProfile.jsx";
import StripeOnboarding    from "../pages/StripeOnboarding.jsx";

// Lazy pages
const AgreementList     = lazy(() => import("../pages/AgreementList.jsx"));
const InvoiceList       = lazy(() => import("../components/InvoiceList.jsx"));
const BusinessDashboard = lazy(() => import("../components/BusinessDashboard.jsx"));
const Calendar          = lazy(() => import("../components/Calendar.jsx"));
const Expenses          = lazy(() => import("../pages/ExpensesPage.jsx"));
const Disputes          = lazy(() => import("../pages/DisputesPages.jsx"));

/**
 * Return a fragment of <Route> definitions wrapped by the authed layout.
 * Use by calling: {protectedRoutes()}
 */
export function protectedRoutes() {
  return (
    <>
      <Route element={
        <RequireAuth>
          <AuthenticatedLayout />
        </RequireAuth>
      }>
        {/* Dashboard */}
        <Route path="/dashboard" element={<ContractorDashboard />} />

        {/* Agreements */}
        <Route
          path="/agreements"
          element={
            <Suspense fallback={<div>Loading agreements…</div>}>
              <AgreementList />
            </Suspense>
          }
        />
        <Route path="/agreements/new" element={<AgreementWizard />} />
        <Route path="/agreements/:id" element={<AgreementDetail />} />
        <Route path="/agreements/:id/edit" element={<AgreementEdit />} />

        {/* Invoices */}
        <Route
          path="/invoices"
          element={
            <Suspense fallback={<div>Loading invoices…</div>}>
              <InvoiceList />
            </Suspense>
          }
        />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />

        {/* Customers */}
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/customers/:id/edit" element={<CustomerEdit />} />

        {/* Calendar */}
        <Route
          path="/calendar"
          element={
            <Suspense fallback={<div>Loading calendar…</div>}>
              <Calendar />
            </Suspense>
          }
        />

        {/* Expenses */}
        <Route
          path="/expenses"
          element={
            <Suspense fallback={<div>Loading expenses…</div>}>
              <Expenses />
            </Suspense>
          }
        />

        {/* Disputes */}
        <Route
          path="/disputes"
          element={
            <Suspense fallback={<div>Loading disputes…</div>}>
              <Disputes />
            </Suspense>
          }
        />

        {/* Business Analytics */}
        <Route
          path="/business-analysis"
          element={
            <Suspense fallback={<div>Loading business dashboard…</div>}>
              <BusinessDashboard />
            </Suspense>
          }
        />

        {/* Profile & Onboarding */}
        <Route path="/profile" element={<ContractorProfile />} />
        <Route path="/onboarding" element={<StripeOnboarding />} />

        {/* Fallback for unknown protected routes */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </>
  );
}
