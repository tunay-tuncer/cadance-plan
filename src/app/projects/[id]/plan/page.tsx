"use client";

import React, { useState, useRef, useEffect, useCallback, use } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { useAuth } from "@/context/AuthContext";
import { subscribeToUserProject, ProjectItem } from "@/lib/firebase/projectService";
import {
  subscribeToRoomPlanItem,
  updateRoomPlanInProject,
} from "@/lib/firebase/roomService";
import type {
  RoomPlanItem,
  Point2D,
  WallElement,
  DoorElement,
  WindowElement,
  ElectricalElement,
  RadiatorElement,
  LightFixtureElement,
} from "@/types/plan";
import { DEFAULT_LAYER_SETTINGS } from "@/types/plan";
import {
  calculatePolygonArea,
  calculatePerimeter,
  getDistance,
  getPolygonFromWalls,
  mergeColinearWalls,
  calculateLightPositionFromWallDistances,
} from "@/lib/cad/geometry";
import { exportRoomToDxf, downloadDxfFile, exportRoomSceneToGltf } from "@/lib/exporters/cadExport";
import PlanCanvas2D from "@/components/canvas/PlanCanvas2D";
import SurveyorControlBar, { Direction } from "@/components/canvas/SurveyorControlBar";
import PlanInspector from "@/components/studio/PlanInspector";

import { FaChevronLeft } from "react-icons/fa";
import {
  Md3dRotation,
  MdDesignServices,
  MdSave,
  MdLayers,
  MdFileDownload,
  MdClose,
  MdMeetingRoom,
  MdWindow,
  MdCheck,
  MdPower,
  MdWhatshot,
  MdLightbulb,
} from "react-icons/md";
import styles from "./planStudio.module.css";

// Dynamic import of 3D BIM Viewer
const BimViewer3D = dynamic(() => import("@/components/bim/BimViewer3D"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        background: "#0d0d12",
        color: "var(--textMuted)",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          border: "3px solid rgba(41, 245, 126, 0.2)",
          borderTopColor: "var(--accent)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span style={{ fontSize: "0.85rem", letterSpacing: "0.05em" }}>
        INITIALIZING 3D BIM STUDIO...
      </span>
    </div>
  ),
});

interface PageProps {
  params: Promise<{ id: string }>;
}

