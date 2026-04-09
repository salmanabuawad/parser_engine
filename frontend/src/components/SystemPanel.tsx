import { useEffect, useState } from "react";
import {
  getProject,
  getPlantInfo,
  updatePlantInfo,
  createProject,
  listProjectFiles,
  uploadProjectFile,
  clearProjectFiles,
  parseProject,
} from "../api";
import { useResponsive } from "../hooks/useResponsive";

interface Props {
  projectId: string;
  onProjectChanged?: (projectId: string) => void;
}

export default function SystemPanel({ projectId, onProjectChanged }: Props) {
  const { isMobile } = useResponsive();
  const [error, setError] = useState("");
  const [project, setProject] = useState<any>(null);
  const [plantInfo, setPlantInfo] = useState<any>(null);
  const [editingPlant, setEditingPlant] = useState(false);
  const [plantDraft, setPlantDraft] = useState<any>({});
  const [files, setFiles] = useState<any[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");

  async function refreshAll() {
    if (!projectId) return;
    try {
      const [proj, pi, fl] = await Promise.all([
        getProject(projectId).catch(() => null),
        getPlantInfo(projectId).catch(() => ({})),
        listProjectFiles(projectId).catch(() => []),
      ]);
      setProject(proj);
      setPlantInfo(pi);
      setFiles(fl);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  useEffect(() => {
    setError("");
    setParseMsg("");
    setProject(null);
    setPlantInfo(null);
    setFiles([]);
    setEditingPlant(false);
    if (projectId) refreshAll();
  }, [projectId]);

  async function handleCreateProject() {
    const id = newProjectId.trim();
    if (!id) return;
    try {
      await createProject({ project_id: id });
      setShowNewProject(false);
      setNewProjectId("");
      onProjectChanged?.(id);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  async function handleFileUpload(kind: string, file: File) {
    if (!projectId || !file) return;
    try {
      setParseMsg(`Uploading ${file.name}...`);
      await uploadProjectFile(projectId, kind, file);
      const fl = await listProjectFiles(projectId);
      setFiles(fl);
      setParseMsg(`Uploaded ${file.name}`);
      setTimeout(() => setParseMsg(""), 2000);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  async function handleClearFiles() {
    if (!projectId) return;
    if (!confirm("Delete all uploaded files for this project? (Parsed data will not be affected until you re-parse)")) return;
    try {
      await clearProjectFiles(projectId);
      setFiles([]);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  async function handleParse() {
    if (!projectId) return;
    if (!confirm("Parse will clear all existing project data and rebuild from uploaded files. Continue?")) return;
    try {
      setParsing(true);
      setParseMsg("Parsing... this may take a minute or two");
      const result = await parseProject(projectId);
      setParseMsg(`Parsed: ${result.block_count} blocks, ${result.tracker_count} trackers, ${result.pier_count} piers`);
      await refreshAll();
      onProjectChanged?.(projectId);
    } catch (e: any) {
      setError(String(e.message || e));
      setParseMsg("");
    } finally {
      setParsing(false);
    }
  }

  async function handlePlantSave() {
    if (!projectId) return;
    try {
      const toSave = { ...plantDraft };
      if (toSave.tolerance_ratio != null && toSave.tolerance_ratio !== "") {
        const n = parseFloat(toSave.tolerance_ratio);
        toSave.tolerance_ratio = isNaN(n) ? 0.05 : n;
      }
      const updated = await updatePlantInfo(projectId, toSave);
      setPlantInfo(updated);
      setEditingPlant(false);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* New Project + Files */}
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: isMobile ? 12 : 16, background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Project Files</div>
          <button
            onClick={() => setShowNewProject(true)}
            style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
          >
            + New Project
          </button>
        </div>
        {showNewProject && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <input
              value={newProjectId}
              onChange={(e) => setNewProjectId(e.target.value)}
              placeholder="project_id (e.g. ashalim4)"
              style={{ flex: 1, minWidth: 180, padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
            />
            <button onClick={handleCreateProject} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "none", background: "#0f172a", color: "#fff", cursor: "pointer" }}>Create</button>
            <button onClick={() => { setShowNewProject(false); setNewProjectId(""); }} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>Cancel</button>
          </div>
        )}
        {projectId ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <FileUploadField label="Construction PDF" kind="construction_pdf" files={files} onUpload={handleFileUpload} />
              <FileUploadField label="Ramming PDF" kind="ramming_pdf" files={files} onUpload={handleFileUpload} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={handleParse}
                disabled={parsing || files.length < 2}
                style={{
                  fontSize: 13, padding: "8px 16px", borderRadius: 6, border: "none",
                  background: parsing || files.length < 2 ? "#cbd5e1" : "#0f172a",
                  color: "#fff", fontWeight: 600,
                  cursor: parsing || files.length < 2 ? "not-allowed" : "pointer",
                }}
              >
                {parsing ? "Parsing..." : "Parse"}
              </button>
              {files.length > 0 && (
                <button onClick={handleClearFiles} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
                  Clear Files
                </button>
              )}
              {parseMsg && <span style={{ fontSize: 12, color: "#475569" }}>{parseMsg}</span>}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: "#64748b" }}>Select or create a project to upload files.</div>
        )}
      </div>

      {/* Project Metadata Card */}
      {project && (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: isMobile ? 12 : 16, background: "#f8fafc" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Project Info</div>
            <span style={{ fontSize: 12, color: "#64748b", background: "#e2e8f0", padding: "2px 8px", borderRadius: 6 }}>{projectId}</span>
          </div>
          <SectionTitle>Site</SectionTitle>
          <MetaGrid isMobile={isMobile}>
            <MetaField label="Project" value={projectId} />
            <MetaField label="Project #" value={plantInfo?.project_number} />
            <MetaField label="Site ID" value={plantInfo?.site_id} />
            <MetaField label="Lat / Long" value={plantInfo?.lat_long} />
            <MetaField label="Wind Load" value={plantInfo?.wind_load} />
            <MetaField label="Snow Load" value={plantInfo?.snow_load} />
            <MetaField label="Issue Date" value={plantInfo?.issue_date} />
            <MetaField label="Nextracker" value={plantInfo?.nextracker_model} />
          </MetaGrid>

          <SectionTitle>Structure</SectionTitle>
          <MetaGrid isMobile={isMobile}>
            <MetaField label="Piers" value={project.pier_count?.toLocaleString()} />
            <MetaField label="Trackers" value={project.tracker_count?.toLocaleString()} />
            <MetaField label="Blocks" value={project.block_count} />
            <MetaField label="Rows" value={project.row_count} />
          </MetaGrid>

          <SectionTitle>Electrical</SectionTitle>
          <MetaGrid isMobile={isMobile}>
            <MetaField label="Total Output (MW)" value={plantInfo?.total_output_mw} />
            <MetaField label="Inverters" value={plantInfo?.inverters} />
            <MetaField label="DCCB" value={plantInfo?.dccb?.toLocaleString?.() ?? plantInfo?.dccb} />
            <MetaField label="String Groups" value={plantInfo?.string_groups} />
            <MetaField label="Total Strings" value={plantInfo?.total_strings?.toLocaleString?.() ?? plantInfo?.total_strings} />
            <MetaField label="Total Modules" value={plantInfo?.total_modules?.toLocaleString?.() ?? plantInfo?.total_modules} />
            <MetaField label="Modules / String" value={plantInfo?.modules_per_string} />
            <MetaField label="Devices" value={plantInfo?.devices} />
          </MetaGrid>

          <SectionTitle>Module</SectionTitle>
          <MetaGrid isMobile={isMobile}>
            <MetaField label="Module Power (W)" value={plantInfo?.module_capacity_w} />
            <MetaField label="Length (m)" value={plantInfo?.module_length_m} />
            <MetaField label="Width (m)" value={plantInfo?.module_width_m} />
            <MetaField label="Pitch (m)" value={plantInfo?.pitch_m} />
          </MetaGrid>
          <SectionTitle>Validation</SectionTitle>
          <MetaGrid isMobile={isMobile}>
            <ValidationField
              label="Trackers"
              actual={project.tracker_count}
              expected={plantInfo?.expected_trackers}
              tolerance={plantInfo?.tolerance_ratio ?? 0.05}
            />
            <ValidationField
              label="Piers"
              actual={project.pier_count}
              expected={plantInfo?.expected_piers}
              tolerance={plantInfo?.tolerance_ratio ?? 0.05}
            />
            <ValidationField
              label="Modules (BoM)"
              actual={plantInfo?.total_modules}
              expected={plantInfo?.expected_modules_from_bom}
              tolerance={plantInfo?.tolerance_ratio ?? 0.05}
            />
            <MetaField label="Tolerance" value={`±${Math.round((plantInfo?.tolerance_ratio ?? 0.05) * 100)}%`} />
          </MetaGrid>

          {plantInfo?.notes && <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>{plantInfo.notes}</div>}
          <div style={{ marginTop: 10 }}>
            {!editingPlant ? (
              <button onClick={() => { setPlantDraft({ ...plantInfo }); setEditingPlant(true); }} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
                Edit Plant Info
              </button>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 8 }}>
                <PlantInput label="Total Output (MW)" field="total_output_mw" draft={plantDraft} setDraft={setPlantDraft} />
                <PlantInput label="Total Strings" field="total_strings" draft={plantDraft} setDraft={setPlantDraft} />
                <PlantInput label="Total Modules" field="total_modules" draft={plantDraft} setDraft={setPlantDraft} />
                <PlantInput label="Inverters" field="inverters" draft={plantDraft} setDraft={setPlantDraft} />
                <PlantInput label="DCCB" field="dccb" draft={plantDraft} setDraft={setPlantDraft} />
                <PlantInput label="Devices" field="devices" draft={plantDraft} setDraft={setPlantDraft} />
                <PlantInput label="Tolerance (0-1)" field="tolerance_ratio" draft={plantDraft} setDraft={setPlantDraft} />
                <div style={{ gridColumn: isMobile ? undefined : "1 / -1" }}>
                  <PlantInput label="Notes" field="notes" draft={plantDraft} setDraft={setPlantDraft} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={handlePlantSave} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "none", background: "#0f172a", color: "#fff", cursor: "pointer" }}>Save</button>
                  <button onClick={() => setEditingPlant(false)} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ color: "#b00020" }}>{error}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6, borderBottom: "1px solid #e2e8f0", paddingBottom: 3 }}>
      {children}
    </div>
  );
}

function MetaGrid({ children, isMobile }: { children: React.ReactNode; isMobile: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? "8px 12px" : "8px 20px", fontSize: 13 }}>
      {children}
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{value ?? "-"}</div>
    </div>
  );
}

