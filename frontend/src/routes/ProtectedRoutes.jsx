// src/routes/ProtectedRoutes.jsx
import React from "react";
import { Route, Navigate, Outlet } from "react-router-dom";

import RequireAuth from "./RequireAuth.jsx";
import AuthenticatedLayout from "../layouts/AuthenticatedLayout.jsx";

import ContractorDashboard from "../components/ContractorDashboard.jsx";

/* ✅ Admin */
import AdminDashboard from "../pages/AdminDashboard.jsx";
import AdminContractorDirectory from "../pages/admin/AdminContractorDirectory.jsx";
import AdminMarketplacePage from "../pages/admin/AdminMarketplacePage.jsx";
import AdminMaintenancePage from "../pages/admin/AdminMaintenancePage.jsx";
import AdminReimbursementsPage from "../pages/admin/AdminReimbursementsPage.jsx";
import AdminReviewsPage from "../pages/admin/AdminReviewsPage.jsx";

/* Employee pages */
import EmployeeDashboard from "../pages/EmployeeDashboard.jsx";
import EmployeeMilestones from "../pages/EmployeeMilestones.jsx";
import EmployeeCalendar from "../pages/EmployeeCalendar.jsx";
import EmployeeProfile from "../pages/EmployeeProfile.jsx";
import EmployeeAgreements from "../pages/EmployeeAgreements.jsx";
import SubcontractorAssignedWorkPage from "../pages/SubcontractorAssignedWorkPage.jsx";

/* Agreements */
import AgreementWizard from "../components/AgreementWizard.jsx";
import AgreementEdit from "../components/AgreementEdit.jsx";
import AgreementDetail from "../pages/AgreementDetail.jsx";
import AgreementList from "../pages/AgreementList.jsx";
import ProjectIntakeForm from "../components/intake/ProjectIntakeForm.jsx";

/* Milestones */
import MilestoneList from "../components/MilestoneList.jsx";
import MilestoneDetail from "../pages/MilestoneDetail.jsx";

/* Templates */
import TemplatesPage from "../pages/TemplatesPage.jsx";
import AdminTemplatesPage from "../pages/AdminTemplatesPage.jsx";

/* Assignments */
import AssignmentsPage from "../pages/AssignmentsPage.jsx";

/* Invoices */
import Invoices from "../pages/Invoices.jsx";
import InvoiceDetail from "../components/InvoiceDetail.jsx";

/* Customers */
import Customers from "../components/Customers.jsx";
import CustomerForm from "../components/CustomerForm.jsx";
import CustomerEdit from "../components/CustomerEdit.jsx";
import CustomerWorkspacePage from "../pages/CustomerWorkspacePage.jsx";

/* Other sections */
import ProfilePage from "../pages/ProfilePage.jsx";
import ContractorOnboardingForm from "../components/ContractorOnboardingForm.jsx";
import EmbeddedStripeOnboarding from "../components/Stripe/EmbeddedStripeOnboarding.jsx";
import BusinessDashboard from "../components/BusinessDashboard.jsx";
import Calendar from "../components/Calendar.jsx";
import Expenses from "../pages/ExpensesPage.jsx";
import Disputes from "../pages/DisputesPages.jsx";
import TeamSchedule from "../pages/TeamSchedule.jsx";
import TeamPage from "../pages/TeamPage.jsx";
import TeamOverviewPage from "../pages/TeamOverviewPage.jsx";
import SubcontractorsPage from "../pages/SubcontractorsPage.jsx";
import ReviewerQueuePage from "../pages/ReviewerQueuePage.jsx";
import PayoutHistoryPage from "../pages/PayoutHistoryPage.jsx";
import PayoutDetailPage from "../pages/PayoutDetailPage.jsx";
import ContractorPayoutHistoryPage from "../pages/ContractorPayoutHistoryPage.jsx";
import ContractorBidsPage from "../pages/ContractorBidsPage.jsx";
import CustomerRecordsPage from "../pages/CustomerRecordsPage.jsx";
import ContractorPublicPresencePage from "../pages/ContractorPublicPresencePage.jsx";
import ContractorWebsitePreviewPage from "../pages/ContractorWebsitePreviewPage.jsx";
import AIAssistantPage from "../pages/AIAssistantPage.jsx";
import SupportTicketsPage from "../pages/SupportTicketsPage.jsx";
import NotificationsPage from "../pages/NotificationsPage.jsx";

