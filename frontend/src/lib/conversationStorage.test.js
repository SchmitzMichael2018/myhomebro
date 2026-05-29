import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  saveConversation,
  loadConversation,
  clearConversation,
  clearExpiredConversations,
  getStorageStats,
  saveDisputeConversation,
  loadDisputeConversation,
  appendDisputeMessage,
  markDisputeResolved,
  getDisputeConversations,
  _setMaxBytesForTesting,
} from "./conversationStorage.js";

// ── localStorage mock ─────────────────────────────────────────────────────────

const makeLocalStorageMock = () => {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
    _store: () => store,
  };
};

const lsMock = makeLocalStorageMock();
vi.stubGlobal("localStorage", lsMock);

beforeEach(() => {
  lsMock.clear();
  _setMaxBytesForTesting(500 * 1024); // reset to production limit
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return {
    phase: "service_area",
    collectedData: { businessName: "Acme Roofing", city: "Austin", state: "TX" },
    messages: [
      { role: "ai", text: "What is your business name?" },
      { role: "user", text: "Acme Roofing" },
    ],
    ...overrides,
  };
}

function pastDate(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

// ── saveConversation + loadConversation round-trip ───────────────────────────

describe("saveConversation + loadConversation", () => {
  it("round-trips onboarding state", () => {
    const state = makeState();
    saveConversation("onboarding", "user-1", state);
    const loaded = loadConversation("onboarding", "user-1");
    expect(loaded).not.toBeNull();
    expect(loaded.type).toBe("onboarding");
    expect(loaded.participantId).toBe("user-1");
    expect(loaded.phase).toBe("service_area");
    expect(loaded.collectedData.businessName).toBe("Acme Roofing");
    expect(loaded.messages).toHaveLength(2);
  });

  it("round-trips workspace_intake state", () => {
    const state = makeState({ phase: "job_details", collectedData: { jobDescription: "roof replacement" } });
    saveConversation("workspace_intake", "user-2", state);
    const loaded = loadConversation("workspace_intake", "user-2");
    expect(loaded).not.toBeNull();
    expect(loaded.type).toBe("workspace_intake");
    expect(loaded.collectedData.jobDescription).toBe("roof replacement");
  });

  it("stores savedAt and expiresAt as ISO strings", () => {
    saveConversation("onboarding", "user-1", makeState());
    const loaded = loadConversation("onboarding", "user-1");
    expect(typeof loaded.savedAt).toBe("string");
    expect(typeof loaded.expiresAt).toBe("string");
    expect(new Date(loaded.savedAt).getTime()).toBeGreaterThan(0);
    expect(new Date(loaded.expiresAt).getTime()).toBeGreaterThan(new Date(loaded.savedAt).getTime());
  });

  it("returns null for unknown participantId", () => {
    expect(loadConversation("onboarding", "nobody")).toBeNull();
  });

  it("returns null for missing or null participantId", () => {
    expect(loadConversation("onboarding", null)).toBeNull();
    expect(loadConversation("onboarding", undefined)).toBeNull();
  });

  it("ignores unknown conversation type", () => {
    saveConversation("unknown_type", "user-1", makeState());
    expect(loadConversation("unknown_type", "user-1")).toBeNull();
  });
});

// ── Expiry ────────────────────────────────────────────────────────────────────

describe("expiry", () => {
  it("expired conversation returns null", () => {
    saveConversation("onboarding", "user-1", makeState());
    // Overwrite with an already-expired record
    const key = "mhb:conversation:onboarding:user-1";
    const record = JSON.parse(lsMock.getItem(key));
    record.expiresAt = pastDate(1000); // expired 1 second ago
    lsMock.setItem(key, JSON.stringify(record));

    expect(loadConversation("onboarding", "user-1")).toBeNull();
  });

  it("loadConversation silently removes expired key on read", () => {
    saveConversation("onboarding", "user-1", makeState());
    const key = "mhb:conversation:onboarding:user-1";
    const record = JSON.parse(lsMock.getItem(key));
    record.expiresAt = pastDate(1000);
    lsMock.setItem(key, JSON.stringify(record));

    expect(lsMock.getItem(key)).not.toBeNull();
    loadConversation("onboarding", "user-1");
    expect(lsMock.getItem(key)).toBeNull();
  });

  it("non-expired conversation is returned normally", () => {
    saveConversation("workspace_intake", "user-3", makeState({ phase: "classify" }));
    const loaded = loadConversation("workspace_intake", "user-3");
    expect(loaded).not.toBeNull();
    expect(loaded.phase).toBe("classify");
  });
});

// ── clearExpiredConversations ─────────────────────────────────────────────────

describe("clearExpiredConversations", () => {
  it("removes expired non-dispute conversations", () => {
    saveConversation("onboarding", "user-1", makeState());
    const key = "mhb:conversation:onboarding:user-1";
    const record = JSON.parse(lsMock.getItem(key));
    record.expiresAt = pastDate(1000);
    lsMock.setItem(key, JSON.stringify(record));

    clearExpiredConversations();
    expect(lsMock.getItem(key)).toBeNull();
  });

  it("leaves non-expired keys intact", () => {
    saveConversation("onboarding", "user-2", makeState());
    const key = "mhb:conversation:onboarding:user-2";

    clearExpiredConversations();
    expect(lsMock.getItem(key)).not.toBeNull();
  });

  it("NEVER removes dispute keys even when they look expired", () => {
    // Write a dispute record with an expiresAt (which disputes shouldn't have, but just in case)
    const disputeKeyStr = "mhb:conversation:dispute:d-1:user-1";
    const record = {
      type: "dispute",
      disputeId: "d-1",
      participantId: "user-1",
      participantRole: "contractor",
      messages: [],
      savedAt: pastDate(2000),
      lastUpdatedAt: pastDate(2000),
      resolvedAt: null,
      retentionExpiresAt: null,
      expiresAt: pastDate(1000), // simulating a misplaced field — should still not be cleared
      version: 1,
    };
    lsMock.setItem(disputeKeyStr, JSON.stringify(record));

    clearExpiredConversations();
    expect(lsMock.getItem(disputeKeyStr)).not.toBeNull();
  });

  it("removes malformed non-dispute keys", () => {
    lsMock.setItem("mhb:conversation:onboarding:bad", "not-json{{");
    clearExpiredConversations();
    expect(lsMock.getItem("mhb:conversation:onboarding:bad")).toBeNull();
  });

  it("does not touch non-mhb keys", () => {
    lsMock.setItem("other:key", "value");
    clearExpiredConversations();
    expect(lsMock.getItem("other:key")).toBe("value");
  });
});

// ── clearConversation ─────────────────────────────────────────────────────────

describe("clearConversation", () => {
  it("removes the stored key", () => {
    saveConversation("onboarding", "user-1", makeState());
    clearConversation("onboarding", "user-1");
    expect(loadConversation("onboarding", "user-1")).toBeNull();
  });

  it("is a no-op when key does not exist", () => {
    expect(() => clearConversation("onboarding", "ghost")).not.toThrow();
  });
});

// ── Storage limit eviction ────────────────────────────────────────────────────

describe("storage limit eviction", () => {
  const SMALL_LIMIT = 2000; // bytes — tiny limit to make tests fast

  beforeEach(() => {
    _setMaxBytesForTesting(SMALL_LIMIT);
  });

  afterEach(() => {
    _setMaxBytesForTesting(500 * 1024);
  });

  it("evicts oldest non-dispute conversation when limit is exceeded", () => {
    // Save an old conversation (set savedAt to past so it's "oldest")
    saveConversation("onboarding", "old-user", makeState());
    const oldKey = "mhb:conversation:onboarding:old-user";
    const oldRec = JSON.parse(lsMock.getItem(oldKey));
    oldRec.savedAt = pastDate(10000);
    lsMock.setItem(oldKey, JSON.stringify(oldRec));

    // Save a new conversation for a different user that pushes us over the limit
    const bigState = makeState({
      messages: Array.from({ length: 100 }, (_, i) => ({
        role: "ai",
        text: `message ${i} `.repeat(20),
      })),
    });
    saveConversation("onboarding", "new-user", bigState);

    // old-user should be evicted; new-user should survive
    expect(lsMock.getItem(oldKey)).toBeNull();
    expect(loadConversation("onboarding", "new-user")).not.toBeNull();
  });

  it("evicts multiple old conversations if one is not enough", () => {
    for (let i = 0; i < 3; i++) {
      saveConversation("onboarding", `old-${i}`, makeState());
      const k = `mhb:conversation:onboarding:old-${i}`;
      const r = JSON.parse(lsMock.getItem(k));
      r.savedAt = new Date(Date.now() - (3 - i) * 10000).toISOString(); // oldest first
      lsMock.setItem(k, JSON.stringify(r));
    }

    const bigState = makeState({
      messages: Array.from({ length: 200 }, (_, i) => ({ role: "ai", text: `msg ${i} `.repeat(20) })),
    });
    saveConversation("workspace_intake", "new-user", bigState);

    // At least the oldest old-0 should be evicted
    expect(lsMock.getItem("mhb:conversation:onboarding:old-0")).toBeNull();
  });

  it("dispute conversations survive storage limit eviction", () => {
    appendDisputeMessage("d-1", "user-1", "contractor", {
      id: "m1",
      role: "contractor",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });

    const disputeKey = "mhb:conversation:dispute:d-1:user-1";
    expect(lsMock.getItem(disputeKey)).not.toBeNull();

    // Push over limit with non-dispute data
    const bigState = makeState({
      messages: Array.from({ length: 200 }, (_, i) => ({ role: "ai", text: `msg ${i} `.repeat(20) })),
    });
    saveConversation("onboarding", "some-user", bigState);

    // Dispute must still be there
    expect(lsMock.getItem(disputeKey)).not.toBeNull();
  });
});

// ── getStorageStats ───────────────────────────────────────────────────────────

describe("getStorageStats", () => {
  it("returns zero counts for empty storage", () => {
    const stats = getStorageStats();
    expect(stats.count).toBe(0);
    expect(stats.totalSizeBytes).toBe(0);
    expect(stats.oldestSavedAt).toBeNull();
  });

  it("counts all mhb:conversation:* keys", () => {
    saveConversation("onboarding", "u1", makeState());
    saveConversation("workspace_intake", "u2", makeState());
    const stats = getStorageStats();
    expect(stats.count).toBe(2);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
    expect(typeof stats.oldestSavedAt).toBe("string");
  });
});

// ── Dispute conversations ─────────────────────────────────────────────────────

describe("saveDisputeConversation + loadDisputeConversation", () => {
  it("round-trips a dispute record", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", {
      messages: [{ id: "m1", role: "contractor", content: "My roof was damaged", timestamp: "2026-01-01T00:00:00Z" }],
    });
    const loaded = loadDisputeConversation("d-1", "user-1");
    expect(loaded).not.toBeNull();
    expect(loaded.type).toBe("dispute");
    expect(loaded.disputeId).toBe("d-1");
    expect(loaded.participantId).toBe("user-1");
    expect(loaded.participantRole).toBe("contractor");
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.version).toBe(1);
  });

  it("increments version on each save", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });
    const loaded = loadDisputeConversation("d-1", "user-1");
    expect(loaded.version).toBe(3);
  });

  it("returns null for unknown dispute", () => {
    expect(loadDisputeConversation("ghost", "user-1")).toBeNull();
  });

  it("returns null for null inputs", () => {
    expect(loadDisputeConversation(null, "user-1")).toBeNull();
    expect(loadDisputeConversation("d-1", null)).toBeNull();
  });

  it("disputes survive clearExpiredConversations", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });

    // Also save an expired non-dispute
    saveConversation("onboarding", "user-1", makeState());
    const key = "mhb:conversation:onboarding:user-1";
    const rec = JSON.parse(lsMock.getItem(key));
    rec.expiresAt = pastDate(1000);
    lsMock.setItem(key, JSON.stringify(rec));

    clearExpiredConversations();

    expect(loadDisputeConversation("d-1", "user-1")).not.toBeNull();
    expect(loadConversation("onboarding", "user-1")).toBeNull();
  });

  it("never expires — loadDisputeConversation always returns the record regardless of time", () => {
    saveDisputeConversation("d-2", "user-2", "homeowner", { messages: [] });
    // Dispute has no expiresAt — it must never be treated as expired
    const loaded = loadDisputeConversation("d-2", "user-2");
    expect(loaded).not.toBeNull();
    expect(loaded.retentionExpiresAt).toBeNull(); // null until resolved
  });
});

