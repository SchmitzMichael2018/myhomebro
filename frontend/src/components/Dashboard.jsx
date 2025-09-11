import React from "react";
import ContractorDashboard from "./ContractorDashboard";

/**
 * Adapter: keeps old routes/imports working.
 * If your router uses <Dashboard/>, it will now render ContractorDashboard.
 * Version tag helps you confirm the new bundle is live in DevTools.
 */
export default function Dashboard() {
  console.log("[MyHomeBro] Dashboard adapter -> ContractorDashboard v2025-09-03");
  return <ContractorDashboard />;
}
