// frontend/src/components/step1/useStep1Templates.jsx
// v2026-03-17-template-apply-response-sync
// Updates:
// - consumes backend apply-template response that returns { agreement, result, detail }
// - returns the full response payload from handleApplyTemplate()
// - syncs Step 1 local state from returned agreement payload
// - preserves strong/medium/weak recommendation behavior
// - keeps template detail + apply flow aligned with Step1Details / TemplateSearchSection

import { useEffect, useMemo, useState, useCallback } from "react";
import api from "../../api";
import toast from "react-hot-toast";
import { safeTrim, sortTemplates } from "./step1Utils";

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function sameText(a, b) {
  return safeTrim(a).toLowerCase() === safeTrim(b).toLowerCase();
}

function classifyTemplateMatch(template, projectType, projectSubtype) {
  const tplType = safeTrim(template?.project_type);
  const tplSubtype = safeTrim(template?.project_subtype);
  const reqType = safeTrim(projectType);
  const reqSubtype = safeTrim(projectSubtype);

  const typeMatch = !!reqType && sameText(tplType, reqType);
  const subtypeMatch = !!reqSubtype && sameText(tplSubtype, reqSubtype);

  if (reqSubtype) {
    if (typeMatch && subtypeMatch) {
      return { level: "strong", rank: 3, reason: "Exact type + subtype match." };
    }
    if (typeMatch) {
      return { level: "medium", rank: 2, reason: "Type matches, subtype differs." };
    }
    return { level: "weak", rank: 1, reason: "Only loose similarity; category does not match." };
  }

  if (reqType) {
    if (typeMatch) {
      return { level: "medium", rank: 2, reason: "Type matches." };
    }
    return { level: "weak", rank: 1, reason: "Only loose similarity; type does not match." };
  }

  return { level: "weak", rank: 1, reason: "No project type/subtype context yet." };
}

function attachMatchMeta(templates, projectType, projectSubtype) {
  const list = Array.isArray(templates) ? templates : [];
  return list.map((tpl) => {
    const match = classifyTemplateMatch(tpl, projectType, projectSubtype);
    return {
      ...tpl,
      _matchLevel: match.level,
      _matchRank: match.rank,
      _matchReason: match.reason,
    };
  });
}

function filterTemplatesForVisibleList(templates, projectType, projectSubtype, search) {
  const list = Array.isArray(templates) ? templates : [];
  const q = safeTrim(search).toLowerCase();
  const typeVal = safeTrim(projectType).toLowerCase();
  const subtypeVal = safeTrim(projectSubtype).toLowerCase();

  let narrowed = list;

  if (subtypeVal) {
    const exactSubtype = list.filter((tpl) =>
      sameText(tpl?.project_subtype, subtypeVal)
    );
    if (exactSubtype.length) {
      narrowed = exactSubtype;
    } else if (typeVal) {
      const sameType = list.filter((tpl) => sameText(tpl?.project_type, typeVal));
      if (sameType.length) {
        narrowed = sameType;
      }
    }
  } else if (typeVal) {
    const sameType = list.filter((tpl) => sameText(tpl?.project_type, typeVal));
    if (sameType.length) {
      narrowed = sameType;
    }
  }

  if (!q) return narrowed;

  return narrowed.filter((tpl) => {
    const name = safeTrim(tpl?.name).toLowerCase();
    const type = safeTrim(tpl?.project_type).toLowerCase();
    const subtype = safeTrim(tpl?.project_subtype).toLowerCase();
    const desc = safeTrim(tpl?.description).toLowerCase();

    return (
      name.includes(q) ||
      type.includes(q) ||
      subtype.includes(q) ||
      desc.includes(q)
    );
  });
}

function normalizeApplyOptions(options = {}, template = null) {
  const parsedDays = Number(options?.estimated_days || template?.estimated_days || 0);
  const estimated_days = parsedDays > 0 ? parsedDays : null;

  const spreadTotalRaw = String(options?.spread_total ?? "").trim();
  const parsedSpreadTotal =
    spreadTotalRaw !== "" && Number.isFinite(Number(spreadTotalRaw))
      ? Number(spreadTotalRaw)
      : null;

  return {
    estimated_days,
    auto_schedule: !!options?.auto_schedule,
    spread_enabled: !!options?.spread_enabled,
    spread_total: parsedSpreadTotal != null && parsedSpreadTotal > 0 ? parsedSpreadTotal : null,
  };
}