// ── appendDisputeMessage ──────────────────────────────────────────────────────

describe("appendDisputeMessage", () => {
  const msg1 = { id: "m1", role: "contractor", content: "First message", timestamp: "2026-01-01T00:00:00Z" };
  const msg2 = { id: "m2", role: "homeowner", content: "Reply", timestamp: "2026-01-01T01:00:00Z" };

  it("creates a new dispute record if none exists", () => {
    appendDisputeMessage("d-new", "user-1", "contractor", msg1);
    const loaded = loadDisputeConversation("d-new", "user-1");
    expect(loaded).not.toBeNull();
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].content).toBe("First message");
    expect(loaded.version).toBe(1);
  });

  it("appends to an existing dispute and increments version", () => {
    appendDisputeMessage("d-1", "user-1", "contractor", msg1);
    appendDisputeMessage("d-1", "user-1", "contractor", msg2);
    const loaded = loadDisputeConversation("d-1", "user-1");
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[1].content).toBe("Reply");
    expect(loaded.version).toBe(2);
  });

  it("does not lose previous messages on append", () => {
    appendDisputeMessage("d-1", "user-1", "contractor", msg1);
    appendDisputeMessage("d-1", "user-1", "contractor", msg2);
    const loaded = loadDisputeConversation("d-1", "user-1");
    expect(loaded.messages[0].id).toBe("m1");
    expect(loaded.messages[1].id).toBe("m2");
  });
});

