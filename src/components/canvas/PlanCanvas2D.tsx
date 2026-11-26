"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { RoomPlanItem, Point2D, LayerSettings, WallElement, BeamElement, ChimneyElement, ACUnitElement } from "@/types/plan";
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
  computeBeamGeometry,
  isPointInPolygon,
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
  selectedElementType: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | "beam" | "chimney" | "acUnit" | null;
  selectedElementIds?: string[];
  onSelectElement: (id: string | null, type: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | "beam" | "chimney" | "acUnit" | null) => void;
  onSelectMultiple?: (ids: string[]) => void;
  onChangeElementOffset?: (elementId: string, type: "door" | "window" | "electrical" | "radiator" | "acUnit", newOffsetMm: number) => void;
  onChangeLightPosition?: (lightId: string, newX: number, newY: number) => void;
  onChangeBeamPosition?: (beamId: string, updates: Partial<BeamElement>) => void;
  onChangeChimneyPosition?: (chimneyId: string, newX: number, newY: number) => void;
  onChangeACUnitPosition?: (acId: string, updates: Partial<ACUnitElement>) => void;
  onSetActivePoint?: (pt: Point2D) => void;
  layerSettings?: LayerSettings;
  placingOpening?: "door" | "window" | "electrical" | "radiator" | "acUnit" | null;
  onSelectWallForOpening?: (wallId: string, offsetMm: number, type: "door" | "window" | "electrical" | "radiator" | "acUnit") => void;
  onCancelPlacingOpening?: () => void;
}

interface TempDimHitbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  kind: "wallOffset" | "lightCoord" | "beamCoord" | "chimneyCoord";
  elementId?: string;
  elementType?: "door" | "window" | "electrical" | "radiator" | "beam" | "chimney" | "acUnit";
  isStartDim?: boolean;
  currentVal?: number;
  wallLen?: number;
  elementWidth?: number;
  lightId?: string;
  beamId?: string;
  chimneyId?: string;
  direction?: "up" | "down" | "left" | "right";
  wallHitCoord?: number;
}

// Pure geometry helpers (module scope)
function getDistanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const l2 = Math.hypot(b.x - a.x, b.y - a.y) ** 2;
  if (l2 === 0) return getDistance(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return getDistance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function getOffsetAlongSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= 0) return 0;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const t = Math.max(0, Math.min(1, dot / (len * len)));
  return Math.round(t * len);
}

