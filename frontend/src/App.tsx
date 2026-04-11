import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { getProjects, getProject, getPlantInfo, getBlocks, getTrackers, getPiers, getPier, getPierStatuses, updatePierStatus, createProject } from "./api";
import SimpleGrid from "./components/SimpleGrid";
import LayerTogglePanel from "./components/LayerTogglePanel";
import PierModal from "./components/PierModal";
import SystemPanel from "./components/SystemPanel";
import { BusyOverlay, ConfirmModal, PromptModal } from "./components/Modals";
import SyncQueuePanel from "./components/SyncQueuePanel";
import { useResponsive } from "./hooks/useResponsive";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { userPrefs } from "./userPrefs";

// MapLibre is our single map engine. Lazy-loaded so the initial bundle
// doesn't pay for it until the user opens the Map tab.
const SiteMapMapLibre = lazy(() => import("./components/SiteMapMapLibre"));

const INITIAL_LAYERS = [
  { key: "blocks", label: "Blocks", visible: true },
  { key: "blockLabels", label: "Block labels", visible: true },
  { key: "trackers", label: "Trackers", visible: true },
  { key: "piers", label: "Piers", visible: true }
];

function getInitialProjectId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("project") || "";
}

export default function App() {
  const { isMobile, isTablet } = useResponsive();
  const { online, pending, syncing, refreshPending } = useOnlineStatus();
  const [showSyncQueue, setShowSyncQueue] = useState(false);
  const [mode, setMode] = useState<"grid" | "map">("map");
  const [activeTab, setActiveTab] = useState<string>("details");
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState(getInitialProjectId);
  const [project, setProject] = useState<any>(null);
  const [plantInfo, setPlantInfo] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [trackers, setTrackers] = useState<any[]>([]);
  const [piers, setPiers] = useState<any[]>([]);
  const [selectedPier, setSelectedPier] = useState<any>(null);
  const [selectedPierFull, setSelectedPierFull] = useState<any>(null);
  const [gridFilterBy, setGridFilterBy] = useState<"row" | "tracker">("row");
  const [gridFilterValue, setGridFilterValue] = useState("");
  const [pierStatuses, setPierStatuses] = useState<Record<string, string>>({});
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [error, setError] = useState("");
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pierLabelThreshold, setPierLabelThreshold] = useState<number>(
    () => userPrefs.getPierLabelThreshold(),
  );
  const [pierDetailThreshold, setPierDetailThreshold] = useState<number>(
    () => userPrefs.getPierDetailThreshold(),
  );
  // Shared pier selection across Grid and Map. `selectedPierCodes` is the
  // single source of truth — the grid checkboxes and map box-select both
  // feed it.
  const [selectedPierCodes, setSelectedPierCodes] = useState<Set<string>>(() => new Set());
  // Bulk status change UI state.
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Persist user preferences.
  useEffect(() => { userPrefs.setPierLabelThreshold(pierLabelThreshold); }, [pierLabelThreshold]);
  useEffect(() => { userPrefs.setPierDetailThreshold(pierDetailThreshold); }, [pierDetailThreshold]);

  // Clear selection whenever the active project changes so we don't carry
  // stale pier codes between datasets.
  useEffect(() => {
    setSelectedPierCodes(new Set());
  }, [projectId]);

  useEffect(() => {
    let ignore = false;
    getProjects()
      .then((items: any[]) => {
        if (ignore) return;
        setProjects(items);
        if (!items.some((item: any) => item.project_id === projectId) && items.length > 0) {
          setProjectId(items[0].project_id);
        }
      })
      .catch((e: any) => { if (!ignore) setError(String(e.message || e)); });
    return () => { ignore = true; };
  }, [projectId]);

  // Load lightweight project metadata immediately on project change.
  useEffect(() => {
    if (!projectId) return;
    let ignore = false;
    setError("");
    setProject(null);
    setPlantInfo(null);
    setSelectedPier(null);
    setSelectedPierFull(null);
    setGridFilterValue("");

    Promise.all([
      getProject(projectId).catch(() => null),
      getPlantInfo(projectId).catch(() => ({})),
    ]).then(([p, pi]) => {
      if (ignore) return;
      setProject(p);
      setPlantInfo(pi);
    }).catch((e: any) => { if (!ignore) setError(String(e.message || e)); });

    const params = new URLSearchParams(window.location.search);
    params.set("project", projectId);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    return () => { ignore = true; };
  }, [projectId, refreshKey]);

  // Load heavy data (blocks, trackers, 25k piers) in the background after
  // project metadata loads. This way the data is ready by the time the user
  // clicks the Details tab — no waiting.
  useEffect(() => {
    if (!projectId || !project) return;
    let ignore = false;
    setBlocks([]);
    setTrackers([]);
    setPiers([]);
    setPierStatuses({});

    Promise.all([getBlocks(projectId), getTrackers(projectId), getPiers(projectId), getPierStatuses(projectId)])
      .then(([b, t, pi, st]) => {
        if (ignore) return;
        setBlocks(b);
        setTrackers(t);
        setPiers(pi);
        setPierStatuses(st || {});
      })
      .catch((e: any) => { if (!ignore) setError(String(e.message || e)); });
    return () => { ignore = true; };
  }, [projectId, refreshKey, project]);

  async function handleStatusChange(pierId: string, status: string) {
    if (!projectId) return;
    try {
      await updatePierStatus(projectId, pierId, status);
      setPierStatuses((prev) => {
        const next = { ...prev };
        if (status === "New") delete next[pierId];
        else next[pierId] = status;
        return next;
      });
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  async function handleBulkApply() {
    if (!projectId || !bulkStatus || selectedPierCodes.size === 0) return;
    const codes = Array.from(selectedPierCodes);
    const status = bulkStatus;
    const total = codes.length;
    let done = 0;
    let failed = 0;
    setBusy(`Updating 0 / ${total} piers…`);
    // Parallel with a small concurrency cap so we don't blow out the server.
    const CONCURRENCY = 6;
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= codes.length) return;
        const code = codes[i];
        try {
          await updatePierStatus(projectId, code, status);
        } catch {
          failed++;
        }
        done++;
        if (done % 10 === 0 || done === total) {
          setBusy(`Updating ${done} / ${total} piers…`);
        }
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, codes.length) }, () => worker()),
      );
      // Merge successes into the local statuses map.
      setPierStatuses((prev) => {
        const next = { ...prev };
        for (const code of codes) {
          if (status === "New") delete next[code];
          else next[code] = status;
        }
        return next;
      });
      if (failed > 0) {
        setError(`Bulk update: ${failed} of ${total} piers failed to update.`);
      }
      // Clear the selection once the operation finishes.
      setSelectedPierCodes(new Set());
      setBulkStatus("");
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  }

  // Stable callbacks for the map component to prevent re-render loops.
  const handleProjectChanged = useCallback((pid: string) => {
    getProjects().then((items: any[]) => {
      setProjects(items);
      if (pid && pid !== projectId) {
        setProjectId(pid);
      } else {
        setRefreshKey((k) => k + 1);
      }
    }).catch(() => {});
  }, [projectId]);

  const handleAreaSelect = useCallback((items: any[]) => {
    setSelectedPierCodes((prev) => {
      const next = new Set(prev);
      for (const it of items) if (it?.pier_code) next.add(it.pier_code);
      return next;
    });
  }, []);

  async function handlePierClick(p: any) {
    if (!projectId) return;
    setSelectedPier(p);
    try {
      const full = await getPier(projectId, p.pier_code);
      setSelectedPierFull(full);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  // Parse comma-separated filter values into a Set for fast lookup.
  const gridFilterSet = useMemo(() => {
    if (!gridFilterValue.trim()) return null;
    const vals = gridFilterValue.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    return vals.length > 0 ? new Set(vals) : null;
  }, [gridFilterValue]);

  // Filtered data based on row/tracker filter
  const filteredPiers = useMemo(() => {
    if (!gridFilterSet) return piers;
    if (gridFilterBy === "row") {
      return piers.filter((p: any) => gridFilterSet.has(String(p.row_num || "").toUpperCase()));
    }
    return piers.filter((p: any) => gridFilterSet.has(String(p.tracker_code || "").toUpperCase()));
  }, [piers, gridFilterBy, gridFilterSet]);

  const filteredTrackers = useMemo(() => {
    if (!gridFilterSet) return trackers;
    if (gridFilterBy === "row") {
      return trackers.filter((t: any) => gridFilterSet.has(String(t.row || "").toUpperCase()));
    }
    return trackers.filter((t: any) => gridFilterSet.has(String(t.tracker_code || "").toUpperCase()));
  }, [trackers, gridFilterBy, gridFilterSet]);

  // Grid rows: apply block/tracker filters, then optionally restrict to
  // whatever piers were visible in the map viewport when the user
  // last interacted with it.
  const gridRows = useMemo(() => {
    return filteredPiers.map((p: any) => ({
      ...p,
      status: pierStatuses[p.pier_code] || "New",
    }));
  }, [filteredPiers, pierStatuses]);

  const STATUS_BG: Record<string, string> = {
    "New": "#ffffff",
    "In Progress": "#fef3c7",
    "Implemented": "#d1fae5",
    "Approved": "#86efac",
    "Rejected": "#fecaca",
    "Fixed": "#bfdbfe",
  };
  const getRowStyle = (p: any) => {
    const bg = STATUS_BG[p.data?.status] || "#ffffff";
    return { backgroundColor: bg };
  };

  const TAB_ITEMS: { key: string; label: string }[] = [
    { key: "details", label: "Project Info" },
    { key: "mapgrid", label: "Details" },
    { key: "devices", label: "Devices" },
    { key: "config", label: "Config" },
  ];

  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      style={{
        padding: isMobile ? "10px 16px" : "6px 14px",
        borderRadius: 10,
        border: "1px solid #e2e8f0",
        background: active ? "#0f172a" : "white",
        color: active ? "white" : "#0f172a",
        fontSize: isMobile ? 14 : 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ maxWidth: isMobile ? "100%" : 1200, margin: "0 auto", padding: isMobile ? "8px 10px" : "12px 16px", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 17 : 20 }}>Solarica</h2>
        <select
          autoComplete="off"
          value={projectId}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__new__") {
              setShowNewProjectModal(true);
              return;
            }
            setProjectId(val);
          }}
          style={{ minWidth: isMobile ? 0 : 160, flex: isMobile ? 1 : undefined, padding: isMobile ? "8px 8px" : "6px 8px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: isMobile ? 14 : undefined }}
        >
          <optgroup label="Existing Projects">
            {!projects.length && <option value="">No projects</option>}
            {projects.map((item: any) => (
              <option key={item.project_id} value={item.project_id}>{item.project_id}</option>
            ))}
          </optgroup>
          <optgroup label="New">
            <option value="__new__">+ New Project…</option>
          </optgroup>
        </select>
        <div style={{ marginLeft: isMobile ? 0 : "auto", width: isMobile ? "100%" : undefined, display: "flex", gap: 6, alignItems: "center" }}>
          {/* Connectivity / sync indicator — click to open the sync queue */}
          <div
            title={
              pending > 0
                ? `${pending} pending sync${pending === 1 ? "" : "s"} — click to review`
                : online
                ? "Online — everything synced"
                : "Offline — no pending changes"
            }
            onClick={() => setShowSyncQueue(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${online ? "#bbf7d0" : "#fecaca"}`,
              background: online ? "#f0fdf4" : "#fef2f2",
              color: online ? "#166534" : "#991b1b",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: online ? "#16a34a" : "#dc2626",
                display: "inline-block",
              }}
            />
            {syncing ? "Syncing…" : online ? "Online" : "Offline"}
            {pending > 0 && (
              <span
                style={{
                  background: online ? "#16a34a" : "#dc2626",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "1px 6px",
                  fontSize: 10,
                }}
              >
                {pending}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 8, fontSize: 13 }}>{error}</div>}


      {/* ---- TAB BAR ---- */}
      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderBottom: "2px solid #e2e8f0" }}>
        {TAB_ITEMS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: isMobile ? "10px 14px" : "8px 18px",
                fontSize: isMobile ? 13 : 13,
                fontWeight: active ? 700 : 500,
                color: active ? "#0f172a" : "#64748b",
                background: "none",
                border: "none",
                borderBottom: active ? "2px solid #0f172a" : "2px solid transparent",
                marginBottom: -2,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ---- TAB: Config (upload/parse + display settings) ---- */}
      <div style={{ display: activeTab === "config" ? "block" : "none" }}>
        <SystemPanel projectId={projectId} section="files" project={project} plantInfo={plantInfo} onProjectChanged={handleProjectChanged} onPlantInfoChanged={setPlantInfo} />
        <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 16, padding: isMobile ? 12 : 16, background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Display Settings</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label htmlFor="pierLabelThreshold" style={{ fontSize: 12, color: "#64748b" }}>Show pier codes when ≤</label>
              <input id="pierLabelThreshold" type="number" min={0} max={500} step={1} value={pierLabelThreshold} onChange={(e) => { const v = parseInt(e.target.value || "0", 10); setPierLabelThreshold(Number.isFinite(v) ? Math.max(0, Math.min(500, v)) : 0); }} style={{ width: 60, padding: "6px 8px", fontSize: 13, borderRadius: 8, border: "1px solid #d1d5db" }} />
              <span style={{ fontSize: 12, color: "#94a3b8" }}>piers visible</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label htmlFor="pierDetailThreshold" style={{ fontSize: 12, color: "#64748b" }}>Show detail cards when ≤</label>
              <input id="pierDetailThreshold" type="number" min={0} max={50} step={1} value={pierDetailThreshold} onChange={(e) => { const v = parseInt(e.target.value || "0", 10); setPierDetailThreshold(Number.isFinite(v) ? Math.max(0, Math.min(50, v)) : 0); }} style={{ width: 60, padding: "6px 8px", fontSize: 13, borderRadius: 8, border: "1px solid #d1d5db" }} />
              <span style={{ fontSize: 12, color: "#94a3b8" }}>piers visible</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- TAB: Project Info (metadata only) ---- */}
      <div style={{ display: activeTab === "details" ? "block" : "none" }}>
        <SystemPanel projectId={projectId} section="info" project={project} plantInfo={plantInfo} onProjectChanged={handleProjectChanged} onPlantInfoChanged={setPlantInfo} />
      </div>

      {/* ---- TAB: Details (Grid / Map) ---- */}
      <div style={{ display: activeTab === "mapgrid" ? "block" : "none" }}>
        {/* Grid/Map toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
          <Pill active={mode === "grid"} onClick={() => setMode("grid")}>Grid</Pill>
          <Pill active={mode === "map"} onClick={() => setMode("map")}>Map</Pill>
        </div>

        {mode === "map" ? (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
              <LayerTogglePanel layers={layers} onChange={(key: string, visible: boolean) => setLayers((prev) => prev.map((l) => l.key === key ? { ...l, visible } : l))} inline />
              {gridFilterValue && (
                <span style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 600 }}>
                  {gridFilterBy === "row" ? "Rows" : "Trackers"}: {gridFilterValue}
                </span>
              )}
              {gridFilterValue && (
                <button onClick={() => setGridFilterValue("")} style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>Clear filter</button>
              )}
            </div>
            <div style={{ height: isMobile ? "calc(100vh - 300px)" : "calc(100vh - 320px)", minHeight: isMobile ? 300 : 400, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }}>
              <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 13, color: "#64748b" }}>Loading map…</div>}>
                <SiteMapMapLibre
                  imageWidth={project?.base_image?.width || 1}
                  imageHeight={project?.base_image?.height || 1}
                  blocks={blocks}
                  trackers={filteredTrackers}
                  piers={filteredPiers}
                  pierStatuses={pierStatuses}
                  selectedBlock={null}
                  selectedTracker={gridFilterBy === "tracker" && gridFilterSet ? trackers.find((t: any) => gridFilterSet.has(String(t.tracker_code || "").toUpperCase())) : null}
                  selectedPier={selectedPier}
                  layers={layers}
                  onBlockClick={() => {}}
                  onTrackerClick={(t: any) => { setGridFilterBy("tracker"); setGridFilterValue(t.tracker_code || ""); }}
                  onPierClick={handlePierClick}
                  onAreaSelect={handleAreaSelect}
                  bulkSelectedPierCodes={selectedPierCodes}
                  pierLabelThreshold={pierLabelThreshold}
                  pierDetailThreshold={pierDetailThreshold}
                />
              </Suspense>
            </div>
            {selectedPierFull && (
              <PierModal selected={selectedPierFull} status={pierStatuses[selectedPier?.pier_code] || ""} onStatusChange={handleStatusChange} onClose={() => { setSelectedPier(null); setSelectedPierFull(null); }} />
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Filter by</span>
              <select value={gridFilterBy} onChange={(e) => { setGridFilterBy(e.target.value as any); setGridFilterValue(""); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }}>
                <option value="row">Rows</option>
                <option value="tracker">Trackers</option>
              </select>
              <input
                value={gridFilterValue}
                onChange={(e) => setGridFilterValue(e.target.value)}
                placeholder={gridFilterBy === "row" ? "e.g. 1, 2, 107" : "e.g. T0001, T0002"}
                style={{ flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }}
              />
              {gridFilterValue && (
                <button onClick={() => setGridFilterValue("")} style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>Clear</button>
              )}
              <span style={{ fontSize: 12, color: "#64748b" }}>{filteredPiers.length.toLocaleString()} piers</span>
            </div>
            <SimpleGrid
              rows={gridRows}
              columns={isMobile ? [
                { field: "block_code", headerName: "Block" },
                { field: "pier_code", headerName: "Pier" },
                { field: "tracker_code", headerName: "Tracker" },
                { field: "pier_type", headerName: "Pier Type" },
                { field: "status", headerName: "Status", cellStyle: { fontWeight: 600 } },
                { field: "row_num", headerName: "Row" },
              ] : [
                { field: "block_code", headerName: "Block", maxWidth: 80 },
                { field: "pier_code", headerName: "Pier", pinned: "left", maxWidth: 120 },
                { field: "tracker_code", headerName: "Tracker", maxWidth: 100 },
                { field: "row_num", headerName: "Row", maxWidth: 80 },
                { field: "pier_type", headerName: "Pier Type", maxWidth: 100 },
                { field: "status", headerName: "Status", maxWidth: 130, cellStyle: { fontWeight: 600 } },
                { field: "structure_code", headerName: "Structure", maxWidth: 100 },
                { field: "slope_band", headerName: "Slope", maxWidth: 90 },
                { field: "tracker_type_code", headerName: "Tracker Type" },
              ]}
              height={isMobile ? Math.min(500, Math.max(300, window.innerHeight - 300)) : Math.min(700, Math.max(400, window.innerHeight - 320))}
              enableQuickFilter
              quickFilterPlaceholder="Search piers..."
              pagination
              pageSize={100}
              getRowId={(p: any) => p.data?.pier_code}
              getRowStyle={getRowStyle}
              onRowClick={handlePierClick}
              rowSelection="multiple"
              selectedIds={selectedPierCodes}
              onSelectionChange={(ids: Set<string>) => setSelectedPierCodes(ids)}
            />
            {selectedPierFull && (
              <PierModal selected={selectedPierFull} status={pierStatuses[selectedPier?.pier_code] || ""} onStatusChange={handleStatusChange} onClose={() => { setSelectedPier(null); setSelectedPierFull(null); }} />
            )}
          </div>
        )}
      </div>

      {/* ---- TAB: Devices ---- */}
      <div style={{ display: activeTab === "devices" ? "block" : "none" }}>
        {project?.electrical ? (() => {
          const e = project.electrical;
          const bom: any[] = (e.bill_of_materials || []).map((item: any, i: number) => {
            const nameParts = (item.name || "").split(",").map((s: string) => s.trim());
            const rowType = nameParts.length >= 3 ? nameParts.slice(2).join(", ").replace(/ - XTR.*$/, "") : "";
            return { ...item, id: i, device_type: `${item.module_count}M-${item.pier_count}P ${rowType}`.trim() };
          });
          const pierSpecRows: any[] = (e.pier_type_specs || []).flatMap((spec: any) =>
            (spec.zones || []).map((z: any, zi: number) => ({
              id: `${spec.pier_type}-${zi}`,
              pier_type: spec.pier_type,
              pier_type_full: spec.pier_type_full,
              zone: z.zone,
              size: z.size,
              part_no: z.part_no,
            }))
          );
          return (
            <div style={{ display: "grid", gap: 14 }}>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "8px 20px", fontSize: 13 }}>
                {[
                  ["Inverters", e.inverters],
                  ["DCCB", e.dccb?.toLocaleString?.() ?? e.dccb],
                  ["String Groups", e.string_groups],
                  ["Total Strings", e.total_strings?.toLocaleString?.() ?? e.total_strings],
                  ["Total Modules", e.total_modules?.toLocaleString?.() ?? e.total_modules],
                  ["Output (MW)", e.total_output_mw],
                  ["Module Power (W)", e.module_capacity_w],
                  ["Modules/String", e.modules_per_string],
                ].map(([label, val]) => (
                  <div key={String(label)}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{val ?? "-"}</div>
                  </div>
                ))}
              </div>

              {/* BOM ag-grid */}
              {bom.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, borderBottom: "1px solid #e2e8f0", paddingBottom: 3 }}>Bill of Materials</div>
                  <SimpleGrid
                    rows={bom}
                    columns={[
                      { field: "part_no", headerName: "Part No", maxWidth: 180 },
                      { field: "device_type", headerName: "Device Type", maxWidth: 220 },
                      { field: "name", headerName: "Name" },
                      { field: "qty", headerName: "Qty", maxWidth: 80, type: "numericColumn" },
                      { field: "module_count", headerName: "Modules", maxWidth: 100, type: "numericColumn" },
                      { field: "pier_count", headerName: "Piers", maxWidth: 80, type: "numericColumn" },
                    ]}
                    height={Math.min(400, 56 + bom.length * 42)}
                    getRowId={(p: any) => String(p.data?.id)}
                    enableQuickFilter
                    quickFilterPlaceholder="Search devices..."
                  />
                </div>
              )}

              {/* Pier Type Specs ag-grid */}
              {pierSpecRows.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, borderBottom: "1px solid #e2e8f0", paddingBottom: 3 }}>Pier Type Specifications</div>
                  <SimpleGrid
                    rows={pierSpecRows}
                    columns={[
                      { field: "pier_type", headerName: "Type", maxWidth: 100 },
                      { field: "pier_type_full", headerName: "Full Name", maxWidth: 220 },
                      { field: "zone", headerName: "Zone" },
                      { field: "size", headerName: "Size", maxWidth: 150 },
                      { field: "part_no", headerName: "Part No", maxWidth: 120 },
                    ]}
                    height={Math.min(400, 56 + pierSpecRows.length * 42)}
                    getRowId={(p: any) => String(p.data?.id)}
                  />
                </div>
              )}
            </div>
          );
        })() : (
          <div style={{ fontSize: 12, color: "#64748b" }}>No electrical metadata available. Parse a project first.</div>
        )}
      </div>

      {showNewProjectModal && (
        <PromptModal
          title="New Project"
          message={online ? "Enter a project id (e.g. ashalim4):" : "Creating a project requires an internet connection."}
          placeholder="project_id"
          confirmLabel="Create"
          onCancel={() => setShowNewProjectModal(false)}
          onConfirm={async (id) => {
            setShowNewProjectModal(false);
            if (!online) {
              setError("Cannot create a project while offline.");
              return;
            }
            try {
              setBusy(`Creating project ${id}…`);
              await createProject({ project_id: id });
              const items = await getProjects();
              setProjects(items);
              setProjectId(id);
              setMode("system");
            } catch (err: any) {
              setError(String(err.message || err));
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
      {bulkConfirmOpen && (
        <ConfirmModal
          title="Change status for selected piers"
          message={`Change the status of ${selectedPierCodes.size.toLocaleString()} pier${selectedPierCodes.size === 1 ? "" : "s"} to "${bulkStatus}"?`}
          confirmLabel="Apply"
          danger
          onCancel={() => setBulkConfirmOpen(false)}
          onConfirm={async () => {
            setBulkConfirmOpen(false);
            await handleBulkApply();
          }}
        />
      )}
      {showSyncQueue && (
        <SyncQueuePanel
          online={online}
          onClose={() => setShowSyncQueue(false)}
          onChanged={() => { refreshPending(); }}
        />
      )}
      {busy && <BusyOverlay message={busy} />}
    </div>
  );
}