function PlanStudioContent({ params }: PageProps) {
  const { id: projectId } = use(params);
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId");
  const { user } = useAuth();

  const [project, setProject] = useState<ProjectItem | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"2d" | "3d">("2d");
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 3D Scene Group Ref for GLTF export
  const sceneGroupRef = useRef<THREE.Group | null>(null);

  // Active Room State
  const [room, setRoom] = useState<RoomPlanItem>({
    id: roomId || "new-room",
    projectId,
    name: "Living Room (Salon)",
    roomType: "living",
    calculatedArea: 0,
    calculatedPerimeter: 0,
    wallCount: 0,
    doorCount: 0,
    windowCount: 0,
    isClosed: false,
    walls: [],
    doors: [],
    windows: [],
    layerSettings: DEFAULT_LAYER_SETTINGS,
  });

  // Current Surveyor Head Point
  const [activePoint, setActivePoint] = useState<Point2D>({ x: 0, y: 0 });

  // Selected Element (Single and Multi-selection)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementType, setSelectedElementType] = useState<"wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);

  // Selection handlers with bidirectional sync between 2D and 3D
  const handleSelectElement = useCallback((id: string | null, type: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | null) => {
    setSelectedElementId(id);
    setSelectedElementType(type);
    setSelectedElementIds(id ? [id] : []);
    if (id) setIsInspectorOpen(true);
  }, []);

  const handleSelectMultiple = useCallback((ids: string[]) => {
    setSelectedElementIds(ids);
    if (ids.length === 1) {
      const singleId = ids[0];
      if (room.walls.some((w) => w.id === singleId)) {
        setSelectedElementId(singleId);
        setSelectedElementType("wall");
      } else if (room.doors.some((d) => d.id === singleId)) {
        setSelectedElementId(singleId);
        setSelectedElementType("door");
      } else if (room.windows.some((w) => w.id === singleId)) {
        setSelectedElementId(singleId);
        setSelectedElementType("window");
      } else if (room.electrical?.some((el) => el.id === singleId)) {
        setSelectedElementId(singleId);
        setSelectedElementType("electrical");
      } else if (room.radiators?.some((rad) => rad.id === singleId)) {
        setSelectedElementId(singleId);
        setSelectedElementType("radiator");
      } else if (room.lighting?.some((l) => l.id === singleId)) {
        setSelectedElementId(singleId);
        setSelectedElementType("lighting");
      }
    } else {
      setSelectedElementId(null);
      setSelectedElementType(null);
    }
    if (ids.length > 0) {
      setIsInspectorOpen(true);
    }
  }, [room.walls, room.doors, room.windows, room.electrical, room.radiators, room.lighting]);

  const handleDeselect = useCallback(() => {
    setSelectedElementId(null);
    setSelectedElementType(null);
    setSelectedElementIds([]);
  }, []);

  const handleChangeElementOffset = useCallback((elementId: string, type: "door" | "window" | "electrical" | "radiator", newOffsetMm: number) => {
    setRoom((prev) => {
      if (type === "door") {
        return {
          ...prev,
          doors: prev.doors.map((d) => (d.id === elementId ? { ...d, offset: Math.round(newOffsetMm) } : d)),
        };
      } else if (type === "window") {
        return {
          ...prev,
          windows: prev.windows.map((w) => (w.id === elementId ? { ...w, offset: Math.round(newOffsetMm) } : w)),
        };
      } else if (type === "electrical") {
        return {
          ...prev,
          electrical: prev.electrical?.map((el) => (el.id === elementId ? { ...el, offset: Math.round(newOffsetMm) } : el)),
        };
      } else if (type === "radiator") {
        return {
          ...prev,
          radiators: prev.radiators?.map((rad) => (rad.id === elementId ? { ...rad, offset: Math.round(newOffsetMm) } : rad)),
        };
      }
      return prev;
    });
  }, []);

  const handleChangeLightPosition = useCallback((lightId: string, newX: number, newY: number) => {
    setRoom((prev) => ({
      ...prev,
      lighting: prev.lighting?.map((l) => (l.id === lightId ? { ...l, x: Math.round(newX), y: Math.round(newY) } : l)),
    }));
  }, []);

  // Add Openings & MEP Modals State
  const [isDoorModalOpen, setIsDoorModalOpen] = useState(false);
  const [isWindowModalOpen, setIsWindowModalOpen] = useState(false);
  const [isElectricalModalOpen, setIsElectricalModalOpen] = useState(false);
  const [isRadiatorModalOpen, setIsRadiatorModalOpen] = useState(false);
  const [isLightModalOpen, setIsLightModalOpen] = useState(false);
  const [placingOpening, setPlacingOpening] = useState<"door" | "window" | "electrical" | "radiator" | null>(null);

  // New Door Form
  const [targetWallId, setTargetWallId] = useState<string>("");
  const [doorWidth, setDoorWidth] = useState<number>(900);
  const [doorSwingDir, setDoorSwingDir] = useState<"left" | "right">("right");
  const [doorSwingOri, setDoorSwingOri] = useState<"inward" | "outward">("inward");
  const [doorOffset, setDoorOffset] = useState<number>(200);
  const [doorType, setDoorType] = useState<"hinged" | "sliding">("hinged");
  const [doorSlidingSegments, setDoorSlidingSegments] = useState<number>(2);
  const [doorFullHeight, setDoorFullHeight] = useState<boolean>(false);

  // New Window Form
  const [windowWidth, setWindowWidth] = useState<number>(1200);
  const [windowHeight, setWindowHeight] = useState<number>(1400);
  const [windowSill, setWindowSill] = useState<number>(900);
  const [windowOffset, setWindowOffset] = useState<number>(300);
  const [windowType, setWindowType] = useState<"standard" | "sliding" | "double_casement" | "french" | "fixed">("standard");
  const [windowSegments, setWindowSegments] = useState<number>(1);
  const [windowFrameMaterial, setWindowFrameMaterial] = useState<"pvc_white" | "anthracite" | "wood" | "aluminum">("anthracite");

  // New Electrical Form
  const [electricalWallId, setElectricalWallId] = useState<string>("");
  const [electricalType, setElectricalType] = useState<"socket" | "switch" | "panel">("socket");
  const [electricalOffset, setElectricalOffset] = useState<number>(500);
  const [electricalElevation, setElectricalElevation] = useState<number>(300);

  // New Radiator Form
  const [radiatorWallId, setRadiatorWallId] = useState<string>("");
  const [radiatorWidth, setRadiatorWidth] = useState<number>(1000);
  const [radiatorHeight, setRadiatorHeight] = useState<number>(600);
  const [radiatorOffset, setRadiatorOffset] = useState<number>(400);
  const [radiatorElevation, setRadiatorElevation] = useState<number>(100);

  // New Lighting Form
  const [lightType, setLightType] = useState<"pendant" | "spot" | "ceiling" | "track">("pendant");
  const [lightRefWall1, setLightRefWall1] = useState<string>("");
  const [lightDist1, setLightDist1] = useState<number>(1500);
  const [lightRefWall2, setLightRefWall2] = useState<string>("");
  const [lightDist2, setLightDist2] = useState<number>(1500);

  // Mobile Phones: Track Visual Viewport to elevate bottom controls above software keyboard
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const updateKeyboard = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const kbHeight = window.innerHeight - vv.height;
      document.documentElement.style.setProperty("--keyboard-offset", `${Math.max(0, kbHeight)}px`);
    };

    window.visualViewport.addEventListener("resize", updateKeyboard);
    window.visualViewport.addEventListener("scroll", updateKeyboard);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateKeyboard);
      window.visualViewport?.removeEventListener("scroll", updateKeyboard);
    };
  }, []);

  // Update all walls and ceiling elevation at once
  const handleUpdateAllWallHeights = useCallback((newHeightMm: number) => {
    const clamped = Math.max(1000, Math.min(6000, newHeightMm));
    setRoom((prev) => ({
      ...prev,
      walls: prev.walls.map((w) => ({ ...w, height: clamped })),
      ceiling: prev.ceiling ? { ...prev.ceiling, elevation: clamped } : prev.ceiling,
    }));
  }, []);

  // Toggle flip side of selected wall or last wall (Spacebar / ⇄ button - Revit style)
  const handleFlipActiveWall = useCallback(() => {
    setRoom((prev) => {
      if (prev.walls.length === 0) return prev;
      let targetId = selectedElementId && selectedElementType === "wall" ? selectedElementId : null;
      if (!targetId && !prev.isClosed) {
        targetId = prev.walls[prev.walls.length - 1].id;
      }
      if (!targetId) return prev;
      return {
        ...prev,
        walls: prev.walls.map((w) =>
          w.id === targetId ? { ...w, flipSide: !w.flipSide } : w
        ),
      };
    });
  }, [selectedElementId, selectedElementType]);

  // Spacebar keyboard listener for Revit-style quick flip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        const target = e.target as HTMLElement;
        const isInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT";
        if (!isInput) {
          e.preventDefault();
          handleFlipActiveWall();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleFlipActiveWall]);

  // Handle direct wall selection from 2D drawing for door/window/electrical/radiator
  const handleSelectWallForOpening = useCallback((wallId: string, offsetMm: number, type: "door" | "window" | "electrical" | "radiator") => {
    const wall = room.walls.find((w) => w.id === wallId);
    const wallLen = wall ? Math.round(getDistance(wall.start, wall.end)) : 3000;

    if (type === "door") {
      setTargetWallId(wallId);
      const safeOffset = Math.max(50, Math.min(wallLen - doorWidth - 50, offsetMm));
      setDoorOffset(safeOffset);
      setIsDoorModalOpen(true);
    } else if (type === "window") {
      setTargetWallId(wallId);
      const safeOffset = Math.max(50, Math.min(wallLen - windowWidth - 50, offsetMm));
      setWindowOffset(safeOffset);
      setIsWindowModalOpen(true);
    } else if (type === "electrical") {
      setElectricalWallId(wallId);
      const safeOffset = Math.max(50, Math.min(wallLen - 50, Math.round(offsetMm)));
      setElectricalOffset(safeOffset);
      setIsElectricalModalOpen(true);
    } else if (type === "radiator") {
      setRadiatorWallId(wallId);
      const safeOffset = Math.max(50, Math.min(wallLen - radiatorWidth - 50, Math.round(offsetMm)));
      setRadiatorOffset(safeOffset);
      setIsRadiatorModalOpen(true);
    }
    setPlacingOpening(null);
  }, [room.walls, doorWidth, windowWidth, radiatorWidth]);

  // Subscriptions
  useEffect(() => {
    if (!user?.uid || !projectId) return;

    const unsubProj = subscribeToUserProject(user.uid, projectId, (proj) => {
      setProject(proj);
    });

    return () => unsubProj();
  }, [user?.uid, projectId]);

  useEffect(() => {
    if (!user?.uid || !projectId || !roomId) return;

    const unsubRoom = subscribeToRoomPlanItem(user.uid, projectId, roomId, (fetched) => {
      if (!fetched) return;
      setRoom(fetched);

      // Set active point to end of last wall
      if (fetched.walls && fetched.walls.length > 0) {
        const lastWall = fetched.walls[fetched.walls.length - 1];
        setActivePoint({ ...lastWall.end });
      } else {
        setActivePoint({ x: 0, y: 0 });
      }

      if (fetched.walls.length > 0) {
        setTargetWallId(fetched.walls[0].id);
      }
    });

    return () => unsubRoom();
  }, [user?.uid, projectId, roomId]);

  // 1. Add Wall in Direction (Surveyor Step)
  const handleAddWall = useCallback((direction: Direction, lengthMm: number, alignment: "interior" | "center" | "exterior" = "interior") => {
    let deltaX = 0;
    let deltaY = 0;

    switch (direction) {
      case "up":
        deltaY = lengthMm;
        break;
      case "down":
        deltaY = -lengthMm;
        break;
      case "right":
        deltaX = lengthMm;
        break;
      case "left":
        deltaX = -lengthMm;
        break;
    }

    const endPoint: Point2D = {
      x: activePoint.x + deltaX,
      y: activePoint.y + deltaY,
    };

    const newWall: WallElement = {
      id: `wall-${Date.now()}`,
      start: { ...activePoint },
      end: endPoint,
      thickness: 150,
      height: 2800,
      alignment,
    };

    setRoom((prev) => {
      const updatedWalls = [...prev.walls, newWall];
      const perim = calculatePerimeter(updatedWalls);
      return {
        ...prev,
        walls: updatedWalls,
        calculatedPerimeter: perim,
        wallCount: updatedWalls.length,
      };
    });

    setActivePoint(endPoint);
  }, [activePoint]);

  // 2. Undo Last Wall
  const handleUndoWall = useCallback(() => {
    setRoom((prev) => {
      if (prev.walls.length === 0) return prev;
      const updatedWalls = prev.walls.slice(0, -1);
      const newActive = updatedWalls.length > 0 ? { ...updatedWalls[updatedWalls.length - 1].end } : { x: 0, y: 0 };
      setActivePoint(newActive);

      return {
        ...prev,
        walls: updatedWalls,
        isClosed: false,
        calculatedPerimeter: calculatePerimeter(updatedWalls),
        calculatedArea: 0,
        wallCount: updatedWalls.length,
      };
    });
  }, []);

  // 3. Close Room (Connect back to start point, with auto-snap if near origin)
  const handleCloseRoom = useCallback(() => {
    if (room.walls.length < 2) return;
    const startPoint = room.walls[0].start;
    const distToStart = getDistance(activePoint, startPoint);

    let updatedWalls: WallElement[];

    // If within 150mm of start point (like drawing 4 walls of a rectangle), snap last wall directly to start
    if (distToStart <= 150 && room.walls.length >= 3) {
      const lastWall = room.walls[room.walls.length - 1];
      const snappedLastWall: WallElement = {
        ...lastWall,
        end: { ...startPoint },
      };
      updatedWalls = [...room.walls.slice(0, -1), snappedLastWall];
    } else {
      // Add closing wall from active point back to start point
      const closingWall: WallElement = {
        id: `wall-close-${Date.now()}`,
        start: { ...activePoint },
        end: { ...startPoint },
        thickness: 150,
        height: 2800,
        alignment: room.walls[0]?.alignment || "interior",
      };
      updatedWalls = [...room.walls, closingWall];
    }

    // Auto join co-planar walls after the drawing is finished
    const mergeResult = mergeColinearWalls(updatedWalls, room.doors, room.windows, true);
    const finalWalls = mergeResult.walls;
    const finalDoors = mergeResult.doors;
    const finalWindows = mergeResult.windows;

    const poly = getPolygonFromWalls(finalWalls);
    const areaM2 = calculatePolygonArea(poly);
    const perimM = calculatePerimeter(finalWalls);

    setRoom((prev) => ({
      ...prev,
      walls: finalWalls,
      doors: finalDoors,
      windows: finalWindows,
      isClosed: true,
      calculatedArea: areaM2,
      calculatedPerimeter: perimM,
      wallCount: finalWalls.length,
      doorCount: finalDoors.length,
      windowCount: finalWindows.length,
      slab: {
        id: `slab-${Date.now()}`,
        boundary: poly,
        thickness: 150,
        material: "hardwood",
        elevation: 0,
      },
      ceiling: {
        id: `ceiling-${Date.now()}`,
        boundary: poly,
        elevation: 2800,
        thickness: 20,
        visibleIn3d: false,
      },
    }));

    setActivePoint({ ...startPoint });
  }, [room.walls, room.doors, room.windows, activePoint]);

  // 4. Manual / On-Demand Merge Colinear Walls
  const handleMergeColinearWalls = useCallback(() => {
    if (room.walls.length < 2) return;
    const result = mergeColinearWalls(room.walls, room.doors, room.windows, room.isClosed);
    if (result.mergedCount > 0) {
      const poly = getPolygonFromWalls(result.walls);
      setRoom((prev) => ({
        ...prev,
        walls: result.walls,
        doors: result.doors,
        windows: result.windows,
        wallCount: result.walls.length,
        doorCount: result.doors.length,
        windowCount: result.windows.length,
        calculatedPerimeter: calculatePerimeter(result.walls),
        calculatedArea: prev.isClosed && result.walls.length >= 3 ? calculatePolygonArea(poly) : prev.calculatedArea,
        slab: prev.slab ? { ...prev.slab, boundary: poly } : prev.slab,
        ceiling: prev.ceiling ? { ...prev.ceiling, boundary: poly } : prev.ceiling,
      }));
      if (result.walls.length > 0) {
        setActivePoint({ ...result.walls[result.walls.length - 1].end });
      }
    }
  }, [room.walls, room.doors, room.windows, room.isClosed]);

  // 5. Delete Wall / Elements with Automatic Cursor Snapping (Only reopens perimeter if a wall is deleted)
  const handleDeleteElements = useCallback((ids: string[]) => {
    setRoom((prev) => {
      const remainingWalls = prev.walls.filter((w) => !ids.includes(w.id));
      const wallDeleted = remainingWalls.length < prev.walls.length;

      const remainingDoors = prev.doors.filter(
        (door) => !ids.includes(door.id) && remainingWalls.some((wall) => wall.id === door.wallId)
      );
      const remainingWindows = prev.windows.filter(
        (win) => !ids.includes(win.id) && remainingWalls.some((wall) => wall.id === win.wallId)
      );
      const remainingElectrical = (prev.electrical || []).filter(
        (el) => !ids.includes(el.id) && remainingWalls.some((wall) => wall.id === el.wallId)
      );
      const remainingRadiators = (prev.radiators || []).filter(
        (rad) => !ids.includes(rad.id) && remainingWalls.some((wall) => wall.id === rad.wallId)
      );
      const remainingLighting = (prev.lighting || []).filter(
        (l) => !ids.includes(l.id)
      );

      // Only if a wall was deleted do we reopen room perimeter and snap cursor
      if (wallDeleted) {
        if (remainingWalls.length > 0) {
          setActivePoint({ ...remainingWalls[remainingWalls.length - 1].end });
        } else {
          setActivePoint({ x: 0, y: 0 });
        }

        return {
          ...prev,
          walls: remainingWalls,
          doors: remainingDoors,
          windows: remainingWindows,
          electrical: remainingElectrical,
          radiators: remainingRadiators,
          lighting: remainingLighting,
          isClosed: false,
          calculatedArea: 0,
          calculatedPerimeter: calculatePerimeter(remainingWalls),
          wallCount: remainingWalls.length,
          doorCount: remainingDoors.length,
          windowCount: remainingWindows.length,
          slab: undefined,
          ceiling: undefined,
        };
      }

      // If only non-wall elements (doors, windows, electrical, radiators, lighting) were deleted:
      // PRESERVE room isClosed status, calculatedArea, slab, and ceiling!
      return {
        ...prev,
        doors: remainingDoors,
        windows: remainingWindows,
        electrical: remainingElectrical,
        radiators: remainingRadiators,
        lighting: remainingLighting,
        doorCount: remainingDoors.length,
        windowCount: remainingWindows.length,
      };
    });

    setSelectedElementId(null);
    setSelectedElementType(null);
    setSelectedElementIds([]);
  }, []);

  // 6. Reopen Room Perimeter
  const handleReopenPerimeter = () => {
    setRoom((prev) => {
      if (prev.walls.length === 0) return prev;
      // Remove last closing wall
      const updatedWalls = prev.walls.slice(0, -1);
      const newActive = updatedWalls.length > 0 ? { ...updatedWalls[updatedWalls.length - 1].end } : { x: 0, y: 0 };
      setActivePoint(newActive);
      return {
        ...prev,
        walls: updatedWalls,
        isClosed: false,
      };
    });
  };

  // 5. Add Door (Hinged or Sliding Pocket/Patio Door)
  const handleConfirmAddDoor = () => {
    if (!targetWallId) return;
    const wall = room.walls.find((w) => w.id === targetWallId);
    if (!wall) return;

    const newDoor: DoorElement = {
      id: `door-${Date.now()}`,
      wallId: targetWallId,
      offset: doorOffset,
      width: doorWidth,
      height: 2100,
      swingDirection: doorSwingDir,
      swingOrientation: doorSwingOri,
      swingAngle: 90,
      doorType,
      slidingSegments: doorType === "sliding" ? doorSlidingSegments : undefined,
      isFullHeight: doorType === "sliding" ? doorFullHeight : undefined,
    };

    setRoom((prev) => ({
      ...prev,
      doors: [...prev.doors, newDoor],
      doorCount: prev.doors.length + 1,
    }));

    setIsDoorModalOpen(false);
  };

  // 6. Add Window (Standard, Sliding, Double Casement, French Balcony, Fixed)
  const handleConfirmAddWindow = () => {
    if (!targetWallId) return;
    const wall = room.walls.find((w) => w.id === targetWallId);
    if (!wall) return;

    const newWindow: WindowElement = {
      id: `win-${Date.now()}`,
      wallId: targetWallId,
      offset: windowOffset,
      width: windowWidth,
      height: windowHeight,
      sillHeight: windowType === "french" ? 0 : windowSill,
      windowType,
      segments: windowSegments,
      frameMaterial: windowFrameMaterial,
    };

    setRoom((prev) => ({
      ...prev,
      windows: [...prev.windows, newWindow],
      windowCount: prev.windows.length + 1,
    }));

    setIsWindowModalOpen(false);
  };

  // 7. Add Electrical Element (Socket, Switch, Fuse Box)
  const handleConfirmAddElectrical = () => {
    const wallId = electricalWallId || targetWallId || room.walls[0]?.id;
    if (!wallId) return;

    const newEl: ElectricalElement = {
      id: `el-${Date.now()}`,
      wallId,
      type: electricalType,
      offset: electricalOffset,
      elevation: electricalElevation,
    };

    setRoom((prev) => ({
      ...prev,
      electrical: [...(prev.electrical || []), newEl],
    }));

    setIsElectricalModalOpen(false);
  };

  // 8. Add Radiator (Doğalgaz Peteği)
  const handleConfirmAddRadiator = () => {
    const wallId = radiatorWallId || targetWallId || room.walls[0]?.id;
    if (!wallId) return;

    const newRad: RadiatorElement = {
      id: `rad-${Date.now()}`,
      wallId,
      offset: radiatorOffset,
      width: radiatorWidth,
      height: radiatorHeight,
      depth: 80,
      elevation: radiatorElevation,
    };

    setRoom((prev) => ({
      ...prev,
      radiators: [...(prev.radiators || []), newRad],
    }));

    setIsRadiatorModalOpen(false);
  };

  // 9. Add Ceiling Lighting Fixture (Avize, Spot, Plafonyer)
  const handleConfirmAddLight = () => {
    const ref1 = lightRefWall1 || room.walls[0]?.id || "wall-ref-1";
    const ref2 = lightRefWall2 || room.walls[1]?.id;

    const calculatedPos = calculateLightPositionFromWallDistances(
      room,
      ref1,
      lightDist1,
      ref2,
      lightDist2
    );

    const newLight: LightFixtureElement = {
      id: `light-${Date.now()}`,
      type: lightType,
      x: calculatedPos.x,
      y: calculatedPos.y,
      elevation: room.walls[0]?.height || 2800,
      refWallId1: ref1,
      distWall1: lightDist1,
      refWallId2: ref2,
      distWall2: lightDist2,
      label: lightType === "pendant" ? "Sarkıt Avize" : lightType === "spot" ? "Gömme Spot" : "Tavan Plafonyeri",
    };

    setRoom((prev) => ({
      ...prev,
      lighting: [...(prev.lighting || []), newLight],
    }));

    setIsLightModalOpen(false);
  };

  // 10. Save to Firestore
  const handleSave = async () => {
    if (!user?.uid || !projectId || !roomId) {
      alert("Lütfen giriş yapın.");
      return;
    }

    setSaving(true);
    setSaveSuccess(false);

    try {
      await updateRoomPlanInProject(user.uid, projectId, roomId, {
        name: room.name,
        roomType: room.roomType,
        calculatedArea: room.calculatedArea,
        calculatedPerimeter: room.calculatedPerimeter,
        wallCount: room.walls.length,
        doorCount: room.doors.length,
        windowCount: room.windows.length,
        isClosed: room.isClosed,
        walls: room.walls,
        doors: room.doors,
        windows: room.windows,
        slab: room.slab,
        ceiling: room.ceiling,
        flooringType: room.flooringType || "laminate",
        hasDrywallCeiling: Boolean(room.hasDrywallCeiling),
        layerSettings: room.layerSettings,
        electrical: room.electrical || [],
        radiators: room.radiators || [],
        lighting: room.lighting || [],
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error("Save error:", err);
      alert("Plan kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  // 8. Export AutoCAD DXF / DWG
  const handleExportDxf = () => {
    const dxfString = exportRoomToDxf(room, project?.name || "Floor Plan");
    const filename = `${room.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}_plan.dxf`;
    downloadDxfFile(dxfString, filename);
  };

  // 9. Export 3D GLTF / GLB
  const handleExportGltf = async () => {
    if (!sceneGroupRef.current) {
      alert("3D model yükleniyor, lütfen 3D moduna geçip tekrar deneyin.");
      return;
    }
    const filename = `${room.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}_3d_bim`;
    await exportRoomSceneToGltf(sceneGroupRef.current, filename);
  };

  return (
    <div className={styles.studioContainer}>
      {/* Viewport Container */}
      <div className={styles.viewportArea}>
        {/* Top Floating Overlay Bar */}
        <header className={styles.topOverlayBar}>
          <div className={styles.topLeftGroup}>
            <Link href={`/projects/${projectId}`} className={styles.backBtn}>
              <FaChevronLeft size={10} />
              <span>Odalar</span>
            </Link>

            {project?.name && (
              <span className={styles.projectBadge}>
                {project.name}
              </span>
            )}

            <span className={styles.roomBadge}>
              {room.name}
            </span>

            {/* Mode Switcher: 2D Plan vs 3D BIM */}
            <div className={styles.modeSwitcher}>
              <button
                type="button"
                className={`${styles.modeBtn} ${workspaceMode === "2d" ? styles.modeBtnActive : ""}`}
                onClick={() => setWorkspaceMode("2d")}
              >
                <MdDesignServices size={15} />
                <span>2D Plan</span>
              </button>

              <button
                type="button"
                className={`${styles.modeBtn} ${workspaceMode === "3d" ? styles.modeBtnActive : ""}`}
                onClick={() => setWorkspaceMode("3d")}
              >
                <Md3dRotation size={15} />
                <span>3D BIM</span>
              </button>
            </div>
          </div>

          <div className={styles.topRightGroup}>
            {/* Export DWG / DXF */}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleExportDxf}
              title="AutoCAD .DWG / .DXF 2D Kat Planı İndir"
            >
              <MdFileDownload size={15} color="var(--accent)" />
              <span>.DWG / .DXF</span>
            </button>

            {/* Export 3D GLTF */}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleExportGltf}
              title="3D BIM Modelini .GLTF / .GLB Olarak İndir"
            >
              <MdFileDownload size={15} color="#38bdf8" />
              <span>3D .GLTF</span>
            </button>

            {/* Toggle Inspector / Layers */}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => setIsInspectorOpen((prev) => !prev)}
            >
              <MdLayers size={16} />
              <span>Katmanlar</span>
            </button>

            {/* Save Button */}
            <button
              type="button"
              className={`${styles.saveBtn} ${saveSuccess ? styles.saveBtnSuccess : ""}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saveSuccess ? <MdCheck size={16} /> : <MdSave size={16} />}
              <span>{saving ? "Kaydediliyor..." : saveSuccess ? "Kaydedildi" : "Kaydet"}</span>
            </button>
          </div>
        </header>

        {/* 2D Canvas Viewport */}
        <div
          aria-hidden={workspaceMode !== "2d"}
          style={{
            position: "absolute",
            inset: 0,
            visibility: workspaceMode === "2d" ? "visible" : "hidden",
            pointerEvents: workspaceMode === "2d" ? "auto" : "none",
            zIndex: workspaceMode === "2d" ? 2 : 1,
          }}
        >
          <PlanCanvas2D
            room={room}
            activePoint={activePoint}
            selectedElementId={selectedElementId}
            selectedElementType={selectedElementType}
            selectedElementIds={selectedElementIds}
            onSelectElement={handleSelectElement}
            onSelectMultiple={handleSelectMultiple}
            onChangeElementOffset={handleChangeElementOffset}
            onChangeLightPosition={handleChangeLightPosition}
            onSetActivePoint={setActivePoint}
            layerSettings={room.layerSettings}
            placingOpening={placingOpening}
            onSelectWallForOpening={handleSelectWallForOpening}
            onCancelPlacingOpening={() => setPlacingOpening(null)}
          />

          {/* Surveyor D-Pad Bottom Bar */}
          <SurveyorControlBar
            room={room}
            onAddWall={handleAddWall}
            onUndoWall={handleUndoWall}
            onCloseRoom={handleCloseRoom}
            onOpenAddDoorModal={() => setPlacingOpening("door")}
            onOpenAddWindowModal={() => setPlacingOpening("window")}
            onOpenAddElectricalModal={() => setPlacingOpening("electrical")}
            onOpenAddRadiatorModal={() => setPlacingOpening("radiator")}
            onOpenAddLightModal={() => setIsLightModalOpen(true)}
            onReopenPerimeter={handleReopenPerimeter}
            onFlipLastWall={handleFlipActiveWall}
            isNearOrigin={!room.isClosed && room.walls.length >= 2 && getDistance(activePoint, room.walls[0]?.start ?? { x: 0, y: 0 }) < 600}
          />
        </div>

        {/* 3D BIM Viewport with Interactive Selection & Bidirectional Sync */}
        <div
          aria-hidden={workspaceMode !== "3d"}
          style={{
            position: "absolute",
            inset: 0,
            visibility: workspaceMode === "3d" ? "visible" : "hidden",
            pointerEvents: workspaceMode === "3d" ? "auto" : "none",
            zIndex: workspaceMode === "3d" ? 2 : 1,
          }}
        >
          <BimViewer3D
            room={room}
            layerSettings={room.layerSettings}
            sceneGroupRef={sceneGroupRef}
            selectedElementId={selectedElementId}
            selectedElementType={selectedElementType}
            selectedElementIds={selectedElementIds}
            onSelectElement={handleSelectElement}
          />
        </div>

        {/* Layer Hierarchy & Object Inspector Drawer */}
        <PlanInspector
          isOpen={isInspectorOpen}
          onClose={() => setIsInspectorOpen(false)}
          room={room}
          onUpdateRoom={setRoom}
          onUpdateAllWallHeights={handleUpdateAllWallHeights}
          selectedElementId={selectedElementId}
          selectedElementType={selectedElementType}
          selectedElementIds={selectedElementIds}
          onDeselect={handleDeselect}
          onDeleteElements={handleDeleteElements}
          onSetActivePoint={setActivePoint}
          onMergeColinearWalls={handleMergeColinearWalls}
          layerSettings={room.layerSettings || DEFAULT_LAYER_SETTINGS}
          onUpdateLayerSettings={(newLayers) =>
            setRoom((prev) => ({ ...prev, layerSettings: newLayers }))
          }
        />
      </div>

      {/* Quick Add Door Modal */}
      {isDoorModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsDoorModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                <MdMeetingRoom size={18} color="#facc15" style={{ verticalAlign: "middle", marginRight: "6px" }} />
                Kapı Ekle
              </h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setIsDoorModalOpen(false)}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Hangi Duvara Eklensin?</label>
              <select
                value={targetWallId}
                onChange={(e) => setTargetWallId(e.target.value)}
                className={styles.selectInput}
              >
                {room.walls.map((w, idx) => (
                  <option key={w.id} value={w.id}>
                    Duvar {idx + 1} ({Math.round(getDistance(w.start, w.end) / 10)} cm)
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Kapı Tipi</label>
              <select
                value={doorType}
                onChange={(e) => setDoorType(e.target.value as "hinged" | "sliding")}
                className={styles.selectInput}
              >
                <option value="hinged">Standart Menteşeli Kapı</option>
                <option value="sliding">Boydan Kayar / Sürme Kapı</option>
              </select>
            </div>

            {doorType === "sliding" && (
              <>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Kayar Kanat Segment Sayısı</label>
                  <select
                    value={doorSlidingSegments}
                    onChange={(e) => setDoorSlidingSegments(Number(e.target.value) || 2)}
                    className={styles.selectInput}
                  >
                    <option value={2}>2 Kanatlı (1 Sabit + 1 Kayar)</option>
                    <option value={3}>3 Kanatlı (Çoklu Ray)</option>
                    <option value={4}>4 Kanatlı (Geniş Açıklık)</option>
                  </select>
                </div>

                <div className={styles.formField} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    id="modalFullHeightDoor"
                    checked={doorFullHeight}
                    onChange={(e) => setDoorFullHeight(e.target.checked)}
                  />
                  <label htmlFor="modalFullHeightDoor" className={styles.formLabel} style={{ marginBottom: 0, cursor: "pointer" }}>
                    Tavana Kadar Boydan (Full Height)
                  </label>
                </div>
              </>
            )}

            <div className={styles.formField}>
              <label className={styles.formLabel}>Kapı Genişliği</label>
              <select
                value={doorWidth}
                onChange={(e) => setDoorWidth(Number(e.target.value))}
                className={styles.selectInput}
              >
                <option value={700}>70 cm (Banyo / WC)</option>
                <option value={800}>80 cm (Oda)</option>
                <option value={900}>90 cm (Standart Oda)</option>
                <option value={1000}>100 cm (Giriş Kapısı)</option>
                <option value={1200}>120 cm (Geniş Kapı)</option>
                <option value={1600}>160 cm (Çift / Geniş Sürme)</option>
                <option value={2000}>200 cm (Büyük Salon Sürme)</option>
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Duvar Başından Mesafe (cm)</label>
              <input
                type="number"
                min="5"
                step="5"
                value={Math.round(doorOffset / 10)}
                onChange={(e) => setDoorOffset((Number(e.target.value) || 0) * 10)}
                className={styles.textInput}
              />
            </div>

            {doorType === "hinged" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Açılış Yönü</label>
                  <select
                    value={doorSwingDir}
                    onChange={(e) => setDoorSwingDir(e.target.value as "left" | "right")}
                    className={styles.selectInput}
                  >
                    <option value="right">Sağ Açılır</option>
                    <option value="left">Sol Açılır</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel}>İç / Dış</label>
                  <select
                    value={doorSwingOri}
                    onChange={(e) => setDoorSwingOri(e.target.value as "inward" | "outward")}
                    className={styles.selectInput}
                  >
                    <option value="inward">İçeriye</option>
                    <option value="outward">Dışarıya</option>
                  </select>
                </div>
              </div>
            )}

            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleConfirmAddDoor}
              style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
            >
              Kapıyı Yerleştir
            </button>
          </div>
        </div>
      )}

      {/* Quick Add Window Modal */}
      {isWindowModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsWindowModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                <MdWindow size={18} color="#38bdf8" style={{ verticalAlign: "middle", marginRight: "6px" }} />
                Pencere Ekle
              </h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setIsWindowModalOpen(false)}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Hangi Duvara Eklensin?</label>
              <select
                value={targetWallId}
                onChange={(e) => setTargetWallId(e.target.value)}
                className={styles.selectInput}
              >
                {room.walls.map((w, idx) => (
                  <option key={w.id} value={w.id}>
                    Duvar {idx + 1} ({Math.round(getDistance(w.start, w.end) / 10)} cm)
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Pencere Tipi</label>
              <select
                value={windowType}
                onChange={(e) => {
                  const wt = e.target.value as any;
                  setWindowType(wt);
                  if (wt === "french") setWindowSill(0);
                }}
                className={styles.selectInput}
              >
                <option value="standard">Standart Açılır Kanat</option>
                <option value="sliding">Sürme Pencere</option>
                <option value="double_casement">Çift Kanat Açılır</option>
                <option value="french">Fransız Balkon (Korkuluklu)</option>
                <option value="fixed">Sabit Cam / Vitrin</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Bölme Sayısı</label>
                <select
                  value={windowSegments}
                  onChange={(e) => setWindowSegments(Number(e.target.value) || 1)}
                  className={styles.selectInput}
                >
                  <option value={1}>1 Bölme (Tek)</option>
                  <option value={2}>2 Bölme</option>
                  <option value={3}>3 Bölme</option>
                  <option value={4}>4 Bölme</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Doğrama Malzemesi</label>
                <select
                  value={windowFrameMaterial}
                  onChange={(e) => setWindowFrameMaterial(e.target.value as any)}
                  className={styles.selectInput}
                >
                  <option value="anthracite">Antrasit</option>
                  <option value="pvc_white">Beyaz PVC</option>
                  <option value="wood">Ahşap</option>
                  <option value="aluminum">Alüminyum</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Genişlik (cm)</label>
                <input
                  type="number"
                  min="50"
                  step="5"
                  value={Math.round(windowWidth / 10)}
                  onChange={(e) => setWindowWidth((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Yükseklik (cm)</label>
                <input
                  type="number"
                  min="50"
                  step="5"
                  value={Math.round(windowHeight / 10)}
                  onChange={(e) => setWindowHeight((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Parapet Kotu (cm)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={Math.round(windowSill / 10)}
                  onChange={(e) => setWindowSill((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                  disabled={windowType === "french"}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Duvar Başı Mesafe (cm)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={Math.round(windowOffset / 10)}
                  onChange={(e) => setWindowOffset((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleConfirmAddWindow}
              style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
            >
              Pencereyi Yerleştir
            </button>
          </div>
        </div>
      )}

      {/* Quick Add Electrical Modal */}
      {isElectricalModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsElectricalModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                <MdPower size={18} color="#4ade80" style={{ verticalAlign: "middle", marginRight: "6px" }} />
                Elektrik Elemanı Ekle
              </h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setIsElectricalModalOpen(false)}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Hangi Duvara Eklensin?</label>
              <select
                value={electricalWallId || room.walls[0]?.id || ""}
                onChange={(e) => setElectricalWallId(e.target.value)}
                className={styles.selectInput}
              >
                {room.walls.map((w, idx) => (
                  <option key={w.id} value={w.id}>
                    Duvar {idx + 1} ({Math.round(getDistance(w.start, w.end) / 10)} cm)
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Eleman Tipi</label>
              <select
                value={electricalType}
                onChange={(e) => {
                  const t = e.target.value as "socket" | "switch" | "panel";
                  setElectricalType(t);
                  setElectricalElevation(t === "socket" ? 300 : t === "switch" ? 1100 : 1800);
                }}
                className={styles.selectInput}
              >
                <option value="socket">Priz (Topraklı Priz)</option>
                <option value="switch">Anahtar (Aydınlatma)</option>
                <option value="panel">Sigorta Panosu (Kutu)</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Duvar Başı (cm)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={Math.round(electricalOffset / 10)}
                  onChange={(e) => setElectricalOffset((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Montaj Kotu (cm)</label>
                <input
                  type="number"
                  min="5"
                  max="280"
                  step="5"
                  value={Math.round(electricalElevation / 10)}
                  onChange={(e) => setElectricalElevation((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleConfirmAddElectrical}
              style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
            >
              Elemanı Yerleştir
            </button>
          </div>
        </div>
      )}

      {/* Quick Add Radiator Modal */}
      {isRadiatorModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsRadiatorModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                <MdWhatshot size={18} color="#f87171" style={{ verticalAlign: "middle", marginRight: "6px" }} />
                Doğalgaz Peteği Ekle
              </h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setIsRadiatorModalOpen(false)}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Hangi Duvara Eklensin?</label>
              <select
                value={radiatorWallId || room.walls[0]?.id || ""}
                onChange={(e) => setRadiatorWallId(e.target.value)}
                className={styles.selectInput}
              >
                {room.walls.map((w, idx) => (
                  <option key={w.id} value={w.id}>
                    Duvar {idx + 1} ({Math.round(getDistance(w.start, w.end) / 10)} cm)
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Petek Genişliği</label>
              <select
                value={radiatorWidth}
                onChange={(e) => setRadiatorWidth(Number(e.target.value))}
                className={styles.selectInput}
              >
                <option value={600}>60 cm (Küçük)</option>
                <option value={800}>80 cm</option>
                <option value={1000}>100 cm (Standart Oda)</option>
                <option value={1200}>120 cm</option>
                <option value={1400}>140 cm (Salon)</option>
                <option value={1600}>160 cm (Büyük Salon)</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Duvar Başı (cm)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={Math.round(radiatorOffset / 10)}
                  onChange={(e) => setRadiatorOffset((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Yükseklik (cm)</label>
                <input
                  type="number"
                  min="30"
                  max="100"
                  step="5"
                  value={Math.round(radiatorHeight / 10)}
                  onChange={(e) => setRadiatorHeight((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleConfirmAddRadiator}
              style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
            >
              Peteği Yerleştir
            </button>
          </div>
        </div>
      )}

      {/* Quick Add Lighting Modal */}
      {isLightModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsLightModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                <MdLightbulb size={18} color="#fbbf24" style={{ verticalAlign: "middle", marginRight: "6px" }} />
                Aydınlatma Armatürü Ekle
              </h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setIsLightModalOpen(false)}
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel}>Armatür Tipi</label>
              <select
                value={lightType}
                onChange={(e) => setLightType(e.target.value as any)}
                className={styles.selectInput}
              >
                <option value="pendant">Sarkıt / Avize</option>
                <option value="spot">Gömme Tavan Spotu</option>
                <option value="ceiling">Tavan Plafonyeri</option>
                <option value="track">Ray Spot Sistemi</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>1. Duvara Mesafe (cm)</label>
                <input
                  type="number"
                  min="10"
                  step="5"
                  value={Math.round(lightDist1 / 10)}
                  onChange={(e) => setLightDist1((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>2. Duvara Mesafe (cm)</label>
                <input
                  type="number"
                  min="10"
                  step="5"
                  value={Math.round(lightDist2 / 10)}
                  onChange={(e) => setLightDist2((Number(e.target.value) || 0) * 10)}
                  className={styles.textInput}
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleConfirmAddLight}
              style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
            >
              Armatürü Yerleştir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlanStudioPage({ params }: PageProps) {
  return (
    <React.Suspense
      fallback={
        <div
          style={{
            width: "100%",
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0d0d12",
            color: "var(--accent)",
            fontSize: "0.85rem",
            letterSpacing: "0.05em",
          }}
        >
          PLAN STUDIO YÜKLENİYOR...
        </div>
      }
    >
      <PlanStudioContent params={params} />
    </React.Suspense>
  );
}
