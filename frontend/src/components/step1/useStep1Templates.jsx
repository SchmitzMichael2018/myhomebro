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
import { getProjectFamilyProfile, normalizeProjectFamilyKey } from "../../lib/projectIntelligence";

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HVAC_ALIAS_PATTERNS = [
  /\bcentral\s+ac\s+install(?:ation)?\b/g,
  /\bcentral\s+air\s+install(?:ation)?\b/g,
  /\bair\s+conditioner\s+install(?:ation)?\b/g,
  /\bhvac\s+install(?:ation)?\b/g,
  /\bcooling\s+system\s+install(?:ation)?\b/g,
  /\bac\s+install(?:ation)?\b/g,
  /\binstall\s+air\s+conditioner\b/g,
  /\binstall\s+central\s+ac\b/g,
  /\binstall\s+central\s+air\b/g,
  /\binstall\s+hvac\b/g,
  /\binstall\s+cooling\s+system\b/g,
];

function canonicalizeHvacText(text) {
  let normalized = normalizeSearchText(text);
  if (!normalized) return "";

  for (const pattern of HVAC_ALIAS_PATTERNS) {
    normalized = normalized.replace(pattern, " central air installation ");
  }

  return normalizeSearchText(normalized);
}

function sameText(a, b) {
  return safeTrim(a).toLowerCase() === safeTrim(b).toLowerCase();
}

