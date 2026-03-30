// src/pages/ProfilePage.jsx
import React from "react";
import ContractorProfile from "../components/ContractorProfile";
import ProfileDangerZone from "../components/ProfileDangerZone";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

export default function ProfilePage() {
  return (
    <ContractorPageSurface
      tier="wide"
      eyebrow="Settings"
      title="Profile & Billing"
      subtitle="Manage your business profile, plan details, Stripe status, and account settings from a consistent account surface."
    >
      <ContractorProfile />
      <ProfileDangerZone />
    </ContractorPageSurface>
  );
}
