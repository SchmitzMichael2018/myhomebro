// src/routes/ProtectedRoutes.jsx
import React, { lazy } from "react";
import { Route, Navigate, Outlet } from "react-router-dom";

import RequireAuth from "./RequireAuth.jsx";
import AuthenticatedLayout from "../layouts/AuthenticatedLayout.jsx";

const ContractorDashboard = lazy(() => import("../components/ContractorDashboard.jsx"));

/* ✅ Admin */
const AdminDashboard = lazy(() => import("../pages/AdminDashboard.jsx"));
const AdminContractorDirectory = lazy(() => import("../pages/admin/AdminContractorDirectory.jsx"));
const AdminMarketplacePage = lazy(() => import("../pages/admin/AdminMarketplacePage.jsx"));
const AdminMaintenancePage = lazy(() => import("../pages/admin/AdminMaintenancePage.jsx"));
const AdminReimbursementsPage = lazy(() => import("../pages/admin/AdminReimbursementsPage.jsx"));
const AdminReviewsPage = lazy(() => import("../pages/admin/AdminReviewsPage.jsx"));

/* Employee pages */
const EmployeeDashboard = lazy(() => import("../pages/EmployeeDashboard.jsx"));
const EmployeeMilestones = lazy(() => import("../pages/EmployeeMilestones.jsx"));
const EmployeeCalendar = lazy(() => import("../pages/EmployeeCalendar.jsx"));
const EmployeeProfile = lazy(() => import("../pages/EmployeeProfile.jsx"));
const EmployeeAgreements = lazy(() => import("../pages/EmployeeAgreements.jsx"));
const SubcontractorAssignedWorkPage = lazy(() => import("../pages/SubcontractorAssignedWorkPage.jsx"));

/* Agreements */
const AgreementWizard = lazy(() => import("../components/AgreementWizard.jsx"));
const AgreementEdit = lazy(() => import("../components/AgreementEdit.jsx"));
const AgreementDetail = lazy(() => import("../pages/AgreementDetail.jsx"));
const AgreementList = lazy(() => import("../pages/AgreementList.jsx"));
const ProjectIntakeForm = lazy(() => import("../components/intake/ProjectIntakeForm.jsx"));

/* Milestones */
const MilestoneList = lazy(() => import("../components/MilestoneList.jsx"));
const MilestoneDetail = lazy(() => import("../pages/MilestoneDetail.jsx"));

/* Templates */
const TemplatesPage = lazy(() => import("../pages/TemplatesPage.jsx"));
const AdminTemplatesPage = lazy(() => import("../pages/AdminTemplatesPage.jsx"));

/* Assignments */
const AssignmentsPage = lazy(() => import("../pages/AssignmentsPage.jsx"));

/* Invoices */
const Invoices = lazy(() => import("../pages/Invoices.jsx"));
const InvoiceDetail = lazy(() => import("../components/InvoiceDetail.jsx"));

/* Customers */
const Customers = lazy(() => import("../components/Customers.jsx"));
const CustomerForm = lazy(() => import("../components/CustomerForm.jsx"));
const CustomerEdit = lazy(() => import("../components/CustomerEdit.jsx"));
const CustomerWorkspacePage = lazy(() => import("../pages/CustomerWorkspacePage.jsx"));

