"use client";

import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type {
  RoomPlanItem,
  WallElement,
  DoorElement,
  WindowElement,
  ElectricalElement,
  RadiatorElement,
  LightFixtureElement,
  LayerSettings,
} from "@/types/plan";
import {
  getDistance,
  getWallsBoundingBox,
  computeWallPolygons,
  WallPolygonCorners,
} from "@/lib/cad/geometry";

interface BimViewer3DProps {
  room: RoomPlanItem;
  layerSettings?: LayerSettings;
  sceneGroupRef?: React.RefObject<THREE.Group | null>;
  selectedElementId?: string | null;
  selectedElementType?: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | null;
  selectedElementIds?: string[];
  onSelectElement?: (id: string | null, type: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | null) => void;
}

// Global CAD mm to 3D Meter Scale (1 Unit = 1 Meter)
const SCALE = 0.001;

/**
 * Builds a clean 6-sided hexahedral prism buffer geometry from 4 local corner points
 * Extruded vertically between yBottom and yTop.
 * Ensures 100% flush architectural miter/butt joins with ZERO overlapping ledges or inside fins.
 */
function createWallPrismBufferGeometry(
  p1: { x: number; z: number }, // innerStart
  p2: { x: number; z: number }, // innerEnd
  p3: { x: number; z: number }, // outerEnd
  p4: { x: number; z: number }, // outerStart
  yBottom: number,
  yTop: number
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const positions = [
    // Bottom 4 vertices (Y = yBottom)
    p1.x, yBottom, p1.z, // 0
    p2.x, yBottom, p2.z, // 1
    p3.x, yBottom, p3.z, // 2
    p4.x, yBottom, p4.z, // 3
    // Top 4 vertices (Y = yTop)
    p1.x, yTop, p1.z,    // 4
    p2.x, yTop, p2.z,    // 5
    p3.x, yTop, p3.z,    // 6
    p4.x, yTop, p4.z,    // 7
  ];

  const indices = [
    // Bottom (normal -Y)
    0, 1, 2,   0, 2, 3,
    // Top (normal +Y)
    4, 7, 6,   4, 6, 5,
    // Inner face (normal -Z)
    0, 4, 5,   0, 5, 1,
    // Outer face (normal +Z)
    2, 6, 7,   2, 7, 3,
    // Start face (normal -X)
    3, 7, 4,   3, 4, 0,
    // End face (normal +X)
    1, 5, 6,   1, 6, 2,
  ];

  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);

  // CRITICAL: toNonIndexed() unshares vertices across adjacent 90-degree perpendicular faces.
  // This completely eliminates smooth/Gouraud shading curvature artifacts and dark corner gradients,
  // ensuring 100% crisp, flat architectural wall corners and faces.
  const flatGeom = geom.toNonIndexed();
  flatGeom.computeVertexNormals();
  geom.dispose();
  return flatGeom;
}

