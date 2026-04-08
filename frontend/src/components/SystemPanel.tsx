import { useEffect, useMemo, useState } from "react";
import SimpleGrid from "./SimpleGrid";
import SystemMapCanvas from "./SystemMapCanvas";
import {
  ensureSystem,
  exportSystemExcel,
  getSystemMeta,
  getSystemPierTypeCounts,
  getSystemPierTypeLegend,
  getSystemPiers,
  getSystemTrackers
} from "../api";

export default function SystemPanel({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState(null);
  const [counts, setCounts] = useState([]);
  const [legend, setLegend] = useState([]);
  const [trackers, setTrackers] = useState([]);
  const [pierType, setPierType] = useState("");
  const [selectedTracker, setSelectedTracker] = useState(null);
  const [piersResp, setPiersResp] = useState({ total: 0, items: [] });
  const [selectedPierId, setSelectedPierId] = useState("");
  const [excelUrl, setExcelUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const legendByType = useMemo(() => {
    const m = new Map();
    for (const row of legend || []) m.set(row.pier_type, row);
    return m;
  }, [legend]);

  useEffect(() => {
    if (!projectId) return;
    setStatus(null);
    setError("");
    setMeta(null);
    setCounts([]);
    setLegend([]);
    setTrackers([]);
    setPierType("");
    setSelectedTracker(null);
    setPiersResp({ total: 0, items: [] });
    setSelectedPierId("");
    setExcelUrl("");
  }, [projectId]);

  async function handleEnsure(force = false) {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const res = await ensureSystem(projectId, { force });
      setStatus(res);
      const [m, c, l, t] = await Promise.all([
        getSystemMeta(projectId),
        getSystemPierTypeCounts(projectId),
        getSystemPierTypeLegend(projectId),
        getSystemTrackers(projectId)
      ]);
      setMeta(m);
      setCounts(c);
      setLegend(l);
      setTrackers(t);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshPiers(next) {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const resp = await getSystemPiers(projectId, next);
      setPiersResp(resp);
      setSelectedPierId("");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleExport(force = false) {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const res = await exportSystemExcel(projectId, { force });
      setExcelUrl(res.url);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  const selectedLegend = pierType ? legendByType.get(pierType) : null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => handleEnsure(false)} disabled={loading} style={{ padding: "8px 10px" }}>
          Ensure System Cache
        </button>
        <button onClick={() => handleEnsure(true)} disabled={loading} style={{ padding: "8px 10px" }}>
          Force Rebuild
        </button>
        <button onClick={() => handleExport(false)} disabled={loading} style={{ padding: "8px 10px" }}>
          Export Excel
        </button>
        {excelUrl && <a href={excelUrl} target="_blank" rel="noreferrer">Download xlsx</a>}
        {status?.vector_json && <span style={{ fontSize: 12, color: "#475569" }}>vector: {status.vector_json}</span>}
      </div>

      {error && <div style={{ color: "#b00020" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr 420px", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Pier Type Counts</div>
            <SimpleGrid
              rows={counts}
              columns={[
                { field: "pier_type", pinned: "left" },
                { field: "count" }
              ]}
              height={210}
              enableQuickFilter
              quickFilterPlaceholder="Search type..."
              onRowClick={(r) => {
                setPierType(r.pier_type);
                setSelectedTracker(null);
                refreshPiers({ pier_type: r.pier_type, limit: 5000, offset: 0 });
              }}
            />
            <div style={{ marginTop: 10, fontSize: 12, color: "#334155", lineHeight: 1.4 }}>
              {pierType ? (
                <>
                  <div><b>{pierType}</b> {selectedLegend?.pier_type_name ? `- ${selectedLegend.pier_type_name}` : ""}</div>
                  {selectedLegend?.details_raw ? <div style={{ opacity: 0.85 }}>{selectedLegend.details_raw}</div> : null}
                </>
              ) : (
                <div style={{ opacity: 0.8 }}>Click a type to filter piers and map</div>
              )}
            </div>
          </div>

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>System Trackers (ROW/TRK)</div>
            <SimpleGrid
              rows={trackers}
              columns={[
                { field: "block", headerName: "Block" },
                { field: "row", headerName: "Row" },
                { field: "tracker", headerName: "Trk" },
                { field: "total_piers", headerName: "Total" }
              ]}
              height={330}
              enableQuickFilter
              quickFilterPlaceholder="Search block/row/trk..."
              onRowClick={(r) => {
                setSelectedTracker(r);
                setPierType("");
                refreshPiers({ block: r.block, row: r.row, tracker: r.tracker, limit: 5000, offset: 0 });
              }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>System Map</div>
            {meta?.pier_count != null && <div style={{ fontSize: 12, color: "#475569" }}>piers: {meta.pier_count}</div>}
            {piersResp?.total != null && <div style={{ fontSize: 12, color: "#475569" }}>shown: {piersResp.total}</div>}
            {(selectedTracker || pierType) && (
              <button
                onClick={() => {
                  setSelectedTracker(null);
                  setPierType("");
                  setPiersResp({ total: 0, items: [] });
                  setSelectedPierId("");
                }}
                style={{ marginLeft: "auto", padding: "6px 10px" }}
              >
                Clear Filter
              </button>
            )}
          </div>

          <SystemMapCanvas
            piers={piersResp.items}
            selectedPierId={selectedPierId}
            onPickPier={(id) => setSelectedPierId(id)}
            height={560}
          />
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Filtered Piers</div>
            <SimpleGrid
              rows={piersResp.items}
              columns={[
                { field: "pier_id", pinned: "left" },
                { field: "block" },
                { field: "row" },
                { field: "tracker" },
                { field: "pier_label", headerName: "Label" },
                { field: "pier_type", headerName: "Type" }
              ]}
              height={560}
              enableQuickFilter
              quickFilterPlaceholder="Search pier id / type..."
              pagination
              pageSize={200}
              getRowId={(p) => p.data?.pier_id}
              onRowClick={(r) => setSelectedPierId(r.pier_id)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
