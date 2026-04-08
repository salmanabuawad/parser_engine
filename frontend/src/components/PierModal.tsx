const PIER_COLORS: Record<string, string> = {
  HAP: "#ff0000",
  HMP: "#ff0000",
  SAP: "#00ffff",
  SAPE: "#0000ff",
  SAPEND: "#ff8c00",
  SMP: "#00ff00",
};

export default function PierModal({ selected, onClose }: { selected: any; onClose: () => void }) {
  if (!selected?.pier) return null;
  const { pier, tracker, block, drawing_bundle } = selected;
  const color = PIER_COLORS[pier.pier_type] || "#888";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: "20px 24px",
          minWidth: 300,
          maxWidth: 420,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 14,
            background: "none",
            border: "none",
            fontSize: 20,
            cursor: "pointer",
            color: "#64748b",
          }}
        >
          x
        </button>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: color, display: "inline-block", border: "2px solid #fff", boxShadow: "0 0 0 1px #ccc" }} />
          <h3 style={{ margin: 0, fontSize: 18 }}>{pier.pier_code}</h3>
          <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 6 }}>{pier.pier_type}</span>
        </div>

        {/* Details grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 13 }}>
          <Field label="Block" value={block?.block_code ?? pier.block_code} />
          <Field label="Tracker" value={tracker?.tracker_code ?? pier.tracker_code} />
          <Field label="Row index" value={pier.row_index} />
          <Field label="Tracker type" value={pier.tracker_type_code} />
          <Field label="Structure" value={pier.structure_code} />
          <Field label="Slope" value={pier.slope_band} />
          <Field label="Tracker sheet" value={pier.tracker_sheet} />
          <Field label="Pier sheet" value={pier.pier_type_sheet} />
        </div>

        {drawing_bundle && (
          <>
            <div style={{ marginTop: 12, marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#334155" }}>Drawing bundle</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 13 }}>
              <Field label="Block plan" value={drawing_bundle.block_pier_plan?.sheet_no} />
              <Field label="Tracker typical" value={drawing_bundle.tracker_typical?.sheet_no} />
              <Field label="Tolerances" value={drawing_bundle.pier_tolerances?.sheet_no} />
              <Field label="Slope detail" value={drawing_bundle.slope_detail?.sheet_no} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span style={{ color: "#64748b" }}>{label}: </span>
      <span style={{ fontWeight: 500 }}>{value ?? "—"}</span>
    </div>
  );
}
