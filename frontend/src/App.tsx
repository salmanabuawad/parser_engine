import { useEffect, useMemo, useState } from "react";
import { getProjects, getProject, getBlocks, getTrackers, getPiers, getPier } from "./api";
import SimpleGrid from "./components/SimpleGrid";
import LayerTogglePanel from "./components/LayerTogglePanel";
import SiteMap from "./components/SiteMap";
import PierDetailsPanel from "./components/PierDetailsPanel";
import PierModal from "./components/PierModal";
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
  const [mode, setMode] = useState<"grid" | "map" | "system">("grid");
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
    setSelectedPier(null);
    setSelectedPierFull(null);
    setFilterBlock("");
    setFilterTracker("");

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
          <Pill active={mode === "grid"} onClick={() => setMode("grid")}>Grid</Pill>
          <Pill active={mode === "map"} onClick={() => setMode("map")}>Map</Pill>
          <Pill active={mode === "system"} onClick={() => setMode("system")}>System</Pill>
        </div>
      </div>

      {error && <div style={{ color: "#b00020", marginBottom: 8, fontSize: 13 }}>{error}</div>}

      {project && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "#64748b" }}>
          {project.block_count} blocks / {project.tracker_count} trackers / {project.pier_count} piers
        </div>
      )}

      {mode === "system" ? (
        <SystemPanel projectId={projectId} />
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
          <div style={{ height: "calc(100vh - 160px)", minHeight: 400, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <SiteMap
              imageWidth={project?.base_image?.width || 1}
              imageHeight={project?.base_image?.height || 1}
              blocks={blocks}
              trackers={filteredTrackers}
              piers={filteredPiers}
              selectedBlock={filterBlock ? blocks.find((b: any) => b.block_code === filterBlock) : null}
              selectedTracker={filterTracker ? trackers.find((t: any) => t.tracker_code === filterTracker) : null}
              selectedPier={selectedPier}
              layers={layers}
              onBlockClick={(b: any) => { setFilterBlock(b.block_code); setFilterTracker(""); }}
              onTrackerClick={(t: any) => { setFilterTracker(t.tracker_code); }}
              onPierClick={handlePierClick}
            />
          </div>
          {selectedPierFull && (
            <PierModal selected={selectedPierFull} onClose={() => { setSelectedPier(null); setSelectedPierFull(null); }} />
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
            rows={filteredPiers}
            columns={[
              { field: "pier_code", headerName: "Pier", pinned: "left", maxWidth: 120 },
              { field: "block_code", headerName: "Block", maxWidth: 80 },
              { field: "tracker_code", headerName: "Tracker", maxWidth: 100 },
              { field: "row_index", headerName: "Row", maxWidth: 60 },
              { field: "pier_type", headerName: "Pier Type", maxWidth: 100 },
              { field: "structure_code", headerName: "Structure", maxWidth: 100 },
              { field: "slope_band", headerName: "Slope", maxWidth: 90 },
              { field: "tracker_type_code", headerName: "Tracker Type" },
              { field: "x", headerName: "X", maxWidth: 80, valueFormatter: (p: any) => p.value?.toFixed(1) },
              { field: "y", headerName: "Y", maxWidth: 80, valueFormatter: (p: any) => p.value?.toFixed(1) },
            ]}
            height={Math.min(700, Math.max(400, window.innerHeight - 200))}
            enableQuickFilter
            quickFilterPlaceholder="Search piers..."
            pagination
            pageSize={100}
            getRowId={(p: any) => p.data?.pier_code}
            onRowClick={handlePierClick}
          />

          {selectedPierFull && (
            <PierModal selected={selectedPierFull} onClose={() => { setSelectedPier(null); setSelectedPierFull(null); }} />
          )}
        </div>
      )}
    </div>
  );
}
