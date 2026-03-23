// src/hooks/useWhoAmI.js
// v2025-11-16 — Role detection for contractor vs employee + debug logging

import { useEffect, useState } from "react";
import api from "../api";

export function useWhoAmI() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function fetchIdentity() {
      try {
        setLoading(true);
        setError(null);

        // IMPORTANT: leading slash, NO extra "api" prefix
        // baseURL = "/api" → "/api/projects/whoami/"
        const res = await api.get("/projects/whoami/");
        const payload = Array.isArray(res.data) ? res.data[0] : res.data;

        if (!active) return;

        console.log("whoami payload:", payload); // 🔍 DEBUG
        setData(payload);
      } catch (err) {
        if (!active) return;

        console.error("whoami error:", err); // 🔍 DEBUG
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    fetchIdentity();
    return () => {
      active = false;
    };
  }, []);

  return {
    data,
    loading,
    error,
    identityType: data?.identity_type || data?.role || data?.type || null,
    isContractor:
      data && data.type === "contractor" && data.role === "contractor_owner",
    isEmployee: data && data.type === "subaccount",
    isSubcontractor: data && data.type === "subcontractor",
    isInternalTeamMember:
      data && (data.identity_type === "internal_team_member" || data.type === "subaccount"),
  };
}