// ── markDisputeResolved ───────────────────────────────────────────────────────

describe("markDisputeResolved", () => {
  it("sets resolvedAt and retentionExpiresAt 7 years later", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });
    markDisputeResolved("d-1", "user-1");
    const loaded = loadDisputeConversation("d-1", "user-1");
    expect(loaded.resolvedAt).not.toBeNull();
    expect(loaded.retentionExpiresAt).not.toBeNull();
    const resolvedYear = new Date(loaded.resolvedAt).getFullYear();
    const retentionYear = new Date(loaded.retentionExpiresAt).getFullYear();
    expect(retentionYear).toBe(resolvedYear + 7);
  });

  it("increments version when resolved", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });
    const before = loadDisputeConversation("d-1", "user-1").version;
    markDisputeResolved("d-1", "user-1");
    const after = loadDisputeConversation("d-1", "user-1").version;
    expect(after).toBe(before + 1);
  });

  it("never clears messages when resolving", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", {
      messages: [{ id: "m1", role: "contractor", content: "Hello", timestamp: "2026-01-01T00:00:00Z" }],
    });
    markDisputeResolved("d-1", "user-1");
    const loaded = loadDisputeConversation("d-1", "user-1");
    expect(loaded.messages).toHaveLength(1);
  });

  it("is a no-op when dispute does not exist", () => {
    expect(() => markDisputeResolved("ghost", "user-1")).not.toThrow();
  });

  it("unresolved disputes have null retentionExpiresAt", () => {
    saveDisputeConversation("d-unresolved", "user-1", "contractor", { messages: [] });
    const loaded = loadDisputeConversation("d-unresolved", "user-1");
    expect(loaded.resolvedAt).toBeNull();
    expect(loaded.retentionExpiresAt).toBeNull();
  });
});