import { useWhoAmI } from "../hooks/useWhoAmI";

function AppHomeRedirect() {
  const { data: identity, loading } = useWhoAmI();
  if (loading) return null;

  const role = identity?.type || identity?.role || "none";
  const r = String(role).toLowerCase();

  if (r === "admin") return <Navigate to="/app/admin" replace />;
  if (r === "subaccount") return <Navigate to="/app/employee/dashboard" replace />;
  if (r === "subcontractor") return <Navigate to="/app/subcontractor/assigned-work" replace />;
  if (r === "contractor" || r === "contractor_owner") {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <Navigate to="/" replace />;
}

function RoleGate({ allow }) {
  const { data: identity, loading } = useWhoAmI();
  const role = identity?.type || identity?.role || "none";
  const r = String(role).toLowerCase();
  if (loading) return null;

  const allowNorm = allow.map((x) => String(x).toLowerCase());

  if (!identity || !allowNorm.includes(r)) {
    if (r === "admin") return <Navigate to="/app/admin" replace />;
    if (r === "subaccount") return <Navigate to="/app/employee/dashboard" replace />;
    if (r === "subcontractor") return <Navigate to="/app/subcontractor/assigned-work" replace />;
    return <Navigate to="/app/dashboard" replace />;
  }

  return <Outlet />;
}

export function protectedRoutes() {
  return (
    <>
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AuthenticatedLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AppHomeRedirect />} />
        <Route path="notifications" element={<NotificationsPage />} />

        {/* ---------------- ADMIN ---------------- */}
        <Route element={<RoleGate allow={["admin"]} />}>
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="admin/marketplace" element={<AdminMarketplacePage />} />
          <Route path="admin/marketplace/analytics" element={<AdminMarketplacePage />} />
          <Route path="admin/marketplace/verification" element={<AdminMarketplacePage />} />
          <Route path="admin/marketplace/contractors" element={<AdminMarketplacePage />} />
          <Route path="admin/marketplace/import" element={<AdminMarketplacePage />} />
          <Route path="admin/marketplace/listings/:id" element={<AdminMarketplacePage />} />
          <Route path="admin/maintenance" element={<AdminMaintenancePage />} />
          <Route path="admin/reimbursements" element={<AdminReimbursementsPage />} />
          <Route path="admin/reviews" element={<AdminReviewsPage />} />
          <Route path="admin/contractor-directory" element={<AdminContractorDirectory />} />
          <Route path="admin/agreements/:id" element={<AgreementDetail adminMode />} />
          <Route path="admin/templates" element={<AdminTemplatesPage />} />
          <Route path="admin/disputes" element={<Disputes />} />
        </Route>

        {/* ---------------- CONTRACTOR ---------------- */}
        <Route
          element={<RoleGate allow={["contractor", "contractor_owner", "subaccount"]} />}
        >
          <Route path="reviewer/queue" element={<ReviewerQueuePage />} />
        </Route>

        <Route element={<RoleGate allow={["contractor", "contractor_owner"]} />}>
          <Route path="dashboard" element={<ContractorDashboard />} />
          <Route path="assistant" element={<AIAssistantPage />} />
          <Route path="support" element={<SupportTicketsPage />} />
          <Route path="support/:ticketNumber" element={<SupportTicketsPage />} />
          <Route path="payouts/history" element={<PayoutHistoryPage />} />
          <Route path="payouts/history/:id" element={<PayoutDetailPage />} />
          <Route path="payout-history" element={<ContractorPayoutHistoryPage />} />

          <Route path="business" element={<BusinessDashboard />} />
          <Route
            path="business-analysis"
            element={<Navigate to="/app/business" replace />}
          />

          <Route path="team" element={<TeamOverviewPage />} />
          <Route path="team/members" element={<TeamPage />} />
          <Route path="team/subcontractors" element={<SubcontractorsPage />} />
          <Route path="team/assignments" element={<AssignmentsPage />} />
          <Route path="team/schedule" element={<TeamSchedule />} />
          <Route path="team-overview" element={<Navigate to="/app/team" replace />} />
          <Route path="team-schedule" element={<Navigate to="/app/team/schedule" replace />} />
          <Route path="subcontractors" element={<Navigate to="/app/team/subcontractors" replace />} />
          <Route path="assignments" element={<Navigate to="/app/team/assignments" replace />} />

          <Route path="marketing" element={<ContractorPublicPresencePage />} />
          <Route path="marketing/preview" element={<ContractorWebsitePreviewPage />} />
          <Route path="public-presence" element={<Navigate to="/app/marketing" replace />} />

          <Route path="opportunities" element={<ContractorBidsPage />} />
          <Route path="bids" element={<Navigate to="/app/opportunities" replace />} />

          <Route path="customers/activity" element={<CustomerRecordsPage />} />
          <Route path="customers/requests" element={<CustomerRecordsPage />} />
          <Route path="customers/agreements" element={<CustomerRecordsPage />} />
          <Route path="customer-records" element={<Navigate to="/app/customers/activity" replace />} />

          <Route path="intake/new" element={<ProjectIntakeForm />} />

          <Route path="agreements" element={<AgreementList />} />

          <Route
            path="agreements/new"
            element={<Navigate to="/app/agreements/new/wizard?step=1" replace />}
          />
          <Route path="agreements/new/wizard" element={<AgreementWizard />} />
          <Route path="agreements/:id/wizard" element={<AgreementWizard />} />

          <Route path="agreements/:id" element={<AgreementDetail />} />
          <Route path="agreements/:id/edit" element={<AgreementEdit />} />

          <Route path="templates" element={<TemplatesPage />} />

          <Route path="milestones" element={<MilestoneList />} />
          <Route path="milestones/:id" element={<MilestoneDetail />} />

          <Route path="payments" element={<Invoices />} />
          <Route path="invoices" element={<Navigate to="/app/payments" replace />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />

          <Route path="customers" element={<Customers />} />
          <Route path="customers/new" element={<CustomerForm />} />
          <Route path="customers/:id/edit" element={<CustomerEdit />} />
          <Route path="customers/:id" element={<CustomerWorkspacePage />} />

          <Route path="calendar" element={<Calendar />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="disputes" element={<Disputes />} />

          <Route path="profile" element={<ProfilePage />} />
          <Route path="onboarding" element={<ContractorOnboardingForm />} />
          <Route path="onboarding/stripe" element={<EmbeddedStripeOnboarding />} />
        </Route>

        {/* ---------------- EMPLOYEE ---------------- */}
        <Route element={<RoleGate allow={["subaccount"]} />}>
          <Route path="employee/dashboard" element={<EmployeeDashboard />} />
          <Route path="employee/agreements" element={<EmployeeAgreements />} />
          <Route path="employee/milestones" element={<EmployeeMilestones />} />
          <Route path="employee/calendar" element={<EmployeeCalendar />} />
          <Route path="employee/profile" element={<EmployeeProfile />} />
          <Route path="support" element={<SupportTicketsPage />} />
          <Route path="support/:ticketNumber" element={<SupportTicketsPage />} />
        </Route>

        <Route element={<RoleGate allow={["subcontractor"]} />}>
          <Route
            path="subcontractor/assigned-work"
            element={<SubcontractorAssignedWorkPage />}
          />
          <Route path="support" element={<SupportTicketsPage />} />
          <Route path="support/:ticketNumber" element={<SupportTicketsPage />} />
        </Route>

        <Route element={<RoleGate allow={["admin"]} />}>
          <Route path="support" element={<SupportTicketsPage />} />
          <Route path="support/:ticketNumber" element={<SupportTicketsPage />} />
        </Route>

        <Route path="*" element={<AppHomeRedirect />} />
      </Route>

      <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
      <Route
        path="/employee"
        element={<Navigate to="/app/employee/dashboard" replace />}
      />
    </>
  );
}