// Lightweight text width cache keyed by font + text to avoid slow per-frame ctx.measureText() calls
const textMeasureCache = new Map<string, number>();
function measureTextCached(ctx: CanvasRenderingContext2D, text: string): { width: number } {
  const key = `${ctx.font}|${text}`;
  const cached = textMeasureCache.get(key);
  if (cached !== undefined) return { width: cached };
  const w = ctx.measureText(text).width;
  if (textMeasureCache.size > 500) {
    textMeasureCache.clear();
  }
  textMeasureCache.set(key, w);
  return { width: w };
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
  onChangeBeamPosition,
  onChangeChimneyPosition,
  onChangeACUnitPosition,
  onSetActivePoint,
  layerSettings,
  placingOpening,
  onSelectWallForOpening,
  onCancelPlacingOpening,
}: PlanCanvas2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ResizeObserver State (triggers initial camera fit & redraw on size changes)
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const canvasRectRef = useRef<{ width: number; height: number; left: number; top: number; dpr: number }>({
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    dpr: 1,
  });

  // High-frequency interactive canvas state stored in refs (zero React re-renders during pan/zoom/hover!)
  const hoveredWallIdRef = useRef<string | null>(null);
  const hoverOffsetRef = useRef<number | null>(null);
  const selectionBoxRef = useRef<{ start: Point2D; current: Point2D } | null>(null);
  const hoveredSnapPointRef = useRef<Point2D | null>(null);
  const tempDimHitboxesRef = useRef<TempDimHitbox[]>([]);

  // Marquee / Box Selection Mode (UI button toggle only)
  const [activeTool, setActiveTool] = useState<"pointer" | "boxSelect">("pointer");

  // Viewport Transform stored in refs so 60-120Hz pan/pinch/wheel bypass React reconciliation
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomRef = useRef<number>(0.1); // 1 mm = 0.1 px (1m = 100px)

  // Camera animation & single-frame RAF draw scheduler refs
  const cameraAnimRef = useRef<number | null>(null);
  const rafDrawRef = useRef<number | null>(null);
  const drawFrameRef = useRef<() => void>(() => {});
  const initializedRoomIdRef = useRef<string | null>(null);
  const prevWallCountRef = useRef<number>(room.walls.length);
  const prevIsClosedRef = useRef<boolean>(room.isClosed);

  const scheduleDraw = useCallback(() => {
    if (rafDrawRef.current !== null) return;
    rafDrawRef.current = requestAnimationFrame(() => {
      rafDrawRef.current = null;
      drawFrameRef.current();
    });
  }, []);

  const cancelCameraAnimation = useCallback(() => {
    if (cameraAnimRef.current !== null) {
      cancelAnimationFrame(cameraAnimRef.current);
      cameraAnimRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelCameraAnimation();
      if (rafDrawRef.current !== null) {
        cancelAnimationFrame(rafDrawRef.current);
        rafDrawRef.current = null;
      }
    };
  }, [cancelCameraAnimation]);

  // Smoothly animate pan & zoom via requestAnimationFrame (zero React state churn!)
  const animateCameraTo = useCallback(
    (targetPan: { x: number; y: number }, targetZoom: number, durationMs = 240) => {
      cancelCameraAnimation();

      if (durationMs <= 0) {
        cameraAnimRef.current = requestAnimationFrame(() => {
          panRef.current = targetPan;
          zoomRef.current = targetZoom;
          cameraAnimRef.current = null;
          scheduleDraw();
        });
        return;
      }

      const startPan = { ...panRef.current };
      const startZoom = zoomRef.current;
      const startTime = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / durationMs);
        // Cubic ease-out for natural CAD camera glide
        const ease = 1 - Math.pow(1 - t, 3);

        panRef.current = {
          x: startPan.x + (targetPan.x - startPan.x) * ease,
          y: startPan.y + (targetPan.y - startPan.y) * ease,
        };
        zoomRef.current = startZoom + (targetZoom - startZoom) * ease;
        scheduleDraw();

        if (t < 1) {
          cameraAnimRef.current = requestAnimationFrame(step);
        } else {
          cameraAnimRef.current = null;
        }
      };

      cameraAnimRef.current = requestAnimationFrame(step);
    },
    [cancelCameraAnimation, scheduleDraw]
  );

  // Measure live HUD insets (top overlay + bottom SurveyorControlBar) so camera always frames in the visible canvas slot
  const getVisibleInsets = useCallback((rect: { width: number; height: number }) => {
    const isMobile = rect.width <= 768;
    const topInset = isMobile ? 64 : 76;
    const sideMargin = isMobile ? 28 : 80;
    const rightMargin = isMobile ? 54 : 80; // Clear floating zoom/tool buttons on right

    let bottomInset = isMobile ? (room.isClosed ? 124 : 285) : 140;
    const barEl = containerRef.current?.parentElement?.querySelector<HTMLElement>("[data-surveyor-bar='true']");
    if (barEl) {
      const barHeight = barEl.getBoundingClientRect().height;
      if (barHeight > 20) {
        bottomInset = barHeight + 16;
      }
    }

    return { topInset, bottomInset, sideMargin, rightMargin, isMobile };
  }, [room.isClosed]);

  // Dragging & Multi-Touch Pinch state
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    dist: number;
    zoom: number;
    midWorld: { x: number; y: number };
  } | null>(null);
  const didPinchRef = useRef(false);

  // In-app Dimension Popover (replaces native window.prompt for mobile numeric keypad UX)
  const [dimEditState, setDimEditState] = useState<{
    hitbox: TempDimHitbox;
    label: string;
    value: string;
  } | null>(null);

  // ResizeObserver: cache rect & update integer DPR backing store ONLY when layout actually changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvasRectRef.current = {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        dpr,
      };

      const canvas = canvasRef.current;
      if (canvas) {
        const targetW = Math.round(rect.width * dpr);
        const targetH = Math.round(rect.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
      }

      setCanvasDimensions((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height }
      );
      scheduleDraw();
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
  }, [scheduleDraw]);

  // Closing snap condition
  const startPoint = useMemo(() => {
    return room.walls.length > 0 ? room.walls[0].start : { x: 0, y: 0 };
  }, [room.walls]);

  const closingDistance = getDistance(activePoint, startPoint);
  const canClose = !room.isClosed && room.walls.length >= 2;
  const isNearOrigin = canClose && closingDistance < 600;

  // World to Screen coordinates helper (reads latest panRef/zoomRef — zero re-allocations!)
  const worldToScreen = useCallback((wX: number, wY: number, cW: number, cH: number) => {
    const curPan = panRef.current;
    const curZoom = zoomRef.current;
    const sX = (wX + curPan.x) * curZoom + cW / 2;
    const sY = cH / 2 - (wY + curPan.y) * curZoom; // Y is inverted in CAD standard
    return { x: sX, y: sY };
  }, []);

  // Screen to World coordinates helper (reads latest panRef/zoomRef — zero re-allocations!)
  const screenToWorld = useCallback((sX: number, sY: number, cW: number, cH: number) => {
    const curPan = panRef.current;
    const curZoom = zoomRef.current;
    const wX = (sX - cW / 2) / curZoom - curPan.x;
    const wY = (cH / 2 - sY) / curZoom - curPan.y;
    return { x: wX, y: wY };
  }, []);

  // Auto-fit room to the exact visible viewport slot (CSS pixels, live HUD insets)
  const computeFitCamera = useCallback(
    (wallsToFit: WallElement[], cursorPt: Point2D) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const { topInset, bottomInset, sideMargin, rightMargin, isMobile } = getVisibleInsets(rect);
      const availW = Math.max(100, rect.width - sideMargin - rightMargin);
      const availH = Math.max(100, rect.height - topInset - bottomInset);

      // Compute visible slot center offset from raw canvas center
      const visCenterX = sideMargin + availW / 2;
      const visCenterY = topInset + availH / 2;
      const dxCenterPx = visCenterX - rect.width / 2;
      const dyCenterPx = visCenterY - rect.height / 2;

      if (wallsToFit.length === 0) {
        const defaultZoom = isMobile ? 0.075 : 0.11;
        return {
          zoom: defaultZoom,
          pan: {
            x: -cursorPt.x + dxCenterPx / defaultZoom,
            y: -cursorPt.y - dyCenterPx / defaultZoom,
          },
        };
      }

      const bbox = getWallsBoundingBox(wallsToFit);
      // Use a sensible minimum span (2500mm) so a single short wall doesn't zoom in excessively
      const effectiveW = Math.max(2500, bbox.width);
      const effectiveH = Math.max(2500, bbox.height);

      const fitZoom = Math.min(availW / effectiveW, availH / effectiveH) * 0.82;
      const maxAutoZoom = isMobile ? 0.16 : 0.22;
      const clampedZoom = Number(Math.max(0.02, Math.min(fitZoom, maxAutoZoom)).toFixed(4));

      return {
        zoom: clampedZoom,
        pan: {
          x: -bbox.centerX + dxCenterPx / clampedZoom,
          y: -bbox.centerY - dyCenterPx / clampedZoom,
        },
      };
    },
    [getVisibleInsets]
  );

  const handleAutoFit = useCallback(
    (animate = true) => {
      const target = computeFitCamera(room.walls, activePoint);
      if (!target) return;
      animateCameraTo(target.pan, target.zoom, animate ? 240 : 0);
    },
    [computeFitCamera, room.walls, activePoint, animateCameraTo]
  );

  // Zoom around the center of the visible canvas area (for +/- buttons)
  const handleStepZoom = useCallback(
    (factor: number) => {
      cancelCameraAnimation();
      const rect = canvasRectRef.current;
      if (rect.width <= 0 || rect.height <= 0) {
        zoomRef.current = Math.max(0.015, Math.min(zoomRef.current * factor, 0.8));
        scheduleDraw();
        return;
      }
      const { topInset, bottomInset, sideMargin, rightMargin } = getVisibleInsets(rect);
      const anchorX = sideMargin + Math.max(100, rect.width - sideMargin - rightMargin) / 2;
      const anchorY = topInset + Math.max(100, rect.height - topInset - bottomInset) / 2;

      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const newZoom = Math.max(0.015, Math.min(curZoom * factor, 0.8));

      const anchorWorldX = (anchorX - rect.width / 2) / curZoom - curPan.x;
      const anchorWorldY = (rect.height / 2 - anchorY) / curZoom - curPan.y;
      const newPan = {
        x: (anchorX - rect.width / 2) / newZoom - anchorWorldX,
        y: (rect.height / 2 - anchorY) / newZoom - anchorWorldY,
      };

      animateCameraTo(newPan, newZoom, 140);
    },
    [cancelCameraAnimation, getVisibleInsets, animateCameraTo, scheduleDraw]
  );

  // 1. Initial fit ONCE per room load (wait until canvas has non-zero dimensions)
  useEffect(() => {
    if (canvasDimensions.width <= 0 || canvasDimensions.height <= 0) return;

    const needsInit = initializedRoomIdRef.current !== room.id;
    // Also refit once if room hydrated from empty -> existing walls right after initial mount
    const hydratedWalls =
      !needsInit && prevWallCountRef.current === 0 && room.walls.length > 1;

    if (needsInit || hydratedWalls) {
      initializedRoomIdRef.current = room.id;
      prevWallCountRef.current = room.walls.length;
      prevIsClosedRef.current = room.isClosed;
      const target = computeFitCamera(room.walls, activePoint);
      if (target) {
        animateCameraTo(target.pan, target.zoom, 0);
      }
    }
  }, [room.id, room.walls, room.isClosed, activePoint, canvasDimensions.width, canvasDimensions.height, computeFitCamera, animateCameraTo]);

  // 2. Smart camera follow when adding walls or closing the room (never snaps/fights manual edits!)
  useEffect(() => {
    if (initializedRoomIdRef.current !== room.id) return;

    const prevCount = prevWallCountRef.current;
    const prevClosed = prevIsClosedRef.current;
    prevWallCountRef.current = room.walls.length;
    prevIsClosedRef.current = room.isClosed;

    // Room just closed -> smoothly frame completed room in the newly expanded viewport
    if (!prevClosed && room.isClosed && room.walls.length > 0) {
      const target = computeFitCamera(room.walls, activePoint);
      if (target) animateCameraTo(target.pan, target.zoom, 280);
      return;
    }

    // New wall added while drafting -> smoothly keep the room & active cursor comfortably framed
    // without jarring zoom-in jumps!
    if (room.walls.length > prevCount && !room.isClosed) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const { topInset, bottomInset, sideMargin, rightMargin } = getVisibleInsets(rect);
      const safeLeft = sideMargin + 16;
      const safeRight = rect.width - rightMargin - 16;
      const safeTop = topInset + 16;
      const safeBottom = rect.height - bottomInset - 16;
      const safeW = Math.max(80, safeRight - safeLeft);
      const safeH = Math.max(80, safeBottom - safeTop);

      const curZoom = zoomRef.current;
      const curPan = panRef.current;

      const bbox = getWallsBoundingBox(room.walls);
      // Include activePoint in bounds check
      const minX = Math.min(bbox.minX, activePoint.x);
      const maxX = Math.max(bbox.maxX, activePoint.x);
      const minY = Math.min(bbox.minY, activePoint.y);
      const maxY = Math.max(bbox.maxY, activePoint.y);
      const spanW = Math.max(1000, maxX - minX);
      const spanH = Math.max(1000, maxY - minY);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Check current screen bounds of the active cursor and the room
      const toScreen = (wx: number, wy: number) => ({
        x: (wx + curPan.x) * curZoom + rect.width / 2,
        y: rect.height / 2 - (wy + curPan.y) * curZoom,
      });

      const sCursor = toScreen(activePoint.x, activePoint.y);
      const sMin = toScreen(minX, maxY); // top-left in screen
      const sMax = toScreen(maxX, minY); // bottom-right in screen

      const cursorOutside =
        sCursor.x < safeLeft + 24 ||
        sCursor.x > safeRight - 24 ||
        sCursor.y < safeTop + 24 ||
        sCursor.y > safeBottom - 24;

      const roomExceedsSafe =
        sMin.x < safeLeft ||
        sMax.x > safeRight ||
        sMin.y < safeTop ||
        sMax.y > safeBottom;

      if (!cursorOutside && !roomExceedsSafe) {
        // Everything is already comfortably in view — don't move the camera at all!
        return;
      }

      // Compute zoom needed so the full drawn footprint fits with generous breathing room for the next wall
      // Only zoom OUT (never unexpectedly zoom in while adding walls!)
      const fitZoomForSpan = Math.min(safeW / spanW, safeH / spanH) * 0.78;
      const nextZoom = Number(
        Math.max(0.015, Math.min(curZoom, fitZoomForSpan)).toFixed(4)
      );

      const visCenterX = safeLeft + safeW / 2;
      const visCenterY = safeTop + safeH / 2;
      const dxCenterPx = visCenterX - rect.width / 2;
      const dyCenterPx = visCenterY - rect.height / 2;

      const targetPan = {
        x: -centerX + dxCenterPx / nextZoom,
        y: -centerY - dyCenterPx / nextZoom,
      };

      animateCameraTo(targetPan, nextZoom, 260);
    }
  }, [room.id, room.walls, room.isClosed, activePoint, getVisibleInsets, computeFitCamera, animateCameraTo]);

  // Main Render Function (invoked via single-frame RAF scheduler; zero React re-renders during pan/zoom/hover)
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Read cached layout rect & integer DPR buffer dimensions (never forces layout reflow mid-gesture!)
    let { width: cW, height: cH, dpr } = canvasRectRef.current;
    if (cW <= 0 || cH <= 0) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      dpr = window.devicePixelRatio || 1;
      cW = rect.width;
      cH = rect.height;
      canvasRectRef.current = { width: cW, height: cH, left: rect.left, top: rect.top, dpr };
      const targetW = Math.round(cW * dpr);
      const targetH = Math.round(cH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    }

    const zoom = zoomRef.current;
    const hoveredWallId = hoveredWallIdRef.current;
    const hoverOffset = hoverOffsetRef.current;
    const hoveredSnapPoint = hoveredSnapPointRef.current;
    const selectionBox = selectionBoxRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
              ? "rgba(250, 204, 21, 0.4)"
              : placingOpening === "window"
                ? "rgba(56, 189, 248, 0.4)"
                : placingOpening === "electrical"
                  ? "rgba(74, 222, 128, 0.4)"
                  : placingOpening === "acUnit"
                    ? "rgba(6, 182, 212, 0.4)"
                    : "rgba(251, 146, 60, 0.4)";
          strokeColor =
            placingOpening === "door"
              ? "#facc15"
              : placingOpening === "window"
                ? "#38bdf8"
                : placingOpening === "electrical"
                  ? "#4ade80"
                  : placingOpening === "acUnit"
                    ? "#06b6d4"
                    : "#fb923c";
          lineWidth = 3.2;
        } else if (placingOpening) {
          // Subtle target highlight on all walls while in placement mode (crucial on touchscreens without hover)
          fillColor =
            placingOpening === "door"
              ? "rgba(250, 204, 21, 0.16)"
              : placingOpening === "window"
                ? "rgba(56, 189, 248, 0.18)"
                : placingOpening === "electrical"
                  ? "rgba(74, 222, 128, 0.16)"
                  : placingOpening === "acUnit"
                    ? "rgba(6, 182, 212, 0.16)"
                    : "rgba(251, 146, 60, 0.16)";
          strokeColor =
            placingOpening === "door"
              ? "rgba(250, 204, 21, 0.85)"
              : placingOpening === "window"
                ? "rgba(56, 189, 248, 0.9)"
                : placingOpening === "electrical"
                  ? "rgba(74, 222, 128, 0.85)"
                  : placingOpening === "acUnit"
                    ? "rgba(6, 182, 212, 0.85)"
                    : "rgba(251, 146, 60, 0.85)";
          lineWidth = 2.2;
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
          const offMet = measureTextCached(ctx, offText);
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
          const metrics = measureTextCached(ctx, dimStr);
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
          // Realistic parallel multi-track sliding panels with clean clearance and no overlap collision
          const numSegs = Math.max(2, Math.min(4, door.slidingSegments || 2));
          const clearW = door.width - jambW * 2;
          const panelW = clearW / numSegs;
          const panelThick = Math.min(30, (wThick * 0.28) / (numSegs === 2 ? 1.5 : numSegs * 0.8));
          const totalTrackSpread = Math.min(wThick * 0.5, 60);
          const trackSpacing = numSegs > 1 ? totalTrackSpread / (numSegs - 1) : 0;
          const midTrackOffset = (innerOffset + outerOffset) / 2;

          for (let sIdx = 0; sIdx < numSegs; sIdx++) {
            // Consecutive panels staggered along the opening
            const segStartX = pA.x + u.x * (jambW + sIdx * panelW);
            const segStartY = pA.y + u.y * (jambW + sIdx * panelW);
            // Parallel distinct track rails (interior to exterior)
            const trackOffset = midTrackOffset - totalTrackSpread / 2 + sIdx * trackSpacing;

            const pS1 = {
              x: segStartX + nExt.x * (trackOffset - panelThick / 2),
              y: segStartY + nExt.y * (trackOffset - panelThick / 2),
            };
            const pS2 = {
              x: segStartX + u.x * panelW + nExt.x * (trackOffset - panelThick / 2),
              y: segStartY + u.y * panelW + nExt.y * (trackOffset - panelThick / 2),
            };
            const pS3 = {
              x: segStartX + u.x * panelW + nExt.x * (trackOffset + panelThick / 2),
              y: segStartY + u.y * panelW + nExt.y * (trackOffset + panelThick / 2),
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
            ctx.lineWidth = 1.4;

            ctx.beginPath();
            ctx.moveTo(sS1.x, sS1.y);
            ctx.lineTo(sS2.x, sS2.y);
            ctx.lineTo(sS3.x, sS3.y);
            ctx.lineTo(sS4.x, sS4.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Directional arrow on sliding panel
            const midX = (sS1.x + sS2.x) / 2;
            const midY = (sS1.y + sS2.y) / 2;
            const arrowDir = sIdx % 2 === 0 ? 1 : -1;
            const lenP = Math.hypot(sS2.x - sS1.x, sS2.y - sS1.y) || 1;
            const scrU = { x: (sS2.x - sS1.x) / lenP, y: (sS2.y - sS1.y) / lenP };
            ctx.strokeStyle = isSelected ? "#29f57e" : "#eab308";
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(midX - scrU.x * 6 * arrowDir, midY - scrU.y * 6 * arrowDir);
            ctx.lineTo(midX + scrU.x * 6 * arrowDir, midY + scrU.y * 6 * arrowDir);
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

        // 1. Exterior Window Sill (Denizlik) - Projects 40mm outwards and 30mm sideways beyond the wall opening
        const sillProjection = 40;
        const sillEar = 30;
        const sSill1 = worldToScreen(p1World.x - u.x * sillEar + nExt.x * outerOffset, p1World.y - u.y * sillEar + nExt.y * outerOffset, cW, cH);
        const sSill2 = worldToScreen(p2World.x + u.x * sillEar + nExt.x * outerOffset, p2World.y + u.y * sillEar + nExt.y * outerOffset, cW, cH);
        const sSill3 = worldToScreen(p2World.x + u.x * sillEar + nExt.x * (outerOffset + sillProjection), p2World.y + u.y * sillEar + nExt.y * (outerOffset + sillProjection), cW, cH);
        const sSill4 = worldToScreen(p1World.x - u.x * sillEar + nExt.x * (outerOffset + sillProjection), p1World.y - u.y * sillEar + nExt.y * (outerOffset + sillProjection), cW, cH);

        ctx.fillStyle = isSelected ? "rgba(56, 189, 248, 0.25)" : "rgba(30, 41, 59, 0.9)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(148, 163, 184, 0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sSill1.x, sSill1.y);
        ctx.lineTo(sSill2.x, sSill2.y);
        ctx.lineTo(sSill3.x, sSill3.y);
        ctx.lineTo(sSill4.x, sSill4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 2. Interior Stool Line (İç denizlik çıtası)
        const stoolProjection = 15;
        const sStool1 = worldToScreen(p1World.x + nExt.x * (innerOffset - stoolProjection), p1World.y + nExt.y * (innerOffset - stoolProjection), cW, cH);
        const sStool2 = worldToScreen(p2World.x + nExt.x * (innerOffset - stoolProjection), p2World.y + nExt.y * (innerOffset - stoolProjection), cW, cH);
        ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(148, 163, 184, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sStool1.x, sStool1.y);
        ctx.lineTo(sStool2.x, sStool2.y);
        ctx.stroke();

        // 3. Window Wall Cavity Opening
        const c1 = worldToScreen(p1World.x + nExt.x * innerOffset, p1World.y + nExt.y * innerOffset, cW, cH);
        const c2 = worldToScreen(p2World.x + nExt.x * innerOffset, p2World.y + nExt.y * innerOffset, cW, cH);
        const c3 = worldToScreen(p2World.x + nExt.x * outerOffset, p2World.y + nExt.y * outerOffset, cW, cH);
        const c4 = worldToScreen(p1World.x + nExt.x * outerOffset, p1World.y + nExt.y * outerOffset, cW, cH);

        ctx.fillStyle = isSelected ? "rgba(56, 189, 248, 0.2)" : "rgba(10, 15, 26, 0.95)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "#38bdf8";
        ctx.lineWidth = isSelected ? 2.2 : 1.4;

        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.lineTo(c3.x, c3.y);
        ctx.lineTo(c4.x, c4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 4. Left and Right Architectural Jamb Casings (Yan söveler / Kasa)
        const jambW = Math.min(50, win.width * 0.08);
        const jL1 = c1;
        const jL2 = worldToScreen(p1World.x + u.x * jambW + nExt.x * innerOffset, p1World.y + u.y * jambW + nExt.y * innerOffset, cW, cH);
        const jL3 = worldToScreen(p1World.x + u.x * jambW + nExt.x * outerOffset, p1World.y + u.y * jambW + nExt.y * outerOffset, cW, cH);
        const jL4 = c4;

        const jR1 = worldToScreen(p2World.x - u.x * jambW + nExt.x * innerOffset, p2World.y - u.y * jambW + nExt.y * innerOffset, cW, cH);
        const jR2 = c2;
        const jR3 = c3;
        const jR4 = worldToScreen(p2World.x - u.x * jambW + nExt.x * outerOffset, p2World.y - u.y * jambW + nExt.y * outerOffset, cW, cH);

        ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.35)" : "rgba(30, 41, 59, 0.95)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(56, 189, 248, 0.8)";
        ctx.lineWidth = 1;

        // Left jamb
        ctx.beginPath();
        ctx.moveTo(jL1.x, jL1.y);
        ctx.lineTo(jL2.x, jL2.y);
        ctx.lineTo(jL3.x, jL3.y);
        ctx.lineTo(jL4.x, jL4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Right jamb
        ctx.beginPath();
        ctx.moveTo(jR1.x, jR1.y);
        ctx.lineTo(jR2.x, jR2.y);
        ctx.lineTo(jR3.x, jR3.y);
        ctx.lineTo(jR4.x, jR4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 5. Dual Glazing Pane Lines (Çift Cam / Isıcam)
        const midOffset = (innerOffset + outerOffset) / 2;
        const glassGap = 16;
        const g1A = worldToScreen(p1World.x + u.x * jambW + nExt.x * (midOffset - glassGap / 2), p1World.y + u.y * jambW + nExt.y * (midOffset - glassGap / 2), cW, cH);
        const g2A = worldToScreen(p2World.x - u.x * jambW + nExt.x * (midOffset - glassGap / 2), p2World.y - u.y * jambW + nExt.y * (midOffset - glassGap / 2), cW, cH);
        const g1B = worldToScreen(p1World.x + u.x * jambW + nExt.x * (midOffset + glassGap / 2), p1World.y + u.y * jambW + nExt.y * (midOffset + glassGap / 2), cW, cH);
        const g2B = worldToScreen(p2World.x - u.x * jambW + nExt.x * (midOffset + glassGap / 2), p2World.y - u.y * jambW + nExt.y * (midOffset + glassGap / 2), cW, cH);

        ctx.strokeStyle = isSelected ? "#ffffff" : "#38bdf8";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(g1A.x, g1A.y);
        ctx.lineTo(g2A.x, g2A.y);
        ctx.moveTo(g1B.x, g1B.y);
        ctx.lineTo(g2B.x, g2B.y);
        ctx.stroke();

        // 6. Architectural Division Mullions / Sashes (Kayıtlar)
        const segs = win.segments || (win.windowType === "sliding" ? 2 : 1);
        const clearOpeningW = win.width - jambW * 2;
        if (segs > 1) {
          ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(224, 242, 254, 0.85)";
          ctx.lineWidth = 1.5;
          const mullionThick = 24;
          for (let s = 1; s < segs; s++) {
            const mFrac = s / segs;
            const mCenter = jambW + clearOpeningW * mFrac;
            const mA1 = worldToScreen(p1World.x + u.x * (mCenter - mullionThick / 2) + nExt.x * innerOffset, p1World.y + u.y * (mCenter - mullionThick / 2) + nExt.y * innerOffset, cW, cH);
            const mA2 = worldToScreen(p1World.x + u.x * (mCenter + mullionThick / 2) + nExt.x * innerOffset, p1World.y + u.y * (mCenter + mullionThick / 2) + nExt.y * innerOffset, cW, cH);
            const mA3 = worldToScreen(p1World.x + u.x * (mCenter + mullionThick / 2) + nExt.x * outerOffset, p1World.y + u.y * (mCenter + mullionThick / 2) + nExt.y * outerOffset, cW, cH);
            const mA4 = worldToScreen(p1World.x + u.x * (mCenter - mullionThick / 2) + nExt.x * outerOffset, p1World.y + u.y * (mCenter - mullionThick / 2) + nExt.y * outerOffset, cW, cH);

            ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.4)" : "rgba(30, 41, 59, 0.95)";
            ctx.beginPath();
            ctx.moveTo(mA1.x, mA1.y);
            ctx.lineTo(mA2.x, mA2.y);
            ctx.lineTo(mA3.x, mA3.y);
            ctx.lineTo(mA4.x, mA4.y);
            ctx.closePath();
            ctx.fill();
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
            const m1 = measureTextCached(ctx, text1);
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
            const m2 = measureTextCached(ctx, text2);
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
            const m1 = measureTextCached(ctx, text1);
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
            const m2 = measureTextCached(ctx, text2);
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
            const m1 = measureTextCached(ctx, text1);
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
            const m2 = measureTextCached(ctx, text2);
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
            const bMetrics = measureTextCached(ctx, badgeText);
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

    // 8b. Draw Structural Beams (Kirişler) with Architectural Dashed Lines & Live 4-Way Wall Dimensions
    const showBeams = layerSettings?.beams?.visible ?? true;
    if (showBeams && room.beams && room.beams.length > 0) {
      room.beams.forEach((beam) => {
        const isSelected =
          (selectedElementId === beam.id && selectedElementType === "beam") ||
          (selectedElementIds && selectedElementIds.includes(beam.id));

        const geo = computeBeamGeometry(beam, room.walls);
        const polyScreen = geo.polygon.map((p) => worldToScreen(p.x, p.y, cW, cH));

        // 1. Draw dashed beam outline & architectural fill
        ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.12)" : "rgba(192, 132, 252, 0.08)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(192, 132, 252, 0.85)";
        ctx.lineWidth = isSelected ? 2.2 : 1.5;
        ctx.setLineDash([8, 6]);

        ctx.beginPath();
        polyScreen.forEach((sp, idx) => {
          if (idx === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // 2. Draw beam label badge (e.g. K101 25/50)
        const sCenter = worldToScreen(geo.center.x, geo.center.y, cW, cH);
        const labelText = `${beam.name || "Kiriş"} (${Math.round(beam.width / 10)}x${Math.round(beam.depth / 10)})`;
        ctx.font = "bold 9px Montserrat, sans-serif";
        const lMetrics = measureTextCached(ctx, labelText);
        const lw = lMetrics.width + 10;
        const lh = 16;
        ctx.fillStyle = "rgba(18, 18, 24, 0.9)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(192, 132, 252, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sCenter.x - lw / 2, sCenter.y - lh / 2, lw, lh, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelected ? "#29f57e" : "#e9d5ff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, sCenter.x, sCenter.y);

        // 3. Dynamic 4-Directional Dimension Lines to Surrounding Walls (Üst, Alt, Sol, Sağ)
        // ONLY RENDER WHEN SELECTED TO PREVENT CLUTTER!
        if (isSelected && room.walls.length >= 3) {
          const dims4 = geo.dimensions;
          const entries: {
            key: "up" | "down" | "left" | "right";
            data: { distanceMm: number; point: Point2D; wallId: string } | null;
            isVertical: boolean;
            startPt: Point2D;
          }[] = [
              { key: "up", data: dims4.up, isVertical: true, startPt: { x: geo.center.x, y: geo.bounds.maxY } },
              { key: "down", data: dims4.down, isVertical: true, startPt: { x: geo.center.x, y: geo.bounds.minY } },
              { key: "left", data: dims4.left, isVertical: false, startPt: { x: geo.bounds.minX, y: geo.center.y } },
              { key: "right", data: dims4.right, isVertical: false, startPt: { x: geo.bounds.maxX, y: geo.center.y } },
            ];

          entries.forEach(({ key, data, isVertical, startPt }) => {
            if (!data) return;
            const sStart = worldToScreen(startPt.x, startPt.y, cW, cH);
            const sProj = worldToScreen(data.point.x, data.point.y, cW, cH);
            const distCm = Math.round(data.distanceMm / 10);

            // Witness Line (dashed)
            ctx.strokeStyle = "rgba(41, 245, 126, 0.9)";
            ctx.lineWidth = 1.4;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(sStart.x, sStart.y);
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
            const midDimX = (sStart.x + sProj.x) / 2;
            const midDimY = (sStart.y + sProj.y) / 2;
            ctx.font = "bold 9px Montserrat, sans-serif";
            const badgeText = `${distCm} cm ✎`;
            const bMetrics = measureTextCached(ctx, badgeText);
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
              kind: "beamCoord",
              beamId: beam.id,
              direction: key,
              wallHitCoord: isVertical ? data.point.y : data.point.x,
              currentVal: data.distanceMm,
            });
          });
        }
      });
    }

    // 8c. Draw Chimneys (Bacalar) with Architectural X Diagonal Cross & Smoke Flue Duct
    const showChimneys = layerSettings?.chimneys?.visible ?? true;
    if (showChimneys && room.chimneys && room.chimneys.length > 0) {
      room.chimneys.forEach((chim) => {
        const isSelected =
          (selectedElementId === chim.id && selectedElementType === "chimney") ||
          (selectedElementIds && selectedElementIds.includes(chim.id));

        const w = chim.width || 400;
        const d = chim.depth || 400;
        const halfW = w / 2;
        const halfD = d / 2;

        const pC1 = { x: chim.x - halfW, y: chim.y - halfD };
        const pC2 = { x: chim.x + halfW, y: chim.y - halfD };
        const pC3 = { x: chim.x + halfW, y: chim.y + halfD };
        const pC4 = { x: chim.x - halfW, y: chim.y + halfD };

        const sC1 = worldToScreen(pC1.x, pC1.y, cW, cH);
        const sC2 = worldToScreen(pC2.x, pC2.y, cW, cH);
        const sC3 = worldToScreen(pC3.x, pC3.y, cW, cH);
        const sC4 = worldToScreen(pC4.x, pC4.y, cW, cH);
        const sCenter = worldToScreen(chim.x, chim.y, cW, cH);

        // 1. Masonry Box Body
        ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.25)" : "rgba(30, 41, 59, 0.9)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "#ea580c";
        ctx.lineWidth = isSelected ? 2.5 : 1.6;

        ctx.beginPath();
        ctx.moveTo(sC1.x, sC1.y);
        ctx.lineTo(sC2.x, sC2.y);
        ctx.lineTo(sC3.x, sC3.y);
        ctx.lineTo(sC4.x, sC4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 2. Architectural Standard Diagonal X Hatching (Baca Çaprazı)
        ctx.strokeStyle = isSelected ? "rgba(41, 245, 126, 0.85)" : "rgba(234, 88, 12, 0.65)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sC1.x, sC1.y);
        ctx.lineTo(sC3.x, sC3.y);
        ctx.moveTo(sC2.x, sC2.y);
        ctx.lineTo(sC4.x, sC4.y);
        ctx.stroke();

        // 3. Smoke Flue Duct Channel (Merkez Baca Deliği)
        const flueDia = chim.flueDiameter || Math.min(w, d) * 0.45;
        const flueRadPx = (flueDia / 2) * zoom;
        ctx.fillStyle = isSelected ? "#29f57e" : "#ea580c";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sCenter.x, sCenter.y, Math.max(3, flueRadPx), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 4. Label Badge (e.g. BACA 40x40)
        const labelText = `${chim.name || "BACA"} (${Math.round(w / 10)}x${Math.round(d / 10)})`;
        ctx.font = "bold 9px Montserrat, sans-serif";
        const lMetrics = measureTextCached(ctx, labelText);
        const lw = lMetrics.width + 10;
        const lh = 16;
        ctx.fillStyle = "rgba(18, 18, 24, 0.92)";
        ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(234, 88, 12, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sCenter.x - lw / 2, sC1.y - lh - 4, lw, lh, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelected ? "#29f57e" : "#fdba74";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, sCenter.x, sC1.y - 4 - lh / 2);

        // 5. 4-Way Distance Dimensions when Selected
        if (isSelected && room.walls.length >= 3) {
          const dims = calculateLightFourWayDimensions({ x: chim.x, y: chim.y }, room.walls);
          const directions: Array<"up" | "down" | "left" | "right"> = ["up", "down", "left", "right"];

          directions.forEach((key) => {
            const data = dims[key];
            if (!data) return;

            const sProj = worldToScreen(data.point.x, data.point.y, cW, cH);
            const distCm = Math.round(data.distanceMm / 10);
            const isVertical = key === "up" || key === "down";

            // Witness Line (dashed)
            ctx.strokeStyle = "rgba(41, 245, 126, 0.85)";
            ctx.lineWidth = 1.4;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(sCenter.x, sCenter.y);
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
            const midDimX = (sCenter.x + sProj.x) / 2;
            const midDimY = (sCenter.y + sProj.y) / 2;
            ctx.font = "bold 9px Montserrat, sans-serif";
            const badgeText = `${distCm} cm ✎`;
            const bMetrics = measureTextCached(ctx, badgeText);
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
              kind: "chimneyCoord",
              chimneyId: chim.id,
              direction: key,
              wallHitCoord: isVertical ? data.point.y : data.point.x,
              currentVal: data.distanceMm,
            });
          });
        }
      });
    }

    // 8d. Draw Air Conditioning Units (Klimalar)
    const showAC = layerSettings?.acUnits?.visible ?? true;
    if (showAC && room.acUnits && room.acUnits.length > 0) {
      const roomPoints = room.walls.map((w) => w.start);
      if (room.walls.length > 0) roomPoints.push(room.walls[room.walls.length - 1].end);
      const orientation = getPolygonOrientation(roomPoints);

      room.acUnits.forEach((ac) => {
        const isSelected =
          (selectedElementId === ac.id && selectedElementType === "acUnit") ||
          (selectedElementIds && selectedElementIds.includes(ac.id));

        const acColor = isSelected ? "#29f57e" : "#06b6d4";

        if (ac.type === "split_wall" && ac.wallId) {
          const wall = room.walls.find((w) => w.id === ac.wallId);
          if (!wall) return;

          const u = getUnitVector(wall.start, wall.end);
          const nExt = getWallExteriorNormal(wall, orientation);
          const nInt = { x: -nExt.x, y: -nExt.y };
          const wThick = wall.thickness || 150;
          const align = wall.alignment || "interior";

          let innerDist = 0;
          if (align === "center") innerDist = -wThick / 2;
          else if (align === "exterior") innerDist = -wThick;

          const wallLen = getDistance(wall.start, wall.end);
          const acOffset = ac.offset || wallLen / 2 - ac.width / 2;
          const p1 = {
            x: wall.start.x + u.x * acOffset + nExt.x * innerDist,
            y: wall.start.y + u.y * acOffset + nExt.y * innerDist,
          };
          const p2 = { x: p1.x + u.x * ac.width, y: p1.y + u.y * ac.width };
          const p3 = { x: p2.x + nInt.x * ac.depth, y: p2.y + nInt.y * ac.depth };
          const p4 = { x: p1.x + nInt.x * ac.depth, y: p1.y + nInt.y * ac.depth };

          const s1 = worldToScreen(p1.x, p1.y, cW, cH);
          const s2 = worldToScreen(p2.x, p2.y, cW, cH);
          const s3 = worldToScreen(p3.x, p3.y, cW, cH);
          const s4 = worldToScreen(p4.x, p4.y, cW, cH);

          // AC Wall Unit Body
          ctx.fillStyle = isSelected ? "rgba(41, 245, 126, 0.28)" : "rgba(6, 182, 212, 0.18)";
          ctx.strokeStyle = acColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.6;

          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Front airflow louvers (Havalandırma menfezi çizgileri)
          const louverFrac = 0.65;
          const sL1 = worldToScreen(p1.x + nInt.x * (ac.depth * louverFrac), p1.y + nInt.y * (ac.depth * louverFrac), cW, cH);
          const sL2 = worldToScreen(p2.x + nInt.x * (ac.depth * louverFrac), p2.y + nInt.y * (ac.depth * louverFrac), cW, cH);
          ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(255, 255, 255, 0.65)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sL1.x, sL1.y);
          ctx.lineTo(sL2.x, sL2.y);
          ctx.stroke();

          // Airflow Direction Waves (Hava Üfleme Dalgası)
          const midFront = { x: (p3.x + p4.x) / 2, y: (p3.y + p4.y) / 2 };
          const sMF = worldToScreen(midFront.x, midFront.y, cW, cH);
          const sWave = worldToScreen(midFront.x + nInt.x * 60, midFront.y + nInt.y * 60, cW, cH);
          ctx.strokeStyle = isSelected ? "#29f57e" : "rgba(6, 182, 212, 0.5)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(sMF.x, sMF.y);
          ctx.lineTo(sWave.x, sWave.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Dimension badge when selected
          if (isSelected) {
            const d1 = acOffset;
            const d2 = wallLen - (acOffset + ac.width);
            const dimOffsetDist = 180;

            const sOffStart = worldToScreen(wall.start.x + nInt.x * (innerDist + dimOffsetDist), wall.start.y + nInt.y * (innerDist + dimOffsetDist), cW, cH);
            const sOffAC1 = worldToScreen(p1.x + nInt.x * dimOffsetDist, p1.y + nInt.y * dimOffsetDist, cW, cH);

            if (d1 > 10) {
              ctx.strokeStyle = "#4ade80";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(sOffStart.x, sOffStart.y);
              ctx.lineTo(sOffAC1.x, sOffAC1.y);
              ctx.stroke();

              const mid1X = (sOffStart.x + sOffAC1.x) / 2;
              const mid1Y = (sOffStart.y + sOffAC1.y) / 2;
              const text1 = `${Math.round(d1 / 10)} cm ✎`;
              ctx.font = "bold 11px Montserrat, sans-serif";
              const m1 = measureTextCached(ctx, text1);
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
                elementId: ac.id,
                elementType: "acUnit",
                isStartDim: true,
                currentVal: d1,
                wallLen,
                elementWidth: ac.width,
              });
            }
          }
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
      const tm = measureTextCached(ctx, tagText);
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
            const sMetrics = measureTextCached(ctx, snapLabel);
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
  }, [
    room,
    activePoint,
    startPoint,
    closingDistance,
    isNearOrigin,
    selectedElementId,
    selectedElementType,
    selectedElementIds,
    layerSettings,
    worldToScreen,
    screenToWorld,
    placingOpening,
  ]);

  // Keep drawFrameRef updated and trigger a RAF redraw whenever React props/data change
  useEffect(() => {
    drawFrameRef.current = drawFrame;
    scheduleDraw();
  }, [drawFrame, canvasDimensions, scheduleDraw]);

  // Apply in-app dimension edit popover value
  const applyDimEdit = useCallback(
    (hb: TempDimHitbox, rawVal: string) => {
      const parsed = parseFloat(rawVal.trim().replace(",", "."));
      if (isNaN(parsed) || parsed < 0) return;
      const parsedMm = Math.round(parsed * 10);

      if (hb.kind === "wallOffset" && hb.elementId && hb.elementType) {
        if (hb.elementType !== "beam" && hb.elementType !== "chimney") {
          const wallLen = hb.wallLen || 3000;
          const elemW = hb.elementWidth || 0;
          let newOffset = hb.isStartDim ? parsedMm : wallLen - elemW - parsedMm;
          newOffset = Math.max(0, Math.min(wallLen - elemW, Math.round(newOffset)));
          onChangeElementOffset?.(hb.elementId, hb.elementType, newOffset);
        }
      } else if (hb.kind === "lightCoord" && hb.lightId && hb.direction && hb.wallHitCoord !== undefined) {
        const light = room.lighting?.find((l) => l.id === hb.lightId);
        if (light) {
          let newX = light.x;
          let newY = light.y;
          if (hb.direction === "up") newY = Math.round(hb.wallHitCoord - parsedMm);
          else if (hb.direction === "down") newY = Math.round(hb.wallHitCoord + parsedMm);
          else if (hb.direction === "left") newX = Math.round(hb.wallHitCoord + parsedMm);
          else if (hb.direction === "right") newX = Math.round(hb.wallHitCoord - parsedMm);
          onChangeLightPosition?.(hb.lightId, newX, newY);
        }
      } else if (hb.kind === "beamCoord" && hb.beamId && hb.direction && hb.wallHitCoord !== undefined) {
        const beam = room.beams?.find((b) => b.id === hb.beamId);
        if (beam) {
          const isHoriz = beam.orientation === "horizontal";
          const w = beam.width || 250;
          if (isHoriz) {
            if (hb.direction === "up") {
              const yTop = hb.wallHitCoord - parsedMm;
              const newY = beam.alignment === "interior" ? yTop - w : beam.alignment === "exterior" ? yTop : yTop - w / 2;
              onChangeBeamPosition?.(beam.id, { y: Math.round(newY) });
            } else if (hb.direction === "down") {
              const yBottom = hb.wallHitCoord + parsedMm;
              const newY = beam.alignment === "interior" ? yBottom : beam.alignment === "exterior" ? yBottom + w : yBottom + w / 2;
              onChangeBeamPosition?.(beam.id, { y: Math.round(newY) });
            } else if (hb.direction === "left") {
              onChangeBeamPosition?.(beam.id, { spanStart: parsedMm });
            } else if (hb.direction === "right") {
              onChangeBeamPosition?.(beam.id, { spanEnd: parsedMm });
            }
          } else {
            if (hb.direction === "left") {
              const xLeft = hb.wallHitCoord + parsedMm;
              const newX = beam.alignment === "interior" ? xLeft : beam.alignment === "exterior" ? xLeft + w : xLeft + w / 2;
              onChangeBeamPosition?.(beam.id, { x: Math.round(newX) });
            } else if (hb.direction === "right") {
              const xRight = hb.wallHitCoord - parsedMm;
              const newX = beam.alignment === "interior" ? xRight - w : beam.alignment === "exterior" ? xRight : xRight - w / 2;
              onChangeBeamPosition?.(beam.id, { x: Math.round(newX) });
            } else if (hb.direction === "down") {
              onChangeBeamPosition?.(beam.id, { spanStart: parsedMm });
            } else if (hb.direction === "up") {
              onChangeBeamPosition?.(beam.id, { spanEnd: parsedMm });
            }
          }
        }
      } else if (hb.kind === "chimneyCoord" && hb.chimneyId && hb.direction && hb.wallHitCoord !== undefined) {
        const chim = room.chimneys?.find((c) => c.id === hb.chimneyId);
        if (chim) {
          let newX = chim.x;
          let newY = chim.y;
          const halfW = (chim.width || 400) / 2;
          const halfD = (chim.depth || 400) / 2;
          if (hb.direction === "up") newY = Math.round(hb.wallHitCoord - parsedMm - halfD);
          else if (hb.direction === "down") newY = Math.round(hb.wallHitCoord + parsedMm + halfD);
          else if (hb.direction === "left") newX = Math.round(hb.wallHitCoord + parsedMm + halfW);
          else if (hb.direction === "right") newX = Math.round(hb.wallHitCoord - parsedMm - halfW);
          onChangeChimneyPosition?.(hb.chimneyId, newX, newY);
        }
      }
    },
    [room.lighting, room.beams, room.chimneys, onChangeElementOffset, onChangeLightPosition, onChangeBeamPosition, onChangeChimneyPosition]
  );

  // Helper: Find the closest wall to a world tap/click using a zoom-aware screen-space tolerance
  const findClosestWallForPlacement = useCallback(
    (worldPt: Point2D, currentZoom: number, isTouch: boolean): { wall: WallElement; offset: number } | null => {
      const screenThresholdPx = isTouch ? 40 : 26;
      const minWorldTol = screenThresholdPx / Math.max(0.015, currentZoom);

      let closestWall: WallElement | null = null;
      let minDist = Infinity;

      for (const wall of room.walls) {
        const d = getDistanceToSegment(worldPt, wall.start, wall.end);
        const wallTol = Math.max((wall.thickness || 150) + 240, minWorldTol);
        if (d <= wallTol && d < minDist) {
          minDist = d;
          closestWall = wall;
        }
      }

      if (!closestWall) return null;
      return {
        wall: closestWall,
        offset: getOffsetAlongSegment(worldPt, closestWall.start, closestWall.end),
      };
    },
    [room.walls]
  );

  // Mouse / Touch Event Handlers for Panning, Pinch-to-Zoom, Marquee Selection, and Tapping Elements
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    cancelCameraAnimation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events where pointer capture isn't supported
    }

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const rect = canvasRectRef.current;

    if (activePointersRef.current.size === 2) {
      // Enter 2-finger pinch-to-zoom mode
      isDraggingRef.current = false;
      didPinchRef.current = true;
      if (selectionBoxRef.current) {
        selectionBoxRef.current = null;
        scheduleDraw();
      }

      if (rect.width <= 0 || rect.height <= 0) return;
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midScreenX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midScreenY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const midWorld = screenToWorld(midScreenX, midScreenY, rect.width, rect.height);

      pinchStartRef.current = { dist, zoom: zoomRef.current, midWorld };
      return;
    }

    if (activePointersRef.current.size === 1) {
      didPinchRef.current = false;
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...panRef.current };

      // Provide immediate visual highlight under finger when tapping a wall to place an opening
      if (placingOpening && rect.width > 0 && rect.height > 0) {
        const downWorld = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        const match = findClosestWallForPlacement(downWorld, zoomRef.current, e.pointerType === "touch");
        hoveredWallIdRef.current = match ? match.wall.id : null;
        hoverOffsetRef.current = match ? match.offset : null;
        scheduleDraw();
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRectRef.current;
    if (rect.width <= 0 || rect.height <= 0) return;

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Active 2-finger pinch-to-zoom & two-finger pan (zero React re-renders!)
    if (activePointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const newDist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const scaleRatio = newDist / pinchStartRef.current.dist;
      const newZoom = Math.max(0.015, Math.min(0.8, pinchStartRef.current.zoom * scaleRatio));

      const midScreenX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midScreenY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const { midWorld } = pinchStartRef.current;

      panRef.current = {
        x: (midScreenX - rect.width / 2) / newZoom - midWorld.x,
        y: (rect.height / 2 - midScreenY) / newZoom - midWorld.y,
      };
      zoomRef.current = newZoom;
      scheduleDraw();
      return;
    }

    if (didPinchRef.current) return;

    // Check vertex snap when moving pointer (hover detection on mouse/pen, only redraw when changed)
    if (!isDraggingRef.current && !placingOpening && e.pointerType !== "touch") {
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
      const prevSnap = hoveredSnapPointRef.current;
      const snapChanged =
        (prevSnap === null) !== (foundSnap === null) ||
        (prevSnap !== null && foundSnap !== null && (prevSnap.x !== foundSnap.x || prevSnap.y !== foundSnap.y));
      if (snapChanged) {
        hoveredSnapPointRef.current = foundSnap;
        scheduleDraw();
      }
    }

    if (placingOpening && !isDraggingRef.current && e.pointerType !== "touch") {
      const curWorld = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      const match = findClosestWallForPlacement(curWorld, zoomRef.current, false);
      const nextWallId = match ? match.wall.id : null;
      const nextOffset = match ? match.offset : null;
      if (hoveredWallIdRef.current !== nextWallId || hoverOffsetRef.current !== nextOffset) {
        hoveredWallIdRef.current = nextWallId;
        hoverOffsetRef.current = nextOffset;
        scheduleDraw();
      }
    }

    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const dist = Math.hypot(dx, dy);

    // Deadzone (6px) prevents finger tremor during a tap from panning the canvas away from a wall
    if (dist < 6) return;

    if (activeTool === "boxSelect" && !placingOpening) {
      // Box selection tool: dragging draws marquee box
      const startWorld = screenToWorld(dragStartRef.current.x - rect.left, dragStartRef.current.y - rect.top, rect.width, rect.height);
      const curWorld = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      selectionBoxRef.current = { start: startWorld, current: curWorld };
      scheduleDraw();
    } else {
      // Default tool: dragging pans the canvas view smoothly via RAF (zero React re-renders!)
      const curZoom = zoomRef.current;
      panRef.current = {
        x: panStartRef.current.x + dx / curZoom,
        y: panStartRef.current.y - dy / curZoom,
      };
      scheduleDraw();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      isDraggingRef.current = false;
      didPinchRef.current = false;
      if (selectionBoxRef.current) {
        selectionBoxRef.current = null;
        scheduleDraw();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }

    if (didPinchRef.current) {
      if (activePointersRef.current.size === 0) {
        didPinchRef.current = false;
      }
      isDraggingRef.current = false;
      return;
    }

    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const rect = canvasRectRef.current;
    if (rect.width <= 0 || rect.height <= 0) return;
    const clickScreenX = e.clientX - rect.left;
    const clickScreenY = e.clientY - rect.top;
    const totalDist = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);

    // 0. Priority: If user is placing an opening (window/door/electrical/radiator/acUnit),
    // resolve wall tap BEFORE box select, temp dimensions, or corner snapping so nothing steals the tap!
    if (placingOpening && onSelectWallForOpening) {
      const tapMaxMove = e.pointerType === "touch" ? 22 : 12;
      if (totalDist < tapMaxMove) {
        const clickWorld = screenToWorld(clickScreenX, clickScreenY, rect.width, rect.height);
        const match = findClosestWallForPlacement(clickWorld, zoomRef.current, e.pointerType === "touch");
        if (match) {
          onSelectWallForOpening(match.wall.id, match.offset, placingOpening);
          hoveredWallIdRef.current = null;
          hoverOffsetRef.current = null;
          hoveredSnapPointRef.current = null;
          scheduleDraw();
        }
      }
      return;
    }

    // 1. Marquee Box Selection Resolution
    const activeSelectionBox = selectionBoxRef.current;
    if (activeSelectionBox) {
      const boxMinX = Math.min(activeSelectionBox.start.x, activeSelectionBox.current.x);
      const boxMaxX = Math.max(activeSelectionBox.start.x, activeSelectionBox.current.x);
      const boxMinY = Math.min(activeSelectionBox.start.y, activeSelectionBox.current.y);
      const boxMaxY = Math.max(activeSelectionBox.start.y, activeSelectionBox.current.y);
      selectionBoxRef.current = null;
      scheduleDraw();

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

      // Beams
      room.beams?.forEach((beam) => {
        const geo = computeBeamGeometry(beam, room.walls);
        if (geo.center.x >= boxMinX && geo.center.x <= boxMaxX && geo.center.y >= boxMinY && geo.center.y <= boxMaxY) {
          hitIds.push(beam.id);
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

    // 2. Check Click / Tap on Temporary Dimension Line Hitboxes (with extra finger padding on touch)
    const touchPad = e.pointerType === "touch" ? 10 : 0;
    for (const hb of tempDimHitboxesRef.current) {
      if (
        clickScreenX >= hb.minX - touchPad &&
        clickScreenX <= hb.maxX + touchPad &&
        clickScreenY >= hb.minY - touchPad &&
        clickScreenY <= hb.maxY + touchPad
      ) {
        const curValCm = Math.round((hb.currentVal || 0) / 10);
        let label = "Mesafe (cm)";
        if (hb.kind === "wallOffset") {
          label = hb.isStartDim ? "Duvar Başından Mesafe (cm)" : "Duvar Sonundan Mesafe (cm)";
        } else if (hb.direction) {
          const dirMap: Record<string, string> = { up: "Üst", down: "Alt", left: "Sol", right: "Sağ" };
          label = `${dirMap[hb.direction] || hb.direction} Duvara Mesafe (cm)`;
        }
        setDimEditState({ hitbox: hb, label, value: String(curValCm) });
        return;
      }
    }

    if (totalDist < (e.pointerType === "touch" ? 14 : 8)) {
      // 3a. Snap Surveyor Cursor to Wall Endpoint (supports both mouse hover & direct touch tap while drafting)
      let tapSnapPoint = hoveredSnapPointRef.current;
      if (!tapSnapPoint && e.pointerType === "touch" && !room.isClosed && onSetActivePoint) {
        let minSnapDist = Infinity;
        for (const wall of room.walls) {
          for (const pt of [wall.start, wall.end]) {
            const sPt = worldToScreen(pt.x, pt.y, rect.width, rect.height);
            const screenDist = Math.hypot(clickScreenX - sPt.x, clickScreenY - sPt.y);
            if (screenDist < 24 && screenDist < minSnapDist) {
              minSnapDist = screenDist;
              tapSnapPoint = pt;
            }
          }
        }
      }

      if (tapSnapPoint && onSetActivePoint) {
        onSetActivePoint(tapSnapPoint);
        const matchedWall = room.walls.find(
          (w) => getDistance(w.start, tapSnapPoint) < 5 || getDistance(w.end, tapSnapPoint) < 5
        );
        if (matchedWall) {
          onSelectElement(matchedWall.id, "wall");
        }
        return;
      }

      const clickWorld = screenToWorld(clickScreenX, clickScreenY, rect.width, rect.height);

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

      // 3b. Hit test Structural Beams (Kirişler)
      if (room.beams) {
        for (const beam of room.beams) {
          const geo = computeBeamGeometry(beam, room.walls);
          if (isPointInPolygon(clickWorld, geo.polygon)) {
            if (e.shiftKey && onSelectMultiple) {
              const currentIds = selectedElementIds || [];
              const nextIds = currentIds.includes(beam.id) ? currentIds.filter((id) => id !== beam.id) : [...currentIds, beam.id];
              onSelectMultiple(nextIds);
            } else {
              onSelectElement(beam.id, "beam");
            }
            return;
          }
        }
      }

      // 3c. Hit test Chimneys (Bacalar)
      if (room.chimneys) {
        for (const chim of room.chimneys) {
          const w = chim.width || 400;
          const d = chim.depth || 400;
          if (
            clickWorld.x >= chim.x - w / 2 &&
            clickWorld.x <= chim.x + w / 2 &&
            clickWorld.y >= chim.y - d / 2 &&
            clickWorld.y <= chim.y + d / 2
          ) {
            if (e.shiftKey && onSelectMultiple) {
              const currentIds = selectedElementIds || [];
              const nextIds = currentIds.includes(chim.id) ? currentIds.filter((id) => id !== chim.id) : [...currentIds, chim.id];
              onSelectMultiple(nextIds);
            } else {
              onSelectElement(chim.id, "chimney");
            }
            return;
          }
        }
      }

      // 3d. Hit test Air Conditioning Units (Klimalar)
      if (room.acUnits) {
        for (const ac of room.acUnits) {
          if (ac.type === "split_wall" && ac.wallId) {
            const wall = room.walls.find((w) => w.id === ac.wallId);
            if (wall) {
              const offset = getOffsetAlongSegment(clickWorld, wall.start, wall.end);
              const distToWall = getDistanceToSegment(clickWorld, wall.start, wall.end);
              const acOffset = ac.offset || 0;
              if (
                offset >= acOffset - 30 &&
                offset <= acOffset + ac.width + 30 &&
                distToWall <= (wall.thickness || 150) + ac.depth + 100
              ) {
                if (e.shiftKey && onSelectMultiple) {
                  const currentIds = selectedElementIds || [];
                  const nextIds = currentIds.includes(ac.id) ? currentIds.filter((id) => id !== ac.id) : [...currentIds, ac.id];
                  onSelectMultiple(nextIds);
                } else {
                  onSelectElement(ac.id, "acUnit");
                }
                return;
              }
            }
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

  // Mouse wheel zoom anchored to pointer position (zero React re-renders!)
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    cancelCameraAnimation();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const rect = canvasRectRef.current;
    if (rect.width <= 0 || rect.height <= 0) {
      zoomRef.current = Math.max(0.015, Math.min(zoomRef.current * zoomFactor, 0.8));
      scheduleDraw();
      return;
    }
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const curZoom = zoomRef.current;
    const curPan = panRef.current;
    const newZoom = Math.max(0.015, Math.min(curZoom * zoomFactor, 0.8));

    const worldX = (cursorX - rect.width / 2) / curZoom - curPan.x;
    const worldY = (rect.height / 2 - cursorY) / curZoom - curPan.y;
    panRef.current = {
      x: (cursorX - rect.width / 2) / newZoom - worldX,
      y: (rect.height / 2 - cursorY) / newZoom - worldY,
    };
    zoomRef.current = newZoom;
    scheduleDraw();
  };

  return (
    <div className={styles.canvasContainer} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
      />

      {/* In-App Numeric Dimension Editor Popover */}
      {dimEditState && (
        <div className={styles.dimPopoverBackdrop} onClick={() => setDimEditState(null)}>
          <form
            className={styles.dimPopoverCard}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              applyDimEdit(dimEditState.hitbox, dimEditState.value);
              setDimEditState(null);
            }}
          >
            <label className={styles.dimPopoverLabel}>{dimEditState.label}</label>
            <div className={styles.dimPopoverInputRow}>
              <input
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="1"
                min="0"
                autoFocus
                value={dimEditState.value}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDimEditState((prev) => (prev ? { ...prev, value: e.target.value } : null))}
                className={styles.dimPopoverInput}
              />
              <span className={styles.dimPopoverUnit}>cm</span>
            </div>
            <div className={styles.dimPopoverChips}>
              {[-10, -5, 5, 10].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  className={styles.dimPopoverChip}
                  onClick={() =>
                    setDimEditState((prev) => {
                      if (!prev) return null;
                      const num = Math.max(0, (parseFloat(prev.value) || 0) + delta);
                      return { ...prev, value: String(num) };
                    })
                  }
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
            <div className={styles.dimPopoverActions}>
              <button
                type="button"
                className={styles.dimPopoverCancel}
                onClick={() => setDimEditState(null)}
              >
                İptal
              </button>
              <button type="submit" className={styles.dimPopoverApply}>
                Uygula
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Placing Opening Prompt Banner */}
      {placingOpening && (
        <div className={styles.placingBanner}>
          <span className={styles.placingText}>
            {placingOpening === "door"
              ? "🚪 Kapı için duvara dokunun"
              : placingOpening === "window"
                ? "🪟 Pencere için duvara dokunun"
                : placingOpening === "electrical"
                  ? "⚡ Elektrik elemanı için duvara dokunun"
                  : placingOpening === "acUnit"
                    ? "❄️ Klima için duvara dokunun"
                    : "🔥 Petek için duvara dokunun"}
          </span>
          <div className={styles.placingBannerActions}>
            {room.walls.length > 0 && onSelectWallForOpening && (
              <button
                type="button"
                className={styles.pickWallListBtn}
                onClick={() => {
                  const firstWall = room.walls[0];
                  const midOff = Math.round(getDistance(firstWall.start, firstWall.end) / 2);
                  onSelectWallForOpening(firstWall.id, midOff, placingOpening);
                  hoveredWallIdRef.current = null;
                  hoverOffsetRef.current = null;
                  scheduleDraw();
                }}
              >
                Listeden Seç
              </button>
            )}
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
          onClick={() => handleAutoFit(true)}
          title="Fit & Center Room"
          aria-label="Odayı ortala ve sığdır"
        >
          <MdCenterFocusStrong size={18} />
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => handleStepZoom(1.25)}
          title="Zoom In"
          aria-label="Yakınlaştır"
        >
          <MdZoomIn size={18} />
        </button>

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => handleStepZoom(0.8)}
          title="Zoom Out"
          aria-label="Uzaklaştır"
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
