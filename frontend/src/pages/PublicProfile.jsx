// src/pages/PublicProfile.jsx

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";

export default function PublicProfile() {
  const { id } = useParams();
  const [contractor, setContractor] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/contractors/${id}/public/`)
      .then(res => setContractor(res.data))
      .catch(err => {
        console.error("Failed to load public profile:", err);
        setError("Contractor not found.");
      });
  }, [id]);

  if (error) return <div className="text-center text-red-600 mt-10">{error}</div>;
  if (!contractor) return <div className="text-center mt-10 text-gray-600">Loading profile...</div>;

  return (
    <div className="max-w-3xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <h2 className="text-3xl font-bold text-blue-800 mb-4">{contractor.business_name}</h2>

      {contractor.logo && (
        <img
          src={contractor.logo}
          alt="Company Logo"
          className="w-40 h-40 object-contain mb-4 border rounded"
        />
      )}

      <div className="mb-4 text-gray-700">
        <strong>License #:</strong> {contractor.license_number || "N/A"}<br />
        <strong>Expires:</strong> {contractor.license_expiration || "N/A"}
      </div>

      <div>
        <strong>Skills:</strong>
        <div className="flex flex-wrap gap-2 mt-2">
          {contractor.skills.map(skill => (
            <span
              key={skill}
              className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