function deriveAgreementPatchFromApplyResponse(data, fallbackTemplate, currentTitle, currentDescription) {
  const agreement = data?.agreement || null;
  const template = agreement?.selected_template || fallbackTemplate || null;

  const nextTemplateId =
    agreement?.selected_template_id ??
    agreement?.selected_template?.id ??
    agreement?.project_template_id ??
    agreement?.template_id ??
    fallbackTemplate?.id ??
    null;

  const nextTemplateName =
    safeTrim(agreement?.selected_template_name_snapshot) ||
    safeTrim(agreement?.selected_template?.name) ||
    safeTrim(fallbackTemplate?.name);

  const nextTitle =
    safeTrim(agreement?.project_title) ||
    safeTrim(agreement?.title) ||
    currentTitle ||
    safeTrim(template?.name);

  const nextDescription =
    agreement?.description ??
    (safeTrim(template?.description) ? template.description : currentDescription);

  return {
    agreement,
    patch: {
      project_title: nextTitle || "",
      project_type: agreement?.project_type ?? "",
      project_subtype: agreement?.project_subtype ?? "",
      description: nextDescription || "",
      selected_template: template,
      selected_template_id: nextTemplateId,
      selected_template_name_snapshot: nextTemplateName || "",
      project_template_id: nextTemplateId,
      template_id: nextTemplateId,
    },
  };
}

