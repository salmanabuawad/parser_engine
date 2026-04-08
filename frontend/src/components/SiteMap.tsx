import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Lightweight canvas-based site map.
 * No OpenSeadragon — works on iPad / smartphones.
 * Supports pinch-zoom, scroll-zoom, pan, and tap-to-select.
 */

const PIER_COLORS: Record<string, string> = {
  HAP: "#ff0000",
  HMP: "#ff0000",
  SAP: "#00ffff",
  SAPE: "#0000ff",
  SAPEND: "#ff8c00",
  SMP: "#00ff00",
  UNKNOWN: "#64748b",
};

const PIER_RADIUS = 3;
const SELECTED_RADIUS = 6;

interface Props {
  imageWidth: number;
  imageHeight: number;
  blocks: any[];
  trackers: any[];
  piers: any[];
  selectedBlock: any;
  selectedTracker: any;
  selectedPier: any;
  layers: { key: string; visible: boolean }[];
  onBlockClick: (b: any) => void;
  onTrackerClick: (t: any) => void;
  onPierClick: (p: any) => void;
}

export default function SiteMap({
  imageWidth,
  imageHeight,
  blocks,
  trackers,
  piers,
  selectedBlock,
  selectedTracker,
  selectedPier,
  layers,
  onBlockClick,
  onTrackerClick,
  onPierClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  const layerVisible = useCallback(
    (key: string) => layers.find((l) => l.key === key)?.visible ?? true,
    [layers]
  );

  // Compute actual data bounds (in rotated canvas space)
  const dataBounds = useMemo(() => {
    if (!piers.length && !blocks.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of piers) {
      // Apply rotation: 90° CCW → (y, W-x)
      const rx = p.y;
      const ry = imageWidth - p.x;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const pad = 20;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [piers, blocks, imageWidth]);

  // Fit to data bounds
  function fitToData() {
    if (!containerRef.current || !dataBounds) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const dw = dataBounds.maxX - dataBounds.minX;
    const dh = dataBounds.maxY - dataBounds.minY;
    if (dw <= 0 || dh <= 0) return;
    const scale = Math.min(cw / dw, ch / dh) * 0.92;
    setView({
      x: (cw - dw * scale) / 2 - dataBounds.minX * scale,
      y: (ch - dh * scale) / 2 - dataBounds.minY * scale,
      scale,
    });
  }

  useEffect(() => {
    fitToData();
  }, [dataBounds]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    const { x: ox, y: oy, scale: s } = view;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Rotate 90° counter-clockwise: (x,y) → (y, W-x)
    const mapPt = (ix: number, iy: number): [number, number] => [
      ox + iy * s,
      oy + (imageWidth - ix) * s,
    ];

    // Draw subtle background rect (rotated dimensions)
    ctx.save();
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, imageHeight * s, imageWidth * s);
    ctx.restore();

    // Blocks
    if (layerVisible("blocks")) {
      for (const b of blocks) {
        const pts = b.polygon;
        if (!pts || pts.length < 3) continue;
        ctx.beginPath();
        const [mx0, my0] = mapPt(pts[0].x, pts[0].y);
        ctx.moveTo(mx0, my0);
        for (let i = 1; i < pts.length; i++) {
          const [mx, my] = mapPt(pts[i].x, pts[i].y);
          ctx.lineTo(mx, my);
        }
        ctx.closePath();
        const isSel = selectedBlock?.block_code === b.block_code;
        ctx.strokeStyle = isSel ? "#f97316" : "#3b82f6";
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.stroke();
        if (isSel) {
          ctx.fillStyle = "rgba(59,130,246,0.08)";
          ctx.fill();
        }
      }
    }

    // Block labels
    if (layerVisible("blockLabels")) {
      ctx.font = `${Math.max(10, 12 * s)}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const b of blocks) {
        const [cx, cy] = mapPt(b.centroid.x, b.centroid.y);
        ctx.fillStyle = "#1e3a5f";
        ctx.fillText(b.block_code, cx, cy);
      }
    }

    // Trackers — draw as N-S lines through their piers
    if (layerVisible("trackers")) {
      // Group piers by tracker
      const piersByTracker: Record<string, {x: number; y: number}[]> = {};
      for (const p of piers) {
        const tid = p.tracker_code;
        if (!tid) continue;
        (piersByTracker[tid] ??= []).push(p);
      }
      for (const t of trackers) {
        const tPiers = piersByTracker[t.tracker_code];
        if (!tPiers || tPiers.length < 2) continue;
        // Sort piers by row_index to draw line in order
        const sorted = [...tPiers].sort((a: any, b: any) => (a.row_index || 0) - (b.row_index || 0));
        const isSel = selectedTracker?.tracker_code === t.tracker_code;
        ctx.strokeStyle = isSel ? "#16a34a" : "rgba(22,163,74,0.3)";
        ctx.lineWidth = isSel ? 2.5 : 1;
        ctx.beginPath();
        const [fx, fy] = mapPt(sorted[0].x, sorted[0].y);
        ctx.moveTo(fx, fy);
        for (let i = 1; i < sorted.length; i++) {
          const [mx, my] = mapPt(sorted[i].x, sorted[i].y);
          ctx.lineTo(mx, my);
        }
        ctx.stroke();
      }
    }

    // Piers
    if (layerVisible("piers")) {
      for (const p of piers) {
        const [px, py] = mapPt(p.x, p.y);
        const isSel = selectedPier?.pier_code === p.pier_code;
        const r = isSel ? SELECTED_RADIUS : PIER_RADIUS;
        ctx.beginPath();
        ctx.arc(px, py, r * Math.min(s * 2, 1.5), 0, Math.PI * 2);
        ctx.fillStyle = isSel ? "#ef4444" : (PIER_COLORS[p.pier_type] || PIER_COLORS.UNKNOWN);
        ctx.fill();
        if (isSel) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }, [view, blocks, trackers, piers, selectedBlock, selectedTracker, selectedPier, layers, imageWidth, imageHeight, layerVisible]);

  // Zoom with scroll wheel — use native listener to avoid passive event issue
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoom(mx, my, factor);
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  });

  function zoom(cx: number, cy: number, factor: number) {
    setView((v) => {
      const newScale = Math.max(0.1, Math.min(20, v.scale * factor));
      const ratio = newScale / v.scale;
      return {
        scale: newScale,
        x: cx - (cx - v.x) * ratio,
        y: cy - (cy - v.y) * ratio,
      };
    });
  }

  function zoomIn() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    zoom(canvas.width / 2, canvas.height / 2, 1.4);
  }

  function zoomOut() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    zoom(canvas.width / 2, canvas.height / 2, 1 / 1.4);
  }

  function fitAll() {
    fitToData();
  }

  // Pan with mouse drag
  function handlePointerDown(e: React.PointerEvent) {
    if (e.pointerType === "touch") return; // handled by touch events
    dragRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setView((v) => ({ ...v, x: drag.viewX + dx, y: drag.viewY + dy }));
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = Math.abs(e.clientX - dragRef.current.startX);
    const dy = Math.abs(e.clientY - dragRef.current.startY);
    // If no significant drag, treat as click
    if (dx < 5 && dy < 5) {
      handleTap(e.clientX, e.clientY);
    }
    dragRef.current = null;
  }

  // Touch: pinch zoom + pan
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchRef.current = { dist: d, scale: view.scale };
    } else if (e.touches.length === 1) {
      dragRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        viewX: view.x,
        viewY: view.y,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = d / pinchRef.current.dist;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = canvasRef.current!.getBoundingClientRect();
      zoom(cx - rect.left, cy - rect.top, factor / (view.scale / pinchRef.current.scale));
      pinchRef.current = { dist: d, scale: view.scale };
    } else if (e.touches.length === 1 && dragRef.current) {
      const drag = dragRef.current;
      const dx = e.touches[0].clientX - drag.startX;
      const dy = e.touches[0].clientY - drag.startY;
      setView((v) => ({ ...v, x: drag.viewX + dx, y: drag.viewY + dy }));
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.changedTouches.length === 1 && !pinchRef.current && dragRef.current) {
      const dx = Math.abs(e.changedTouches[0].clientX - dragRef.current.startX);
      const dy = Math.abs(e.changedTouches[0].clientY - dragRef.current.startY);
      if (dx < 10 && dy < 10) {
        handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
    }
    dragRef.current = null;
    pinchRef.current = null;
  }

  // Tap to select pier/tracker/block
  function handleTap(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const { x: ox, y: oy, scale: s } = view;
    // Reverse: mapPt: cx = oy + iy*s, cy = oy + (W-ix)*s
    // Inverse: iy = (mx - ox)/s, ix = W - (my - oy)/s
    const ix = imageWidth - (my - oy) / s;
    const iy = (mx - ox) / s;

    // Check piers first (smallest)
    if (layerVisible("piers")) {
      const hitR = Math.max(8, 12 / s);
      let closest: any = null;
      let closestD = hitR * hitR;
      for (const p of piers) {
        const d = (p.x - ix) ** 2 + (p.y - iy) ** 2;
        if (d < closestD) {
          closestD = d;
          closest = p;
        }
      }
      if (closest) {
        onPierClick(closest);
        return;
      }
    }

    // Check trackers
    if (layerVisible("trackers")) {
      for (const t of trackers) {
        const bb = t.bbox;
        if (bb && ix >= bb.x && ix <= bb.x + bb.w && iy >= bb.y && iy <= bb.y + bb.h) {
          onTrackerClick(t);
          return;
        }
      }
    }

    // Check blocks (point-in-polygon is expensive, use bbox)
    if (layerVisible("blocks")) {
      for (const b of blocks) {
        const bb = b.bbox;
        if (bb && ix >= bb.x && ix <= bb.x + bb.w && iy >= bb.y && iy <= bb.y + bb.h) {
          onBlockClick(b);
          return;
        }
      }
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 300, touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", cursor: "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {/* Zoom controls */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {[
          { label: "+", action: zoomIn },
          { label: "-", action: zoomOut },
          { label: "Fit", action: fitAll },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "white",
              fontSize: 18,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
      {/* Pier type legend */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          background: "rgba(255,255,255,0.9)",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {Object.entries(PIER_COLORS).filter(([k]) => k !== "UNKNOWN").map(([type, color]) => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
