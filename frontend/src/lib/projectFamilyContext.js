import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api";

const STORAGE_KEY = "mhb_project_family_context";
const WORKSPACE_CONTEXT_PATH = "/projects/workspace-context/";

function safeText(value) {
  return value == null ? "" : String(value).trim();
}

function titleCaseWords(value) {
  return safeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatProjectFamilyLabel(projectFamilyKey = "") {
  const key = safeText(projectFamilyKey);
  if (!key) return "";
  return titleCaseWords(key.replaceAll("_", " "));
}

export function normalizeProjectFamilyContext(value = {}) {
  const next = value && typeof value === "object" ? value : {};
  const projectFamilyKey = safeText(
    next.project_family_key || next.projectFamilyKey || next.key
  );
  const projectFamilyLabel = safeText(
    next.project_family_label || next.projectFamilyLabel || next.label
  ) || formatProjectFamilyLabel(projectFamilyKey);

  return {
    project_family_key: projectFamilyKey,
    project_family_label: projectFamilyLabel,
  };
}

export function normalizeWorkspaceProjectFamilyContext(value = {}) {
  const next = value && typeof value === "object" ? value : {};
  const projectFamilySource =
    next.project_family && typeof next.project_family === "object"
      ? next.project_family
      : {
          ...next,
          project_family_key: next.default_project_family_key || next.project_family_key || next.key,
          project_family_label:
            next.default_project_family_label || next.project_family_label || next.label,
        };
  const normalizedFamily = normalizeProjectFamilyContext(projectFamilySource);

  return {
    project_family: normalizedFamily,
    source: safeText(next.source) || "server",
    updated_at: safeText(
      next.updated_at ||
        next.context_updated_at ||
        next.default_project_family_updated_at ||
        ""
    ),
  };
}

export function readStoredProjectFamilyContext() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return normalizeProjectFamilyContext();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeProjectFamilyContext();
    return normalizeProjectFamilyContext(JSON.parse(raw));
  } catch {
    return normalizeProjectFamilyContext();
  }
}

export function writeStoredProjectFamilyContext(value = {}) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const normalized = normalizeProjectFamilyContext(value);
    if (!normalized.project_family_key) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage failures
  }
}

export function clearStoredProjectFamilyContext() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export async function fetchWorkspaceProjectFamilyContext() {
  const response = await api.get(WORKSPACE_CONTEXT_PATH, {
    params: { _ts: Date.now() },
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  return normalizeWorkspaceProjectFamilyContext(response?.data || {});
}

export async function saveWorkspaceProjectFamilyContext(value = {}) {
  const normalized = normalizeProjectFamilyContext(value);
  const response = await api.patch(WORKSPACE_CONTEXT_PATH, {
    project_family: normalized,
  });
  return normalizeWorkspaceProjectFamilyContext(response?.data || {});
}

export function useWorkspaceProjectFamilyContext() {
  const [projectFamilyContext, setProjectFamilyContextState] = useState(() =>
    readStoredProjectFamilyContext()
  );
  const [workspaceMeta, setWorkspaceMeta] = useState({
    source: "local",
    updated_at: "",
    syncing: true,
    error: "",
  });
  const currentContextRef = useRef(projectFamilyContext);
  const revisionRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyContext = useCallback((value = {}, meta = {}) => {
    const normalized = normalizeProjectFamilyContext(value);
    revisionRef.current += 1;
    currentContextRef.current = normalized;
    if (!mountedRef.current) return normalized;
    setProjectFamilyContextState(normalized);
    writeStoredProjectFamilyContext(normalized);
    setWorkspaceMeta((prev) => ({
      ...prev,
      source: meta.source || prev.source || "local",
      updated_at: meta.updated_at ?? prev.updated_at ?? "",
      syncing: Boolean(meta.syncing),
      error: meta.error || "",
    }));
    return normalized;
  }, []);

  const setProjectFamilyContext = useCallback(
    async (value = {}, options = {}) => {
      const normalized = applyContext(value, { source: "local", syncing: true, error: "" });
      if (options?.syncServer === false) {
        if (!mountedRef.current) return normalized;
        setWorkspaceMeta((prev) => ({
          ...prev,
          syncing: false,
        }));
        return normalized;
      }

      const saveRevision = ++saveRevisionRef.current;
      try {
        const serverContext = await saveWorkspaceProjectFamilyContext(normalized);
        if (saveRevision !== saveRevisionRef.current) return currentContextRef.current;
        const resolved = applyContext(serverContext.project_family, {
          source: serverContext.source || "server",
          updated_at: serverContext.updated_at || "",
          syncing: false,
          error: "",
        });
        return resolved;
      } catch (error) {
        if (saveRevision === saveRevisionRef.current && mountedRef.current) {
          setWorkspaceMeta((prev) => ({
            ...prev,
            source: "local",
            syncing: false,
            error: "",
          }));
        }
        return normalized;
      }
    },
    [applyContext]
  );

  useEffect(() => {
    let cancelled = false;
    const startingRevision = revisionRef.current;

    (async () => {
      try {
        const serverContext = await fetchWorkspaceProjectFamilyContext();
        if (cancelled || revisionRef.current !== startingRevision) return;

        const serverFamily = normalizeProjectFamilyContext(serverContext.project_family);
        if (serverFamily.project_family_key) {
          applyContext(serverFamily, {
            source: serverContext.source || "server",
            updated_at: serverContext.updated_at || "",
            syncing: false,
            error: "",
          });
          return;
        }

        const localFamily = currentContextRef.current;
        if (localFamily.project_family_key) {
          const syncedContext = await saveWorkspaceProjectFamilyContext(localFamily);
          if (cancelled || revisionRef.current !== startingRevision) return;
          applyContext(syncedContext.project_family, {
            source: syncedContext.source || "server",
            updated_at: syncedContext.updated_at || "",
            syncing: false,
            error: "",
          });
          return;
        }

        if (!mountedRef.current) return;
        setWorkspaceMeta((prev) => ({
          ...prev,
          source: serverContext.source || "server",
          updated_at: serverContext.updated_at || "",
          syncing: false,
          error: "",
        }));
      } catch {
        if (cancelled || revisionRef.current !== startingRevision) return;
        if (!mountedRef.current) return;
        setWorkspaceMeta((prev) => ({
          ...prev,
          source: "local",
          syncing: false,
          error: "",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyContext]);

  return {
    projectFamilyContext,
    setProjectFamilyContext,
    workspaceMeta,
    refreshWorkspaceContext: async () => {
      const serverContext = await fetchWorkspaceProjectFamilyContext();
      const serverFamily = normalizeProjectFamilyContext(serverContext.project_family);
      if (serverFamily.project_family_key) {
        applyContext(serverFamily, {
          source: serverContext.source || "server",
          updated_at: serverContext.updated_at || "",
          syncing: false,
          error: "",
        });
      }
      return serverContext;
    },
  };
}
