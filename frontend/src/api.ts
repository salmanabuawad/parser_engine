const API = (import.meta as any).env?.VITE_API_URL ?? "";

async function j<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Projects
export const getProjects = () => j<any[]>(`${API}/api/projects`);
export const getProject = (id: string) => j<any>(`${API}/api/projects/${id}`);

export const createProject = (body: { project_id: string; name?: string; site_profile?: string }) =>
  j<any>(`${API}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Entities
export const getBlocks = (id: string) => j<any[]>(`${API}/api/projects/${id}/blocks`);
export const getTrackers = (id: string) => j<any[]>(`${API}/api/projects/${id}/trackers`);
export const getPiers = (id: string) => j<any[]>(`${API}/api/projects/${id}/piers`);
export const getPier = (pid: string, pier: string) => j<any>(`${API}/api/projects/${pid}/pier/${pier}`);
export const getZoomTarget = (pid: string, pier: string) =>
  j<any>(`${API}/api/projects/${pid}/pier/${pier}/zoom-target`);

// Aggregations (fast DB-backed)
export const getPierTypeCounts = (pid: string) =>
  j<any[]>(`${API}/api/projects/${pid}/pier-type-counts`);
export const getBlockSummary = (pid: string) =>
  j<any[]>(`${API}/api/projects/${pid}/block-summary`);
export const getRowSummary = (pid: string) =>
  j<any[]>(`${API}/api/projects/${pid}/row-summary`);

// Plant info
export const getPlantInfo = (pid: string) => j<any>(`${API}/api/projects/${pid}/plant-info`);
export const updatePlantInfo = (pid: string, data: Record<string, any>) =>
  j<any>(`${API}/api/projects/${pid}/plant-info`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

// Pier statuses
export const getPierStatuses = (pid: string) =>
  j<Record<string, string>>(`${API}/api/projects/${pid}/pier-statuses`);
export const updatePierStatus = (pid: string, pierId: string, status: string) =>
  j<any>(`${API}/api/projects/${pid}/pier/${pierId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

// Files
export const listProjectFiles = (pid: string) => j<any[]>(`${API}/api/projects/${pid}/files`);

export const uploadProjectFile = async (pid: string, kind: string, file: File) => {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  const r = await fetch(`${API}/api/projects/${pid}/files`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

export const clearProjectFiles = (pid: string) =>
  j<any>(`${API}/api/projects/${pid}/files`, { method: "DELETE" });

export const parseProject = (pid: string) =>
  j<any>(`${API}/api/projects/${pid}/parse`, { method: "POST" });

export function apiBase() {
  return API;
}
