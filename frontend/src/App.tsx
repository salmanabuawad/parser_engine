import { useEffect, useMemo, useState } from "react";
import { getProjects, getProject, getBlocks, getTrackers, getPiers, getPier, getZoomTarget } from "./api";
import SimpleGrid from "./components/SimpleGrid";
import LayerTogglePanel from "./components/LayerTogglePanel";
import SiteMap from "./components/SiteMap";
import PierDetailsPanel from "./components/PierDetailsPanel";
import SystemPanel from "./components/SystemPanel";

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
  const [mode, setMode] = useState<"core" | "system">("core");
  const [coreView, setCoreView] = useState<"map" | "grid">("grid");
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState(getInitialProjectId);
  const [project, setProject] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [trackers, setTrackers] = useState<any[]>([]);
  const [piers, setPiers] = useState<any[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [selectedTracker, setSelectedTracker] = useState<any>(null);
  const [selectedPier, setSelectedPier] = useState<any>(null);
  const [selectedPierFull, setSelectedPierFull] = useState<any>(null);
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [error, setError] = useState("");

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
    clearSelection();

    Promise.all([getProject(projectId), getBlocks(projectId), getTrackers(projectId), getPiers(projectId)])
      .then(([p, b, t, pi]: any[]) => {
        if (ignore) return;
        setProject(p);
        setBlocks(b);
        setTrackers(t);
        setPiers(pi);
      })
      .catch((e: any) => { if (!ignore) setError(String(e.message || e)); });

    const params = new URLSearchParams(window.location.search);
    params.set("project", projectId);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    return () => { ignore = true; };
  }, [projectId]);

  function clearSelection() {
    setSelectedBlock(null);
    setSelectedTracker(null);
    setSelectedPier(null);
    setSelectedPierFull(null);
  }

  async function handlePierClick(p: any) {
    if (!projectId) return;
    setSelectedPier(p);
    setSelectedTracker(trackers.find((t: any) => t.tracker_code === p.tracker_code) || null);
    setSelectedBlock(blocks.find((b: any) => b.block_code === p.block_code) || null);
    try {
      const full = await getPier(projectId, p.pier_code);
      setSelectedPierFull(full);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  const visibleTrackers = useMemo(() => {
    if (!selectedBlock) return trackers;
    return trackers.filter((t: any) => t.block_code === selectedBlock.block_code);
  }, [trackers, selectedBlock]);

  const visiblePiers = useMemo(() => {
    if (selectedTracker) return piers.filter((p: any) => p.tracker_code === selectedTracker.tracker_code);
    if (selectedBlock) return piers.filter((p: any) => p.block_code === selectedBlock.block_code);
    return piers;
  }, [piers, selectedBlock, selectedTracker]);

  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 10,
        border: "1px solid #e2e8f0",
        background: active ? "#0f172a" : "white",
        color: active ? "white" : "#0f172a",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 16px", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Solarica</h2>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          style={{ minWidth: 160, padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d5db" }}
        >
          {!projects.length && <option value="">No projects</option>}
          {projects.map((item: any) => (
            <option key={item.project_id} value={item.project_id}>{item.project_id}</option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Pill active={mode === "core" && coreView === "grid"} onClick={() => { setMode("core"); setCoreView("grid"); }}>Grid</Pill>
          <Pill active={mode === "core" && coreView === "map"} onClick={() => { setMode("core"); setCoreView("map"); }}>Map</Pill>
          <Pill active={mode === "system"} onClick={() => setMode("system")}>System</Pill>
        </div>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 8, fontSize: 13 }}>{error}</div>}

      {project?.coordinate_system?.origin_pier_id && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "#64748b" }}>
          {project.tracker_count} trackers / {project.pier_count} piers / Origin: {project.coordinate_system.origin_pier_id}
        </div>
      )}

      {mode === "system" ? (
        <SystemPanel projectId={projectId} />
      ) : coreView === "map" ? (
        /* ---- MAP VIEW ---- */
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <LayerTogglePanel
              layers={layers}
              onChange={(key: string, visible: boolean) => setLayers((prev) => prev.map((l) => l.key === key ? { ...l, visible } : l))}
              inline
            />
            {selectedBlock && (
              <span style={{ fontSize: 12, background: "#eff6ff", padding: "4px 10px", borderRadius: 8 }}>
                Block: {selectedBlock.block_code}
                <button onClick={() => { clearSelection(); }} style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>x</button>
              </span>
            )}
            {selectedTracker && (
              <span style={{ fontSize: 12, background: "#f0fdf4", padding: "4px 10px", borderRadius: 8 }}>
                Tracker: {selectedTracker.tracker_code}
                <button onClick={() => { setSelectedTracker(null); setSelectedPier(null); setSelectedPierFull(null); }} style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>x</button>
              </span>
            )}
          </div>
          <div style={{ height: "calc(100vh - 160px)", minHeight: 400, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <SiteMap
              imageWidth={project?.base_image?.width || 1}
              imageHeight={project?.base_image?.height || 1}
              blocks={blocks}
              trackers={visibleTrackers}
              piers={visiblePiers}
              selectedBlock={selectedBlock}
              selectedTracker={selectedTracker}
              selectedPier={selectedPier}
              layers={layers}
              onBlockClick={(b: any) => { setSelectedBlock(b); setSelectedTracker(null); setSelectedPier(null); setSelectedPierFull(null); }}
              onTrackerClick={(t: any) => { setSelectedTracker(t); setSelectedPier(null); setSelectedPierFull(null); }}
              onPierClick={handlePierClick}
            />
          </div>
          {selectedPierFull && (
            <div style={{ marginTop: 8 }}>
              <PierDetailsPanel selected={selectedPierFull} />
            </div>
          )}
        </div>
      ) : (
        /* ---- GRID VIEW ---- */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <SimpleGrid
              rows={blocks}
              columns={[
                { field: "block_code", pinned: "left", maxWidth: 100 },
                { field: "original_block_id", headerName: "Orig Block", maxWidth: 100 },
                { field: "block_pier_plan_sheet", headerName: "Sheet", maxWidth: 100 }
              ]}
              height={260}
              enableQuickFilter
              quickFilterPlaceholder="Search blocks..."
              onRowClick={(row: any) => { setSelectedBlock(row); setSelectedTracker(null); setSelectedPier(null); setSelectedPierFull(null); }}
            />
            <SimpleGrid
              rows={visibleTrackers}
              columns={[
                { field: "tracker_code", pinned: "left", maxWidth: 100 },
                { field: "block_code", maxWidth: 80 },
                { field: "tracker_type_code", headerName: "Type" },
                { field: "pier_count", maxWidth: 80 }
              ]}
              height={300}
              enableQuickFilter
              quickFilterPlaceholder="Search trackers..."
              onRowClick={(row: any) => { setSelectedTracker(row); setSelectedPier(null); setSelectedPierFull(null); }}
            />
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <SimpleGrid
              rows={visiblePiers}
              columns={[
                { field: "pier_code", pinned: "left", maxWidth: 120 },
                { field: "block_code", maxWidth: 80 },
                { field: "tracker_code", maxWidth: 100 },
                { field: "row_index", maxWidth: 60 },
                { field: "pier_type", maxWidth: 90 }
              ]}
              height={360}
              enableQuickFilter
              quickFilterPlaceholder="Search piers..."
              pagination
              pageSize={200}
              getRowId={(p: any) => p.data?.pier_code}
              onRowClick={handlePierClick}
            />
            <PierDetailsPanel selected={selectedPierFull} />
          </div>
        </div>
      )}
    </div>
  );
}