function normalizeStep1FieldValue(value) {
  const raw = safeTrim(value);
  if (!raw) return "";
  const cleaned = raw
    .replace(/\s*\(new\)\s*$/i, "")
    .replace(/^[\-–—•\s]+/, "")
    .replace(/[\s\-–—•]+$/, "")
    .trim();
  if (!cleaned) return "";
  if (/^\d+$/.test(cleaned)) return "";
  if (/^\d+\s*\(new\)$/i.test(raw)) return "";
  if (/^(not available|custom project|draft agreement|my new template|null|undefined)$/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function normalizeRecommendationLevel(value) {
  const normalized = safeTrim(value).toLowerCase();
  if (normalized === "high" || normalized === "recommended") return "high";
  if (normalized === "medium" || normalized === "possible") return "medium";
  return "low";
}

function templateText(template) {
  const clarificationText = Array.isArray(template?.default_clarifications)
    ? template.default_clarifications
        .map((item) => normalizeSearchText(typeof item === "string" ? item : JSON.stringify(item || "")))
        .filter(Boolean)
        .join(" ")
    : "";

  return [
    template?.name,
    template?.description,
    template?.default_scope,
    template?.exclusions_text,
    template?.assumptions_text,
    template?.project_materials_hint,
    template?.project_type,
    template?.project_subtype,
    clarificationText,
  ]
    .map((value) => canonicalizeHvacText(value))
    .filter(Boolean)
    .join(" ");
}

function scoreFamilyMatch(template, familyProfile) {
  if (!familyProfile || familyProfile.isGeneric) return { matched: false, score: 0, reason: "" };

  const haystack = templateText(template);
  const familyKey = normalizeProjectFamilyKey(familyProfile.key);
  const familyLabel = safeTrim(familyProfile.label).toLowerCase();
  const keywords = Array.isArray(familyProfile.keywords) ? familyProfile.keywords : [];

  let score = 0;

  if (familyKey && haystack.includes(familyKey)) {
    score += 3;
  }
  if (familyLabel && haystack.includes(familyLabel)) {
    score += 3;
  }

  for (const keyword of keywords) {
    const needle = safeTrim(keyword).toLowerCase();
    if (needle && haystack.includes(needle)) {
      score += needle.includes(" ") ? 2 : 1;
    }
  }

  if (!score) {
    return { matched: false, score: 0, reason: "" };
  }

  return {
    matched: true,
    score,
    reason: `${familyProfile.label} family match.`,
  };
}

function classifyTemplateMatch(template, projectType, projectSubtype, projectFamilyContext = {}) {
  const tplType = safeTrim(template?.project_type);
  const tplSubtype = safeTrim(template?.project_subtype);
  const reqType = safeTrim(projectType);
  const reqSubtype = safeTrim(projectSubtype);
  const familyProfile = getProjectFamilyProfile(projectFamilyContext?.project_family_key || "");
  const familyMatch = scoreFamilyMatch(template, familyProfile);

  const typeMatch = !!reqType && sameText(tplType, reqType);
  const subtypeMatch = !!reqSubtype && sameText(tplSubtype, reqSubtype);

  if (reqSubtype) {
    if (typeMatch && subtypeMatch) {
      return {
        level: "strong",
        rank: 4 + familyMatch.score,
        reason: familyMatch.matched
          ? `Exact type + subtype match. ${familyMatch.reason}`
          : "Exact type + subtype match.",
      };
    }
    if (typeMatch) {
      return {
        level: familyMatch.matched ? "medium" : "medium",
        rank: 3 + familyMatch.score,
        reason: familyMatch.matched
          ? `Type matches, subtype differs. ${familyMatch.reason}`
          : "Type matches, subtype differs.",
      };
    }
    if (familyMatch.matched) {
      return {
        level: "medium",
        rank: 2 + familyMatch.score,
        reason: familyMatch.reason,
      };
    }
    return { level: "weak", rank: 1, reason: "Only loose similarity; category does not match." };
  }

  if (reqType) {
    if (typeMatch) {
      return {
        level: familyMatch.matched ? "medium" : "medium",
        rank: 3 + familyMatch.score,
        reason: familyMatch.matched ? `Type matches. ${familyMatch.reason}` : "Type matches.",
      };
    }
    if (familyMatch.matched) {
      return {
        level: "medium",
        rank: 2 + familyMatch.score,
        reason: familyMatch.reason,
      };
    }
    return { level: "weak", rank: 1, reason: "Only loose similarity; type does not match." };
  }

  if (familyMatch.matched) {
    return {
      level: "medium",
      rank: 2 + familyMatch.score,
      reason: familyMatch.reason,
    };
  }

  return { level: "weak", rank: 1, reason: "No project type/subtype context yet." };
}

function attachMatchMeta(templates, projectType, projectSubtype, projectFamilyContext = {}) {
  const list = Array.isArray(templates) ? templates : [];
  return list.map((tpl) => {
    const match = classifyTemplateMatch(tpl, projectType, projectSubtype, projectFamilyContext);
    return {
      ...tpl,
      _matchLevel: match.level,
      _matchRank: match.rank,
      _matchReason: match.reason,
    };
  });
}

function filterTemplatesForVisibleList(templates, projectType, projectSubtype, search, projectFamilyContext = {}) {
  const list = Array.isArray(templates) ? templates : [];
  const q = canonicalizeHvacText(search);
  const typeVal = canonicalizeHvacText(projectType);
  const subtypeVal = canonicalizeHvacText(projectSubtype);
  const familyProfile = getProjectFamilyProfile(projectFamilyContext?.project_family_key || "");
  const familyMatch = familyProfile.isGeneric ? [] : list.filter((tpl) => scoreFamilyMatch(tpl, familyProfile).matched);

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

  if (familyMatch.length) {
    const familyIds = new Set(familyMatch.map((tpl) => String(tpl?.id)));
    const familyNarrowed = narrowed.filter((tpl) => familyIds.has(String(tpl?.id)));
    if (familyNarrowed.length) {
      narrowed = familyNarrowed;
    }
  }

  if (!q) return narrowed;

  return narrowed.filter((tpl) => {
    return templateText(tpl).includes(q);
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
  const hasValidSpreadTotal = parsedSpreadTotal != null && parsedSpreadTotal > 0;

  return {
    estimated_days,
    auto_schedule: !!options?.auto_schedule,
    spread_enabled: !!options?.spread_enabled && hasValidSpreadTotal,
    spread_total: hasValidSpreadTotal ? parsedSpreadTotal : null,
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
    normalizeStep1FieldValue(
      agreement?.project_title ||
        agreement?.title ||
        currentTitle ||
        template?.name ||
        ""
    );

  const nextDescription =
    normalizeStep1FieldValue(
      agreement?.description ??
        (safeTrim(template?.description) ? template.description : currentDescription)
    );

  return {
    agreement,
    patch: {
      project_title: nextTitle || "",
      project_type: normalizeStep1FieldValue(agreement?.project_type ?? ""),
      project_subtype: normalizeStep1FieldValue(agreement?.project_subtype ?? ""),
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
  projectFamilyContext = {},
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
  const debugTemplateMatch =
    typeof import.meta !== "undefined" &&
    !!import.meta?.env &&
    (import.meta.env.DEV || import.meta.env.MODE === "test");
  const resolvedProjectFamily = useMemo(
    () => {
      const base = getProjectFamilyProfile(projectFamilyContext?.project_family_key || "");
      const label = safeTrim(projectFamilyContext?.project_family_label || projectFamilyContext?.label || "");
      const derivedKey = label
        ? normalizeProjectFamilyKey(
            label
              .toLowerCase()
              .replace(/&/g, " and ")
              .replace(/[()/,:.-]/g, " ")
              .replace(/\s+/g, "_")
          )
        : "";

      return {
        ...base,
        ...projectFamilyContext,
        project_family_key: normalizeProjectFamilyKey(
          projectFamilyContext?.project_family_key || projectFamilyContext?.key || derivedKey
        ),
        project_family_label: label || safeTrim(base.label),
      };
    },
    [projectFamilyContext]
  );

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
      currentProjectSubtype,
      resolvedProjectFamily
    );

    return sortTemplates(withMeta).sort((a, b) => {
      const rankDiff = (b?._matchRank || 0) - (a?._matchRank || 0);
      if (rankDiff !== 0) return rankDiff;
      return 0;
    });
  }, [
    templates,
    recommendedCandidates,
    currentProjectType,
    currentProjectSubtype,
    resolvedProjectFamily,
  ]);

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
      templateSearch,
      resolvedProjectFamily
    );
  }, [mergedTemplates, currentProjectType, currentProjectSubtype, templateSearch, resolvedProjectFamily]);

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
      if (resolvedProjectFamily.project_family_key) {
        params.project_family_key = resolvedProjectFamily.project_family_key;
      }
      if (resolvedProjectFamily.project_family_label) {
        params.project_family_label = resolvedProjectFamily.project_family_label;
      }

      if (currentProjectSubtype) {
        params.project_subtype = currentProjectSubtype;
      } else if (currentProjectType) {
        params.project_type = currentProjectType;
      }

      const searchQuery = safeTrim(templateSearch) || currentTitle || currentDescription;
      if (searchQuery) {
        params.q = searchQuery;
      }

      const { data } = await api.get("/projects/templates/", { params });
      const rows = sortTemplates(normalizeList(data));

      setTemplates(rows);

      if (debugTemplateMatch) {
        console.debug("[Step1 templates] loaded", {
          count: rows.length,
          query: searchQuery || "",
          projectType: currentProjectType,
          projectSubtype: currentProjectSubtype,
        });
      }

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
  }, [
    locked,
    currentProjectType,
    currentProjectSubtype,
    currentTitle,
    currentDescription,
    templateSearch,
    resetRecommendationState,
    resolvedProjectFamily.project_family_key,
    resolvedProjectFamily.project_family_label,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (locked) return;

      setTemplatesLoading(true);
      setTemplatesErr("");

      try {
        const params = { _ts: Date.now() };
        if (resolvedProjectFamily.project_family_key) {
          params.project_family_key = resolvedProjectFamily.project_family_key;
        }
        if (resolvedProjectFamily.project_family_label) {
          params.project_family_label = resolvedProjectFamily.project_family_label;
        }

        if (currentProjectSubtype) {
          params.project_subtype = currentProjectSubtype;
        } else if (currentProjectType) {
          params.project_type = currentProjectType;
        }

        const searchQuery = safeTrim(templateSearch) || currentTitle || currentDescription;
        if (searchQuery) {
          params.q = searchQuery;
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
    currentTitle,
    currentDescription,
    templateSearch,
    resetRecommendationState,
    resolvedProjectFamily.project_family_key,
    resolvedProjectFamily.project_family_label,
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
          project_family_key: resolvedProjectFamily.project_family_key || "",
          project_family_label: resolvedProjectFamily.project_family_label || "",
        });

        if (cancelled) return;

        const backendConfidence = normalizeRecommendationLevel(
          data?.confidence_level || data?.confidence || "low"
        );
        const backendRec =
          backendConfidence === "high"
            ? data?.recommended_template || null
            : backendConfidence === "medium"
            ? data?.possible_match || null
            : null;
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
          currentProjectSubtype,
          resolvedProjectFamily
        );

        setRecommendedCandidates(classifiedCandidates);

        const strongCandidates = classifiedCandidates.filter((t) => t?._matchLevel === "strong");
        const mediumCandidates = classifiedCandidates.filter((t) => t?._matchLevel === "medium");
        const backendChosen =
          backendRec?.id != null
            ? classifiedCandidates.find((t) => String(t?.id) === String(backendRec.id)) || null
            : null;
        const chosen =
          backendConfidence === "high"
            ? backendChosen || strongCandidates[0] || null
            : backendConfidence === "medium"
            ? backendChosen || mediumCandidates[0] || null
            : null;
        const chosenId = chosen?.id != null ? String(chosen.id) : null;

        if (chosenId) {
          setRecommendedTemplateId(chosenId);
          setTemplateRecommendationScore(backendScore);
          setRecommendationConfidence(backendConfidence);
          setNoTemplateMatch(false);
          setNoTemplateReason("");

          if (backendConfidence === "high") {
            setTemplateRecommendationReason(
              data?.reason
                ? data.reason
                : chosen?._matchReason || "Exact type and subtype match."
            );
          } else if (backendConfidence === "medium") {
            setTemplateRecommendationReason(
              data?.reason || chosen?._matchReason || "This template could fit, but review it before applying."
            );
          } else {
            setTemplateRecommendationReason("");
          }
        } else {
          setRecommendedTemplateId(null);
          setTemplateRecommendationScore(backendScore);
          setRecommendationConfidence("low");
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

        if (debugTemplateMatch) {
          console.debug("[Step1 templates] recommendation", {
            count: classifiedCandidates.length,
            selectedId: chosenId,
            selectedName: chosen?.name || "",
            score: backendScore,
            confidence: backendConfidence,
            reason: chosen?._matchReason || data?.reason || "",
          });
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
    resolvedProjectFamily.project_family_key,
    resolvedProjectFamily.project_family_label,
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

      toast.success("Template applied. Review the agreement details below.");
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
      if (resolvedProjectFamily.project_family_key) {
        params.project_family_key = resolvedProjectFamily.project_family_key;
      }
      if (resolvedProjectFamily.project_family_label) {
        params.project_family_label = resolvedProjectFamily.project_family_label;
      }
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
    recommendedCandidates,
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