function ValidationField({ label, actual, expected, tolerance }: { label: string; actual: any; expected: any; tolerance: number }) {
  const hasBoth = typeof actual === "number" && typeof expected === "number" && expected > 0;
  let status: "pass" | "fail" | "unknown" = "unknown";
  let diffPct = 0;
  if (hasBoth) {
    diffPct = (actual - expected) / expected;
    status = Math.abs(diffPct) <= tolerance ? "pass" : "fail";
  }
  const color = status === "pass" ? "#16a34a" : status === "fail" ? "#dc2626" : "#94a3b8";
  const icon = status === "pass" ? "✓" : status === "fail" ? "⚠" : "—";
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {actual?.toLocaleString?.() ?? actual ?? "-"}
          {hasBoth && <span style={{ color: "#64748b", fontWeight: 400 }}> / {expected.toLocaleString()}</span>}
        </span>
      </div>
      {hasBoth && (
        <div style={{ fontSize: 10, color, marginTop: 1 }}>
          {diffPct >= 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function FileUploadField({ label, kind, files, onUpload }: { label: string; kind: string; files: any[]; onUpload: (kind: string, file: File) => void }) {
  const existing = files.filter((f) => f.kind === kind);
  return (
    <div style={{ border: "1px dashed #cbd5e1", borderRadius: 8, padding: 10, background: "#f8fafc" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {existing.length > 0 && (
        <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>
          {existing.map((f) => (
            <div key={f.id}>✓ {f.original_name || f.filename} ({(f.size_bytes / (1024 * 1024)).toFixed(1)} MB)</div>
          ))}
        </div>
      )}
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onUpload(kind, f);
            e.target.value = "";
          }
        }}
        style={{ fontSize: 12 }}
      />
    </div>
  );
}

function PlantInput({ label, field, draft, setDraft }: { label: string; field: string; draft: any; setDraft: (d: any) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <input
        value={draft[field] ?? ""}
        onChange={(e) => setDraft({ ...draft, [field]: e.target.value || null })}
        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box" }}
      />
    </div>
  );
}
