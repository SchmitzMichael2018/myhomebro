// src/pages/ProjectDetail.jsx

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";

const FIELD_FINDINGS_ENABLED =
  String(import.meta.env.VITE_CAPTURE_FIELD_FINDINGS_ENABLED || "").toLowerCase() === "true";

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchProject = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // This endpoint should use a detailed serializer on the backend
      // that includes nested homeowner and contractor objects.
      const { data } = await api.get(`/projects/${id}/`);
      setProject(data);
    } catch (err) {
      setError("Failed to load project details.");
      toast.error("Failed to load project details.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading project details...</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-red-500">{error}</div>;
  }

  if (!project) {
    return <div className="p-6 text-center text-gray-500">Project not found.</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="text-sm text-blue-600 hover:underline">
            ← Back
        </button>
        <h1 className="text-3xl font-bold text-gray-800 mt-2">
          {project.title}
        </h1>
        <p className="text-gray-500 font-mono text-sm">Project #{project.number}</p>
      </div>
      
      <div className="bg-white rounded-xl shadow-lg p-6 space-y-6">
        <section aria-labelledby="project-field-actions" className="border-b pb-6">
          <h2 id="project-field-actions" className="text-sm font-semibold text-gray-600">
            Field capture
          </h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("mhb:open-capture", {
                detail: { mode: "issue", projectId: project.id },
              }))}
              className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold text-gray-800"
            >
              Document an Issue
            </button>
            {FIELD_FINDINGS_ENABLED ? (
              <>
                <button
                  type="button"
                  data-testid="project-add-punch-items"
                  onClick={() => window.dispatchEvent(new CustomEvent("mhb:open-capture", {
                    detail: { mode: "punch_item", projectId: project.id },
                  }))}
                  className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold text-white"
                >
                  Add Punch Items
                </button>
                <button
                  type="button"
                  data-testid="project-record-site-condition"
                  onClick={() => window.dispatchEvent(new CustomEvent("mhb:open-capture", {
                    detail: { mode: "site_condition", projectId: project.id },
                  }))}
                  className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold text-gray-800"
                >
                  Record Site Condition
                </button>
              </>
            ) : null}
          </div>
        </section>
        <div>
          <h3 className="font-semibold text-gray-600 text-sm">Description</h3>
          <p className="text-gray-800 mt-1">{project.description || "No description provided."}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t pt-6">
          <div>
            <h3 className="font-semibold text-gray-600 text-sm">Contractor</h3>
            <p>{project.contractor?.name || "N/A"}</p>
            <p className="text-xs text-gray-500">{project.contractor?.email}</p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-600 text-sm">Homeowner</h3>
            <p>{project.homeowner?.name || "N/A"}</p>
            <p className="text-xs text-gray-500">{project.homeowner?.email}</p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-600 text-sm">Status</h3>
            <p className="font-bold capitalize">{project.status || "N/A"}</p>
          </div>
           <div>
            <h3 className="font-semibold text-gray-600 text-sm">Last Updated</h3>
            <p>{new Date(project.updated_at).toLocaleString()}</p>
          </div>
        </div>

        <div className="border-t pt-6">
            <Link 
                to={`/agreements/${project.agreement?.id || ''}`} 
                className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
            >
                View Full Agreement
            </Link>
        </div>
      </div>
    </div>
  );
}
