// src/pages/PublicProfile.jsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";

function formatDate(s) {
  if (!s) return "N/A";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString();
  } catch {
    return s;
  }
}

export default function PublicProfile() {
  const { id } = useParams();
  const [contractor, setContractor] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // NOTE: projects namespace — /api/projects/contractors/:id/public/
    api
      .get(`/projects/contractors/${id}/public/`)
      .then((res) => setContractor(res.data))
      .catch((err) => {
        console.error("Failed to load public profile:", err);
        setError("Contractor not found.");
      });
  }, [id]);

  if (error) return <div className="mt-10 text-center text-red-600">{error}</div>;
  if (!contractor) return <div className="mt-10 text-center text-gray-600">Loading profile…</div>;

  const logo = contractor.logo_url || contractor.logo || "";
  const skills =
    Array.isArray(contractor.skills) && contractor.skills.length
      ? contractor.skills.map((s) => s?.name || s?.slug || String(s))
      : [];

  return (
    <div className="mx-auto mt-10 max-w-3xl rounded bg-white p-6 shadow">
      <h2 className="mb-4 text-3xl font-bold text-blue-800">{contractor.business_name}</h2>

      {logo && (
        <img
          src={logo}
          alt="Company Logo"
          className="mb-4 h-40 w-40 rounded border object-contain"
        />
      )}

      <div className="mb-4 text-gray-700">
        <div>
          <strong>License #:</strong> {contractor.license_number || "N/A"}
        </div>
        <div>
          <strong>Expires:</strong> {formatDate(contractor.license_expiration)}
        </div>
      </div>

      <div>
        <strong>Skills:</strong>
        <div className="mt-2 flex flex-wrap gap-2">
          {skills.length ? (
            skills.map((label, i) => (
              <span
                key={`${label}-${i}`}
                className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800"
              >
                {label}
              </span>
            ))
          ) : (
            <span className="text-gray-500">None listed</span>
          )}
        </div>
      </div>
    </div>
  );
}
