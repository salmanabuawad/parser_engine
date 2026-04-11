import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { getProjects, getProject, getBlocks, getTrackers, getPiers, getPier, getPierStatuses, updatePierStatus, createProject } from "./api";
import SimpleGrid from "./components/SimpleGrid";
import LayerTogglePanel from "./components/LayerTogglePanel";
import PierDetailsPanel from "./components/PierDetailsPanel";
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
  const [mode, setMode] = useState<"grid" | "map" | "system">("system");
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState(getInitialProjectId);
  const [project, setProject] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [trackers, setTrackers] = useState<any[]>([]);
  const [piers, setPiers] = useState<any[]>([]);
  const [selectedPier, setSelectedPier] = useState<any>(null);
  const [selectedPierFull, setSelectedPierFull] = useState<any>(null);
  const [filterBlock, setFilterBlock] = useState("");
  const [filterTracker, setFilterTracker] = useState("");
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
  // Snapshot of the pier codes currently inside the map viewport. Updated
  // by onViewportChange. When `useViewportFilter` is ON the grid is
  // restricted to this set.
  const [viewportPierCodes, setViewportPierCodes] = useState<Set<string> | null>(null);
  const [useViewportFilter, setUseViewportFilter] = useState(false);
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
    setViewportPierCodes(null);
    setUseViewportFilter(false);
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

  useEffect(() => {
    if (!projectId) return;
    let ignore = false;
    setError("");
    setProject(null);
    setBlocks([]);
    setTrackers([]);
    setPiers([]);
    setSelectedPier(null);
    setSelectedPierFull(null);
    setFilterBlock("");
    setFilterTracker("");
    setPierStatuses({});

    Promise.all([getProject(projectId), getBlocks(projectId), getTrackers(projectId), getPiers(projectId), getPierStatuses(projectId)])
      .then(([p, b, t, pi, st]: any[]) => {
        if (ignore) return;
        setProject(p);
        setBlocks(b);
        setTrackers(t);
        setPiers(pi);
        setPierStatuses(st || {});
      })
      .catch((e: any) => { if (!ignore) setError(String(e.message || e)); });

    const params = new URLSearchParams(window.location.search);
    params.set("project", projectId);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    return () => { ignore = true; };
  }, [projectId, refreshKey]);

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

  // Filtered data based on block/tracker selection
  const filteredPiers = useMemo(() => {
    let result = piers;
    if (filterBlock) result = result.filter((p: any) => p.block_code === filterBlock);
    if (filterTracker) result = result.filter((p: any) => p.tracker_code === filterTracker);
    return result;
  }, [piers, filterBlock, filterTracker]);

  const filteredTrackers = useMemo(() => {
    if (!filterBlock) return trackers;
    return trackers.filter((t: any) => t.block_code === filterBlock);
  }, [trackers, filterBlock]);

  // Unique block codes for filter dropdown
  const blockCodes = useMemo(() => {
    return [...new Set(blocks.map((b: any) => b.block_code))].sort();
  }, [blocks]);

  const trackerCodes = useMemo(() => {
    return [...new Set(filteredTrackers.map((t: any) => t.tracker_code))].sort();
  }, [filteredTrackers]);

  // Grid rows: apply block/tracker filters, then optionally restrict to
  // whatever piers were visible in the map viewport when the user
  // last interacted with it.
  const gridRows = useMemo(() => {
    let rows = filteredPiers;
    if (useViewportFilter && viewportPierCodes && viewportPierCodes.size > 0) {
      rows = rows.filter((p: any) => viewportPierCodes.has(p.pier_code));
    }
    return rows.map((p: any) => ({
      ...p,
      status: pierStatuses[p.pier_code] || "New",
    }));
  }, [filteredPiers, pierStatuses, useViewportFilter, viewportPierCodes]);

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
          <Pill active={mode === "system"} onClick={() => setMode("system")}>System</Pill>
          <Pill active={mode === "grid"} onClick={() => setMode("grid")}>Grid</Pill>
          <Pill active={mode === "map"} onClick={() => setMode("map")}>Map</Pill>
        </div>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 8, fontSize: 13 }}>{error}</div>}

      {project && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "#64748b" }}>
          {project.block_count} blocks / {project.tracker_count} trackers / {project.pier_count} piers
        </div>
      )}

      {/* Shared bulk-selection toolbar — visible in both Grid and Map */}
      {mode !== "system" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            marginBottom: 8,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: selectedPierCodes.size > 0 ? "#eff6ff" : "#f8fafc",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: selectedPierCodes.size > 0 ? "#1d4ed8" : "#64748b",
              minWidth: 96,
            }}
          >
            {selectedPierCodes.size.toLocaleString()} selected
          </span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            disabled={selectedPierCodes.size === 0}
            style={{
              padding: "6px 10px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              opacity: selectedPierCodes.size === 0 ? 0.5 : 1,
              cursor: selectedPierCodes.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            <option value="">Change status…</option>
            {["New", "In Progress", "Implemented", "Approved", "Rejected", "Fixed"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => setBulkConfirmOpen(true)}
            disabled={selectedPierCodes.size === 0 || !bulkStatus}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              background:
                selectedPierCodes.size === 0 || !bulkStatus ? "#cbd5e1" : "#0f172a",
              color: "#fff",
              cursor:
                selectedPierCodes.size === 0 || !bulkStatus ? "not-allowed" : "pointer",
            }}
          >
            Apply
          </button>
          <button
            onClick={() => { setSelectedPierCodes(new Set()); setBulkStatus(""); }}
            disabled={selectedPierCodes.size === 0}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              cursor: selectedPierCodes.size === 0 ? "not-allowed" : "pointer",
              opacity: selectedPierCodes.size === 0 ? 0.5 : 1,
            }}
          >
            Clear
          </button>
          {/* Map → Grid viewport filter toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#475569",
              marginLeft: "auto",
              cursor: viewportPierCodes ? "pointer" : "not-allowed",
              opacity: viewportPierCodes ? 1 : 0.4,
            }}
            title="When ON, the Grid is restricted to piers currently visible in the map viewport."
          >
            <input
              type="checkbox"
              checked={useViewportFilter}
              onChange={(e) => setUseViewportFilter(e.target.checked)}
              disabled={!viewportPierCodes}
            />
            Filter grid by map view
            {useViewportFilter && viewportPierCodes && (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                ({viewportPierCodes.size.toLocaleString()})
              </span>
            )}
          </label>
        </div>
      )}

      {mode === "system" ? (
        <SystemPanel projectId={projectId} onProjectChanged={(pid) => {
          // Refresh projects list and switch to the (possibly new) project.
          // Also bump refreshKey so Grid/Map re-fetch blocks/trackers/piers
          // even when the project id did not change (e.g. re-parse in place).
          getProjects().then((items: any[]) => {
            setProjects(items);
            if (pid && pid !== projectId) {
              setProjectId(pid);
            } else {
              setRefreshKey((k) => k + 1);
            }
          }).catch(() => {});
        }} />
      ) : mode === "map" ? (
        /* ---- MAP VIEW ---- */
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <LayerTogglePanel
              layers={layers}
              onChange={(key: string, visible: boolean) => setLayers((prev) => prev.map((l) => l.key === key ? { ...l, visible } : l))}
              inline
            />
            {/* Block filter */}
            <select
              value={filterBlock}
              onChange={(e) => { setFilterBlock(e.target.value); setFilterTracker(""); }}
              style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 12 }}
            >
              <option value="">All blocks</option>
              {blockCodes.map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
            {filterBlock && (
              <button onClick={() => { setFilterBlock(""); setFilterTracker(""); }} style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>Clear filter</button>
            )}
          </div>
          {/* Pier-label threshold + selection badge */}
          <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label htmlFor="pierLabelThreshold" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                Pier #s ≤
              </label>
              <input
                id="pierLabelThreshold"
                type="number"
                min={0}
                max={500}
                step={1}
                value={pierLabelThreshold}
                onChange={(e) => {
                  const v = parseInt(e.target.value || "0", 10);
                  setPierLabelThreshold(Number.isFinite(v) ? Math.max(0, Math.min(500, v)) : 0);
                }}
                style={{
                  width: 60,
                  padding: "4px 8px",
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
                title="Pier code labels appear when the number of visible piers is at or below this value."
              />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label htmlFor="pierDetailThreshold" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                Details ≤
              </label>
              <input
                id="pierDetailThreshold"
                type="number"
                min={0}
                max={50}
                step={1}
                value={pierDetailThreshold}
                onChange={(e) => {
                  const v = parseInt(e.target.value || "0", 10);
                  setPierDetailThreshold(Number.isFinite(v) ? Math.max(0, Math.min(50, v)) : 0);
                }}
                style={{
                  width: 60,
                  padding: "4px 8px",
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
                title="Full pier detail cards appear when the number of visible piers is at or below this value."
              />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>visible</span>
            </div>
          </div>
          <div style={{ height: isMobile ? "calc(100vh - 170px)" : "calc(100vh - 200px)", minHeight: isMobile ? 300 : 400, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <Suspense
              fallback={
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 13, color: "#64748b" }}>
                  Loading map…
                </div>
              }
            >
              <SiteMapMapLibre
                imageWidth={project?.base_image?.width || 1}
                imageHeight={project?.base_image?.height || 1}
                blocks={blocks}
                trackers={filteredTrackers}
                piers={filteredPiers}
                pierStatuses={pierStatuses}
                selectedBlock={filterBlock ? blocks.find((b: any) => b.block_code === filterBlock) : null}
                selectedTracker={filterTracker ? trackers.find((t: any) => t.tracker_code === filterTracker) : null}
                selectedPier={selectedPier}
                layers={layers}
                onBlockClick={(b: any) => { setFilterBlock(b.block_code); setFilterTracker(""); }}
                onTrackerClick={(t: any) => { setFilterTracker(t.tracker_code); }}
                onPierClick={handlePierClick}
                onAreaSelect={(items: any[]) => {
                  // Merge into the shared selection (union with anything the
                  // user already picked in the grid).
                  setSelectedPierCodes((prev) => {
                    const next = new Set(prev);
                    for (const it of items) if (it?.pier_code) next.add(it.pier_code);
                    return next;
                  });
                }}
                onViewportChange={(codes) => setViewportPierCodes(codes)}
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
        /* ---- GRID VIEW (single detailed grid) ---- */
        <div>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={filterBlock}
              onChange={(e) => { setFilterBlock(e.target.value); setFilterTracker(""); }}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }}
            >
              <option value="">All blocks</option>
              {blockCodes.map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterTracker}
              onChange={(e) => setFilterTracker(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }}
            >
              <option value="">All trackers</option>
              {trackerCodes.map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
            {(filterBlock || filterTracker) && (
              <button
                onClick={() => { setFilterBlock(""); setFilterTracker(""); }}
                style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
              >
                Clear
              </button>
            )}
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {filteredPiers.length.toLocaleString()} piers
            </span>
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
            height={isMobile ? Math.min(500, Math.max(300, window.innerHeight - 180)) : Math.min(700, Math.max(400, window.innerHeight - 200))}
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
