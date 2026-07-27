const DB_NAME = "myhomebro-pwa-drafts";
const DB_VERSION = 1;
const STORE = "drafts";
const SCHEMA_VERSION = "pwa-draft.v1";
const MAX_DRAFTS = 20;
const MAX_TEXT_LENGTH = 20000;
const MAX_VALUES_BYTES = 50000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function database(factory = globalThis.indexedDB) {
  if (!factory) return Promise.reject(new Error("indexeddb_unavailable"));
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("identity", ["userId", "contractorId"], { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("indexeddb_open_failed"));
  });
}

function requestResult(request, errorCode) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(errorCode));
  });
}

function run(db, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    try {
      result = callback(tx.objectStore(STORE));
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = async () => resolve(await result);
    tx.onerror = () => reject(new Error("indexeddb_transaction_failed"));
    tx.onabort = () => reject(new Error("indexeddb_transaction_aborted"));
  });
}

export function draftIdentity(identity = {}) {
  const userId = String(identity.user_id || identity.id || "");
  const contractorId = String(
    identity.contractor_id
    || identity.parent_contractor_id
    || identity.contractor?.id
    || (String(identity.type || "").startsWith("contractor") ? identity.id : "")
    || ""
  );
  return userId && contractorId ? { userId, contractorId } : null;
}

export function validateDraftInput(input) {
  if (!input?.identity?.userId || !input?.identity?.contractorId) {
    throw new Error("draft_identity_required");
  }
  const sourceText = String(input.sourceText || "");
  if (sourceText.length > MAX_TEXT_LENGTH) throw new Error("draft_text_too_large");
  const values = input.values || {};
  if (JSON.stringify(values).length > MAX_VALUES_BYTES) throw new Error("draft_values_too_large");
  return { sourceText, values };
}

export async function savePwaDraft(input, factory) {
  const { sourceText, values } = validateDraftInput(input);
  const now = new Date();
  const record = {
    id: `${input.identity.userId}:${input.identity.contractorId}:${input.draftType}:${input.contextKey}`,
    schemaVersion: SCHEMA_VERSION,
    draftType: input.draftType,
    userId: String(input.identity.userId),
    contractorId: String(input.identity.contractorId),
    contextKey: String(input.contextKey || "global").slice(0, 200),
    sourceText,
    values,
    artifactReferences: (input.artifactReferences || []).slice(0, 10).map((row, index) => ({
      label: `Pending file ${index + 1}`,
      size: Number(row.size || 0),
      type: String(row.type || "").slice(0, 120),
      requiresReselection: true,
    })),
    syncState: "local_draft",
    conflictState: "none",
    createdAt: input.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(),
  };
  const db = await database(factory);
  try {
    await run(db, "readwrite", (store) => requestResult(store.put(record), "indexeddb_write_failed"));
    const all = await run(db, "readonly", (store) => requestResult(store.getAll(), "indexeddb_read_failed"));
    const excess = (all || [])
      .filter((row) => row.userId === record.userId && row.contractorId === record.contractorId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(MAX_DRAFTS);
    for (const row of excess) {
      await run(db, "readwrite", (store) => requestResult(store.delete(row.id), "indexeddb_delete_failed"));
    }
    return record;
  } finally {
    db.close();
  }
}

export async function loadPwaDraft({ identity, draftType, contextKey }, factory) {
  if (!identity?.userId || !identity?.contractorId) return null;
  const id = `${identity.userId}:${identity.contractorId}:${draftType}:${contextKey}`;
  const db = await database(factory);
  try {
    const record = await run(db, "readonly", (store) => requestResult(store.get(id), "indexeddb_read_failed"));
    if (!record) return null;
    if (record.schemaVersion !== SCHEMA_VERSION || Date.parse(record.expiresAt) <= Date.now()) {
      await run(db, "readwrite", (store) => requestResult(store.delete(id), "indexeddb_delete_failed"));
      return null;
    }
    return record;
  } finally {
    db.close();
  }
}

export async function deletePwaDraft({ identity, draftType, contextKey }, factory) {
  if (!identity?.userId || !identity?.contractorId) return;
  const id = `${identity.userId}:${identity.contractorId}:${draftType}:${contextKey}`;
  const db = await database(factory);
  try {
    await run(db, "readwrite", (store) => requestResult(store.delete(id), "indexeddb_delete_failed"));
  } finally {
    db.close();
  }
}

export async function clearPwaDrafts(factory) {
  const db = await database(factory);
  try {
    await run(db, "readwrite", (store) => requestResult(store.clear(), "indexeddb_clear_failed"));
  } finally {
    db.close();
  }
}

export const PWA_DRAFT_LIMITS = {
  schemaVersion: SCHEMA_VERSION,
  maxDrafts: MAX_DRAFTS,
  maxTextLength: MAX_TEXT_LENGTH,
  maxValuesBytes: MAX_VALUES_BYTES,
  retentionMs: RETENTION_MS,
};
