"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { RoomPlanItem, Point2D, LayerSettings, WallElement } from "@/types/plan";
import {
  getDistance,
  getUnitVector,
  getNormalVector,
  getWallsBoundingBox,
  computeWallPolygons,
  getPolygonOrientation,
  getWallExteriorNormal,
  getNearestPointOnSegment,
  calculateLightFourWayDimensions,
} from "@/lib/cad/geometry";
import {
  MdCenterFocusStrong,
  MdZoomIn,
  MdZoomOut,
  MdTouchApp,
  MdHighlightAlt,
} from "react-icons/md";
import styles from "./PlanCanvas2D.module.css";

interface PlanCanvas2DProps {
  room: RoomPlanItem;
  activePoint: Point2D;
  selectedElementId: string | null;
  selectedElementType: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | null;
  selectedElementIds?: string[];
  onSelectElement: (id: string | null, type: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | null) => void;
  onSelectMultiple?: (ids: string[]) => void;
  onChangeElementOffset?: (elementId: string, type: "door" | "window" | "electrical" | "radiator", newOffsetMm: number) => void;
  onChangeLightPosition?: (lightId: string, newX: number, newY: number) => void;
  onSetActivePoint?: (pt: Point2D) => void;
  layerSettings?: LayerSettings;
  placingOpening?: "door" | "window" | "electrical" | "radiator" | null;
  onSelectWallForOpening?: (wallId: string, offsetMm: number, type: "door" | "window" | "electrical" | "radiator") => void;
  onCancelPlacingOpening?: () => void;
}

interface TempDimHitbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  kind: "wallOffset" | "lightCoord";
  elementId?: string;
  elementType?: "door" | "window" | "electrical" | "radiator";
  isStartDim?: boolean;
  currentVal?: number;
  wallLen?: number;
  elementWidth?: number;
  lightId?: string;
  direction?: "up" | "down" | "left" | "right";
  wallHitCoord?: number;
}

