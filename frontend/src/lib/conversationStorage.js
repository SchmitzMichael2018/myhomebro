// src/lib/conversationStorage.js
// Pure functions — no React, no app imports, no module-level side effects.
//
// Key pattern:
//   mhb:conversation:{type}:{participantId}            — onboarding, workspace_intake
//   mhb:conversation:dispute:{disputeId}:{participantId} — disputes (permanent)
//
// TTL: onboarding=30d, workspace_intake=24h, dispute=PERMANENT

const KEY_PREFIX = "mhb:conversation:";
const DISPUTE_SEGMENT = ":dispute:";

let MAX_NON_DISPUTE_BYTES = 500 * 1024; // 500 KB across all non-dispute keys

// Exposed only for tests — do not call in production code.
export function _setMaxBytesForTesting(n) {
  MAX_NON_DISPUTE_BYTES = n;
}

const TTL_MS = {
  onboarding: 30 * 24 * 60 * 60 * 1000,
  workspace_intake: 24 * 60 * 60 * 1000,
};

// ── Key builders ──────────────────────────────────────────────────────────────

function conversationKey(type, participantId) {
  return `${KEY_PREFIX}${type}:${participantId}`;
}

function disputeKey(disputeId, participantId) {
  return `${KEY_PREFIX}dispute:${disputeId}:${participantId}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function byteSize(str) {
  return str.length * 2; // UTF-16 approximation
}

function isDisputeKey(key) {
  return key.includes(DISPUTE_SEGMENT);
}

function allConversationKeys() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

// ── Eviction ──────────────────────────────────────────────────────────────────

function evictIfNeeded(keyBeingWritten, incomingBytes) {
  const nonDisputeKeys = allConversationKeys().filter(
    (k) => !isDisputeKey(k) && k !== keyBeingWritten
  );

  let totalBytes = incomingBytes;
  const entries = [];

  for (const k of nonDisputeKeys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      totalBytes += byteSize(raw);
      let savedAt = "";
      try {
        savedAt = JSON.parse(raw)?.savedAt || "";
      } catch {}
      entries.push({ key: k, savedAt, size: byteSize(raw) });
    } catch {
      entries.push({ key: k, savedAt: "", size: 0 });
    }
  }

  if (totalBytes <= MAX_NON_DISPUTE_BYTES) return;

  entries.sort((a, b) => (a.savedAt < b.savedAt ? -1 : 1)); // oldest first

  for (const entry of entries) {
    if (totalBytes <= MAX_NON_DISPUTE_BYTES) break;
    try {
      localStorage.removeItem(entry.key);
      totalBytes -= entry.size;
    } catch {}
  }
}

// ── onboarding / workspace_intake ─────────────────────────────────────────────

export function saveConversation(type, participantId, state) {
  if (!participantId || !TTL_MS[type]) return;

  const now = Date.now();
  const record = {
    type,
    participantId,
    phase: state.phase,
    collectedData: state.collectedData ?? {},
    messages: state.messages ?? [],
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS[type]).toISOString(),
  };
  const serialized = JSON.stringify(record);
  const key = conversationKey(type, participantId);

  evictIfNeeded(key, byteSize(serialized));

  try {
    localStorage.setItem(key, serialized);
  } catch {
    // Storage full even after eviction — silently skip
  }
}

export function loadConversation(type, participantId) {
  if (!participantId) return null;
  const key = conversationKey(type, participantId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || typeof record !== "object") {
      localStorage.removeItem(key);
      return null;
    }
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return record;
  } catch {
    try { localStorage.removeItem(key); } catch {}
    return null;
  }
}

export function clearConversation(type, participantId) {
  if (!participantId) return;
  try {
    localStorage.removeItem(conversationKey(type, participantId));
  } catch {}
}

export function clearExpiredConversations() {
  const now = Date.now();
  for (const key of allConversationKeys()) {
    if (isDisputeKey(key)) continue; // NEVER touch dispute keys
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (record?.expiresAt && new Date(record.expiresAt).getTime() < now) {
        localStorage.removeItem(key);
      }
    } catch {
      try { localStorage.removeItem(key); } catch {}
    }
  }
}

export function getStorageStats() {
  const keys = allConversationKeys();
  let totalSizeBytes = 0;
  let oldestSavedAt = null;

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      totalSizeBytes += byteSize(raw);
      const record = JSON.parse(raw);
      if (record?.savedAt) {
        if (!oldestSavedAt || record.savedAt < oldestSavedAt) {
          oldestSavedAt = record.savedAt;
        }
      }
    } catch {}
  }

  return { count: keys.length, oldestSavedAt, totalSizeBytes };
}

// ── Dispute conversations ──────────────────────────────────────────────────────

export function saveDisputeConversation(disputeId, participantId, role, state) {
  if (!disputeId || !participantId) return;
  const key = disputeKey(disputeId, participantId);
  const now = new Date().toISOString();

  let existing = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) existing = JSON.parse(raw);
  } catch {}

  const currentVersion = typeof existing?.version === "number" ? existing.version : 0;

  const record = {
    type: "dispute",
    disputeId,
    participantId,
    participantRole: role,
    messages: state.messages ?? existing?.messages ?? [],
    savedAt: existing?.savedAt ?? now,
    lastUpdatedAt: now,
    resolvedAt: state.resolvedAt ?? existing?.resolvedAt ?? null,
    retentionExpiresAt: state.retentionExpiresAt ?? existing?.retentionExpiresAt ?? null,
    version: currentVersion + 1,
  };

  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {}
}

export function loadDisputeConversation(disputeId, participantId) {
  if (!disputeId || !participantId) return null;
  try {
    const raw = localStorage.getItem(disputeKey(disputeId, participantId));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || typeof record !== "object" || record.type !== "dispute") return null;
    return record;
  } catch {
    return null;
  }
}

export function appendDisputeMessage(disputeId, participantId, role, message) {
  if (!disputeId || !participantId) return;
  const now = new Date().toISOString();

  const existing = loadDisputeConversation(disputeId, participantId) ?? {
    type: "dispute",
    disputeId,
    participantId,
    participantRole: role,
    messages: [],
    savedAt: now,
    lastUpdatedAt: now,
    resolvedAt: null,
    retentionExpiresAt: null,
    version: 0,
  };

  const updated = {
    ...existing,
    messages: [...existing.messages, message],
    lastUpdatedAt: now,
    version: existing.version + 1,
  };

  try {
    localStorage.setItem(disputeKey(disputeId, participantId), JSON.stringify(updated));
  } catch {}
}

export function markDisputeResolved(disputeId, participantId) {
  if (!disputeId || !participantId) return;
  const existing = loadDisputeConversation(disputeId, participantId);
  if (!existing) return;

  const resolvedAt = new Date().toISOString();
  const retentionDate = new Date(resolvedAt);
  retentionDate.setFullYear(retentionDate.getFullYear() + 7);

  const updated = {
    ...existing,
    resolvedAt,
    retentionExpiresAt: retentionDate.toISOString(),
    lastUpdatedAt: resolvedAt,
    version: existing.version + 1,
  };

  try {
    localStorage.setItem(disputeKey(disputeId, participantId), JSON.stringify(updated));
  } catch {}
}

export function getDisputeConversations(participantId) {
  if (!participantId) return [];

  const results = [];
  for (const key of allConversationKeys()) {
    if (!isDisputeKey(key)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (
        record &&
        typeof record === "object" &&
        record.type === "dispute" &&
        String(record.participantId) === String(participantId)
      ) {
        results.push(record);
      }
    } catch {}
  }

  return results.sort((a, b) => {
    if (!a.lastUpdatedAt) return 1;
    if (!b.lastUpdatedAt) return -1;
    return a.lastUpdatedAt < b.lastUpdatedAt ? 1 : -1;
  });
}