// 1. Procedural 3D Wall with Exact Corner Geometry and Door/Window Cutouts
function Wall3DMesh({
  wall,
  poly,
  doors,
  windows,
  isSelected = false,
  onSelect,
}: {
  wall: WallElement;
  poly?: WallPolygonCorners;
  doors: DoorElement[];
  windows: WindowElement[];
  isSelected?: boolean;
  onSelect?: (id: string, type: "wall") => void;
}) {
  const wallHeight = (wall.height || 2800) * SCALE;
  const wallThick = (wall.thickness || 150) * SCALE;

  const dx = (wall.end.x - wall.start.x) * SCALE;
  const dz = -(wall.end.y - wall.start.y) * SCALE;
  const angleY = -Math.atan2(dz, dx);
  const wallLen = Math.hypot(dx, dz) || 0.001;
  const ux = dx / wallLen;
  const uz = dz / wallLen;

  const align = wall.alignment || "interior";
  const flip = wall.flipSide ? -1 : 1;
  const zOffset = (align === "interior" ? -wallThick / 2 : align === "exterior" ? wallThick / 2 : 0) * flip;

  // Convert 2D CAD world polygon corners to local 3D wall coordinates
  const worldToLocal = (pt: { x: number; y: number }) => {
    const rx = (pt.x - wall.start.x) * SCALE;
    const rz = -(pt.y - wall.start.y) * SCALE;
    const x = rx * ux + rz * uz;
    const z = -rx * uz + rz * ux;
    return { x, z };
  };

  const lp1 = poly ? worldToLocal(poly.innerStart) : { x: 0, z: zOffset + wallThick / 2 };
  const lp2 = poly ? worldToLocal(poly.innerEnd) : { x: wallLen, z: zOffset + wallThick / 2 };
  const lp3 = poly ? worldToLocal(poly.outerEnd) : { x: wallLen, z: zOffset - wallThick / 2 };
  const lp4 = poly ? worldToLocal(poly.outerStart) : { x: 0, z: zOffset - wallThick / 2 };

  const wallColor = isSelected ? "#86efac" : "#f1f5f9";
  const emissiveColor = isSelected ? "#22c55e" : "#000000";
  const emissiveIntensity = isSelected ? 0.35 : 0;

  const handlePointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
  };
  const handlePointerOut = () => {
    document.body.style.cursor = "default";
  };
  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(wall.id, "wall");
  };

  const hasOpenings = doors.length > 0 || windows.length > 0;

  // Wall without openings: single continuous prism fitting the corners perfectly
  const solidGeom = useMemo(() => {
    if (hasOpenings) return null;
    return createWallPrismBufferGeometry(lp1, lp2, lp3, lp4, 0, wallHeight);
  }, [hasOpenings, lp1.x, lp1.z, lp2.x, lp2.z, lp3.x, lp3.z, lp4.x, lp4.z, wallHeight]);

  if (!hasOpenings && solidGeom) {
    return (
      <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
        <mesh
          geometry={solidGeom}
          castShadow
          receiveShadow
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <meshStandardMaterial
            color={wallColor}
            emissive={emissiveColor}
            emissiveIntensity={emissiveIntensity}
            roughness={0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    );
  }

  // Wall with Openings (Doors & Windows)
  const allOpenings = [
    ...doors.map((d) => ({
      type: "door" as const,
      offset: d.offset * SCALE,
      width: d.width * SCALE,
      height: d.height * SCALE,
      sill: 0,
    })),
    ...windows.map((w) => ({
      type: "window" as const,
      offset: w.offset * SCALE,
      width: w.width * SCALE,
      height: w.height * SCALE,
      sill: w.sillHeight * SCALE,
    })),
  ].sort((a, b) => a.offset - b.offset);

  const zIn = (lp1.z + lp2.z) / 2;
  const zOut = (lp4.z + lp3.z) / 2;

  return (
    <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
      {allOpenings.map((op, idx) => {
        const prevEnd = idx === 0 ? 0 : allOpenings[idx - 1].offset + allOpenings[idx - 1].width;
        const opStart = op.offset;
        const opEnd = op.offset + op.width;

        const pA_in = idx === 0 ? lp1 : { x: prevEnd, z: zIn };
        const pB_in = { x: opStart, z: zIn };
        const pB_out = { x: opStart, z: zOut };
        const pA_out = idx === 0 ? lp4 : { x: prevEnd, z: zOut };

        const hasPreSegment = opStart - prevEnd > 0.01;
        const preGeom = hasPreSegment
          ? createWallPrismBufferGeometry(pA_in, pB_in, pB_out, pA_out, 0, wallHeight)
          : null;

        const opInStart = { x: opStart, z: zIn };
        const opInEnd = { x: opEnd, z: zIn };
        const opOutEnd = { x: opEnd, z: zOut };
        const opOutStart = { x: opStart, z: zOut };

        const lintelTop = wallHeight;
        const lintelBot = op.sill + op.height;
        const hasLintel = lintelTop - lintelBot > 0.01;
        const lintelGeom = hasLintel
          ? createWallPrismBufferGeometry(opInStart, opInEnd, opOutEnd, opOutStart, lintelBot, lintelTop)
          : null;

        const hasSill = op.type === "window" && op.sill > 0.01;
        const sillGeom = hasSill
          ? createWallPrismBufferGeometry(opInStart, opInEnd, opOutEnd, opOutStart, 0, op.sill)
          : null;

        return (
          <React.Fragment key={idx}>
            {preGeom && (
              <mesh
                geometry={preGeom}
                castShadow
                receiveShadow
                onClick={handleClick}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
              >
                <meshStandardMaterial
                  color={wallColor}
                  emissive={emissiveColor}
                  emissiveIntensity={emissiveIntensity}
                  roughness={0.4}
                  metalness={0.05}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}

            {lintelGeom && (
              <mesh
                geometry={lintelGeom}
                castShadow
                receiveShadow
                onClick={handleClick}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
              >
                <meshStandardMaterial
                  color={wallColor}
                  emissive={emissiveColor}
                  emissiveIntensity={emissiveIntensity}
                  roughness={0.4}
                  metalness={0.05}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}

            {sillGeom && (
              <mesh
                geometry={sillGeom}
                castShadow
                receiveShadow
                onClick={handleClick}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
              >
                <meshStandardMaterial
                  color={wallColor}
                  emissive={emissiveColor}
                  emissiveIntensity={emissiveIntensity}
                  roughness={0.4}
                  metalness={0.05}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
          </React.Fragment>
        );
      })}

      {/* Trailing wall segment after last opening */}
      {(() => {
        if (allOpenings.length === 0) return null;
        const lastOp = allOpenings[allOpenings.length - 1];
        const lastEnd = lastOp.offset + lastOp.width;

        const pA_in = { x: lastEnd, z: zIn };
        const pB_in = lp2;
        const pB_out = lp3;
        const pA_out = { x: lastEnd, z: zOut };

        const trailGeom = createWallPrismBufferGeometry(pA_in, pB_in, pB_out, pA_out, 0, wallHeight);

        return (
          <mesh
            geometry={trailGeom}
            castShadow
            receiveShadow
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
          >
            <meshStandardMaterial
              color={wallColor}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
              roughness={0.4}
              metalness={0.05}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })()}
    </group>
  );
}

// 2. Procedural 3D Door Fixture (Supports Standard Hinged & Sliding Pocket/Patio Doors)
function Door3DFixture({
  door,
  wall,
  isSelected = false,
  onSelect,
}: {
  door: DoorElement;
  wall: WallElement;
  isSelected?: boolean;
  onSelect?: (id: string, type: "door") => void;
}) {
  const dx = (wall.end.x - wall.start.x) * SCALE;
  const dz = -(wall.end.y - wall.start.y) * SCALE;
  const angleY = -Math.atan2(dz, dx);

  const wThick = (wall.thickness || 150) * SCALE;
  const dWidth = door.width * SCALE;
  const dHeight = (door.isFullHeight ? (wall.height || 2800) : door.height) * SCALE;
  const dOffset = door.offset * SCALE;

  const align = wall.alignment || "interior";
  const flip = wall.flipSide ? -1 : 1;
  const zOffset = (align === "interior" ? -wThick / 2 : align === "exterior" ? wThick / 2 : 0) * flip;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(door.id, "door");
  };

  const jambW = 0.045;
  const frameDepth = wThick + 0.015;
  const frameColor = isSelected ? "#fef08a" : "#1e293b";
  const frameEmissive = isSelected ? "#eab308" : "#000000";

  // Sliding Door Mode
  if (door.doorType === "sliding") {
    const numSegs = Math.max(2, Math.min(4, door.slidingSegments || 2));
    const clearW = dWidth - jambW * 2;
    const segW = (clearW / numSegs) * 1.12;
    const panelThick = 0.035;
    const trackGap = 0.02;

    return (
      <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
        <group
          position={[dOffset, 0, zOffset]}
          onClick={handleClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "default";
          }}
        >
          {/* Outer Sliding Frame Jambs & Head Rail */}
          <mesh position={[jambW / 2, dHeight / 2, 0]} castShadow>
            <boxGeometry args={[jambW, dHeight, frameDepth]} />
            <meshStandardMaterial color={frameColor} emissive={frameEmissive} emissiveIntensity={isSelected ? 0.4 : 0} />
          </mesh>
          <mesh position={[dWidth - jambW / 2, dHeight / 2, 0]} castShadow>
            <boxGeometry args={[jambW, dHeight, frameDepth]} />
            <meshStandardMaterial color={frameColor} emissive={frameEmissive} emissiveIntensity={isSelected ? 0.4 : 0} />
          </mesh>
          <mesh position={[dWidth / 2, dHeight - jambW / 2, 0]} castShadow>
            <boxGeometry args={[dWidth, jambW, frameDepth]} />
            <meshStandardMaterial color={frameColor} emissive={frameEmissive} emissiveIntensity={isSelected ? 0.4 : 0} />
          </mesh>

          {/* Staggered Sliding Door Panels */}
          {Array.from({ length: numSegs }).map((_, sIdx) => {
            const segX = jambW + (sIdx * (clearW - segW)) / (numSegs - 1 || 1) + segW / 2;
            const trackSign = sIdx % 2 === 0 ? -1 : 1;
            const segZ = trackSign * (trackGap / 2);

            return (
              <group key={sIdx} position={[segX, dHeight / 2, segZ]}>
                {/* Panel Aluminum Outer Sash */}
                <mesh castShadow>
                  <boxGeometry args={[segW, dHeight - jambW * 1.8, panelThick]} />
                  <meshStandardMaterial color={isSelected ? "#86efac" : "#18181b"} roughness={0.2} metalness={0.7} />
                </mesh>
                {/* Panel Tempered Glass */}
                <mesh>
                  <boxGeometry args={[segW - 0.08, dHeight - jambW * 1.8 - 0.08, panelThick - 0.015]} />
                  <meshPhysicalMaterial
                    color="#38bdf8"
                    transparent
                    opacity={0.35}
                    roughness={0.05}
                    transmission={0.9}
                    ior={1.5}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                {/* Recessed Grip Handle */}
                <mesh position={[sIdx === 0 ? segW / 2 - 0.04 : -segW / 2 + 0.04, 0, panelThick / 2 + 0.003]}>
                  <boxGeometry args={[0.02, 0.25, 0.008]} />
                  <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.15} />
                </mesh>
              </group>
            );
          })}
        </group>
      </group>
    );
  }

  // Standard Hinged Door
  const swingAngleDeg = door.swingAngle ?? 90;
  const swingRad = THREE.MathUtils.degToRad(swingAngleDeg);
  const leafW = Math.max(0.2, dWidth - jambW * 2);
  const leafThick = 0.04;
  const leafH = Math.max(0.5, dHeight - jambW - 0.01);

  const isLeftHinge = door.swingDirection === "left";
  const hingeX = isLeftHinge ? jambW : dWidth - jambW;
  const isInward = door.swingOrientation === "inward";
  const swingSign = (isInward ? 1 : -1) * flip;
  const leafAngleY = isLeftHinge ? -swingRad * swingSign : swingRad * swingSign;

  const leafColor = isSelected ? "#fef08a" : "#9a3412";
  const leafEmissive = isSelected ? "#eab308" : "#000000";

  return (
    <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
      <group
        position={[dOffset, 0, zOffset]}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <mesh position={[jambW / 2, dHeight / 2, 0]} castShadow>
          <boxGeometry args={[jambW, dHeight, frameDepth]} />
          <meshStandardMaterial color={frameColor} emissive={frameEmissive} emissiveIntensity={isSelected ? 0.4 : 0} roughness={0.4} />
        </mesh>
        <mesh position={[dWidth - jambW / 2, dHeight / 2, 0]} castShadow>
          <boxGeometry args={[jambW, dHeight, frameDepth]} />
          <meshStandardMaterial color={frameColor} emissive={frameEmissive} emissiveIntensity={isSelected ? 0.4 : 0} roughness={0.4} />
        </mesh>
        <mesh position={[dWidth / 2, dHeight - jambW / 2, 0]} castShadow>
          <boxGeometry args={[dWidth, jambW, frameDepth]} />
          <meshStandardMaterial color={frameColor} emissive={frameEmissive} emissiveIntensity={isSelected ? 0.4 : 0} roughness={0.4} />
        </mesh>

        <group position={[hingeX, 0, 0]} rotation={[0, leafAngleY, 0]}>
          <mesh position={[isLeftHinge ? leafW / 2 : -leafW / 2, leafH / 2, 0]} castShadow>
            <boxGeometry args={[leafW, leafH, leafThick]} />
            <meshStandardMaterial color={leafColor} emissive={leafEmissive} emissiveIntensity={isSelected ? 0.35 : 0} roughness={0.35} />
          </mesh>
          <group position={[isLeftHinge ? leafW - 0.06 : -leafW + 0.06, 1.0, 0]}>
            <mesh position={[0, 0, leafThick / 2 + 0.02]} rotation={[0, 0, isLeftHinge ? 0 : Math.PI]}>
              <cylinderGeometry args={[0.008, 0.008, 0.1]} />
              <meshStandardMaterial color="#f8fafc" metalness={0.9} roughness={0.15} />
            </mesh>
            <mesh position={[0, 0, -leafThick / 2 - 0.02]} rotation={[0, 0, isLeftHinge ? 0 : Math.PI]}>
              <cylinderGeometry args={[0.008, 0.008, 0.1]} />
              <meshStandardMaterial color="#f8fafc" metalness={0.9} roughness={0.15} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

// 3. Procedural 3D Window Fixture with Customizable Frame Materials, Segments & French Balcony
function Window3DFixture({
  win,
  wall,
  isSelected = false,
  onSelect,
}: {
  win: WindowElement;
  wall: WallElement;
  isSelected?: boolean;
  onSelect?: (id: string, type: "window") => void;
}) {
  const dx = (wall.end.x - wall.start.x) * SCALE;
  const dz = -(wall.end.y - wall.start.y) * SCALE;
  const angleY = -Math.atan2(dz, dx);

  const wThick = (wall.thickness || 150) * SCALE;
  const winW = win.width * SCALE;
  const isFrench = win.windowType === "french";
  const winSill = (isFrench ? 0 : win.sillHeight) * SCALE;
  const winH = win.height * SCALE;
  const winOff = win.offset * SCALE;

  const align = wall.alignment || "interior";
  const flip = wall.flipSide ? -1 : 1;
  const zOffset = (align === "interior" ? -wThick / 2 : align === "exterior" ? wThick / 2 : 0) * flip;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(win.id, "window");
  };

  const frameMat = win.frameMaterial || "anthracite";
  const frameColor =
    frameMat === "pvc_white"
      ? "#f8fafc"
      : frameMat === "wood"
      ? "#854d0e"
      : frameMat === "aluminum"
      ? "#18181b"
      : "#334155"; // anthracite default

  const frameBorder = 0.05; // 50mm frame profile
  const numPanes = Math.max(1, Math.min(4, win.segments || (win.windowType === "sliding" || win.windowType === "double_casement" ? 2 : 1)));
  const paneW = (winW - frameBorder * 2) / numPanes;

  return (
    <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
      <group
        position={[winOff + winW / 2, winSill + winH / 2, zOffset]}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        {/* Outer Frame (Top, Bottom, Left, Right) */}
        {/* Left Jamb */}
        <mesh position={[-winW / 2 + frameBorder / 2, 0, 0]} castShadow>
          <boxGeometry args={[frameBorder, winH, wThick + 0.02]} />
          <meshStandardMaterial color={isSelected ? "#7dd3fc" : frameColor} roughness={0.3} />
        </mesh>
        {/* Right Jamb */}
        <mesh position={[winW / 2 - frameBorder / 2, 0, 0]} castShadow>
          <boxGeometry args={[frameBorder, winH, wThick + 0.02]} />
          <meshStandardMaterial color={isSelected ? "#7dd3fc" : frameColor} roughness={0.3} />
        </mesh>
        {/* Top Header */}
        <mesh position={[0, winH / 2 - frameBorder / 2, 0]} castShadow>
          <boxGeometry args={[winW, frameBorder, wThick + 0.02]} />
          <meshStandardMaterial color={isSelected ? "#7dd3fc" : frameColor} roughness={0.3} />
        </mesh>
        {/* Bottom Sill Frame */}
        <mesh position={[0, -winH / 2 + frameBorder / 2, 0]} castShadow>
          <boxGeometry args={[winW, frameBorder, wThick + 0.02]} />
          <meshStandardMaterial color={isSelected ? "#7dd3fc" : frameColor} roughness={0.3} />
        </mesh>

        {/* Vertical Dividing Mullions (if multi-pane) */}
        {Array.from({ length: numPanes - 1 }).map((_, mIdx) => {
          const mX = -winW / 2 + frameBorder + (mIdx + 1) * paneW;
          return (
            <mesh key={mIdx} position={[mX, 0, 0]} castShadow>
              <boxGeometry args={[0.04, winH - frameBorder * 2, wThick + 0.015]} />
              <meshStandardMaterial color={isSelected ? "#7dd3fc" : frameColor} roughness={0.3} />
            </mesh>
          );
        })}

        {/* Glazing Panes */}
        {Array.from({ length: numPanes }).map((_, pIdx) => {
          const pX = -winW / 2 + frameBorder + pIdx * paneW + paneW / 2;
          return (
            <mesh key={pIdx} position={[pX, 0, 0]}>
              <boxGeometry args={[paneW - 0.01, winH - frameBorder * 2 - 0.01, 0.015]} />
              <meshPhysicalMaterial
                color={isSelected ? "#38bdf8" : "#38bdf8"}
                emissive={isSelected ? "#0284c7" : "#000000"}
                emissiveIntensity={isSelected ? 0.4 : 0}
                transparent
                opacity={0.4}
                roughness={0.05}
                transmission={0.88}
                ior={1.5}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        })}

        {/* French Balcony Exterior Safety Guardrail (Korkuluk) */}
        {isFrench && (
          <group position={[0, -winH / 2 + 0.45, (wThick / 2 + 0.06) * flip]}>
            {/* Top Handrail */}
            <mesh position={[0, 0.45, 0]}>
              <boxGeometry args={[winW + 0.08, 0.04, 0.04]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Bottom Support Rail */}
            <mesh position={[0, -0.4, 0]}>
              <boxGeometry args={[winW + 0.08, 0.03, 0.03]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Intermediate Horizontal Security Tubes */}
            {[-0.15, 0.1, 0.28].map((yOff, i) => (
              <mesh key={i} position={[0, yOff, 0]}>
                <cylinderGeometry args={[0.008, 0.008, winW + 0.06]} />
                <meshStandardMaterial color="#475569" metalness={0.85} roughness={0.15} />
              </mesh>
            ))}
          </group>
        )}
      </group>
    </group>
  );
}

// 4. Procedural 3D Wall-Mounted Electrical Fixtures (Socket, Switch, Fuse Panel)
function Electrical3DFixture({
  element,
  wall,
  isSelected = false,
  onSelect,
}: {
  element: ElectricalElement;
  wall: WallElement;
  isSelected?: boolean;
  onSelect?: (id: string, type: "electrical") => void;
}) {
  const dx = (wall.end.x - wall.start.x) * SCALE;
  const dz = -(wall.end.y - wall.start.y) * SCALE;
  const angleY = -Math.atan2(dz, dx);

  const wThick = (wall.thickness || 150) * SCALE;
  const elOffset = element.offset * SCALE;
  const elElev = (element.elevation || (element.type === "socket" ? 300 : element.type === "switch" ? 1100 : 1800)) * SCALE;

  const align = wall.alignment || "interior";
  const flip = wall.flipSide ? -1 : 1;
  // Mounted directly flush on the interior wall face (inside the room)
  // In local CAD wall coordinates, the interior face is at Z = 0, room extends into +Z.
  let innerFaceZ = 0;
  if (align === "center") {
    innerFaceZ = (wThick / 2) * flip;
  } else if (align === "exterior") {
    innerFaceZ = wThick * flip;
  }
  const fixtureDepth = element.type === "panel" ? 0.06 : 0.012;
  const faceZ = (innerFaceZ + fixtureDepth / 2) * flip;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(element.id, "electrical");
  };

  const plateColor = isSelected ? "#4ade80" : element.type === "panel" ? "#334155" : "#f1f5f9";
  const plateEmissive = isSelected ? "#22c55e" : "#000000";

  return (
    <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
      <group
        position={[elOffset, elElev, faceZ]}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        {element.type === "panel" ? (
          // Electric Distribution Board / Fuse Box (Pano)
          <group>
            <mesh castShadow>
              <boxGeometry args={[0.26, 0.38, 0.06]} />
              <meshStandardMaterial color={plateColor} emissive={plateEmissive} emissiveIntensity={isSelected ? 0.5 : 0} metalness={0.6} roughness={0.3} />
            </mesh>
            {/* Front Panel Door Outline & Handle */}
            <mesh position={[0, 0, 0.032]}>
              <boxGeometry args={[0.24, 0.35, 0.005]} />
              <meshStandardMaterial color="#475569" roughness={0.4} />
            </mesh>
            <mesh position={[0.08, 0, 0.038]}>
              <boxGeometry args={[0.015, 0.06, 0.01]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.9} />
            </mesh>
          </group>
        ) : element.type === "switch" ? (
          // Light Switch (Anahtar)
          <group>
            <mesh castShadow>
              <boxGeometry args={[0.085, 0.085, 0.012]} />
              <meshStandardMaterial color={plateColor} emissive={plateEmissive} emissiveIntensity={isSelected ? 0.5 : 0} roughness={0.25} />
            </mesh>
            {/* Rocker Switch Toggle */}
            <mesh position={[0, 0, 0.008]} rotation={[-0.1, 0, 0]}>
              <boxGeometry args={[0.045, 0.055, 0.006]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.2} />
            </mesh>
          </group>
        ) : (
          // Electric Socket Outlet (Priz)
          <group>
            <mesh castShadow>
              <boxGeometry args={[0.085, 0.085, 0.012]} />
              <meshStandardMaterial color={plateColor} emissive={plateEmissive} emissiveIntensity={isSelected ? 0.5 : 0} roughness={0.25} />
            </mesh>
            {/* Plug Pin Sockets */}
            <mesh position={[-0.012, 0, 0.007]}>
              <cylinderGeometry args={[0.003, 0.003, 0.004]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
            <mesh position={[0.012, 0, 0.007]}>
              <cylinderGeometry args={[0.003, 0.003, 0.004]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

// 5. Procedural 3D Wall-Mounted Panel Radiator (Doğalgaz Peteği)
function Radiator3DFixture({
  rad,
  wall,
  isSelected = false,
  onSelect,
}: {
  rad: RadiatorElement;
  wall: WallElement;
  isSelected?: boolean;
  onSelect?: (id: string, type: "radiator") => void;
}) {
  const dx = (wall.end.x - wall.start.x) * SCALE;
  const dz = -(wall.end.y - wall.start.y) * SCALE;
  const angleY = -Math.atan2(dz, dx);

  const wThick = (wall.thickness || 150) * SCALE;
  const rWidth = (rad.width || 1000) * SCALE;
  const rHeight = (rad.height || 600) * SCALE;
  const rDepth = (rad.depth || 80) * SCALE;
  const rElev = (rad.elevation || 100) * SCALE;
  const rOffset = rad.offset * SCALE;

  const align = wall.alignment || "interior";
  const flip = wall.flipSide ? -1 : 1;
  let innerFaceZ = 0;
  if (align === "center") {
    innerFaceZ = (wThick / 2) * flip;
  } else if (align === "exterior") {
    innerFaceZ = wThick * flip;
  }
  // Positioned flush with a 2cm air-gap from interior wall face (inside the room)
  const faceZ = (innerFaceZ + 0.02 + rDepth / 2) * flip;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(rad.id, "radiator");
  };

  const bodyColor = isSelected ? "#fef08a" : "#f8fafc";
  const bodyEmissive = isSelected ? "#eab308" : "#000000";

  return (
    <group position={[wall.start.x * SCALE, 0, -wall.start.y * SCALE]} rotation={[0, angleY, 0]}>
      <group
        position={[rOffset + rWidth / 2, rElev + rHeight / 2, faceZ]}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        {/* Main Enameled Steel Radiator Body */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[rWidth, rHeight, rDepth]} />
          <meshStandardMaterial
            color={bodyColor}
            emissive={bodyEmissive}
            emissiveIntensity={isSelected ? 0.35 : 0}
            roughness={0.25}
            metalness={0.2}
          />
        </mesh>

        {/* Top Convection Air Grille */}
        <mesh position={[0, rHeight / 2 + 0.005, 0]}>
          <boxGeometry args={[rWidth, 0.01, rDepth]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.3} />
        </mesh>

        {/* Thermostatic Radiator Valve (TRV) on top side */}
        <group position={[rWidth / 2 + 0.035, rHeight / 2 - 0.06, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.015, 0.015, 0.06]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0.03, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.022, 0.022, 0.04]} />
            <meshStandardMaterial color="#ef4444" roughness={0.3} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// 6. Procedural 3D Ceiling Lighting Fixtures (Pendant, Spot, Ceiling Luminaire)
function Light3DFixture({
  fixture,
  wallHeightMm = 2800,
  isSelected = false,
  onSelect,
}: {
  fixture: LightFixtureElement;
  wallHeightMm?: number;
  isSelected?: boolean;
  onSelect?: (id: string, type: "lighting") => void;
}) {
  const fX = fixture.x * SCALE;
  const fZ = -fixture.y * SCALE;
  const ceilY = ((fixture.elevation || wallHeightMm)) * SCALE;

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(fixture.id, "lighting");
  };

  const fType = fixture.type || "pendant";
  const glowColor = isSelected ? "#a7f3d0" : "#fef08a";

  return (
    <group
      position={[fX, ceilY, fZ]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
    >
      {fType === "pendant" ? (
        // Modern Chandelier / Pendant Light (Sarkıt Avize)
        <group>
          {/* Ceiling Canopy Plate */}
          <mesh position={[0, -0.01, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.02]} />
            <meshStandardMaterial color="#18181b" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Hanging Cord */}
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.003, 0.003, 0.48]} />
            <meshStandardMaterial color="#09090b" />
          </mesh>
          {/* Lamp Shade / Ring */}
          <mesh position={[0, -0.5, 0]}>
            <cylinderGeometry args={[0.16, 0.22, 0.16, 24, 1, true]} />
            <meshStandardMaterial color={isSelected ? "#4ade80" : "#1e293b"} metalness={0.6} roughness={0.25} side={THREE.DoubleSide} />
          </mesh>
          {/* Glowing Frosted Bulb */}
          <mesh position={[0, -0.48, 0]}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshStandardMaterial color="#ffffff" emissive={glowColor} emissiveIntensity={3.5} />
          </mesh>
          {/* Realistic Dynamic Point Light */}
          <pointLight position={[0, -0.52, 0]} intensity={1.8} distance={7} decay={2} color="#fffbeb" castShadow />
        </group>
      ) : fType === "spot" ? (
        // Recessed Ceiling Downlight (Gömme Spot)
        <group>
          {/* Trim Ring */}
          <mesh position={[0, -0.005, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 0.01]} />
            <meshStandardMaterial color={isSelected ? "#4ade80" : "#f8fafc"} metalness={0.5} roughness={0.3} />
          </mesh>
          {/* Recessed Glowing Lens */}
          <mesh position={[0, -0.008, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.005]} />
            <meshStandardMaterial color="#ffffff" emissive={glowColor} emissiveIntensity={4.0} />
          </mesh>
          <pointLight position={[0, -0.05, 0]} intensity={1.5} distance={5} decay={2} color="#fef9c3" />
        </group>
      ) : (
        // Flush Ceiling Diffuser Luminaire (Tavan Plafonyeri)
        <group>
          <mesh position={[0, -0.02, 0]}>
            <boxGeometry args={[0.4, 0.04, 0.4]} />
            <meshStandardMaterial color={isSelected ? "#4ade80" : "#ffffff"} emissive={glowColor} emissiveIntensity={2.5} roughness={0.2} />
          </mesh>
          <pointLight position={[0, -0.1, 0]} intensity={2.2} distance={8} decay={2} color="#ffffff" />
        </group>
      )}
    </group>
  );
}

// 4. Procedural 3D Floor Slab Mesh (Supports Ceramic Tile vs Hardwood Laminate)
function FloorSlabMesh({ room }: { room: RoomPlanItem }) {
  const isCeramic = room.flooringType === "ceramic" || room.slab?.material === "ceramic_tile";

  const shape = useMemo(() => {
    if (room.walls.length < 3) return null;
    const s = new THREE.Shape();
    room.walls.forEach((w, idx) => {
      const xM = w.start.x * SCALE;
      const zM = -w.start.y * SCALE;
      if (idx === 0) s.moveTo(xM, zM);
      else s.lineTo(xM, zM);
    });
    s.closePath();
    return s;
  }, [room.walls]);

  const extrudeSettings = useMemo(
    () => ({ depth: 0.15, bevelEnabled: false }),
    []
  );

  if (!shape) return null;

  return (
    <group position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh receiveShadow>
        <extrudeGeometry
          args={[shape, extrudeSettings]}
          key={`slab-${room.walls.length}-${isCeramic ? "cer" : "lam"}`}
        />
        <meshStandardMaterial
          color={isCeramic ? "#e2e8f0" : "#d4a373"}
          roughness={isCeramic ? 0.18 : 0.45}
          metalness={isCeramic ? 0.08 : 0.04}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// 5. Procedural 3D Ceiling Mesh (Supports Drywall False Ceiling)
function CeilingMesh({ room }: { room: RoomPlanItem }) {
  const isDrywall = Boolean(room.hasDrywallCeiling);
  const wallHeight = (room.walls[0]?.height || 2800) * SCALE;

  const shape = useMemo(() => {
    if (room.walls.length < 3) return null;
    const s = new THREE.Shape();
    room.walls.forEach((w, idx) => {
      const xM = w.start.x * SCALE;
      const zM = -w.start.y * SCALE;
      if (idx === 0) s.moveTo(xM, zM);
      else s.lineTo(xM, zM);
    });
    s.closePath();
    return s;
  }, [room.walls]);

  const extrudeSettings = useMemo(
    () => ({ depth: isDrywall ? 0.04 : 0.02, bevelEnabled: false }),
    [isDrywall]
  );

  if (!shape) return null;

  return (
    <group position={[0, wallHeight, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <extrudeGeometry
          args={[shape, extrudeSettings]}
          key={`ceiling-${room.walls.length}-${isDrywall ? "dry" : "pln"}`}
        />
        <meshStandardMaterial
          color={isDrywall ? "#ffffff" : "#f1f5f9"}
          roughness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default function BimViewer3D({
  room,
  layerSettings,
  sceneGroupRef,
  selectedElementId,
  selectedElementType,
  selectedElementIds,
  onSelectElement,
}: BimViewer3DProps) {
  const showWalls = layerSettings?.walls?.visible ?? true;
  const showDoors = layerSettings?.doors?.visible ?? true;
  const showWindows = layerSettings?.windows?.visible ?? true;
  const showSlab = layerSettings?.slab?.visible ?? true;
  const showCeiling = (layerSettings?.ceiling?.visible ?? false) || Boolean(room.hasDrywallCeiling);
  const showElectrical = layerSettings?.electrical?.visible ?? true;
  const showRadiators = layerSettings?.radiators?.visible ?? true;
  const showLighting = layerSettings?.lighting?.visible ?? true;

  // Pre-calculate exact 2D mitered/aligned polygon corners for 100% flush 3D joins
  const wallPolygons = useMemo(
    () => computeWallPolygons(room.walls, room.isClosed),
    [room.walls, room.isClosed]
  );

  // Deterministic bounding box calculation for perfect framing & zero NaN matrix corruption
  const bbox = useMemo(() => getWallsBoundingBox(room.walls), [room.walls]);
  const centerX = (bbox.centerX || 0) * SCALE;
  const centerZ = -(bbox.centerY || 0) * SCALE;
  const wallHeightM = ((room.walls[0]?.height || 2800)) * SCALE;
  const maxDim = Math.max(3.5, Math.max(bbox.width, bbox.height) * SCALE);

  return (
    <div style={{ width: "100%", height: "100%", background: "#0c0d12", position: "relative" }}>
      <Canvas
        shadows
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).tagName === "CANVAS") {
            onSelectElement?.(null, null);
          }
        }}
      >
        <PerspectiveCamera makeDefault position={[maxDim * 0.85, maxDim * 0.95, maxDim * 1.25]} fov={45} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2 - 0.02}
          target={[0, wallHeightM / 2, 0]}
        />

        {/* Multi-angle architectural lighting */}
        <ambientLight intensity={1.4} />
        <hemisphereLight args={["#ffffff", "#334155", 1.0]} />
        <directionalLight
          position={[12, 20, 15]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0001}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
        />
        <directionalLight position={[-12, 16, -10]} intensity={1.2} color="#e2e8f0" />
        <directionalLight position={[0, 12, 16]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[0, -6, 0]} intensity={0.5} color="#94a3b8" />

        {/* Reference Floor Grid in Meters */}
        <Grid
          position={[0, -0.001, 0]}
          args={[20, 20]}
          cellSize={0.5}
          cellThickness={0.7}
          cellColor="#1e293b"
          sectionSize={1.0}
          sectionThickness={1.2}
          sectionColor="#475569"
          fadeDistance={25}
        />

        {/* Centered BIM Room Geometry */}
        <group position={[-centerX, 0, -centerZ]}>
          <group ref={sceneGroupRef}>
            {/* 3D Walls with Clean Butt Joints */}
            {showWalls &&
              room.walls.map((wall, idx) => {
                const wallDoors = room.doors.filter((d) => d.wallId === wall.id);
                const wallWindows = room.windows.filter((w) => w.wallId === wall.id);
                const isSelected =
                  (selectedElementType === "wall" && selectedElementId === wall.id) ||
                  (selectedElementIds && selectedElementIds.includes(wall.id));

                return (
                  <Wall3DMesh
                    key={wall.id}
                    wall={wall}
                    poly={wallPolygons[idx]}
                    doors={showDoors ? wallDoors : []}
                    windows={showWindows ? wallWindows : []}
                    isSelected={!!isSelected}
                    onSelect={(id: string, type: "wall") => onSelectElement?.(id, type)}
                  />
                );
              })}

            {/* 3D Doors */}
            {showDoors &&
              room.doors.map((door) => {
                const wall = room.walls.find((w) => w.id === door.wallId);
                if (!wall) return null;
                const isSelected =
                  (selectedElementType === "door" && selectedElementId === door.id) ||
                  (selectedElementIds && selectedElementIds.includes(door.id));

                return (
                  <Door3DFixture
                    key={door.id}
                    door={door}
                    wall={wall}
                    isSelected={!!isSelected}
                    onSelect={(id: string, type: "door") => onSelectElement?.(id, type)}
                  />
                );
              })}

            {/* 3D Windows */}
            {showWindows &&
              room.windows.map((win) => {
                const wall = room.walls.find((w) => w.id === win.wallId);
                if (!wall) return null;
                const isSelected =
                  (selectedElementType === "window" && selectedElementId === win.id) ||
                  (selectedElementIds && selectedElementIds.includes(win.id));

                return (
                  <Window3DFixture
                    key={win.id}
                    win={win}
                    wall={wall}
                    isSelected={!!isSelected}
                    onSelect={(id: string, type: "window") => onSelectElement?.(id, type)}
                  />
                );
              })}

            {/* 3D Electrical Fixtures (Socket, Switch, Panel) */}
            {showElectrical &&
              room.electrical?.map((el) => {
                const wall = room.walls.find((w) => w.id === el.wallId);
                if (!wall) return null;
                const isSelected =
                  (selectedElementType === "electrical" && selectedElementId === el.id) ||
                  (selectedElementIds && selectedElementIds.includes(el.id));

                return (
                  <Electrical3DFixture
                    key={el.id}
                    element={el}
                    wall={wall}
                    isSelected={!!isSelected}
                    onSelect={(id: string, type: "electrical") => onSelectElement?.(id, type)}
                  />
                );
              })}

            {/* 3D Heating Radiators (Doğalgaz Peteği) */}
            {showRadiators &&
              room.radiators?.map((rad) => {
                const wall = room.walls.find((w) => w.id === rad.wallId);
                if (!wall) return null;
                const isSelected =
                  (selectedElementType === "radiator" && selectedElementId === rad.id) ||
                  (selectedElementIds && selectedElementIds.includes(rad.id));

                return (
                  <Radiator3DFixture
                    key={rad.id}
                    rad={rad}
                    wall={wall}
                    isSelected={!!isSelected}
                    onSelect={(id: string, type: "radiator") => onSelectElement?.(id, type)}
                  />
                );
              })}

            {/* 3D Ceiling Lighting (Avize, Spot, Plafonyer) */}
            {showLighting &&
              room.lighting?.map((fixture) => {
                const isSelected =
                  (selectedElementType === "lighting" && selectedElementId === fixture.id) ||
                  (selectedElementIds && selectedElementIds.includes(fixture.id));

                return (
                  <Light3DFixture
                    key={fixture.id}
                    fixture={fixture}
                    wallHeightMm={room.walls[0]?.height || 2800}
                    isSelected={!!isSelected}
                    onSelect={(id: string, type: "lighting") => onSelectElement?.(id, type)}
                  />
                );
              })}

            {/* 3D Floor Slab */}
            {showSlab && room.isClosed && <FloorSlabMesh room={room} />}

            {/* 3D Ceiling */}
            {showCeiling && room.isClosed && <CeilingMesh room={room} />}
          </group>
        </group>
      </Canvas>
    </div>
  );
}