/* Other sections */
const ProfilePage = lazy(() => import("../pages/ProfilePage.jsx"));
const ContractorOnboardingForm = lazy(() => import("../components/ContractorOnboardingForm.jsx"));
const EmbeddedStripeOnboarding = lazy(() => import("../components/Stripe/EmbeddedStripeOnboarding.jsx"));
const BusinessDashboard = lazy(() => import("../components/BusinessDashboard.jsx"));
const Calendar = lazy(() => import("../components/Calendar.jsx"));
const Expenses = lazy(() => import("../pages/ExpensesPage.jsx"));
const Disputes = lazy(() => import("../pages/DisputesPages.jsx"));
const TeamSchedule = lazy(() => import("../pages/TeamSchedule.jsx"));
const TeamPage = lazy(() => import("../pages/TeamPage.jsx"));
const TeamEmployeeDetailPage = lazy(() => import("../pages/TeamEmployeeDetailPage.jsx"));
const TeamOverviewPage = lazy(() => import("../pages/TeamOverviewPage.jsx"));
const EstimateAvailabilityPage = lazy(() => import("../pages/EstimateAvailabilityPage.jsx"));
const SubcontractorsPage = lazy(() => import("../pages/SubcontractorsPage.jsx"));
const ReviewerQueuePage = lazy(() => import("../pages/ReviewerQueuePage.jsx"));
const PayoutHistoryPage = lazy(() => import("../pages/PayoutHistoryPage.jsx"));
const PayoutDetailPage = lazy(() => import("../pages/PayoutDetailPage.jsx"));
const ContractorPayoutHistoryPage = lazy(() => import("../pages/ContractorPayoutHistoryPage.jsx"));
const ContractorBidsPage = lazy(() => import("../pages/ContractorBidsPage.jsx"));
const EstimatesPage = lazy(() => import("../pages/EstimatesPage.jsx"));
const ProposalWorkspacePage = lazy(() => import("../pages/ProposalWorkspacePage.jsx"));
const CustomerRecordsPage = lazy(() => import("../pages/CustomerRecordsPage.jsx"));
const ContractorPublicPresencePage = lazy(() => import("../pages/ContractorPublicPresencePage.jsx"));
const ContractorWebsitePreviewPage = lazy(() => import("../pages/ContractorWebsitePreviewPage.jsx"));
const AIAssistantPage = lazy(() => import("../pages/AIAssistantPage.jsx"));
const GuidedOnboardingPage = lazy(() => import("../pages/GuidedOnboardingPage.jsx"));
const SupportTicketsPage = lazy(() => import("../pages/SupportTicketsPage.jsx"));
const NotificationsPage = lazy(() => import("../pages/NotificationsPage.jsx"));
const WarrantyDashboardPage = lazy(() => import("../pages/WarrantyDashboardPage.jsx"));

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
        <Route path="guided-onboarding" element={<GuidedOnboardingPage />} />

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
          <Route path="insights" element={<BusinessDashboard />} />
          <Route
            path="business-analysis"
            element={<Navigate to="/app/business" replace />}
          />

          <Route path="team" element={<TeamOverviewPage />} />
          <Route path="team/members" element={<TeamPage />} />
          <Route path="team/employees/:subaccountId" element={<TeamEmployeeDetailPage />} />
          <Route path="team/subcontractors" element={<SubcontractorsPage />} />
          <Route path="team/assignments" element={<AssignmentsPage />} />
          <Route path="team/schedule" element={<TeamSchedule />} />
          <Route path="team/estimate-availability" element={<EstimateAvailabilityPage />} />
          <Route path="team/settings/estimate-availability" element={<Navigate to="/app/team/estimate-availability" replace />} />
          <Route path="team-overview" element={<Navigate to="/app/team" replace />} />
          <Route path="team-schedule" element={<Navigate to="/app/team/schedule" replace />} />
          <Route path="subcontractors" element={<Navigate to="/app/team/subcontractors" replace />} />
          <Route path="assignments" element={<Navigate to="/app/team/assignments" replace />} />

          <Route path="marketing" element={<ContractorPublicPresencePage />} />
          <Route path="marketing/preview" element={<ContractorWebsitePreviewPage />} />
          <Route path="public-presence" element={<Navigate to="/app/marketing" replace />} />

          <Route path="opportunities" element={<ContractorBidsPage />} />
          <Route path="estimates" element={<EstimatesPage />} />
          <Route path="estimates/:proposalId" element={<ProposalWorkspacePage />} />
          <Route path="bids" element={<Navigate to="/app/opportunities" replace />} />
          <Route path="proposals/:proposalId" element={<ProposalWorkspacePage />} />

          <Route path="customers/records" element={<CustomerRecordsPage />} />
          <Route path="customers/activity" element={<Navigate to="/app/customers/records" replace />} />
          <Route path="customers/requests" element={<Navigate to="/app/customers/records?type=request" replace />} />
          <Route path="customers/agreements" element={<Navigate to="/app/customers/records?type=agreement" replace />} />
          <Route path="customer-records" element={<Navigate to="/app/customers/records" replace />} />

          <Route path="intake/new" element={<ProjectIntakeForm />} />

          <Route path="agreements" element={<AgreementList />} />

          <Route
            path="agreements/new"
            element={<Navigate to="/app/agreements/new/wizard?step=1" replace />}
          />
          <Route path="agreements/new/wizard" element={<AgreementWizard />} />
          <Route path="agreements/:id/wizard" element={<AgreementWizard />} />

          <Route path="agreements/:id/workspace" element={<AgreementDetail />} />
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
          <Route path="warranties" element={<WarrantyDashboardPage />} />

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
