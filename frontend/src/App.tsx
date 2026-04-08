import { useEffect, useMemo, useState } from "react";
import { getProjects, getProject, getBlocks, getTrackers, getPiers, getPier, getZoomTarget } from "./api";
import SimpleGrid from "./components/SimpleGrid";
import LayerTogglePanel from "./components/LayerTogglePanel";
import EngineeringViewer from "./components/EngineeringViewer";
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
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(getInitialProjectId);
  const [project, setProject] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [trackers, setTrackers] = useState([]);
  const [piers, setPiers] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [selectedTracker, setSelectedTracker] = useState(null);
  const [selectedPier, setSelectedPier] = useState(null);
  const [selectedPierFull, setSelectedPierFull] = useState(null);
  const [zoomTarget, setZoomTarget] = useState(null);
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    getProjects()
      .then((items) => {
        if (ignore) return;
        setProjects(items);
        if (!items.some((item) => item.project_id === projectId) && items.length > 0) {
          setProjectId(items[0].project_id);
        }
      })
      .catch((e) => {
        if (!ignore) setError(String(e.message || e));
      });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let ignore = false;
    setError("");
    setProject(null);
    setBlocks([]);
    setTrackers([]);
    setPiers([]);
    setSelectedBlock(null);
    setSelectedTracker(null);
    setSelectedPier(null);
    setSelectedPierFull(null);
    setZoomTarget(null);

    Promise.all([getProject(projectId), getBlocks(projectId), getTrackers(projectId), getPiers(projectId)])
      .then(([p, b, t, pi]) => {
        if (ignore) return;
        setProject(p);
        setBlocks(b);
        setTrackers(t);
        setPiers(pi);
      })
      .catch((e) => {
        if (!ignore) setError(String(e.message || e));
      });

    const params = new URLSearchParams(window.location.search);
    params.set("project", projectId);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);

    return () => {
      ignore = true;
    };
  }, [projectId]);

  async function handlePierClick(p: any) {
    if (!projectId) return;
    setSelectedPier(p);
    setSelectedTracker(trackers.find((t) => t.tracker_code === p.tracker_code) || null);
    setSelectedBlock(blocks.find((b) => b.block_code === p.block_code) || null);
    try {
      const [full, zoom] = await Promise.all([getPier(projectId, p.pier_code), getZoomTarget(projectId, p.pier_code)]);
      setSelectedPierFull(full);
      setZoomTarget(zoom);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  const visibleTrackers = useMemo(() => {
    if (!selectedBlock) return trackers;
    return trackers.filter((t) => t.block_code === selectedBlock.block_code);
  }, [trackers, selectedBlock]);

  const visiblePiers = useMemo(() => {
    if (selectedTracker) return piers.filter((p) => p.tracker_code === selectedTracker.tracker_code);
    if (selectedBlock) return piers.filter((p) => p.block_code === selectedBlock.block_code);
    return piers;
  }, [piers, selectedBlock, selectedTracker]);

  const imageUrl = projectId ? `/projects/${projectId}/base_site.png` : "";

  return (
    <div style={{ maxWidth: 1900, margin: "0 auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h2>Solarica</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label>
          <span style={{ marginRight: 8 }}>Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ minWidth: 220 }}>
            {!projects.length && <option value="">No projects found</option>}
            {projects.map((item) => (
              <option key={item.project_id} value={item.project_id}>
                {item.project_id}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 13, color: "#555" }}>
          Profile: {project?.site_profile || "loading"}
          {project?.detected_site_profile ? ` (detected ${project.detected_site_profile})` : ""}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>Mode</span>
          <button
            onClick={() => setMode("core")}
            style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: mode === "core" ? "#0f172a" : "white", color: mode === "core" ? "white" : "#0f172a" }}
          >
            Core
          </button>
          <button
            onClick={() => setMode("system")}
            style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: mode === "system" ? "#0f172a" : "white", color: mode === "system" ? "white" : "#0f172a" }}
          >
            System (vector)
          </button>
        </div>
      </div>
      {project?.coordinate_system?.origin_pier_id && (
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          Origin: {project.coordinate_system.origin_pier_id}
        </div>
      )}
      {error && <div style={{ color: "#b00020", marginBottom: 12 }}>{error}</div>}

      {mode === "system" ? (
        <SystemPanel projectId={projectId} />
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 420px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <LayerTogglePanel
            layers={layers}
            onChange={(key, visible) => setLayers((prev) => prev.map((l) => l.key === key ? { ...l, visible } : l))}
          />
          <SimpleGrid
            rows={blocks}
            columns={[
              { field: "block_code", pinned: "left" },
              { field: "original_block_id", headerName: "Orig Block" },
              { field: "block_pier_plan_sheet", headerName: "Sheet" }
            ]}
            height={220}
            enableQuickFilter
            quickFilterPlaceholder="Search blocks..."
            onRowClick={(row) => {
              setSelectedBlock(row);
              setSelectedTracker(null);
              setSelectedPier(null);
              setSelectedPierFull(null);
              setZoomTarget(null);
            }}
          />
          <SimpleGrid
            rows={visibleTrackers}
            columns={[
              { field: "tracker_code", pinned: "left" },
              { field: "block_code" },
              { field: "tracker_type_code", headerName: "Tracker Type" },
              { field: "pier_count" }
            ]}
            height={260}
            enableQuickFilter
            quickFilterPlaceholder="Search trackers..."
            onRowClick={(row) => {
              setSelectedTracker(row);
              setSelectedPier(null);
              setSelectedPierFull(null);
              setZoomTarget(null);
            }}
          />
        </div>

        <EngineeringViewer
          imageUrl={imageUrl}
          imageWidth={project?.base_image?.width}
          imageHeight={project?.base_image?.height}
          blocks={blocks}
          trackers={visibleTrackers}
          piers={visiblePiers}
          selectedBlock={selectedBlock}
          selectedTracker={selectedTracker}
          selectedPier={selectedPier}
          layers={layers}
          onBlockClick={(b) => {
            setSelectedBlock(b);
            setSelectedTracker(null);
            setSelectedPier(null);
            setSelectedPierFull(null);
            setZoomTarget(null);
          }}
          onTrackerClick={(t) => {
            setSelectedTracker(t);
            setSelectedPier(null);
            setSelectedPierFull(null);
            setZoomTarget(null);
          }}
          onPierClick={handlePierClick}
          zoomTarget={zoomTarget}
        />

        <div style={{ display: "grid", gap: 16 }}>
          <SimpleGrid
            rows={visiblePiers}
            columns={[
              { field: "pier_code", pinned: "left" },
              { field: "block_code" },
              { field: "tracker_code" },
              { field: "row_index" },
              { field: "pier_type" }
            ]}
            height={320}
            enableQuickFilter
            quickFilterPlaceholder="Search piers..."
            pagination
            pageSize={200}
            getRowId={(p) => p.data?.pier_code}
            onRowClick={handlePierClick}
          />
          <PierDetailsPanel selected={selectedPierFull} />
        </div>
      </div>
      )}
    </div>
  );
}
