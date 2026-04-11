/**
 * Offline-aware API layer.
 *
 * - GET endpoints used during normal field work (projects list, project,
 *   blocks, trackers, piers, pier-statuses, plant-info) are network-first
 *   with a transparent fall-back to the IndexedDB cache.
 * - `updatePierStatus` writes optimistically to the local cache and queues
 *   a pending mutation. If we're online the mutation is flushed
 *   immediately, otherwise it sits in the queue until `syncPending()`
 *   fires (on window 'online' event or from the manual Sync button).
 * - Writes that require the server (create project, upload file, parse,
 *   update plant-info) throw an `OfflineError` when there is no network so
 *   the UI can show a friendly message.
 */
import {
  PendingMutation,
  applyPendingToStatuses,
  countPendingMutations,
  enqueueStatusMutation,
  listPendingMutations,
  loadProjectBundle,
  loadProjectsList,
  markPendingFailure,
  patchPierStatus,
  patchProjectBundle,
  removePendingMutation,
  saveProjectBundle,
  saveProjectsList,
} from "./offlineStore";

const API = (import.meta as any).env?.VITE_API_URL ?? "";

export class OfflineError extends Error {
  constructor(message = "This action requires an internet connection.") {
    super(message);
    this.name = "OfflineError";
  }
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

async function j<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/**
 * Try to fetch from the network; if that fails for any reason (offline,
 * DNS, 5xx, etc) fall back to the provided loader. If both fail, rethrow
 * the network error so the caller can surface it.
 */
async function networkFirst<T>(
  fetcher: () => Promise<T>,
  fallback: () => Promise<T | null>,
  onFetched?: (value: T) => Promise<void> | void,
): Promise<T> {
  if (isOnline()) {
    try {
      const value = await fetcher();
      try {
        await onFetched?.(value);
      } catch {
        // cache write failures are non-fatal
      }
      return value;
    } catch (e) {
      const cached = await fallback();
      if (cached != null) return cached;
      throw e;
    }
  }
  const cached = await fallback();
  if (cached != null) return cached;
  throw new OfflineError("No offline copy available for this request.");
}

/* ---------------- Projects list ---------------- */

export const getProjects = () =>
  networkFirst<any[]>(
    () => j<any[]>(`${API}/api/projects`),
    () => loadProjectsList(),
    async (items) => { await saveProjectsList(items); },
  );

/* ---------------- Per-project bundle ----------------
 *
 * We cache each project's blocks/trackers/piers/etc as a single bundle so
 * the Map and Grid views can reload instantly from cache offline.
 */

/**
 * In-flight bundle fetches are deduped by project id so that when the
 * App fires getProject / getBlocks / getTrackers / getPiers /
 * getPierStatuses in parallel we hit the server exactly once per project
 * instead of five times in a row.
 */
const inflightBundles = new Map<string, Promise<BundleShape>>();

interface BundleShape {
  project: any;
  blocks: any[];
  trackers: any[];
  piers: any[];
  pierStatuses: Record<string, string>;
  plantInfo: any;
  files: any[];
}

async function fetchAndCacheProjectBundle(id: string): Promise<BundleShape> {
  // Each sub-request has its own `.catch` so a single missing endpoint
  // (common on a freshly-created unparsed project) does not nuke the
  // entire bundle. Missing pieces fall back to sensible empty defaults.
  const [project, blocks, trackers, piers, pierStatuses, plantInfo, files] =
    await Promise.all([
      j<any>(`${API}/api/projects/${id}`).catch(() => null),
      j<any[]>(`${API}/api/projects/${id}/blocks`).catch(() => []),
      j<any[]>(`${API}/api/projects/${id}/trackers`).catch(() => []),
      j<any[]>(`${API}/api/projects/${id}/piers`).catch(() => []),
      j<Record<string, string>>(`${API}/api/projects/${id}/pier-statuses`).catch(() => ({})),
      j<any>(`${API}/api/projects/${id}/plant-info`).catch(() => ({})),
      j<any[]>(`${API}/api/projects/${id}/files`).catch(() => []),
    ]);
  const bundle: BundleShape = { project, blocks, trackers, piers, pierStatuses, plantInfo, files };
  await saveProjectBundle({
    project_id: id,
    ...bundle,
    fetchedAt: Date.now(),
  });
  return bundle;
}

async function ensureBundle(id: string): Promise<BundleShape> {
  if (isOnline()) {
    // Reuse any in-flight request for this project id.
    let pending = inflightBundles.get(id);
    if (!pending) {
      pending = fetchAndCacheProjectBundle(id).finally(() => {
        inflightBundles.delete(id);
      });
      inflightBundles.set(id, pending);
    }
    try {
      return await pending;
    } catch {
      // fall through to cached
    }
  }
  const cached = await loadProjectBundle(id);
  if (!cached) throw new OfflineError(`No offline copy of project ${id}.`);
  return cached;
}

export const getProject = async (id: string) => {
  const b = await ensureBundle(id);
  return b.project;
};
export const getBlocks = async (id: string) => {
  const b = await ensureBundle(id);
  return b.blocks;
};
export const getTrackers = async (id: string) => {
  const b = await ensureBundle(id);
  return b.trackers;
};
export const getPiers = async (id: string) => {
  const b = await ensureBundle(id);
  return b.piers;
};

/**
 * getPierStatuses merges server statuses with any locally-queued mutations
 * so the UI never loses in-flight edits.
 */
export const getPierStatuses = async (id: string) => {
  const b = await ensureBundle(id);
  return applyPendingToStatuses(id, b.pierStatuses || {});
};

export const getPier = async (pid: string, pier: string) => {
  // Individual-pier endpoint: try network when online, otherwise
  // reconstruct from the cached piers/blocks/trackers.
  if (isOnline()) {
    try {
      return await j<any>(`${API}/api/projects/${pid}/pier/${pier}`);
    } catch {
      // fall through to cached lookup
    }
  }
  const bundle = await loadProjectBundle(pid);
  if (!bundle) throw new OfflineError(`No offline copy of project ${pid}.`);
  const match = bundle.piers.find((p: any) => p.pier_code === pier);
  if (!match) throw new OfflineError(`Pier ${pier} not found in cached project.`);
  // Shape the object the way the backend returns it so PierModal keeps working.
  return { pier: match };
};

export const getZoomTarget = (pid: string, pier: string) =>
  j<any>(`${API}/api/projects/${pid}/pier/${pier}/zoom-target`);

/* ---------------- Aggregations (online only) ---------------- */

export const getPierTypeCounts = (pid: string) =>
  j<any[]>(`${API}/api/projects/${pid}/pier-type-counts`);
export const getBlockSummary = (pid: string) =>
  j<any[]>(`${API}/api/projects/${pid}/block-summary`);
export const getRowSummary = (pid: string) =>
  j<any[]>(`${API}/api/projects/${pid}/row-summary`);

/* ---------------- Plant info ---------------- */

export const getPlantInfo = async (pid: string) => {
  if (isOnline()) {
    try {
      const v = await j<any>(`${API}/api/projects/${pid}/plant-info`);
      await patchProjectBundle(pid, { plantInfo: v });
      return v;
    } catch {
      // fall through
    }
  }
  const bundle = await loadProjectBundle(pid);
  if (!bundle) throw new OfflineError();
  return bundle.plantInfo || {};
};

export const updatePlantInfo = async (pid: string, data: Record<string, any>) => {
  if (!isOnline()) throw new OfflineError("Plant info updates need a connection.");
  const v = await j<any>(`${API}/api/projects/${pid}/plant-info`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await patchProjectBundle(pid, { plantInfo: v });
  return v;
};

/* ---------------- Pier status writes (offline-capable) ---------------- */

/**
 * Update a single pier's status. Always updates the local cache and (if
 * appropriate) enqueues a pending sync. When online we attempt the server
 * write inline; on failure the mutation stays in the queue and will be
 * retried by `syncPending()`.
 */
export const updatePierStatus = async (pid: string, pierId: string, status: string) => {
  // 1) optimistic local write
  await patchPierStatus(pid, pierId, status);
  // 2) enqueue (or coalesce) the mutation
  await enqueueStatusMutation(pid, pierId, status);
  // 3) fire-and-forget online flush
  if (isOnline()) {
    // don't await — caller wants instant feedback
    syncPending().catch(() => {});
  }
  return { ok: true, offline: !isOnline() };
};

/**
 * Flush every pending mutation to the server. Called on window 'online'
 * events, from the manual Sync button, and after each local write while
 * online. Returns the number of successfully flushed mutations.
 *
 * Optional `ids` restricts the sync to a specific subset — used by the
 * sync-queue panel when the user clicks "Retry" on a single row.
 */
export async function syncPending(ids?: number[]): Promise<{ synced: number; failed: number }> {
  if (!isOnline()) return { synced: 0, failed: 0 };
  const all = await listPendingMutations();
  const filter = ids ? new Set(ids) : null;
  const pending = filter ? all.filter((m) => m.id != null && filter.has(m.id)) : all;
  let synced = 0;
  let failed = 0;
  for (const m of pending) {
    try {
      await j<any>(`${API}/api/projects/${m.projectId}/pier/${m.pierCode}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: m.status }),
      });
      if (m.id != null) await removePendingMutation(m.id);
      synced++;
    } catch (e: any) {
      if (m.id != null) await markPendingFailure(m.id, String(e?.message || e));
      failed++;
    }
  }
  return { synced, failed };
}

/**
 * Retry a single mutation by id. Returns `true` on success.
 */
export async function syncOneMutation(id: number): Promise<boolean> {
  const res = await syncPending([id]);
  return res.synced === 1;
}

/**
 * Drop a pending mutation without sending it to the server. Used by the
 * sync-queue panel when the user decides to ignore a failing update.
 * Note: the optimistic local change already applied to the cache is left
 * in place — you can undo it manually via a fresh status edit if needed.
 */
export async function ignorePendingMutation(id: number): Promise<void> {
  await removePendingMutation(id);
}

export async function pendingCount(): Promise<number> {
  return countPendingMutations();
}

export async function listPending(projectId?: string): Promise<PendingMutation[]> {
  return listPendingMutations(projectId);
}

/* ---------------- Files (all online-only) ---------------- */

export const listProjectFiles = async (pid: string) => {
  if (isOnline()) {
    try {
      const v = await j<any[]>(`${API}/api/projects/${pid}/files`);
      await patchProjectBundle(pid, { files: v });
      return v;
    } catch {
      // fall through
    }
  }
  const bundle = await loadProjectBundle(pid);
  if (!bundle) return [];
  return bundle.files || [];
};

export const uploadProjectFile = async (pid: string, kind: string, file: File) => {
  if (!isOnline()) throw new OfflineError("File uploads need a connection.");
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  const r = await fetch(`${API}/api/projects/${pid}/files`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

export const clearProjectFiles = async (pid: string) => {
  if (!isOnline()) throw new OfflineError("Clearing files needs a connection.");
  return j<any>(`${API}/api/projects/${pid}/files`, { method: "DELETE" });
};

export const parseProject = async (pid: string) => {
  if (!isOnline()) throw new OfflineError("Parsing needs a connection.");
  return j<any>(`${API}/api/projects/${pid}/parse`, { method: "POST" });
};

export const createProject = async (body: { project_id: string; name?: string; site_profile?: string }) => {
  if (!isOnline()) throw new OfflineError("Creating a project needs a connection.");
  return j<any>(`${API}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

export function apiBase() {
  return API;
}
