// src/pages/ProfilePage.jsx
import React from "react";
import ContractorProfile from "../components/ContractorProfile";
import ProfileDangerZone from "../components/ProfileDangerZone";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <ContractorProfile />
      <ProfileDangerZone />
    </div>
  );
}
