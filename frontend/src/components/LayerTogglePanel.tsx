export default function LayerTogglePanel({ layers, onChange }: any) {
  return (
    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, background: "#fff" }}>
      <h4 style={{ marginTop: 0 }}>Layers</h4>
      {layers.map((l) => (
        <label key={l.key} style={{ display: "block", marginBottom: 8 }}>
          <input type="checkbox" checked={l.visible} onChange={(e) => onChange(l.key, e.target.checked)} style={{ marginRight: 8 }} />
          {l.label}
        </label>
      ))}
    </div>
  );
}
