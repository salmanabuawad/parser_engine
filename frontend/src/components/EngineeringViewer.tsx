import { useEffect, useRef, useState } from "react";
import OpenSeadragon from "openseadragon";
import { useResponsive } from "../hooks/useResponsive";

function poly(points) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function sameRect(a, b) {
  return a && b &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5;
}

function shapeStyle() {
  return { pointerEvents: "auto", cursor: "pointer" };
}

export default function EngineeringViewer({
  imageUrl, imageWidth, imageHeight,
  blocks, trackers, piers,
  selectedBlock, selectedTracker, selectedPier,
  layers, onBlockClick, onTrackerClick, onPierClick, zoomTarget
}: any) {
  const { isMobile, isTablet } = useResponsive();
  const viewerRef = useRef<any>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [overlayRect, setOverlayRect] = useState<any>(null);
  const [contentSize, setContentSize] = useState<any>(null);

  useEffect(() => {
    if (!hostRef.current || !imageUrl) return undefined;

    const viewer = OpenSeadragon({
      element: hostRef.current,
      tileSources: { type: "image", url: imageUrl },
      showNavigator: false,
      showNavigationControl: false,
      minZoomLevel: 0.4,
      animationTime: 0.8
    });
    viewerRef.current = viewer;

    const syncOverlay = () => {
      const tiledImage = viewer.world.getItemAt(0);
      if (!tiledImage || !viewer.viewport) return;

      const size = tiledImage.getContentSize();
      setContentSize((prev) => (
        prev?.width === size.x && prev?.height === size.y
          ? prev
          : { width: size.x, height: size.y }
      ));

      const topLeft = viewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(0, 0),
        true
      );
      const bottomRight = viewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(size.x, size.y),
        true
      );
      const nextRect = {
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y
      };
      setOverlayRect((prev) => (sameRect(prev, nextRect) ? prev : nextRect));
    };

    viewer.addHandler("open", syncOverlay);
    viewer.addHandler("animation", syncOverlay);
    viewer.addHandler("pan", syncOverlay);
    viewer.addHandler("zoom", syncOverlay);
    viewer.addHandler("resize", syncOverlay);

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      setOverlayRect(null);
      setContentSize(null);
    };
  }, [imageUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const tiledImage = viewer?.world.getItemAt(0);
    const bbox = zoomTarget?.map_target?.bbox;
    if (!viewer || !tiledImage || !bbox) return;
    const rect = tiledImage.imageToViewportRectangle(bbox.x, bbox.y, bbox.w, bbox.h);
    viewer.viewport.fitBounds(rect, true);
  }, [zoomTarget, contentSize]);

  const visible = Object.fromEntries(layers.map((l) => [l.key, l.visible]));
  const width = contentSize?.width || imageWidth || 1;
  const height = contentSize?.height || imageHeight || 1;

  return (
    <div style={{ position: "relative", border: "1px solid #ddd", borderRadius: 16, overflow: "hidden", height: isMobile ? "60vh" : isTablet ? "70vh" : "78vh", background: "#f7f7f7" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      {overlayRect && (
        <div
          style={{
            position: "absolute",
            left: overlayRect.left,
            top: overlayRect.top,
            width: overlayRect.width,
            height: overlayRect.height,
            pointerEvents: "none"
          }}
        >
          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%", overflow: "visible" }}>
            {visible.blocks && blocks.map((b) => (
              <polygon
                key={b.block_code}
                points={poly(b.polygon)}
                fill={selectedBlock?.block_code === b.block_code ? "rgba(255,120,0,0.20)" : "rgba(0,128,255,0.08)"}
                stroke={selectedBlock?.block_code === b.block_code ? "#ff7800" : "#1d4ed8"}
                strokeWidth={selectedBlock?.block_code === b.block_code ? 4 : 2}
                style={shapeStyle()}
                onClick={() => onBlockClick?.(b)}
              />
            ))}
            {visible.blockLabels && blocks.map((b) => (
              <text
                key={`${b.block_code}_lbl`}
                x={b.centroid.x}
                y={b.centroid.y}
                fontSize="24"
                fontWeight="700"
                textAnchor="middle"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {b.block_code}
              </text>
            ))}
            {visible.trackers && trackers.map((t) => (
              <rect
                key={t.tracker_code}
                x={t.bbox.x}
                y={t.bbox.y}
                width={t.bbox.w}
                height={t.bbox.h}
                fill={selectedTracker?.tracker_code === t.tracker_code ? "rgba(16,185,129,0.18)" : "rgba(16,185,129,0.05)"}
                stroke={selectedTracker?.tracker_code === t.tracker_code ? "#10b981" : "#059669"}
                strokeWidth={selectedTracker?.tracker_code === t.tracker_code ? 3 : 1.5}
                style={shapeStyle()}
                onClick={() => onTrackerClick?.(t)}
              />
            ))}
            {visible.piers && piers.map((p) => (
              <circle
                key={p.pier_code}
                cx={p.x}
                cy={p.y}
                r={selectedPier?.pier_code === p.pier_code ? 7 : 4}
                fill={selectedPier?.pier_code === p.pier_code ? "#ef4444" : "#7c3aed"}
                style={shapeStyle()}
                onClick={() => onPierClick?.(p)}
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