export default function useStep1Templates({
  locked,
  agreementId,
  dLocal,
  setDLocal,
  isNewAgreement,
  writeCache,
  onTemplateApplied,
  refreshAgreement,
}) {
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesErr, setTemplatesErr] = useState("");
  const [templates, setTemplates] = useState([]);
  const [recommendedCandidates, setRecommendedCandidates] = useState([]);

  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [applyingTemplateId, setApplyingTemplateId] = useState(null);

  const [recommendedTemplateId, setRecommendedTemplateId] = useState(null);
  const [templateRecommendationReason, setTemplateRecommendationReason] = useState("");
  const [templateRecommendationScore, setTemplateRecommendationScore] = useState(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationConfidence, setRecommendationConfidence] = useState("none");

  const [templateSearch, setTemplateSearch] = useState("");
  const [noTemplateMatch, setNoTemplateMatch] = useState(false);
  const [noTemplateReason, setNoTemplateReason] = useState("");

  const [templateDetailLoading, setTemplateDetailLoading] = useState(false);
  const [templateDetailErr, setTemplateDetailErr] = useState("");
  const [templateDetail, setTemplateDetail] = useState(null);

  const currentProjectType = safeTrim(dLocal?.project_type);
  const currentProjectSubtype = safeTrim(dLocal?.project_subtype);
  const currentTitle = safeTrim(dLocal?.project_title);
  const currentDescription = safeTrim(dLocal?.description);

  const mergedTemplates = useMemo(() => {
    const base = Array.isArray(templates) ? templates : [];
    const recs = Array.isArray(recommendedCandidates) ? recommendedCandidates : [];
    const map = new Map();

    [...recs, ...base].forEach((tpl) => {
      if (!tpl?.id) return;

      const key = String(tpl.id);
      const existing = map.get(key);

      if (!existing) {
        map.set(key, tpl);
        return;
      }

      const existingMilestones = Array.isArray(existing?.milestones)
        ? existing.milestones.length
        : 0;
      const nextMilestones = Array.isArray(tpl?.milestones) ? tpl.milestones.length : 0;

      const existingScore =
        Object.keys(existing || {}).length +
        (safeTrim(existing?.description) ? 3 : 0) +
        (safeTrim(existing?.default_scope) ? 3 : 0) +
        existingMilestones;

      const nextScore =
        Object.keys(tpl || {}).length +
        (safeTrim(tpl?.description) ? 3 : 0) +
        (safeTrim(tpl?.default_scope) ? 3 : 0) +
        nextMilestones;

      map.set(key, nextScore >= existingScore ? tpl : existing);
    });

    const withMeta = attachMatchMeta(
      Array.from(map.values()),
      currentProjectType,
      currentProjectSubtype
    );

    return sortTemplates(withMeta).sort((a, b) => {
      const rankDiff = (b?._matchRank || 0) - (a?._matchRank || 0);
      if (rankDiff !== 0) return rankDiff;
      return 0;
    });
  }, [templates, recommendedCandidates, currentProjectType, currentProjectSubtype]);

  const selectedTemplate = useMemo(() => {
    return (
      (mergedTemplates || []).find((t) => String(t?.id) === String(selectedTemplateId || "")) ||
      null
    );
  }, [mergedTemplates, selectedTemplateId]);

  const filteredTemplates = useMemo(() => {
    return filterTemplatesForVisibleList(
      mergedTemplates,
      currentProjectType,
      currentProjectSubtype,
      templateSearch
    );
  }, [mergedTemplates, currentProjectType, currentProjectSubtype, templateSearch]);

  const resetRecommendationState = useCallback(() => {
    setRecommendedTemplateId(null);
    setTemplateRecommendationReason("");
    setTemplateRecommendationScore(null);
    setRecommendationConfidence("none");
    setNoTemplateMatch(false);
    setNoTemplateReason("");
    setRecommendedCandidates([]);
  }, []);

  const clearTemplateDetail = useCallback(() => {
    setTemplateDetail(null);
    setTemplateDetailErr("");
    setTemplateDetailLoading(false);
  }, []);

  const fetchTemplateDetail = useCallback(
    async (templateId) => {
      if (!templateId) {
        clearTemplateDetail();
        return null;
      }

      setTemplateDetailLoading(true);
      setTemplateDetailErr("");

      try {
        const { data } = await api.get(`/projects/templates/${templateId}/`, {
          params: { _ts: Date.now() },
        });
        setTemplateDetail(data || null);
        return data || null;
      } catch (e) {
        setTemplateDetail(null);
        setTemplateDetailErr(
          e?.response?.data?.detail ||
            e?.response?.data?.error ||
            "Could not load template preview."
        );
        return null;
      } finally {
        setTemplateDetailLoading(false);
      }
    },
    [clearTemplateDetail]
  );

  const fetchTemplates = useCallback(async () => {
    if (locked) return;

    setTemplatesLoading(true);
    setTemplatesErr("");

    try {
      const params = { _ts: Date.now() };

      if (currentProjectSubtype) {
        params.project_subtype = currentProjectSubtype;
      } else if (currentProjectType) {
        params.project_type = currentProjectType;
      }

      const { data } = await api.get("/projects/templates/", { params });
      const rows = sortTemplates(normalizeList(data));

      setTemplates(rows);

      setSelectedTemplateId((prev) => {
        if (prev && rows.some((t) => String(t.id) === String(prev))) return prev;
        return prev || null;
      });
    } catch (e) {
      setTemplates([]);
      setSelectedTemplateId(null);
      resetRecommendationState();
      setTemplatesErr(
        e?.response?.data?.detail || e?.response?.data?.error || "Could not load templates."
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, [locked, currentProjectType, currentProjectSubtype, resetRecommendationState]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (locked) return;

      setTemplatesLoading(true);
      setTemplatesErr("");

      try {
        const params = { _ts: Date.now() };

        if (currentProjectSubtype) {
          params.project_subtype = currentProjectSubtype;
        } else if (currentProjectType) {
          params.project_type = currentProjectType;
        }

        const { data } = await api.get("/projects/templates/", { params });
        const rows = sortTemplates(normalizeList(data));

        if (cancelled) return;

        setTemplates(rows);

        setSelectedTemplateId((prev) => {
          if (!prev) return null;

          const existsInRows = rows.some((t) => String(t.id) === String(prev));
          const existsInRecs = recommendedCandidates.some((t) => String(t.id) === String(prev));

          return existsInRows || existsInRecs ? prev : null;
        });
      } catch (e) {
        if (cancelled) return;
        setTemplates([]);
        setSelectedTemplateId(null);
        resetRecommendationState();
        setTemplatesErr(
          e?.response?.data?.detail || e?.response?.data?.error || "Could not load templates."
        );
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [
    locked,
    currentProjectType,
    currentProjectSubtype,
    recommendedCandidates,
    resetRecommendationState,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function recommendTemplateIfPossible() {
      if (locked) return;

      if (!currentProjectType && !currentProjectSubtype && !currentTitle && !currentDescription) {
        resetRecommendationState();
        return;
      }

      setRecommendationLoading(true);

      try {
        const { data } = await api.post("/projects/templates/recommend/", {
          project_title: currentTitle,
          project_type: currentProjectType,
          project_subtype: currentProjectSubtype,
          description: currentDescription,
        });

        if (cancelled) return;

        const backendConfidence = String(data?.confidence || "none");
        const backendRec = data?.recommended_template || data?.possible_match || null;
        const backendScore = data?.score ?? null;

        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
        const combinedCandidates = [...candidates];

        if (
          backendRec?.id &&
          !combinedCandidates.some((t) => String(t?.id) === String(backendRec.id))
        ) {
          combinedCandidates.unshift(backendRec);
        }

        const classifiedCandidates = attachMatchMeta(
          combinedCandidates,
          currentProjectType,
          currentProjectSubtype
        );

        setRecommendedCandidates(classifiedCandidates);

        const strongCandidates = classifiedCandidates.filter((t) => t?._matchLevel === "strong");
        const mediumCandidates = classifiedCandidates.filter((t) => t?._matchLevel === "medium");

        const chosen = strongCandidates[0] || mediumCandidates[0] || null;
        const chosenId = chosen?.id != null ? String(chosen.id) : null;

        if (chosenId) {
          setRecommendedTemplateId(chosenId);
          setTemplateRecommendationScore(backendScore);

          const chosenLevel = chosen?._matchLevel || "none";
          const uiConfidence =
            chosenLevel === "strong"
              ? "recommended"
              : chosenLevel === "medium"
              ? "possible"
              : "none";

          setRecommendationConfidence(uiConfidence);
          setNoTemplateMatch(false);
          setNoTemplateReason("");

          if (chosenLevel === "strong") {
            setTemplateRecommendationReason(
              backendConfidence === "recommended" && data?.reason
                ? data.reason
                : chosen?._matchReason || "Exact type and subtype match."
            );

            setSelectedTemplateId((prev) => prev || chosenId);
          } else if (chosenLevel === "medium") {
            setTemplateRecommendationReason(
              chosen?._matchReason || "Type matches, but subtype differs."
            );

            setSelectedTemplateId((prev) => prev || null);
          } else {
            setTemplateRecommendationReason("");
          }
        } else {
          setRecommendedTemplateId(null);
          setTemplateRecommendationScore(backendScore);
          setRecommendationConfidence("none");
          setTemplateRecommendationReason("");
          setSelectedTemplateId((prev) => {
            const current = classifiedCandidates.find((t) => String(t.id) === String(prev || ""));
            return current?.id ? prev : null;
          });

          if (!classifiedCandidates.length) {
            setNoTemplateMatch(true);
            setNoTemplateReason(
              data?.detail ||
                data?.reason ||
                "No matching template exists yet for this type/subtype."
            );
          } else {
            setNoTemplateMatch(true);
            setNoTemplateReason(
              "No strong template match yet. You can continue with a blank agreement or generate milestones from the project scope."
            );
          }
        }
      } catch {
        if (cancelled) return;
        resetRecommendationState();
      } finally {
        if (!cancelled) setRecommendationLoading(false);
      }
    }

    recommendTemplateIfPossible();
    return () => {
      cancelled = true;
    };
  }, [
    currentProjectType,
    currentProjectSubtype,
    currentTitle,
    currentDescription,
    locked,
    resetRecommendationState,
  ]);

  useEffect(() => {
    if (!selectedTemplateId) {
      clearTemplateDetail();
      return;
    }
    fetchTemplateDetail(selectedTemplateId);
  }, [selectedTemplateId, fetchTemplateDetail, clearTemplateDetail]);

  async function handleApplyTemplate(templateArg, options = {}) {
    if (locked) return null;

    const template = templateArg || selectedTemplate;
    if (!template?.id) {
      toast.error("Please select a template first.");
      return null;
    }

    if (!agreementId) {
      toast.error("Save Draft first so the agreement can receive template milestones.");
      return null;
    }

    setApplyingTemplateId(template.id);

    try {
      const detail =
        templateDetail && String(templateDetail?.id) === String(template.id)
          ? templateDetail
          : await fetchTemplateDetail(template.id);

      const applyOptions = normalizeApplyOptions(options, detail || template);

      const response = await api.post(`/projects/agreements/${agreementId}/apply-template/`, {
        template_id: template.id,
        overwrite_existing: true,
        copy_text_fields: true,
        estimated_days: applyOptions.estimated_days,
        auto_schedule: applyOptions.auto_schedule,
        spread_enabled: applyOptions.spread_enabled,
        spread_total: applyOptions.spread_total,
      });

      const data = response?.data || {};
      const { agreement, patch } = deriveAgreementPatchFromApplyResponse(
        data,
        detail || template,
        currentTitle,
        currentDescription
      );

      setDLocal((prev) => ({
        ...prev,
        ...patch,
      }));

      if (!isNewAgreement) {
        writeCache({
          project_title: patch.project_title || "",
          description: patch.description || "",
          selected_template: patch.selected_template || null,
          selected_template_id: patch.selected_template_id || null,
          selected_template_name_snapshot: patch.selected_template_name_snapshot || "",
          project_template_id: patch.project_template_id || null,
          template_id: patch.template_id || null,
        });
      }

      setSelectedTemplateId(String(template.id));
      setTemplateSearch(template.name || "");

      await fetchTemplates();

      if (typeof onTemplateApplied === "function") {
        await onTemplateApplied(agreement || null, data);
      } else if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }

      toast.success(`Template applied: ${template.name}`);
      return data;
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not apply template."
      );
      return null;
    } finally {
      setApplyingTemplateId(null);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplate?.id) {
      toast.error("No template selected.");
      return;
    }

    if (selectedTemplate.is_system) {
      toast.error("Built-in templates cannot be deleted.");
      return;
    }

    const confirmDelete = window.confirm(`Delete template "${selectedTemplate.name}"?`);
    if (!confirmDelete) return;

    try {
      await api.delete(`/projects/templates/${selectedTemplate.id}/`);

      toast.success("Template deleted.");

      setTemplates((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (t) => String(t.id) !== String(selectedTemplate.id)
        )
      );

      setRecommendedCandidates((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (t) => String(t.id) !== String(selectedTemplate.id)
        )
      );

      if (String(recommendedTemplateId || "") === String(selectedTemplate.id)) {
        resetRecommendationState();
      }

      setSelectedTemplateId(null);
      setTemplateSearch("");
      clearTemplateDetail();
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not delete template."
      );
    }
  }

  async function handleSaveAsTemplate(payload) {
    if (!agreementId) {
      toast.error("Save the agreement draft first.");
      return;
    }

    setTemplatesLoading(true);
    try {
      await api.post(`/projects/agreements/${agreementId}/save-as-template/`, payload);
      toast.success("Template saved successfully.");

      const params = { _ts: Date.now() };
      if (currentProjectSubtype) {
        params.project_subtype = currentProjectSubtype;
      } else if (currentProjectType) {
        params.project_type = currentProjectType;
      }

      const { data } = await api.get("/projects/templates/", { params });
      const rows = sortTemplates(normalizeList(data));
      setTemplates(rows);

      const savedName = safeTrim(payload?.name);
      const justSaved = rows.find((t) => safeTrim(t?.name) === savedName && !t?.is_system);
      if (justSaved?.id) {
        setSelectedTemplateId(String(justSaved.id));
        setTemplateSearch(justSaved.name || "");
      }

      return { ok: true };
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not save template."
      );
      return { ok: false };
    } finally {
      setTemplatesLoading(false);
    }
  }

  function handleTemplatePick(picked) {
    if (!picked?.id) return;

    setSelectedTemplateId(String(picked.id));
    setTemplateSearch(picked.name || "");

    setDLocal((prev) => ({ ...prev }));

    if (!isNewAgreement) {
      writeCache({});
    }
  }

  return {
    templatesLoading,
    templatesErr,
    templates: mergedTemplates,
    selectedTemplateId,
    setSelectedTemplateId,
    applyingTemplateId,

    recommendedTemplateId,
    templateRecommendationReason,
    templateRecommendationScore,
    recommendationLoading,
    recommendationConfidence,

    templateSearch,
    setTemplateSearch,

    selectedTemplate,
    filteredTemplates,

    noTemplateMatch,
    noTemplateReason,

    templateDetail,
    templateDetailLoading,
    templateDetailErr,

    handleApplyTemplate,
    handleDeleteTemplate,
    handleSaveAsTemplate,
    handleTemplatePick,
  };
}