export default function PlanCanvas2D({
  room,
  activePoint,
  selectedElementId,
  selectedElementType,
  selectedElementIds = [],
  onSelectElement,
  onSelectMultiple,
  onChangeElementOffset,
  onChangeLightPosition,
  onSetActivePoint,
  layerSettings,
  placingOpening,
  onSelectWallForOpening,
  onCancelPlacingOpening,
}: PlanCanvas2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ResizeObserver State to prevent any canvas stretching on resolution / window size change
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Direct Wall Selection Hover state for opening placement
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null);
  const [hoverOffset, setHoverOffset] = useState<number | null>(null);

  // Marquee / Box Selection State (Dedicated Tool)
  const [activeTool, setActiveTool] = useState<"pointer" | "boxSelect">("pointer");
  const [selectionBox, setSelectionBox] = useState<{ start: Point2D; current: Point2D } | null>(null);
  const tempDimHitboxesRef = useRef<TempDimHitbox[]>([]);

  // Snap to wall endpoint cursor state
  const [hoveredSnapPoint, setHoveredSnapPoint] = useState<Point2D | null>(null);

  // Viewport Transform (origin at center of canvas)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(0.12); // 1 mm = 0.12 px (approx 1m = 120px)

  // Dragging state
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // ResizeObserver to detect any container size / resolution changes immediately
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasDimensions({ width: rect.width, height: rect.height });
      }
    };

    handleResize();

    const ro = new ResizeObserver(() => {
      handleResize();
    });
    ro.observe(container);

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  // Closing snap condition
  const startPoint = useMemo(() => {
    return room.walls.length > 0 ? room.walls[0].start : { x: 0, y: 0 };
  }, [room.walls]);

  const closingDistance = getDistance(activePoint, startPoint);
  const canClose = !room.isClosed && room.walls.length >= 2;
  const isNearOrigin = canClose && closingDistance < 600;

  // World to Screen coordinates helper
  const worldToScreen = useCallback(
    (wX: number, wY: number, cW: number, cH: number) => {
      const sX = (wX + pan.x) * zoom + cW / 2;
      const sY = cH / 2 - (wY + pan.y) * zoom; // Y is inverted in CAD standard
      return { x: sX, y: sY };
    },
    [pan, zoom]
  );

  // Screen to World coordinates helper
  const screenToWorld = useCallback(
    (sX: number, sY: number, cW: number, cH: number) => {
      const wX = (sX - cW / 2) / zoom - pan.x;
      const wY = (cH / 2 - sY) / zoom - pan.y;
      return { x: wX, y: wY };
    },
    [pan, zoom]
  );

  // Auto-fit room to viewport
  const handleAutoFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bbox = getWallsBoundingBox(room.walls.length > 0 ? room.walls : [
      { id: "temp", start: { x: 0, y: 0 }, end: activePoint, thickness: 150, height: 2800 },
    ]);

    const margin = 100;
    const availW = Math.max(100, canvas.width - margin * 2);
    const availH = Math.max(100, canvas.height - margin * 2);

    const fitZoom = Math.min(availW / Math.max(1000, bbox.width), availH / Math.max(1000, bbox.height));
    const clampedZoom = Math.max(0.04, Math.min(fitZoom * 0.85, 0.4));

    setZoom(Number(clampedZoom.toFixed(3)));
    setPan({ x: -bbox.centerX, y: -bbox.centerY });
  }, [room.walls, activePoint]);

  // Initial fit on room load
  useEffect(() => {
    if (room.walls.length > 0) {
      handleAutoFit();
    }
  }, [room.id, handleAutoFit, room.walls.length]);

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    const cW = rect.width;
    const cH = rect.height;

    // Clear background
    ctx.fillStyle = "#0d0d12";
    ctx.fillRect(0, 0, cW, cH);

    // Clear hitboxes on each draw
    tempDimHitboxesRef.current = [];

    // 1. Draw Architectural Grid
    const gridMajorMm = 1000; // 1 meter
    const gridMinorMm = 200;  // 200 mm
    const topLeftWorld = screenToWorld(0, 0, cW, cH);
    const bottomRightWorld = screenToWorld(cW, cH, cW, cH);

    const minX = Math.floor(topLeftWorld.x / gridMinorMm) * gridMinorMm;
    const maxX = Math.ceil(bottomRightWorld.x / gridMinorMm) * gridMinorMm;
    const minY = Math.floor(bottomRightWorld.y / gridMinorMm) * gridMinorMm;
    const maxY = Math.ceil(topLeftWorld.y / gridMinorMm) * gridMinorMm;

    // Draw Minor Grid (if zoom is high enough)
    if (zoom > 0.08) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = minX; x <= maxX; x += gridMinorMm) {
        const p1 = worldToScreen(x, minY, cW, cH);
        const p2 = worldToScreen(x, maxY, cW, cH);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
      for (let y = minY; y <= maxY; y += gridMinorMm) {
        const p1 = worldToScreen(minX, y, cW, cH);
        const p2 = worldToScreen(maxX, y, cW, cH);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
    }

    // Draw Major Grid (1 Meter Intervals)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(minX / gridMajorMm) * gridMajorMm; x <= maxX; x += gridMajorMm) {
      const p1 = worldToScreen(x, minY, cW, cH);
      const p2 = worldToScreen(x, maxY, cW, cH);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    for (let y = Math.floor(minY / gridMajorMm) * gridMajorMm; y <= maxY; y += gridMajorMm) {
      const p1 = worldToScreen(minX, y, cW, cH);
      const p2 = worldToScreen(maxX, y, cW, cH);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Origin Axes
    const origin = worldToScreen(0, 0, cW, cH);
    ctx.strokeStyle = "rgba(41, 245, 126, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(origin.x - 20, origin.y);
    ctx.lineTo(origin.x + 20, origin.y);
    ctx.moveTo(origin.x, origin.y - 20);
    ctx.lineTo(origin.x, origin.y + 20);
    ctx.stroke();

    // 2. Draw Floor Slab if room is closed
    const showSlab = layerSettings?.slab?.visible ?? true;
    if (showSlab && room.isClosed && room.walls.length >= 3) {
      ctx.fillStyle = "rgba(41, 245, 126, 0.045)";
      ctx.beginPath();
      room.walls.forEach((w, idx) => {
        const sP = worldToScreen(w.start.x, w.start.y, cW, cH);
        if (idx === 0) ctx.moveTo(sP.x, sP.y);
        else ctx.lineTo(sP.x, sP.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    // 3. Draw Walls with Clean Straight Butt Joints & Interior Measurement Accuracy
    const showWalls = layerSettings?.walls?.visible ?? true;
    if (showWalls && room.walls.length > 0) {
      const wallPolygons = computeWallPolygons(room.walls, room.isClosed);

      wallPolygons.forEach((poly) => {
        const wall = room.walls.find((w) => w.id === poly.wallId);
        if (!wall) return;

        const isHoveredForOpening = hoveredWallId === wall.id && !!placingOpening;
        const isSelected =
          (selectedElementId === wall.id && selectedElementType === "wall") ||
          (selectedElementIds && selectedElementIds.includes(wall.id));

        // Screen coordinates for the 4 corners (straight extended butt joints)
        const c1 = worldToScreen(poly.innerStart.x, poly.innerStart.y, cW, cH);
        const c2 = worldToScreen(poly.innerEnd.x, poly.innerEnd.y, cW, cH);
        const c3 = worldToScreen(poly.outerEnd.x, poly.outerEnd.y, cW, cH);
        const c4 = worldToScreen(poly.outerStart.x, poly.outerStart.y, cW, cH);

        // Wall fill & stroke
        let fillColor = "rgba(255, 255, 255, 0.12)";
        let strokeColor = "rgba(255, 255, 255, 0.7)";
        let lineWidth = 1.5;

        if (isHoveredForOpening) {
          fillColor =
            placingOpening === "door"
              ? "rgba(250, 204, 21, 0.35)"
              : placingOpening === "window"
              ? "rgba(56, 189, 248, 0.35)"
              : placingOpening === "electrical"
              ? "rgba(74, 222, 128, 0.35)"
              : "rgba(251, 146, 60, 0.35)";
          strokeColor =
            placingOpening === "door"
              ? "#facc15"
              : placingOpening === "window"
              ? "#38bdf8"
              : placingOpening === "electrical"
              ? "#4ade80"
              : "#fb923c";
          lineWidth = 3;
        } else if (isSelected) {
          fillColor = "rgba(41, 245, 126, 0.25)";
          strokeColor = "#29f57e";
          lineWidth = 2.5;
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = "miter";
        ctx.miterLimit = 3;

        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.lineTo(c3.x, c3.y);
        ctx.lineTo(c4.x, c4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw hover preview marker on the wall when in placingOpening mode
        if (isHoveredForOpening && hoverOffset !== null) {
          const u = getUnitVector(wall.start, wall.end);
          const markerWorldX = wall.start.x + u.x * hoverOffset;
          const markerWorldY = wall.start.y + u.y * hoverOffset;
          const markerScreen = worldToScreen(markerWorldX, markerWorldY, cW, cH);

          const markerColor =
            placingOpening === "door"
              ? "#facc15"
              : placingOpening === "window"
              ? "#38bdf8"
              : placingOpening === "electrical"
              ? "#4ade80"
              : "#fb923c";

          ctx.fillStyle = markerColor;
          ctx.beginPath();
          ctx.arc(markerScreen.x, markerScreen.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();

          // Offset text bubble above hover marker
          const offsetCm = Math.round(hoverOffset / 10);
          const offText = `${offsetCm} cm`;
          ctx.font = "bold 10px Montserrat, sans-serif";
          const offMet = ctx.measureText(offText);
          const bW = offMet.width + 10;
          const bH = 17;
          ctx.fillStyle = "rgba(13, 13, 18, 0.92)";
          ctx.fillRect(markerScreen.x - bW / 2, markerScreen.y - 24 - bH / 2, bW, bH);
          ctx.strokeStyle = markerColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(markerScreen.x - bW / 2, markerScreen.y - 24 - bH / 2, bW, bH);
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(offText, markerScreen.x, markerScreen.y - 24);
        }

        // Interior reference line (where surveyor laser measured)
        const sStart = worldToScreen(wall.start.x, wall.start.y, cW, cH);
        const sEnd = worldToScreen(wall.end.x, wall.end.y, cW, cH);
        ctx.strokeStyle = isSelected ? "rgba(41, 245, 126, 0.9)" : "rgba(41, 245, 126, 0.4)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sStart.x, sStart.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dimension text with dark badge for high contrast
        const showDims = layerSettings?.dimensions?.visible ?? true;
        if (showDims) {
          const lenMm = Math.round(getDistance(wall.start, wall.end));
          const lenCm = Math.round(lenMm / 10);
          const n = getNormalVector(wall.start, wall.end);
          const midX = (wall.start.x + wall.end.x) / 2;
          const midY = (wall.start.y + wall.end.y) / 2;
          const offsetDist = (wall.thickness || 150) / 2 + 180;
          const textWorldX = midX + n.x * offsetDist;
          const textWorldY = midY + n.y * offsetDist;
          const textScreen = worldToScreen(textWorldX, textWorldY, cW, cH);

          ctx.font = "bold 11px Montserrat, sans-serif";
          const dimStr = `${lenCm}`;
          const metrics = ctx.measureText(dimStr);
          const padX = 6;
          const padY = 3;
          const badgeW = metrics.width + padX * 2;
          const badgeH = 10 + padY * 2;

          // Dimension badge background
          ctx.fillStyle = "rgba(18, 18, 23, 0.85)";
          ctx.fillRect(textScreen.x - badgeW / 2, textScreen.y - badgeH / 2, badgeW, badgeH);
          ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 1;
          ctx.strokeRect(textScreen.x - badgeW / 2, textScreen.y - badgeH / 2, badgeW, badgeH);

          // Dimension number
          ctx.fillStyle = isSelected ? "#29f57e" : "#f1f5f9";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(dimStr, textScreen.x, textScreen.y);
        }
      });
    }

    // 4. Draw Doors with Authentic Architectural CAD Symbol & Precise Orientation
    const showDoors = layerSettings?.doors?.visible ?? true;
    if (showDoors && room.doors.length > 0) {
      const roomPoints = room.walls.map((w) => w.start);
      if (room.walls.length > 0) roomPoints.push(room.walls[room.walls.length - 1].end);
      const orientation = getPolygonOrientation(roomPoints);

      room.doors.forEach((door) => {
        const wall = room.walls.find((w) => w.id === door.wallId);
        if (!wall) return;
        const isSelected =
          (selectedElementId === door.id && selectedElementType === "door") ||
          (selectedElementIds && selectedElementIds.includes(door.id));

        const u = getUnitVector(wall.start, wall.end);
        const nExt = getWallExteriorNormal(wall, orientation);
        const nInt = { x: -nExt.x, y: -nExt.y };

        // Swing normal: inward points into the room, outward points out of the room
        const nSwing = door.swingOrientation === "inward" ? nInt : nExt;

        const wThick = wall.thickness || 150;
        const align = wall.alignment || "interior";
        let innerOffset = 0;
        let outerOffset = wThick;
        if (align === "center") {
          innerOffset = -wThick / 2;
          outerOffset = wThick / 2;
        } else if (align === "exterior") {
          innerOffset = -wThick;
          outerOffset = 0;
        }

        // Door opening jamb points along wall
        const pA = { x: wall.start.x + u.x * door.offset, y: wall.start.y + u.y * door.offset };
        const pB = { x: pA.x + u.x * door.width, y: pA.y + u.y * door.width };

        // 4 corners of wall opening
        const cA_in = { x: pA.x + nExt.x * innerOffset, y: pA.y + nExt.y * innerOffset };
        const cB_in = { x: pB.x + nExt.x * innerOffset, y: pB.y + nExt.y * innerOffset };
        const cB_out = { x: pB.x + nExt.x * outerOffset, y: pB.y + nExt.y * outerOffset };
        const cA_out = { x: pA.x + nExt.x * outerOffset, y: pA.y + nExt.y * outerOffset };

        const sA_in = worldToScreen(cA_in.x, cA_in.y, cW, cH);
        const sB_in = worldToScreen(cB_in.x, cB_in.y, cW, cH);
        const sB_out = worldToScreen(cB_out.x, cB_out.y, cW, cH);
        const sA_out = worldToScreen(cA_out.x, cA_out.y, cW, cH);

        // 1. Cut doorway opening through the wall
        ctx.fillStyle = "#0d0d12"; // canvas dark background
        ctx.beginPath();
        ctx.moveTo(sA_in.x, sA_in.y);
        ctx.lineTo(sB_in.x, sB_in.y);
        ctx.lineTo(sB_out.x, sB_out.y);
        ctx.lineTo(sA_out.x, sA_out.y);
        ctx.closePath();
        ctx.fill();

        // 2. Door threshold lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sA_in.x, sA_in.y);
        ctx.lineTo(sB_in.x, sB_in.y);
        ctx.moveTo(sA_out.x, sA_out.y);
        ctx.lineTo(sB_out.x, sB_out.y);
        ctx.stroke();

        // 3. Frame Jambs (Kasalar) at each side (50mm width)
        const jambW = 50;
        const jA_in = worldToScreen(pA.x + u.x * jambW + nExt.x * innerOffset, pA.y + u.y * jambW + nExt.y * innerOffset, cW, cH);
        const jA_out = worldToScreen(pA.x + u.x * jambW + nExt.x * outerOffset, pA.y + u.y * jambW + nExt.y * outerOffset, cW, cH);
        const jB_in = worldToScreen(pB.x - u.x * jambW + nExt.x * innerOffset, pB.y - u.y * jambW + nExt.y * innerOffset, cW, cH);
        const jB_out = worldToScreen(pB.x - u.x * jambW + nExt.x * outerOffset, pB.y - u.y * jambW + nExt.y * outerOffset, cW, cH);

        ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.3)" : "#1e293b";
        ctx.strokeStyle = isSelected ? "#29f57e" : "#475569";
        ctx.lineWidth = 1;

        // Left jamb
        ctx.beginPath();
        ctx.moveTo(sA_in.x, sA_in.y);
        ctx.lineTo(jA_in.x, jA_in.y);
        ctx.lineTo(jA_out.x, jA_out.y);
        ctx.lineTo(sA_out.x, sA_out.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Right jamb
        ctx.beginPath();
        ctx.moveTo(sB_in.x, sB_in.y);
        ctx.lineTo(jB_in.x, jB_in.y);
        ctx.lineTo(jB_out.x, jB_out.y);
        ctx.lineTo(sB_out.x, sB_out.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (door.doorType === "sliding") {
          // Architectural Sliding Pocket / Patio Door symbol
          const numSegs = Math.max(2, Math.min(4, door.slidingSegments || 2));
          const clearW = door.width - jambW * 2;
          const segW = (clearW / numSegs) * 1.15;
          const panelThick = 35;
          const trackGap = 16;

          for (let sIdx = 0; sIdx < numSegs; sIdx++) {
            const segStartX = pA.x + u.x * (jambW + (sIdx * (clearW - segW)) / (numSegs - 1 || 1));
            const segStartY = pA.y + u.y * (jambW + (sIdx * (clearW - segW)) / (numSegs - 1 || 1));
            const trackSign = sIdx % 2 === 0 ? -1 : 1;
            const trackOffset = (innerOffset + outerOffset) / 2 + trackSign * (trackGap / 2);

            const pS1 = {
              x: segStartX + nExt.x * (trackOffset - panelThick / 2),
              y: segStartY + nExt.y * (trackOffset - panelThick / 2),
            };
            const pS2 = {
              x: segStartX + u.x * segW + nExt.x * (trackOffset - panelThick / 2),
              y: segStartY + u.y * segW + nExt.y * (trackOffset - panelThick / 2),
            };
            const pS3 = {
              x: segStartX + u.x * segW + nExt.x * (trackOffset + panelThick / 2),
              y: segStartY + u.y * segW + nExt.y * (trackOffset + panelThick / 2),
            };
            const pS4 = {
              x: segStartX + nExt.x * (trackOffset + panelThick / 2),
              y: segStartY + nExt.y * (trackOffset + panelThick / 2),
            };

            const sS1 = worldToScreen(pS1.x, pS1.y, cW, cH);
            const sS2 = worldToScreen(pS2.x, pS2.y, cW, cH);
            const sS3 = worldToScreen(pS3.x, pS3.y, cW, cH);
            const sS4 = worldToScreen(pS4.x, pS4.y, cW, cH);

            ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.35)" : "rgba(250, 204, 21, 0.22)";
            ctx.strokeStyle = isSelected ? "#29f57e" : "#facc15";
            ctx.lineWidth = 1.3;

            ctx.beginPath();
            ctx.moveTo(sS1.x, sS1.y);
            ctx.lineTo(sS2.x, sS2.y);
            ctx.lineTo(sS3.x, sS3.y);
            ctx.lineTo(sS4.x, sS4.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Arrow on sliding panel indicating movement
            const midX = (sS1.x + sS2.x) / 2;
            const midY = (sS1.y + sS2.y) / 2;
            const arrowDir = sIdx === 0 ? 1 : -1;
            const lenP = Math.hypot(sS2.x - sS1.x, sS2.y - sS1.y) || 1;
            const scrU = { x: (sS2.x - sS1.x) / lenP, y: (sS2.y - sS1.y) / lenP };
            ctx.strokeStyle = isSelected ? "#29f57e" : "#eab308";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(midX - scrU.x * 7 * arrowDir, midY - scrU.y * 7 * arrowDir);
            ctx.lineTo(midX + scrU.x * 7 * arrowDir, midY + scrU.y * 7 * arrowDir);
            ctx.stroke();
          }
        } else {
          // Standard Hinged Door
          // 4. Hinge and Latch calculation
          const isLeftHinge = door.swingDirection === "left";
          const pHinge = isLeftHinge ? pA : pB;
          const pLatch = isLeftHinge ? pB : pA;
          const pTip = {
            x: pHinge.x + nSwing.x * door.width,
            y: pHinge.y + nSwing.y * door.width,
          };

          const sHinge = worldToScreen(pHinge.x, pHinge.y, cW, cH);
          const sLatch = worldToScreen(pLatch.x, pLatch.y, cW, cH);
          const sTip = worldToScreen(pTip.x, pTip.y, cW, cH);

          // 5. Architectural 90-degree Swing Arc connecting latch to leaf tip
          const radiusPx = door.width * zoom;
          const startAngle = Math.atan2(sLatch.y - sHinge.y, sLatch.x - sHinge.x);
          const endAngle = Math.atan2(sTip.y - sHinge.y, sTip.x - sHinge.x);
          let delta = endAngle - startAngle;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;

          ctx.strokeStyle = isSelected ? "rgba(41, 245, 126, 0.85)" : "rgba(250, 204, 21, 0.6)";
          ctx.lineWidth = 1.3;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(sHinge.x, sHinge.y, radiusPx, startAngle, startAngle + delta, delta < 0);
          ctx.stroke();
          ctx.setLineDash([]);

          // 6. Realistic Architectural Door Leaf Rectangle (40mm thickness)
          const leafThick = 40;
          const leafU = isLeftHinge ? u : { x: -u.x, y: -u.y };
          const pL1 = pHinge;
          const pL2 = pTip;
          const pL3 = { x: pTip.x + leafU.x * leafThick, y: pTip.y + leafU.y * leafThick };
          const pL4 = { x: pHinge.x + leafU.x * leafThick, y: pHinge.y + leafU.y * leafThick };

          const sL1 = worldToScreen(pL1.x, pL1.y, cW, cH);
          const sL2 = worldToScreen(pL2.x, pL2.y, cW, cH);
          const sL3 = worldToScreen(pL3.x, pL3.y, cW, cH);
          const sL4 = worldToScreen(pL4.x, pL4.y, cW, cH);

          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.35)" : "rgba(250, 204, 21, 0.25)";
          ctx.strokeStyle = isSelected ? "#29f57e" : "#facc15";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sL1.x, sL1.y);
          ctx.lineTo(sL2.x, sL2.y);
          ctx.lineTo(sL3.x, sL3.y);
          ctx.lineTo(sL4.x, sL4.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // 7. Hinge Pivot Ring Indicator
          ctx.fillStyle = isSelected ? "#29f57e" : "#facc15";
          ctx.beginPath();
          ctx.arc(sHinge.x, sHinge.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 5. Draw Windows with Crisp Frames & Center Glazing
    const showWindows = layerSettings?.windows?.visible ?? true;
    if (showWindows && room.windows.length > 0) {
      const roomPoints = room.walls.map((w) => w.start);
      if (room.walls.length > 0) roomPoints.push(room.walls[room.walls.length - 1].end);
      const orientation = getPolygonOrientation(roomPoints);

      room.windows.forEach((win) => {
        const wall = room.walls.find((w) => w.id === win.wallId);
        if (!wall) return;
        const isSelected =
          (selectedElementId === win.id && selectedElementType === "window") ||
          (selectedElementIds && selectedElementIds.includes(win.id));

        const u = getUnitVector(wall.start, wall.end);
        const nExt = getWallExteriorNormal(wall, orientation);
        const wThick = wall.thickness || 150;
        const align = wall.alignment || "interior";
        let innerOffset = 0;
        let outerOffset = wThick;
        if (align === "center") {
          innerOffset = -wThick / 2;
          outerOffset = wThick / 2;
        } else if (align === "exterior") {
          innerOffset = -wThick;
          outerOffset = 0;
        }

        const p1World = { x: wall.start.x + u.x * win.offset, y: wall.start.y + u.y * win.offset };
        const p2World = { x: p1World.x + u.x * win.width, y: p1World.y + u.y * win.width };

        const c1 = worldToScreen(p1World.x + nExt.x * innerOffset, p1World.y + nExt.y * innerOffset, cW, cH);
        const c2 = worldToScreen(p2World.x + nExt.x * innerOffset, p2World.y + nExt.y * innerOffset, cW, cH);
        const c3 = worldToScreen(p2World.x + nExt.x * outerOffset, p2World.y + nExt.y * outerOffset, cW, cH);
        const c4 = worldToScreen(p1World.x + nExt.x * outerOffset, p1World.y + nExt.y * outerOffset, cW, cH);

        // Window Cutout & Frame
        ctx.fillStyle = isSelected ? "rgba(56, 189, 248, 0.35)" : "rgba(15, 23, 42, 0.9)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "#38bdf8";
        ctx.lineWidth = isSelected ? 2.5 : 1.5;

        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.lineTo(c3.x, c3.y);
        ctx.lineTo(c4.x, c4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Center glass line
        const midOffset = (innerOffset + outerOffset) / 2;
        const g1 = worldToScreen(p1World.x + nExt.x * midOffset, p1World.y + nExt.y * midOffset, cW, cH);
        const g2 = worldToScreen(p2World.x + nExt.x * midOffset, p2World.y + nExt.y * midOffset, cW, cH);
        ctx.strokeStyle = isSelected ? "#ffffff" : "#7dd3fc";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(g1.x, g1.y);
        ctx.lineTo(g2.x, g2.y);
        ctx.stroke();

        // Division Mullions (1, 2, 3, 4 panels)
        const segs = win.segments || (win.windowType === "sliding" ? 2 : 1);
        if (segs > 1) {
          ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(255, 255, 255, 0.6)";
          ctx.lineWidth = 1.5;
          for (let s = 1; s < segs; s++) {
            const frac = s / segs;
            const m1 = worldToScreen(p1World.x + u.x * (win.width * frac) + nExt.x * innerOffset, p1World.y + u.y * (win.width * frac) + nExt.y * innerOffset, cW, cH);
            const m2 = worldToScreen(p1World.x + u.x * (win.width * frac) + nExt.x * outerOffset, p1World.y + u.y * (win.width * frac) + nExt.y * outerOffset, cW, cH);
            ctx.beginPath();
            ctx.moveTo(m1.x, m1.y);
            ctx.lineTo(m2.x, m2.y);
            ctx.stroke();
          }
        }

        // French Balcony window exterior guardrail indicator
        if (win.windowType === "french") {
          const railOffset = outerOffset + 120;
          const r1 = worldToScreen(p1World.x + nExt.x * railOffset, p1World.y + nExt.y * railOffset, cW, cH);
          const r2 = worldToScreen(p2World.x + nExt.x * railOffset, p2World.y + nExt.y * railOffset, cW, cH);
          ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(255, 255, 255, 0.45)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(r1.x, r1.y);
          ctx.lineTo(r2.x, r2.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    // 5b. Temporary Dimensions for Selected Opening (Revit Style Witness & Dimension Lines)
    if (selectedElementId && (selectedElementType === "door" || selectedElementType === "window")) {
      const selectedDoor = selectedElementType === "door" ? room.doors.find((d) => d.id === selectedElementId) : null;
      const selectedWin = selectedElementType === "window" ? room.windows.find((w) => w.id === selectedElementId) : null;
      const opening = selectedDoor || selectedWin;

      if (opening) {
        const wall = room.walls.find((w) => w.id === opening.wallId);
        if (wall) {
          const u = getUnitVector(wall.start, wall.end);
          const n = getNormalVector(wall.start, wall.end);
          const wallLen = Math.round(getDistance(wall.start, wall.end));
          const d1 = Math.round(opening.offset);
          const d2 = Math.max(0, Math.round(wallLen - (opening.offset + opening.width)));
          const opWidth = opening.width;
          const opType = selectedDoor ? "door" : "window";

          // Offset dimension lines outwards from wall
          const dimOffset = (wall.thickness || 150) / 2 + 280;
          const pStart = wall.start;
          const pEnd = wall.end;
          const pOpStart = { x: wall.start.x + u.x * opening.offset, y: wall.start.y + u.y * opening.offset };
          const pOpEnd = { x: wall.start.x + u.x * (opening.offset + opening.width), y: wall.start.y + u.y * (opening.offset + opening.width) };

          const offStart = { x: pStart.x + n.x * dimOffset, y: pStart.y + n.y * dimOffset };
          const offOpStart = { x: pOpStart.x + n.x * dimOffset, y: pOpStart.y + n.y * dimOffset };
          const offOpEnd = { x: pOpEnd.x + n.x * dimOffset, y: pOpEnd.y + n.y * dimOffset };
          const offEnd = { x: pEnd.x + n.x * dimOffset, y: pEnd.y + n.y * dimOffset };

          const sStart = worldToScreen(pStart.x, pStart.y, cW, cH);
          const sEnd = worldToScreen(pEnd.x, pEnd.y, cW, cH);
          const sOpStart = worldToScreen(pOpStart.x, pOpStart.y, cW, cH);
          const sOpEnd = worldToScreen(pOpEnd.x, pOpEnd.y, cW, cH);

          const sOffStart = worldToScreen(offStart.x, offStart.y, cW, cH);
          const sOffOpStart = worldToScreen(offOpStart.x, offOpStart.y, cW, cH);
          const sOffOpEnd = worldToScreen(offOpEnd.x, offOpEnd.y, cW, cH);
          const sOffEnd = worldToScreen(offEnd.x, offEnd.y, cW, cH);

          // 1. Witness Lines (dashed cyan)
          ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(sStart.x, sStart.y);
          ctx.lineTo(sOffStart.x, sOffStart.y);
          ctx.moveTo(sOpStart.x, sOpStart.y);
          ctx.lineTo(sOffOpStart.x, sOffOpStart.y);
          ctx.moveTo(sOpEnd.x, sOpEnd.y);
          ctx.lineTo(sOffOpEnd.x, sOffOpEnd.y);
          ctx.moveTo(sEnd.x, sEnd.y);
          ctx.lineTo(sOffEnd.x, sOffEnd.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // 2. Dimension Line 1: Wall Start to Opening
          if (d1 > 10) {
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sOffStart.x, sOffStart.y);
            ctx.lineTo(sOffOpStart.x, sOffOpStart.y);
            ctx.stroke();

            // Interactive Pill Badge
            const mid1X = (sOffStart.x + sOffOpStart.x) / 2;
            const mid1Y = (sOffStart.y + sOffOpStart.y) / 2;
            const text1 = `${Math.round(d1 / 10)} cm ✎`;
            ctx.font = "bold 11px Montserrat, sans-serif";
            const m1 = ctx.measureText(text1);
            const b1W = m1.width + 12;
            const b1H = 22;

            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mid1X - b1W / 2, mid1Y - b1H / 2, b1W, b1H, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#38bdf8";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text1, mid1X, mid1Y);

            tempDimHitboxesRef.current.push({
              minX: mid1X - b1W / 2 - 4,
              maxX: mid1X + b1W / 2 + 4,
              minY: mid1Y - b1H / 2 - 4,
              maxY: mid1Y + b1H / 2 + 4,
              kind: "wallOffset",
              elementId: opening.id,
              elementType: opType,
              isStartDim: true,
              currentVal: d1,
              wallLen,
              elementWidth: opWidth,
            });
          }

          // 3. Dimension Line 2: Opening to Wall End
          if (d2 > 10) {
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sOffOpEnd.x, sOffOpEnd.y);
            ctx.lineTo(sOffEnd.x, sOffEnd.y);
            ctx.stroke();

            // Interactive Pill Badge
            const mid2X = (sOffOpEnd.x + sOffEnd.x) / 2;
            const mid2Y = (sOffOpEnd.y + sOffEnd.y) / 2;
            const text2 = `${Math.round(d2 / 10)} cm ✎`;
            ctx.font = "bold 11px Montserrat, sans-serif";
            const m2 = ctx.measureText(text2);
            const b2W = m2.width + 12;
            const b2H = 22;

            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mid2X - b2W / 2, mid2Y - b2H / 2, b2W, b2H, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#38bdf8";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text2, mid2X, mid2Y);

            tempDimHitboxesRef.current.push({
              minX: mid2X - b2W / 2 - 4,
              maxX: mid2X + b2W / 2 + 4,
              minY: mid2Y - b2H / 2 - 4,
              maxY: mid2Y + b2H / 2 + 4,
              kind: "wallOffset",
              elementId: opening.id,
              elementType: opType,
              isStartDim: false,
              currentVal: d2,
              wallLen,
              elementWidth: opWidth,
            });
          }
        }
      }
    }

    // 6. Draw Electrical Fixtures (Priz, Anahtar, Sigorta Kutusu)
    const showElectrical = layerSettings?.electrical?.visible ?? true;
    if (showElectrical && room.electrical && room.electrical.length > 0) {
      const roomPoints = room.walls.map((w) => w.start);
      if (room.walls.length > 0) roomPoints.push(room.walls[room.walls.length - 1].end);
      const orientation = getPolygonOrientation(roomPoints);

      room.electrical.forEach((elem) => {
        const wall = room.walls.find((w) => w.id === elem.wallId);
        if (!wall) return;
        const isSelected =
          (selectedElementId === elem.id && selectedElementType === "electrical") ||
          (selectedElementIds && selectedElementIds.includes(elem.id));

        const u = getUnitVector(wall.start, wall.end);
        const nExt = getWallExteriorNormal(wall, orientation);
        const nInt = { x: -nExt.x, y: -nExt.y };

        const wThick = wall.thickness || 150;
        const align = wall.alignment || "interior";
        const innerOffset = align === "interior" ? 0 : align === "center" ? -wThick / 2 : -wThick;

        // Position on interior wall face
        const pWorld = {
          x: wall.start.x + u.x * elem.offset + nExt.x * innerOffset,
          y: wall.start.y + u.y * elem.offset + nExt.y * innerOffset,
        };
        const sP = worldToScreen(pWorld.x, pWorld.y, cW, cH);
        const angle = Math.atan2(nInt.y, nInt.x);

        ctx.save();
        ctx.translate(sP.x, sP.y);
        ctx.rotate(-angle);

        const elemColor = isSelected
          ? "#29f57e"
          : elem.type === "socket"
          ? "#fb923c"
          : elem.type === "switch"
          ? "#a3e635"
          : "#f87171";

        if (elem.type === "socket") {
          // Architectural Socket Symbol
          ctx.strokeStyle = elemColor;
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.4)" : "rgba(251, 146, 60, 0.25)";
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(0, 8, 8, Math.PI, 0, false);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(-4, 0);
          ctx.lineTo(-4, 6);
          ctx.moveTo(4, 0);
          ctx.lineTo(4, 6);
          ctx.stroke();

          if (elem.subType === "double") {
            ctx.beginPath();
            ctx.moveTo(-8, 12);
            ctx.lineTo(8, 12);
            ctx.stroke();
          }
        } else if (elem.type === "switch") {
          // Architectural Switch Symbol
          ctx.strokeStyle = elemColor;
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.4)" : "rgba(163, 230, 53, 0.25)";
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(0, 7, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(0, 13);
          ctx.lineTo(0, 18);
          ctx.lineTo(6, 21);
          if (elem.subType === "two_way") {
            ctx.moveTo(0, 18);
            ctx.lineTo(-6, 21);
          }
          ctx.stroke();
        } else if (elem.type === "panel") {
          // Fuse Box / Sigorta Panosu
          ctx.strokeStyle = elemColor;
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.4)" : "rgba(248, 113, 113, 0.25)";
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.rect(-12, 0, 24, 14);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(-12, 0);
          ctx.lineTo(12, 14);
          ctx.stroke();
        }

        ctx.restore();

        // Temporary Dimension Lines for Selected Electrical Element (Priz, Anahtar, Sigorta Panosu)
        if (isSelected) {
          const wallLen = getDistance(wall.start, wall.end);
          const d1 = elem.offset;
          const d2 = wallLen - elem.offset;

          const dimWitnessOffset = 220;
          const pOffStart = { x: wall.start.x + nInt.x * dimWitnessOffset, y: wall.start.y + nInt.y * dimWitnessOffset };
          const pOffEl = { x: wall.start.x + u.x * elem.offset + nInt.x * dimWitnessOffset, y: wall.start.y + u.y * elem.offset + nInt.y * dimWitnessOffset };
          const pOffEnd = { x: wall.end.x + nInt.x * dimWitnessOffset, y: wall.end.y + nInt.y * dimWitnessOffset };

          const sOffStart = worldToScreen(pOffStart.x, pOffStart.y, cW, cH);
          const sOffEl = worldToScreen(pOffEl.x, pOffEl.y, cW, cH);
          const sOffEnd = worldToScreen(pOffEnd.x, pOffEnd.y, cW, cH);

          // Dimension 1: Wall Start to Electrical Element
          if (d1 > 10) {
            ctx.strokeStyle = "#4ade80";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sOffStart.x, sOffStart.y);
            ctx.lineTo(sOffEl.x, sOffEl.y);
            ctx.stroke();

            const mid1X = (sOffStart.x + sOffEl.x) / 2;
            const mid1Y = (sOffStart.y + sOffEl.y) / 2;
            const text1 = `${Math.round(d1 / 10)} cm ✎`;
            ctx.font = "bold 11px Montserrat, sans-serif";
            const m1 = ctx.measureText(text1);
            const b1W = m1.width + 12;
            const b1H = 22;

            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.strokeStyle = "#4ade80";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mid1X - b1W / 2, mid1Y - b1H / 2, b1W, b1H, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#4ade80";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text1, mid1X, mid1Y);

            tempDimHitboxesRef.current.push({
              minX: mid1X - b1W / 2 - 4,
              maxX: mid1X + b1W / 2 + 4,
              minY: mid1Y - b1H / 2 - 4,
              maxY: mid1Y + b1H / 2 + 4,
              kind: "wallOffset",
              elementId: elem.id,
              elementType: "electrical",
              isStartDim: true,
              currentVal: d1,
              wallLen,
              elementWidth: 0,
            });
          }

          // Dimension 2: Electrical Element to Wall End
          if (d2 > 10) {
            ctx.strokeStyle = "#4ade80";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sOffEl.x, sOffEl.y);
            ctx.lineTo(sOffEnd.x, sOffEnd.y);
            ctx.stroke();

            const mid2X = (sOffEl.x + sOffEnd.x) / 2;
            const mid2Y = (sOffEl.y + sOffEnd.y) / 2;
            const text2 = `${Math.round(d2 / 10)} cm ✎`;
            ctx.font = "bold 11px Montserrat, sans-serif";
            const m2 = ctx.measureText(text2);
            const b2W = m2.width + 12;
            const b2H = 22;

            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.strokeStyle = "#4ade80";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mid2X - b2W / 2, mid2Y - b2H / 2, b2W, b2H, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#4ade80";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text2, mid2X, mid2Y);

            tempDimHitboxesRef.current.push({
              minX: mid2X - b2W / 2 - 4,
              maxX: mid2X + b2W / 2 + 4,
              minY: mid2Y - b2H / 2 - 4,
              maxY: mid2Y + b2H / 2 + 4,
              kind: "wallOffset",
              elementId: elem.id,
              elementType: "electrical",
              isStartDim: false,
              currentVal: d2,
              wallLen,
              elementWidth: 0,
            });
          }
        }
      });
    }

    // 7. Draw Radiators (Doğalgaz Petekleri)
    const showRadiators = layerSettings?.radiators?.visible ?? true;
    if (showRadiators && room.radiators && room.radiators.length > 0) {
      const roomPoints = room.walls.map((w) => w.start);
      if (room.walls.length > 0) roomPoints.push(room.walls[room.walls.length - 1].end);
      const orientation = getPolygonOrientation(roomPoints);

      room.radiators.forEach((rad) => {
        const wall = room.walls.find((w) => w.id === rad.wallId);
        if (!wall) return;
        const isSelected =
          (selectedElementId === rad.id && selectedElementType === "radiator") ||
          (selectedElementIds && selectedElementIds.includes(rad.id));

        const u = getUnitVector(wall.start, wall.end);
        const nExt = getWallExteriorNormal(wall, orientation);
        const nInt = { x: -nExt.x, y: -nExt.y };

        const wThick = wall.thickness || 150;
        const align = wall.alignment || "interior";
        const innerOffset = align === "interior" ? 0 : align === "center" ? -wThick / 2 : -wThick;

        const radDepth = rad.depth || 100;
        const radWidth = rad.width || 800;

        const p1 = {
          x: wall.start.x + u.x * rad.offset + nExt.x * innerOffset,
          y: wall.start.y + u.y * rad.offset + nExt.y * innerOffset,
        };
        const p2 = { x: p1.x + u.x * radWidth, y: p1.y + u.y * radWidth };
        const p3 = { x: p2.x + nInt.x * radDepth, y: p2.y + nInt.y * radDepth };
        const p4 = { x: p1.x + nInt.x * radDepth, y: p1.y + nInt.y * radDepth };

        const s1 = worldToScreen(p1.x, p1.y, cW, cH);
        const s2 = worldToScreen(p2.x, p2.y, cW, cH);
        const s3 = worldToScreen(p3.x, p3.y, cW, cH);
        const s4 = worldToScreen(p4.x, p4.y, cW, cH);

        ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.35)" : "rgba(6, 182, 212, 0.25)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "#06b6d4";
        ctx.lineWidth = isSelected ? 2 : 1.3;

        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.lineTo(s3.x, s3.y);
        ctx.lineTo(s4.x, s4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Ribs
        const ribStep = 40;
        const numRibs = Math.floor(radWidth / ribStep);
        ctx.strokeStyle = isSelected ? "rgba(41, 245, 126, 0.6)" : "rgba(6, 182, 212, 0.6)";
        ctx.lineWidth = 1;
        for (let r = 1; r < numRibs; r++) {
          const rP1 = { x: p1.x + u.x * (r * ribStep), y: p1.y + u.y * (r * ribStep) };
          const rP2 = { x: rP1.x + nInt.x * radDepth, y: rP1.y + nInt.y * radDepth };
          const sr1 = worldToScreen(rP1.x, rP1.y, cW, cH);
          const sr2 = worldToScreen(rP2.x, rP2.y, cW, cH);
          ctx.beginPath();
          ctx.moveTo(sr1.x, sr1.y);
          ctx.lineTo(sr2.x, sr2.y);
          ctx.stroke();
        }

        // Valve
        const valveP = worldToScreen(p1.x + nInt.x * (radDepth / 2), p1.y + nInt.y * (radDepth / 2), cW, cH);
        ctx.fillStyle = isSelected ? "#29f57e" : "#ef4444";
        ctx.beginPath();
        ctx.arc(valveP.x, valveP.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Temporary Dimension Lines for Selected Radiator (Doğalgaz Peteği)
        if (isSelected) {
          const wallLen = getDistance(wall.start, wall.end);
          const d1 = rad.offset;
          const d2 = wallLen - (rad.offset + radWidth);

          const dimWitnessOffset = radDepth + 200;
          const pOffStart = { x: wall.start.x + nInt.x * dimWitnessOffset, y: wall.start.y + nInt.y * dimWitnessOffset };
          const pOffR1 = { x: wall.start.x + u.x * rad.offset + nInt.x * dimWitnessOffset, y: wall.start.y + u.y * rad.offset + nInt.y * dimWitnessOffset };
          const pOffR2 = { x: wall.start.x + u.x * (rad.offset + radWidth) + nInt.x * dimWitnessOffset, y: wall.start.y + u.y * (rad.offset + radWidth) + nInt.y * dimWitnessOffset };
          const pOffEnd = { x: wall.end.x + nInt.x * dimWitnessOffset, y: wall.end.y + nInt.y * dimWitnessOffset };

          const sOffStart = worldToScreen(pOffStart.x, pOffStart.y, cW, cH);
          const sOffR1 = worldToScreen(pOffR1.x, pOffR1.y, cW, cH);
          const sOffR2 = worldToScreen(pOffR2.x, pOffR2.y, cW, cH);
          const sOffEnd = worldToScreen(pOffEnd.x, pOffEnd.y, cW, cH);

          if (d1 > 10) {
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sOffStart.x, sOffStart.y);
            ctx.lineTo(sOffR1.x, sOffR1.y);
            ctx.stroke();

            const mid1X = (sOffStart.x + sOffR1.x) / 2;
            const mid1Y = (sOffStart.y + sOffR1.y) / 2;
            const text1 = `${Math.round(d1 / 10)} cm ✎`;
            ctx.font = "bold 11px Montserrat, sans-serif";
            const m1 = ctx.measureText(text1);
            const b1W = m1.width + 12;
            const b1H = 22;

            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mid1X - b1W / 2, mid1Y - b1H / 2, b1W, b1H, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#06b6d4";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text1, mid1X, mid1Y);

            tempDimHitboxesRef.current.push({
              minX: mid1X - b1W / 2 - 4,
              maxX: mid1X + b1W / 2 + 4,
              minY: mid1Y - b1H / 2 - 4,
              maxY: mid1Y + b1H / 2 + 4,
              kind: "wallOffset",
              elementId: rad.id,
              elementType: "radiator",
              isStartDim: true,
              currentVal: d1,
              wallLen,
              elementWidth: radWidth,
            });
          }

          if (d2 > 10) {
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sOffR2.x, sOffR2.y);
            ctx.lineTo(sOffEnd.x, sOffEnd.y);
            ctx.stroke();

            const mid2X = (sOffR2.x + sOffEnd.x) / 2;
            const mid2Y = (sOffR2.y + sOffEnd.y) / 2;
            const text2 = `${Math.round(d2 / 10)} cm ✎`;
            ctx.font = "bold 11px Montserrat, sans-serif";
            const m2 = ctx.measureText(text2);
            const b2W = m2.width + 12;
            const b2H = 22;

            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(mid2X - b2W / 2, mid2Y - b2H / 2, b2W, b2H, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#06b6d4";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text2, mid2X, mid2Y);

            tempDimHitboxesRef.current.push({
              minX: mid2X - b2W / 2 - 4,
              maxX: mid2X + b2W / 2 + 4,
              minY: mid2Y - b2H / 2 - 4,
              maxY: mid2Y + b2H / 2 + 4,
              kind: "wallOffset",
              elementId: rad.id,
              elementType: "radiator",
              isStartDim: false,
              currentVal: d2,
              wallLen,
              elementWidth: radWidth,
            });
          }
        }
      });
    }

    // 8. Draw Lighting Fixtures with Live Dynamic Dimension Lines to Reference Walls
    const showLighting = layerSettings?.lighting?.visible ?? true;
    if (showLighting && room.lighting && room.lighting.length > 0) {
      room.lighting.forEach((light) => {
        const isSelected =
          (selectedElementId === light.id && selectedElementType === "lighting") ||
          (selectedElementIds && selectedElementIds.includes(light.id));

        const sP = worldToScreen(light.x, light.y, cW, cH);
        const lightColor = isSelected ? "#29f57e" : "#fef08a";

        // Dynamic 4-Directional Dimension Lines to Surrounding Walls (Üst, Alt, Sol, Sağ)
        // ONLY RENDER WHEN SELECTED TO PREVENT CLUTTER!
        if (isSelected && room.walls.length >= 3) {
          const dims4 = calculateLightFourWayDimensions({ x: light.x, y: light.y }, room.walls);
          const entries: { key: "up" | "down" | "left" | "right"; data: { distanceMm: number; point: Point2D; wallId: string } | null; isVertical: boolean }[] = [
            { key: "up", data: dims4.up, isVertical: true },
            { key: "down", data: dims4.down, isVertical: true },
            { key: "left", data: dims4.left, isVertical: false },
            { key: "right", data: dims4.right, isVertical: false },
          ];

          entries.forEach(({ key, data, isVertical }) => {
            if (!data) return;
            const sProj = worldToScreen(data.point.x, data.point.y, cW, cH);
            const distCm = Math.round(data.distanceMm / 10);

            // Witness Line (dashed)
            ctx.strokeStyle = "rgba(41, 245, 126, 0.85)";
            ctx.lineWidth = 1.4;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(sP.x, sP.y);
            ctx.lineTo(sProj.x, sProj.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Wall T-Tick Marker
            ctx.strokeStyle = "#29f57e";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            const tick = 5;
            if (isVertical) {
              ctx.moveTo(sProj.x - tick, sProj.y);
              ctx.lineTo(sProj.x + tick, sProj.y);
            } else {
              ctx.moveTo(sProj.x, sProj.y - tick);
              ctx.lineTo(sProj.x, sProj.y + tick);
            }
            ctx.stroke();

            // Distance Pill Badge
            const midDimX = (sP.x + sProj.x) / 2;
            const midDimY = (sP.y + sProj.y) / 2;
            ctx.font = "bold 9px Montserrat, sans-serif";
            const badgeText = `${distCm} cm ✎`;
            const bMetrics = ctx.measureText(badgeText);
            const bW = bMetrics.width + 12;
            const bH = 18;
            ctx.fillStyle = "rgba(13, 13, 18, 0.95)";
            ctx.strokeStyle = "#29f57e";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(midDimX - bW / 2, midDimY - bH / 2, bW, bH, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#29f57e";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(badgeText, midDimX, midDimY);

            tempDimHitboxesRef.current.push({
              minX: midDimX - bW / 2 - 4,
              maxX: midDimX + bW / 2 + 4,
              minY: midDimY - bH / 2 - 4,
              maxY: midDimY + bH / 2 + 4,
              kind: "lightCoord",
              lightId: light.id,
              direction: key,
              wallHitCoord: isVertical ? data.point.y : data.point.x,
              currentVal: data.distanceMm,
            });
          });
        }

        // Fixture symbol
        if (light.type === "pendant") {
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.25)" : "rgba(253, 224, 71, 0.2)";
          ctx.strokeStyle = lightColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(sP.x, sP.y, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sP.x - 10, sP.y - 10);
          ctx.lineTo(sP.x + 10, sP.y + 10);
          ctx.moveTo(sP.x + 10, sP.y - 10);
          ctx.lineTo(sP.x - 10, sP.y + 10);
          ctx.stroke();
        } else if (light.type === "spot") {
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.3)" : "rgba(253, 224, 71, 0.25)";
          ctx.strokeStyle = lightColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sP.x, sP.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = lightColor;
          ctx.beginPath();
          ctx.arc(sP.x, sP.y, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.3)" : "rgba(253, 224, 71, 0.25)";
          ctx.strokeStyle = lightColor;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(sP.x, sP.y, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sP.x - 12, sP.y);
          ctx.lineTo(sP.x + 12, sP.y);
          ctx.moveTo(sP.x, sP.y - 12);
          ctx.lineTo(sP.x, sP.y + 12);
          ctx.stroke();
        }
      });
    }

    // 9. Draw Auto-Close Guide Line if room is not yet closed
    if (!room.isClosed && room.walls.length >= 1) {
      const sHead = worldToScreen(activePoint.x, activePoint.y, cW, cH);
      const sStart = worldToScreen(startPoint.x, startPoint.y, cW, cH);

      ctx.strokeStyle = isNearOrigin ? "#29f57e" : "rgba(41, 245, 126, 0.4)";
      ctx.lineWidth = isNearOrigin ? 2 : 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(sHead.x, sHead.y);
      ctx.lineTo(sStart.x, sStart.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distance tag to start point with dedicated background pill to prevent any text overlaps
      const midX = (sHead.x + sStart.x) / 2;
      const midY = (sHead.y + sStart.y) / 2 - 14;
      const tagText = `${Math.round(closingDistance / 10)} cm`;
      ctx.font = "bold 10px Montserrat, sans-serif";
      const tm = ctx.measureText(tagText);
      const tagW = tm.width + 12;
      const tagH = 18;

      ctx.fillStyle = "rgba(13, 13, 18, 0.92)";
      ctx.fillRect(midX - tagW / 2, midY - tagH / 2, tagW, tagH);
      ctx.strokeStyle = isNearOrigin ? "#29f57e" : "rgba(41, 245, 126, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(midX - tagW / 2, midY - tagH / 2, tagW, tagH);

      ctx.fillStyle = isNearOrigin ? "#29f57e" : "#4ade80";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tagText, midX, midY);
    }

    // 7. Draw Active Cursor Point & Start Point
    const sActive = worldToScreen(activePoint.x, activePoint.y, cW, cH);
    const sOrigin = worldToScreen(startPoint.x, startPoint.y, cW, cH);

    // Start point marker (pulsing circle)
    ctx.fillStyle = "rgba(41, 245, 126, 0.25)";
    ctx.beginPath();
    ctx.arc(sOrigin.x, sOrigin.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#29f57e";
    ctx.beginPath();
    ctx.arc(sOrigin.x, sOrigin.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Active Head marker
    if (!room.isClosed) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sActive.x, sActive.y, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#29f57e";
      ctx.beginPath();
      ctx.arc(sActive.x, sActive.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 7b. Draw Wall End Vertex Snap Handles & Highlights
    if (room.walls.length > 0) {
      room.walls.forEach((w) => {
        [w.start, w.end].forEach((pt) => {
          const sPt = worldToScreen(pt.x, pt.y, cW, cH);
          const isHoveredSnap = hoveredSnapPoint && Math.hypot(hoveredSnapPoint.x - pt.x, hoveredSnapPoint.y - pt.y) < 5;
          const isActiveCursor = Math.hypot(activePoint.x - pt.x, activePoint.y - pt.y) < 5;

          if (isHoveredSnap) {
            // Magnetic Glowing Snap Ring
            ctx.fillStyle = "rgba(41, 245, 126, 0.4)";
            ctx.beginPath();
            ctx.arc(sPt.x, sPt.y, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#29f57e";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(sPt.x, sPt.y, 10, 0, Math.PI * 2);
            ctx.stroke();

            // Snap Tag
            ctx.font = "bold 10px Montserrat, sans-serif";
            const snapLabel = "Duvar Ucu (Snap)";
            const sMetrics = ctx.measureText(snapLabel);
            const tagW = sMetrics.width + 10;
            const tagH = 18;
            ctx.fillStyle = "rgba(18, 18, 23, 0.92)";
            ctx.strokeStyle = "#29f57e";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(sPt.x + 12, sPt.y - tagH / 2, tagW, tagH, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#29f57e";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(snapLabel, sPt.x + 17, sPt.y);
          } else {
            // Subtle vertex marker
            ctx.fillStyle = isActiveCursor ? "rgba(41, 245, 126, 0.5)" : "rgba(255, 255, 255, 0.25)";
            ctx.strokeStyle = isActiveCursor ? "#29f57e" : "rgba(255, 255, 255, 0.6)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(sPt.x, sPt.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        });
      });
    }

    // 8. Room Center Tag when closed
    const showTags = layerSettings?.roomTags?.visible ?? true;
    if (showTags && room.isClosed && room.walls.length >= 3) {
      let sumX = 0;
      let sumY = 0;
      room.walls.forEach((w) => {
        sumX += w.start.x;
        sumY += w.start.y;
      });
      const avgWorld = { x: sumX / room.walls.length, y: sumY / room.walls.length };
      const sCenter = worldToScreen(avgWorld.x, avgWorld.y, cW, cH);

      // Pill Background
      ctx.fillStyle = "rgba(18, 18, 22, 0.85)";
      ctx.strokeStyle = "rgba(41, 245, 126, 0.35)";
      ctx.lineWidth = 1;
      const tagW = 140;
      const tagH = 50;
      ctx.beginPath();
      ctx.roundRect(sCenter.x - tagW / 2, sCenter.y - tagH / 2, tagW, tagH, 8);
      ctx.fill();
      ctx.stroke();

      // Room Name
      ctx.font = "bold 12px Montserrat, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(room.name, sCenter.x, sCenter.y - 10);

      // Area m²
      ctx.font = "bold 13px Montserrat, sans-serif";
      ctx.fillStyle = "#29f57e";
      ctx.fillText(`${room.calculatedArea.toFixed(1)} m²`, sCenter.x, sCenter.y + 10);
    }

    // 9. Marquee Selection Box
    if (selectionBox) {
      const s1 = worldToScreen(selectionBox.start.x, selectionBox.start.y, cW, cH);
      const s2 = worldToScreen(selectionBox.current.x, selectionBox.current.y, cW, cH);
      const bx = Math.min(s1.x, s2.x);
      const by = Math.min(s1.y, s2.y);
      const bw = Math.abs(s1.x - s2.x);
      const bh = Math.abs(s1.y - s2.y);

      ctx.fillStyle = "rgba(41, 245, 126, 0.12)";
      ctx.fillRect(bx, by, bw, bh);

      ctx.strokeStyle = "#29f57e";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    room,
    activePoint,
    startPoint,
    closingDistance,
    isNearOrigin,
    pan,
    zoom,
    selectedElementId,
    selectedElementType,
    selectedElementIds,
    selectionBox,
    activeTool,
    hoveredSnapPoint,
    layerSettings,
    worldToScreen,
    screenToWorld,
    canvasDimensions,
    hoveredWallId,
    hoverOffset,
    placingOpening,
  ]);

  // Mouse / Touch Event Handlers for Panning, Marquee Selection, and Tapping Elements
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Check vertex snap when moving pointer (hover detection)
    if (!isDraggingRef.current) {
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      let foundSnap: Point2D | null = null;
      let minSnapDist = Infinity;

      for (const wall of room.walls) {
        for (const pt of [wall.start, wall.end]) {
          const sPt = worldToScreen(pt.x, pt.y, rect.width, rect.height);
          const screenDist = Math.hypot(curX - sPt.x, curY - sPt.y);
          if (screenDist < 18 && screenDist < minSnapDist) {
            minSnapDist = screenDist;
            foundSnap = pt;
          }
        }
      }
      setHoveredSnapPoint(foundSnap);
    }

    if (placingOpening) {
      const curWorld = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      let foundWall: WallElement | null = null;
      let minDistance = Infinity;
      for (const wall of room.walls) {
        const d = getDistanceToSegment(curWorld, wall.start, wall.end);
        if (d < wall.thickness + 200 && d < minDistance) {
          minDistance = d;
          foundWall = wall;
        }
      }
      if (foundWall) {
        setHoveredWallId(foundWall.id);
        const off = getOffsetAlongSegment(curWorld, foundWall.start, foundWall.end);
        setHoverOffset(off);
      } else {
        setHoveredWallId(null);
        setHoverOffset(null);
      }
    }

    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const dist = Math.hypot(dx, dy);

    if (activeTool === "boxSelect") {
      // Box selection tool: dragging draws marquee box
      if (dist > 6) {
        const startWorld = screenToWorld(dragStartRef.current.x - rect.left, dragStartRef.current.y - rect.top, rect.width, rect.height);
        const curWorld = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        setSelectionBox({ start: startWorld, current: curWorld });
      }
    } else {
      // Default tool: dragging pans the canvas view smoothly
      setPan({
        x: panStartRef.current.x + dx / zoom,
        y: panStartRef.current.y - dy / zoom,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickScreenX = e.clientX - rect.left;
    const clickScreenY = e.clientY - rect.top;

    // 1. Marquee Box Selection Resolution
    if (selectionBox) {
      const boxMinX = Math.min(selectionBox.start.x, selectionBox.current.x);
      const boxMaxX = Math.max(selectionBox.start.x, selectionBox.current.x);
      const boxMinY = Math.min(selectionBox.start.y, selectionBox.current.y);
      const boxMaxY = Math.max(selectionBox.start.y, selectionBox.current.y);
      setSelectionBox(null);

      const hitIds: string[] = [];
      // Walls
      room.walls.forEach((wall) => {
        const midX = (wall.start.x + wall.end.x) / 2;
        const midY = (wall.start.y + wall.end.y) / 2;
        const inside =
          (wall.start.x >= boxMinX && wall.start.x <= boxMaxX && wall.start.y >= boxMinY && wall.start.y <= boxMaxY) ||
          (wall.end.x >= boxMinX && wall.end.x <= boxMaxX && wall.end.y >= boxMinY && wall.end.y <= boxMaxY) ||
          (midX >= boxMinX && midX <= boxMaxX && midY >= boxMinY && midY <= boxMaxY);
        if (inside) hitIds.push(wall.id);
      });

      // Doors
      room.doors.forEach((door) => {
        const wall = room.walls.find((w) => w.id === door.wallId);
        if (wall) {
          const u = getUnitVector(wall.start, wall.end);
          const p = { x: wall.start.x + u.x * door.offset, y: wall.start.y + u.y * door.offset };
          if (p.x >= boxMinX && p.x <= boxMaxX && p.y >= boxMinY && p.y <= boxMaxY) {
            hitIds.push(door.id);
          }
        }
      });

      // Windows
      room.windows.forEach((win) => {
        const wall = room.walls.find((w) => w.id === win.wallId);
        if (wall) {
          const u = getUnitVector(wall.start, wall.end);
          const p = { x: wall.start.x + u.x * (win.offset + win.width / 2), y: wall.start.y + u.y * (win.offset + win.width / 2) };
          if (p.x >= boxMinX && p.x <= boxMaxX && p.y >= boxMinY && p.y <= boxMaxY) {
            hitIds.push(win.id);
          }
        }
      });

      // Electrical
      room.electrical?.forEach((elem) => {
        const wall = room.walls.find((w) => w.id === elem.wallId);
        if (wall) {
          const u = getUnitVector(wall.start, wall.end);
          const p = { x: wall.start.x + u.x * elem.offset, y: wall.start.y + u.y * elem.offset };
          if (p.x >= boxMinX && p.x <= boxMaxX && p.y >= boxMinY && p.y <= boxMaxY) {
            hitIds.push(elem.id);
          }
        }
      });

      // Radiators
      room.radiators?.forEach((rad) => {
        const wall = room.walls.find((w) => w.id === rad.wallId);
        if (wall) {
          const u = getUnitVector(wall.start, wall.end);
          const p = { x: wall.start.x + u.x * (rad.offset + (rad.width || 800) / 2), y: wall.start.y + u.y * (rad.offset + (rad.width || 800) / 2) };
          if (p.x >= boxMinX && p.x <= boxMaxX && p.y >= boxMinY && p.y <= boxMaxY) {
            hitIds.push(rad.id);
          }
        }
      });

      // Lighting
      room.lighting?.forEach((light) => {
        if (light.x >= boxMinX && light.x <= boxMaxX && light.y >= boxMinY && light.y <= boxMaxY) {
          hitIds.push(light.id);
        }
      });

      if (hitIds.length > 0) {
        onSelectMultiple?.(hitIds);
      } else {
        onSelectElement(null, null);
        onSelectMultiple?.([]);
      }
      return;
    }

    // 2. Check Click on Temporary Dimension Line Hitboxes
    for (const hb of tempDimHitboxesRef.current) {
      if (
        clickScreenX >= hb.minX &&
        clickScreenX <= hb.maxX &&
        clickScreenY >= hb.minY &&
        clickScreenY <= hb.maxY
      ) {
        if (hb.kind === "wallOffset" && hb.elementId && hb.elementType) {
          const curValCm = Math.round((hb.currentVal || 0) / 10);
          const label = hb.isStartDim ? "Mesafe Duvar Başından (cm):" : "Mesafe Duvar Sonundan (cm):";
          const inputVal = window.prompt(label, String(curValCm));
          if (inputVal !== null) {
            const parsed = parseFloat(inputVal.trim());
            if (!isNaN(parsed) && parsed >= 0) {
              const parsedMm = parsed * 10;
              const wallLen = hb.wallLen || 3000;
              const elemW = hb.elementWidth || 0;
              let newOffset = hb.isStartDim ? parsedMm : wallLen - elemW - parsedMm;
              newOffset = Math.max(0, Math.min(wallLen - elemW, Math.round(newOffset)));
              onChangeElementOffset?.(hb.elementId, hb.elementType, newOffset);
            }
          }
          return;
        } else if (hb.kind === "lightCoord" && hb.lightId && hb.direction && hb.wallHitCoord !== undefined) {
          const curValCm = Math.round((hb.currentVal || 0) / 10);
          const dirLabel =
            hb.direction === "up" ? "Üst" : hb.direction === "down" ? "Alt" : hb.direction === "left" ? "Sol" : "Sağ";
          const inputVal = window.prompt(`Mesafe (${dirLabel} Duvara) (cm):`, String(curValCm));
          if (inputVal !== null) {
            const parsed = parseFloat(inputVal.trim());
            if (!isNaN(parsed) && parsed >= 0) {
              const newDistMm = Math.round(parsed * 10);
              const light = room.lighting?.find((l) => l.id === hb.lightId);
              if (light) {
                let newX = light.x;
                let newY = light.y;
                if (hb.direction === "up") {
                  newY = Math.round(hb.wallHitCoord - newDistMm);
                } else if (hb.direction === "down") {
                  newY = Math.round(hb.wallHitCoord + newDistMm);
                } else if (hb.direction === "left") {
                  newX = Math.round(hb.wallHitCoord + newDistMm);
                } else if (hb.direction === "right") {
                  newX = Math.round(hb.wallHitCoord - newDistMm);
                }
                onChangeLightPosition?.(hb.lightId, newX, newY);
              }
            }
          }
          return;
        }
      }
    }

    // 3. Quick Tap Hit-Testing for Snapping & Individual Elements
    const totalDist = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
    if (totalDist < 8) {
      // 3a. Snap Surveyor Cursor to Wall Endpoint
      if (hoveredSnapPoint && onSetActivePoint) {
        onSetActivePoint(hoveredSnapPoint);
        const matchedWall = room.walls.find(
          (w) => getDistance(w.start, hoveredSnapPoint) < 5 || getDistance(w.end, hoveredSnapPoint) < 5
        );
        if (matchedWall) {
          onSelectElement(matchedWall.id, "wall");
        }
        return;
      }

      const clickWorld = screenToWorld(clickScreenX, clickScreenY, rect.width, rect.height);

      // If user is placing an opening, select the clicked wall and open configuration modal
      if (placingOpening && onSelectWallForOpening) {
        for (const wall of room.walls) {
          const dist = getDistanceToSegment(clickWorld, wall.start, wall.end);
          if (dist < wall.thickness + 220) {
            const offset = getOffsetAlongSegment(clickWorld, wall.start, wall.end);
            onSelectWallForOpening(wall.id, offset, placingOpening);
            setHoveredWallId(null);
            setHoverOffset(null);
            return;
          }
        }
        return;
      }

      // 1. Hit test Radiators FIRST with exact footprint (resolves radiator under window selection conflict!)
      if (room.radiators) {
        for (const rad of room.radiators) {
          const wall = room.walls.find((w) => w.id === rad.wallId);
          if (wall) {
            const radWidth = rad.width || 800;
            const radDepth = rad.depth || 100;
            const offset = getOffsetAlongSegment(clickWorld, wall.start, wall.end);
            const distToWall = getDistanceToSegment(clickWorld, wall.start, wall.end);
            if (
              offset >= rad.offset - 40 &&
              offset <= rad.offset + radWidth + 40 &&
              distToWall <= (wall.thickness || 150) + radDepth + 120
            ) {
              if (e.shiftKey && onSelectMultiple) {
                const currentIds = selectedElementIds || [];
                const nextIds = currentIds.includes(rad.id) ? currentIds.filter((id) => id !== rad.id) : [...currentIds, rad.id];
                onSelectMultiple(nextIds);
              } else {
                onSelectElement(rad.id, "radiator");
              }
              return;
            }
          }
        }
      }

      // 2. Hit test Electrical Elements (Priz, Anahtar, Sigorta Panosu)
      if (room.electrical) {
        for (const el of room.electrical) {
          const wall = room.walls.find((w) => w.id === el.wallId);
          if (wall) {
            const u = getUnitVector(wall.start, wall.end);
            const elPos = {
              x: wall.start.x + u.x * el.offset,
              y: wall.start.y + u.y * el.offset,
            };
            if (getDistance(clickWorld, elPos) < 160) {
              if (e.shiftKey && onSelectMultiple) {
                const currentIds = selectedElementIds || [];
                const nextIds = currentIds.includes(el.id) ? currentIds.filter((id) => id !== el.id) : [...currentIds, el.id];
                onSelectMultiple(nextIds);
              } else {
                onSelectElement(el.id, "electrical");
              }
              return;
            }
          }
        }
      }

      // 3. Hit test Lighting Fixtures
      if (room.lighting) {
        for (const light of room.lighting) {
          if (getDistance(clickWorld, { x: light.x, y: light.y }) < 180) {
            if (e.shiftKey && onSelectMultiple) {
              const currentIds = selectedElementIds || [];
              const nextIds = currentIds.includes(light.id) ? currentIds.filter((id) => id !== light.id) : [...currentIds, light.id];
              onSelectMultiple(nextIds);
            } else {
              onSelectElement(light.id, "lighting");
            }
            return;
          }
        }
      }

      // 4. Hit test Doors
      for (const door of room.doors) {
        const wall = room.walls.find((w) => w.id === door.wallId);
        if (wall) {
          const offset = getOffsetAlongSegment(clickWorld, wall.start, wall.end);
          const distToWall = getDistanceToSegment(clickWorld, wall.start, wall.end);
          if (
            offset >= door.offset - 40 &&
            offset <= door.offset + door.width + 40 &&
            distToWall <= (wall.thickness || 150) + 200
          ) {
            if (e.shiftKey && onSelectMultiple) {
              const currentIds = selectedElementIds || [];
              const nextIds = currentIds.includes(door.id) ? currentIds.filter((id) => id !== door.id) : [...currentIds, door.id];
              onSelectMultiple(nextIds);
            } else {
              onSelectElement(door.id, "door");
            }
            return;
          }
        }
      }

      // 5. Hit test Windows (TIGHT bounds within wall segment, so radiators underneath are never blocked)
      for (const win of room.windows) {
        const wall = room.walls.find((w) => w.id === win.wallId);
        if (wall) {
          const offset = getOffsetAlongSegment(clickWorld, wall.start, wall.end);
          const distToWall = getDistanceToSegment(clickWorld, wall.start, wall.end);
          if (
            offset >= win.offset - 30 &&
            offset <= win.offset + win.width + 30 &&
            distToWall <= (wall.thickness || 150) / 2 + 80
          ) {
            if (e.shiftKey && onSelectMultiple) {
              const currentIds = selectedElementIds || [];
              const nextIds = currentIds.includes(win.id) ? currentIds.filter((id) => id !== win.id) : [...currentIds, win.id];
              onSelectMultiple(nextIds);
            } else {
              onSelectElement(win.id, "window");
            }
            return;
          }
        }
      }

      // 6. Hit test Walls (Distance from point to segment)
      for (const wall of room.walls) {
        const dist = getDistanceToSegment(clickWorld, wall.start, wall.end);
        if (dist < wall.thickness + 120) {
          if (e.shiftKey && onSelectMultiple) {
            const currentIds = selectedElementIds || [];
            const nextIds = currentIds.includes(wall.id) ? currentIds.filter((id) => id !== wall.id) : [...currentIds, wall.id];
            onSelectMultiple(nextIds);
          } else {
            onSelectElement(wall.id, "wall");
          }
          return;
        }
      }

      // Tapped empty space -> Deselect
      onSelectElement(null, null);
      onSelectMultiple?.([]);
    }
  };

  // Helper: Point to line segment distance
  function getDistanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
    const l2 = Math.hypot(b.x - a.x, b.y - a.y) ** 2;
    if (l2 === 0) return getDistance(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return getDistance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }

  // Helper: Offset along segment from point 'a' in mm
  function getOffsetAlongSegment(p: Point2D, a: Point2D, b: Point2D): number {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 0) return 0;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    const t = Math.max(0, Math.min(1, dot / (len * len)));
    return Math.round(t * len);
  }

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => Math.max(0.02, Math.min(prev * zoomFactor, 0.8)));
  };

  return (
    <div className={styles.canvasContainer} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* Placing Opening Prompt Banner */}
      {placingOpening && (
        <div className={styles.placingBanner}>
          <span className={styles.placingText}>
            {placingOpening === "door"
              ? "🚪 Kapı eklemek için duvara tıklayın"
              : placingOpening === "window"
              ? "🪟 Pencere eklemek için duvara tıklayın"
              : placingOpening === "electrical"
              ? "⚡ Elektrik elemanı (priz/anahtar/sigorta) eklemek için duvara tıklayın"
              : "🔥 Doğalgaz peteği eklemek için duvara tıklayın"}
          </span>
          {onCancelPlacingOpening && (
            <button
              type="button"
              className={styles.cancelPlacingBtn}
              onClick={onCancelPlacingOpening}
            >
              İptal
            </button>
          )}
        </div>
      )}

      {/* Box Selection Active Banner */}
      {activeTool === "boxSelect" && !placingOpening && (
        <div className={styles.placingBanner} style={{ borderColor: "#29f57e" }}>
          <span className={styles.placingText}>
            🔲 Kutu Seçim Aracı Aktif — Birden çok duvarı ve öğeyi seçmek için sürükleyin
          </span>
          <button
            type="button"
            className={styles.cancelPlacingBtn}
            onClick={() => setActiveTool("pointer")}
          >
            Kapat
          </button>
        </div>
      )}

      {/* Floating Canvas Controls */}
      <div className={styles.floatingControls}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleAutoFit}
          title="Fit & Center Room"
        >
          <MdCenterFocusStrong size={18} />
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setZoom((prev) => Math.min(prev * 1.25, 0.8))}
          title="Zoom In"
        >
          <MdZoomIn size={18} />
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setZoom((prev) => Math.max(prev * 0.8, 0.02))}
          title="Zoom Out"
        >
          <MdZoomOut size={18} />
        </button>

        {/* Default Navigation / Single Select Tool */}
        <button
          type="button"
          className={`${styles.iconBtn} ${activeTool === "pointer" ? styles.iconBtnActive : ""}`}
          onClick={() => setActiveTool("pointer")}
          title="Gezinme & Tekil Seçim (Sürükleyerek Kaydırın, Tıklayarak Seçin)"
        >
          <MdTouchApp size={18} />
        </button>

        {/* Dedicated Box Select Tool */}
        <button
          type="button"
          className={`${styles.iconBtn} ${activeTool === "boxSelect" ? styles.iconBtnActive : ""}`}
          onClick={() => setActiveTool((prev) => (prev === "boxSelect" ? "pointer" : "boxSelect"))}
          title="Kutu Seçim Aracı (Sürükleyerek birden çok öğeyi kutu içine alın)"
        >
          <MdHighlightAlt size={18} />
        </button>
      </div>
    </div>
  );
}
