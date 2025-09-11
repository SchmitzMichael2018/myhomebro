// src/context/MilestonesDraftContext.jsx
'use client';

import React, { createContext, useContext, useMemo, useCallback } from "react";
import usePersistentState from "@/hooks/usePersistentState";

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const normalize = (m = {}) => ({
  id: m.id ?? newId(),
  title: m.title ?? "",
  due_date: m.due_date ?? null,        // keep dates null until set
  amount: Number.isFinite(+m.amount) ? +m.amount : 0,
  description: m.description ?? "",
});

const withIds = (arr) => (arr || []).map((m) => normalize(m));

const DEFAULT = {
  milestones: [],
  lastSavedAt: null,
};

const Ctx = createContext(null);

/**
 * Provider for milestone drafts.
 * - agreementKey: unique key per agreement (e.g., agreement ID or "new")
 * - initialMilestones: hydrate from server when no local draft exists yet
 */
export function MilestonesDraftProvider({
  agreementKey = "new",
  initialMilestones = [],
  children,
}) {
  const storageKey = `milestonesDraft:${agreementKey}`;

  const [draft, setDraft, clearDraft] = usePersistentState(storageKey, {
    ...DEFAULT,
    milestones: withIds(initialMilestones),
  });

  // One-time hydrate/replace from server (or whenever you call it)
  const hydrateFromServer = useCallback(
    (serverMilestones = []) => {
      setDraft({
        milestones: withIds(serverMilestones),
        lastSavedAt: new Date().toISOString(),
      });
    },
    [setDraft]
  );

  const saveDraft = useCallback(
    (partial = {}) => {
      let next;
      setDraft((prev) => {
        next = {
          ...prev,
          ...partial,
          // if incoming includes milestones, normalize them
          ...(partial.milestones
            ? { milestones: withIds(partial.milestones) }
            : {}),
          lastSavedAt: new Date().toISOString(),
        };
        return next;
      });
      return next;
    },
    [setDraft]
  );

  const addMilestone = useCallback(() => {
    const id = newId();
    setDraft((d) => ({
      ...d,
      milestones: [...d.milestones, normalize({ id })],
      lastSavedAt: new Date().toISOString(),
    }));
    return id;
  }, [setDraft]);

  const updateMilestone = useCallback(
    (id, patch) => {
      setDraft((d) => ({
        ...d,
        milestones: d.milestones.map((m) =>
          m.id === id ? normalize({ ...m, ...patch, id }) : m
        ),
        lastSavedAt: new Date().toISOString(),
      }));
    },
    [setDraft]
  );

  const removeMilestone = useCallback(
    (id) => {
      setDraft((d) => ({
        ...d,
        milestones: d.milestones.filter((m) => m.id !== id),
        lastSavedAt: new Date().toISOString(),
      }));
    },
    [setDraft]
  );

  const getMilestone = useCallback(
    (id) => (draft.milestones || []).find((m) => m.id === id) || null,
    [draft.milestones]
  );

  const value = useMemo(
    () => ({
      draft,
      setDraft,
      clearDraft,
      saveDraft,
      hydrateFromServer,
      addMilestone,
      updateMilestone,
      removeMilestone,
      getMilestone,
    }),
    [
      draft,
      setDraft,
      clearDraft,
      saveDraft,
      hydrateFromServer,
      addMilestone,
      updateMilestone,
      removeMilestone,
      getMilestone,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMilestonesDraft() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useMilestonesDraft must be used within MilestonesDraftProvider"
    );
  return ctx;
}
