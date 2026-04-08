const API = (import.meta as any).env?.VITE_API_URL ?? "";

async function j<T = any>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export const getProjects = () => j<any[]>(`${API}/api/projects`);
export const getProject = (id: string) => j<any>(`${API}/api/projects/${id}`);
export const getBlocks = (id: string) => j<any[]>(`${API}/api/projects/${id}/blocks`);
export const getTrackers = (id: string) => j<any[]>(`${API}/api/projects/${id}/trackers`);
export const getPiers = (id: string) => j<any[]>(`${API}/api/projects/${id}/piers`);
export const getPier = (pid: string, pier: string) => j<any>(`${API}/api/projects/${pid}/pier/${pier}`);
export const getZoomTarget = (pid: string, pier: string) => j<any>(`${API}/api/projects/${pid}/pier/${pier}/zoom-target`);

export const ensureSystem = async (pid: string, { force = false }: { force?: boolean } = {}) => {
  const r = await fetch(`${API}/api/projects/${pid}/system/ensure?force=${force ? "true" : "false"}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
export const getSystemMeta = (pid: string) => j<any>(`${API}/api/projects/${pid}/system/meta`);
export const getSystemPierTypeCounts = (pid: string) => j<any[]>(`${API}/api/projects/${pid}/system/pier-type-counts`);
export const getSystemPierTypeLegend = (pid: string) => j<any[]>(`${API}/api/projects/${pid}/system/pier-type-legend`);
export const getSystemTrackers = (pid: string) => j<any[]>(`${API}/api/projects/${pid}/system/trackers`);
export const getSystemPiers = (pid: string, params: Record<string, string | number | boolean> = {}) => {
  const q = new URLSearchParams(params as any);
  return j<any>(`${API}/api/projects/${pid}/system/piers?${q.toString()}`);
};
export const exportSystemExcel = async (pid: string, { force = false }: { force?: boolean } = {}) => {
  const r = await fetch(`${API}/api/projects/${pid}/system/export-excel?force=${force ? "true" : "false"}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

export function apiBase() {
  return API;
}
