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
          minWidth: 320,
          maxWidth: 460,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          position: "relative",
          maxHeight: "90vh",
          overflow: "auto",
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: color, display: "inline-block", border: "2px solid #fff", boxShadow: "0 0 0 1px #ccc" }} />
          <h3 style={{ margin: 0, fontSize: 18 }}>{pier.pier_code}</h3>
          <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 6 }}>{pier.pier_type}</span>
        </div>

        {/* Pier details */}
        <Section title="Pier">
          <Field label="Pier code" value={pier.pier_code} />
          <Field label="Pier type" value={pier.pier_type} />
          <Field label="Structure" value={pier.structure_code} />
          <Field label="Row index" value={pier.row_index} />
          <Field label="Slope band" value={pier.slope_band} />
          <Field label="Pier sheet" value={pier.pier_type_sheet} />
          <Field label="Slope sheet" value={pier.slope_sheet} />
        </Section>

        {/* Tracker details */}
        <Section title="Tracker">
          <Field label="Tracker" value={tracker?.tracker_code ?? pier.tracker_code} />
          <Field label="Type" value={tracker?.tracker_type_code ?? pier.tracker_type_code} />
          <Field label="Row" value={tracker?.row} />
          <Field label="TRK" value={tracker?.trk} />
          <Field label="Pier count" value={tracker?.pier_count} />
          <Field label="Tracker sheet" value={tracker?.tracker_sheet ?? pier.tracker_sheet} />
        </Section>

        {/* Block details */}
        <Section title="Block">
          <Field label="Block" value={block?.block_code ?? pier.block_code} />
          <Field label="Block plan sheet" value={block?.block_pier_plan_sheet} />
        </Section>

        {/* Drawing bundle */}
        {drawing_bundle && (
          <Section title="Drawing bundle">
            <Field label="Block plan" value={drawing_bundle.block_pier_plan?.sheet_no} />
            <Field label="Tracker typical" value={drawing_bundle.tracker_typical?.sheet_no} />
            <Field label="Tolerances" value={drawing_bundle.pier_tolerances?.sheet_no} />
            <Field label="Slope detail" value={drawing_bundle.slope_detail?.sheet_no} />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4, borderBottom: "1px solid #e2e8f0", paddingBottom: 3 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 13 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <span style={{ color: "#64748b" }}>{label}: </span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
