import { useEffect, useMemo, useRef, useState } from "react";

const COLORS = {
  HAP: "#0ea5e9",
  HMP: "#06b6d4",
  SAP: "#7c3aed",
  SAPE: "#f97316",
  SAPEND: "#ef4444",
  SMP: "#10b981",
  UNKNOWN: "#64748b"
};

function colorForType(t) {
  const key = (t || "").toUpperCase();
  return COLORS[key] || COLORS.UNKNOWN;
}

export default function SystemMapCanvas({ piers, selectedPierId, onPickPier, height = 520 }: any) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: height });

  const drawable = useMemo(() => {
    const pts = [];
    for (const p of piers || []) {
      const xr = p.x_rel;
      const yr = p.y_rel;
      if (typeof xr !== "number" || typeof yr !== "number") continue;
      pts.push({
        id: p.pier_id,
        x: xr,
        y: yr,
        pier_type: p.pier_type || ""
      });
    }
    return pts;
  }, [piers]);

  useEffect(() => {
    if (!hostRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(240, Math.floor(r.height)) });
    });
    ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.floor(size.w * dpr);
    c.height = Math.floor(size.h * dpr);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, size.w, size.h);

    // subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= size.w; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    for (let y = 0; y <= size.h; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }

    // points
    for (const p of drawable) {
      const px = p.x * size.w;
      const py = p.y * size.h;
      ctx.fillStyle = colorForType(p.pier_type);
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // selection
    if (selectedPierId) {
      const sel = drawable.find((p) => p.id === selectedPierId);
      if (sel) {
        const px = sel.x * size.w;
        const py = sel.y * size.h;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [drawable, selectedPierId, size]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !onPickPier) return;
    const handler = (e) => {
      const rect = c.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      let best = null;
      let bestD2 = 1e9;
      for (const p of drawable) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p;
        }
      }
      if (best && bestD2 < 0.00012) onPickPier(best.id);
    };
    c.addEventListener("click", handler);
    return () => c.removeEventListener("click", handler);
  }, [drawable, onPickPier]);

  return (
    <div ref={hostRef} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(15,23,42,0.25)", height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