// ── getDisputeConversations ───────────────────────────────────────────────────

describe("getDisputeConversations", () => {
  it("returns all disputes for a participant sorted by lastUpdatedAt descending", () => {
    const now = Date.now();
    saveDisputeConversation("d-old", "user-1", "contractor", { messages: [] });
    const kOld = "mhb:conversation:dispute:d-old:user-1";
    const rOld = JSON.parse(lsMock.getItem(kOld));
    rOld.lastUpdatedAt = new Date(now - 10000).toISOString();
    lsMock.setItem(kOld, JSON.stringify(rOld));

    saveDisputeConversation("d-new", "user-1", "contractor", { messages: [] });

    const results = getDisputeConversations("user-1");
    expect(results).toHaveLength(2);
    expect(results[0].disputeId).toBe("d-new"); // most recent first
    expect(results[1].disputeId).toBe("d-old");
  });

  it("does not return disputes belonging to other participants", () => {
    saveDisputeConversation("d-1", "user-1", "contractor", { messages: [] });
    saveDisputeConversation("d-2", "user-2", "homeowner", { messages: [] });

    const results = getDisputeConversations("user-1");
    expect(results).toHaveLength(1);
    expect(results[0].participantId).toBe("user-1");
  });

  it("returns empty array when no disputes exist", () => {
    expect(getDisputeConversations("nobody")).toEqual([]);
  });

  it("returns empty array for null participantId", () => {
    expect(getDisputeConversations(null)).toEqual([]);
  });
});

// ── Malformed data ────────────────────────────────────────────────────────────

describe("malformed localStorage values", () => {
  it("loadConversation returns null for corrupted JSON", () => {
    lsMock.setItem("mhb:conversation:onboarding:user-x", "not{json");
    expect(loadConversation("onboarding", "user-x")).toBeNull();
  });

  it("loadConversation returns null for null-ish stored objects", () => {
    lsMock.setItem("mhb:conversation:onboarding:user-x", "null");
    expect(loadConversation("onboarding", "user-x")).toBeNull();
  });

  it("loadDisputeConversation returns null for wrong type field", () => {
    lsMock.setItem(
      "mhb:conversation:dispute:d-x:user-1",
      JSON.stringify({ type: "onboarding", disputeId: "d-x", participantId: "user-1" })
    );
    expect(loadDisputeConversation("d-x", "user-1")).toBeNull();
  });

  it("loadDisputeConversation returns null for corrupted JSON", () => {
    lsMock.setItem("mhb:conversation:dispute:d-x:user-1", "{{bad");
    expect(loadDisputeConversation("d-x", "user-1")).toBeNull();
  });

  it("clearExpiredConversations does not throw on malformed non-dispute keys", () => {
    lsMock.setItem("mhb:conversation:onboarding:bad", "{{not json");
    expect(() => clearExpiredConversations()).not.toThrow();
    expect(lsMock.getItem("mhb:conversation:onboarding:bad")).toBeNull();
  });
});
