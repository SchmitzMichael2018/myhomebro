import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function TemplatePicker({
  agreementId,
  projectType,
  projectSubtype,
  onTemplateApplied,
}) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const params = {};
      if (projectType) params.project_type = projectType;
      if (projectSubtype) params.project_subtype = projectSubtype;

      const { data } = await api.get("/projects/templates/", { params });
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error("Unable to load templates.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [projectType, projectSubtype]);

  const applyTemplate = async (templateId) => {
    if (!agreementId) {
      toast.error("Create the agreement first.");
      return;
    }

    try {
      setApplyingId(templateId);

      await api.post(
        `/projects/agreements/${agreementId}/apply-template/`,
        {
          template_id: templateId,
          overwrite_existing: true,
          copy_text_fields: true,
        }
      );

      toast.success("Template applied.");
      if (onTemplateApplied) onTemplateApplied();

    } catch (err) {
      toast.error(err?.response?.data?.detail || "Unable to apply template.");
    } finally {
      setApplyingId(null);
    }
  };

  const systemTemplates = templates.filter((t) => t.is_system);
  const contractorTemplates = templates.filter((t) => !t.is_system);

  return (
    <div className="space-y-6">

      <div>
        <div className="text-sm font-semibold text-white mb-2">
          System Templates
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {systemTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              applying={applyingId === t.id}
              onApply={() => applyTemplate(t.id)}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-white mb-2">
          My Templates
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contractorTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              applying={applyingId === t.id}
              onApply={() => applyTemplate(t.id)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-white/70">Loading templates…</div>
      ) : null}
    </div>
  );
}

function TemplateCard({ template, onApply, applying }) {
  return (
    <div className="border border-white/20 rounded-lg p-3 bg-white/10">
      <div className="text-sm font-semibold text-white">
        {template.name}
      </div>

      {template.description ? (
        <div className="text-xs text-white/70 mt-1">
          {template.description}
        </div>
      ) : null}

      <div className="text-xs text-white/60 mt-1">
        {template.milestone_count} milestones
      </div>

      <button
        onClick={onApply}
        disabled={applying}
        className="mt-3 px-3 py-1 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-700"
      >
        {applying ? "Applying..." : "Use Template"}
      </button>
    </div>
  );
}