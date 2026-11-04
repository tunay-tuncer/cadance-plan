import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { RoomPlanItem } from "@/types/plan";
import { getDistance, getNormalVector, getUnitVector, computeWallPolygons } from "../cad/geometry";

/**
 * Sanitizes strings to pure 7-bit ASCII to prevent crashes in AutoCAD R12 / R2000 C++ parsers.
 */
function toDxfAscii(str: string): string {
  return str
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C")
    .replace(/²/g, "2")
    .replace(/[^\x20-\x7E]/g, " ");
}

/**
 * Normalizes an angle in degrees strictly to [0, 360) counter-clockwise.
 */
function normalizeDxfAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return Number(a.toFixed(2));
}

/**
 * Generates an AutoCAD R12 / R2000 fully-compliant ASCII DXF file for the room plan.
 * Compatible with AutoCAD (all versions), AutoCAD LT, Revit, ArchiCAD, DWG FastView, TrueView.
 * Includes mandatory HEADER, TABLES (VPORT, LTYPE, LAYER, STYLE, APPID), BLOCKS, and ENTITIES sections.
 */
export function exportRoomToDxf(room: RoomPlanItem, projectName: string = "Floor Plan Project"): string {
  const lines: string[] = [];

  // Helper to push code/value pairs
  const push = (...args: (string | number)[]) => {
    for (const a of args) lines.push(String(a));
  };

  // 1. HEADER SECTION
  push("0", "SECTION");
  push("2", "HEADER");
  push("9", "$ACADVER", "1", "AC1009"); // AutoCAD R12 ASCII standard
  push("9", "$INSUNITS", "70", 4);     // 4 = Millimeters
  push("9", "$MEASUREMENT", "70", 1);  // 1 = Metric
  push("0", "ENDSEC");

  // 2. TABLES SECTION
  push("0", "SECTION");
  push("2", "TABLES");

  // VPORT Table
  push("0", "TABLE", "2", "VPORT", "70", 1);
  push("0", "VPORT", "2", "*ACTIVE", "70", 0, "10", "0.0", "20", "0.0", "11", "1.0", "21", "1.0", "12", "0.0", "22", "0.0", "40", "3000.0", "41", "1.5");
  push("0", "ENDTAB");

  // LTYPE Table
  push("0", "TABLE", "2", "LTYPE", "70", 2);
  push("0", "LTYPE", "2", "CONTINUOUS", "70", 0, "3", "Solid line", "72", 65, "73", 0, "40", "0.0");
  push("0", "LTYPE", "2", "HIDDEN", "70", 0, "3", "Hidden __ __ __", "72", 65, "73", 2, "40", "9.525", "49", "6.35", "49", "-3.175");
  push("0", "ENDTAB");

  // LAYER Table (AIA CAD Layers)
  push("0", "TABLE", "2", "LAYER", "70", 8);
  push("0", "LAYER", "2", "0", "70", 0, "62", 7, "6", "CONTINUOUS");
  push("0", "LAYER", "2", "A-WALL", "70", 0, "62", 7, "6", "CONTINUOUS");     // White / Black
  push("0", "LAYER", "2", "A-DOOR", "70", 0, "62", 2, "6", "CONTINUOUS");     // Yellow
  push("0", "LAYER", "2", "A-GLAZ", "70", 0, "62", 4, "6", "CONTINUOUS");     // Cyan
  push("0", "LAYER", "2", "A-ELEC", "70", 0, "62", 3, "6", "CONTINUOUS");     // Green
  push("0", "LAYER", "2", "A-HVAC", "70", 0, "62", 30, "6", "CONTINUOUS");    // Orange
  push("0", "LAYER", "2", "A-LITE", "70", 0, "62", 2, "6", "CONTINUOUS");     // Yellow
  push("0", "LAYER", "2", "A-DIMS", "70", 0, "62", 1, "6", "CONTINUOUS");     // Red
  push("0", "ENDTAB");

  // STYLE Table
  push("0", "TABLE", "2", "STYLE", "70", 1);
  push("0", "STYLE", "2", "STANDARD", "70", 0, "40", "0.0", "41", "1.0", "50", "0.0", "71", 0, "42", "2.5", "3", "txt", "4", "");
  push("0", "ENDTAB");

  // APPID Table
  push("0", "TABLE", "2", "APPID", "70", 1);
  push("0", "APPID", "2", "ACAD", "70", 0);
  push("0", "ENDTAB");

  push("0", "ENDSEC");

  // 3. BLOCKS SECTION (MANDATORY IN AUTOCAD - Prevents fatal 0x000 Access Violation crash)
  push("0", "SECTION");
  push("2", "BLOCKS");
  push("0", "BLOCK", "8", "0", "2", "*MODEL_SPACE", "70", 0, "10", "0.0", "20", "0.0", "30", "0.0", "3", "*MODEL_SPACE", "1", "");
  push("0", "ENDBLK", "8", "0");
  push("0", "BLOCK", "8", "0", "2", "*PAPER_SPACE", "70", 0, "10", "0.0", "20", "0.0", "30", "0.0", "3", "*PAPER_SPACE", "1", "");
  push("0", "ENDBLK", "8", "0");
  push("0", "ENDSEC");

  // 4. ENTITIES SECTION
  push("0", "SECTION");
  push("2", "ENTITIES");

  const addLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    push("0", "LINE");
    push("8", layer);
    push("10", Number(x1.toFixed(2)));
    push("20", Number(y1.toFixed(2)));
    push("30", "0.0");
    push("11", Number(x2.toFixed(2)));
    push("21", Number(y2.toFixed(2)));
    push("31", "0.0");
  };

  const addText = (text: string, x: number, y: number, height: number = 150, layer: string = "A-DIMS") => {
    push("0", "TEXT");
    push("8", layer);
    push("10", Number(x.toFixed(2)));
    push("20", Number(y.toFixed(2)));
    push("30", "0.0");
    push("40", Number(height.toFixed(2)));
    push("1", toDxfAscii(text));
  };

  const addCircle = (cx: number, cy: number, radius: number, layer: string) => {
    push("0", "CIRCLE");
    push("8", layer);
    push("10", Number(cx.toFixed(2)));
    push("20", Number(cy.toFixed(2)));
    push("30", "0.0");
    push("40", Number(radius.toFixed(2)));
  };

  const addArc = (cx: number, cy: number, radius: number, startAngleDeg: number, endAngleDeg: number, layer: string = "A-DOOR") => {
    push("0", "ARC");
    push("8", layer);
    push("10", Number(cx.toFixed(2)));
    push("20", Number(cy.toFixed(2)));
    push("30", "0.0");
    push("40", Number(radius.toFixed(2)));
    push("50", normalizeDxfAngle(startAngleDeg));
    push("51", normalizeDxfAngle(endAngleDeg));
  };

  // Draw Walls using computed flush miter polygons
  const polys = computeWallPolygons(room.walls, room.isClosed);
  if (polys.length > 0) {
    polys.forEach((poly) => {
      // Inner line
      addLine(poly.innerStart.x, poly.innerStart.y, poly.innerEnd.x, poly.innerEnd.y, "A-WALL");
      // Outer line
      addLine(poly.outerStart.x, poly.outerStart.y, poly.outerEnd.x, poly.outerEnd.y, "A-WALL");
      // Start cap if unclosed
      if (!room.isClosed) {
        addLine(poly.innerStart.x, poly.innerStart.y, poly.outerStart.x, poly.outerStart.y, "A-WALL");
        addLine(poly.innerEnd.x, poly.innerEnd.y, poly.outerEnd.x, poly.outerEnd.y, "A-WALL");
      }
    });
  } else {
    // Fallback if no polygons
    room.walls.forEach((wall) => {
      const halfThick = wall.thickness / 2;
      const n = getNormalVector(wall.start, wall.end);
      addLine(wall.start.x + n.x * halfThick, wall.start.y + n.y * halfThick, wall.end.x + n.x * halfThick, wall.end.y + n.y * halfThick, "A-WALL");
      addLine(wall.start.x - n.x * halfThick, wall.start.y - n.y * halfThick, wall.end.x - n.x * halfThick, wall.end.y - n.y * halfThick, "A-WALL");
    });
  }

  // Dimension annotations for each wall
  room.walls.forEach((wall) => {
    const len = getDistance(wall.start, wall.end);
    const n = getNormalVector(wall.start, wall.end);
    const halfThick = wall.thickness / 2;
    const midX = (wall.start.x + wall.end.x) / 2 + n.x * (halfThick + 160);
    const midY = (wall.start.y + wall.end.y) / 2 + n.y * (halfThick + 160);
    addText(`${Math.round(len / 10)} cm`, midX, midY, 120, "A-DIMS");
  });

  // Draw Doors
  room.doors.forEach((door) => {
    const hostWall = room.walls.find((w) => w.id === door.wallId);
    if (!hostWall) return;

    const u = getUnitVector(hostWall.start, hostWall.end);
    const n = getNormalVector(hostWall.start, hostWall.end);

    const hingeX = hostWall.start.x + u.x * door.offset;
    const hingeY = hostWall.start.y + u.y * door.offset;

    const swingMult = door.swingOrientation === "inward" ? 1 : -1;
    const leafEndX = hingeX + n.x * door.width * swingMult;
    const leafEndY = hingeY + n.y * door.width * swingMult;

    // Leaf line
    addLine(hingeX, hingeY, leafEndX, leafEndY, "A-DOOR");

    // Swing Arc
    const wallAngDeg = Math.atan2(u.y, u.x) * (180 / Math.PI);
    const arcDelta = (door.swingDirection === "right" ? 90 : -90) * swingMult;
    const ang1 = wallAngDeg;
    const ang2 = wallAngDeg + arcDelta;
    addArc(hingeX, hingeY, door.width, Math.min(ang1, ang2), Math.max(ang1, ang2), "A-DOOR");
  });

  // Draw Windows
  room.windows.forEach((win) => {
    const hostWall = room.walls.find((w) => w.id === win.wallId);
    if (!hostWall) return;

    const u = getUnitVector(hostWall.start, hostWall.end);
    const n = getNormalVector(hostWall.start, hostWall.end);
    const halfThick = hostWall.thickness / 2;

    const startX = hostWall.start.x + u.x * win.offset;
    const startY = hostWall.start.y + u.y * win.offset;
    const endX = startX + u.x * win.width;
    const endY = startY + u.y * win.width;

    // Window frame outer/inner lines
    addLine(startX + n.x * halfThick, startY + n.y * halfThick, endX + n.x * halfThick, endY + n.y * halfThick, "A-GLAZ");
    addLine(startX - n.x * halfThick, startY - n.y * halfThick, endX - n.x * halfThick, endY - n.y * halfThick, "A-GLAZ");
    // Glass center line
    addLine(startX, startY, endX, endY, "A-GLAZ");
  });

  // Draw Electrical Elements
  if (room.electrical && room.electrical.length > 0) {
    room.electrical.forEach((el) => {
      const hostWall = room.walls.find((w) => w.id === el.wallId);
      if (!hostWall) return;
      const u = getUnitVector(hostWall.start, hostWall.end);
      const ex = hostWall.start.x + u.x * el.offset;
      const ey = hostWall.start.y + u.y * el.offset;

      if (el.type === "socket") {
        addCircle(ex, ey, 60, "A-ELEC");
        addLine(ex - 40, ey, ex + 40, ey, "A-ELEC");
      } else if (el.type === "switch") {
        addCircle(ex, ey, 50, "A-ELEC");
        addLine(ex, ey, ex + 35, ey + 35, "A-ELEC");
      } else {
        // Panel box
        addLine(ex - 80, ey - 50, ex + 80, ey - 50, "A-ELEC");
        addLine(ex + 80, ey - 50, ex + 80, ey + 50, "A-ELEC");
        addLine(ex + 80, ey + 50, ex - 80, ey + 50, "A-ELEC");
        addLine(ex - 80, ey + 50, ex - 80, ey - 50, "A-ELEC");
        addLine(ex - 80, ey - 50, ex + 80, ey + 50, "A-ELEC");
      }
    });
  }

  // Draw Radiators
  if (room.radiators && room.radiators.length > 0) {
    room.radiators.forEach((rad) => {
      const hostWall = room.walls.find((w) => w.id === rad.wallId);
      if (!hostWall) return;
      const u = getUnitVector(hostWall.start, hostWall.end);
      const n = getNormalVector(hostWall.start, hostWall.end);
      const rx = hostWall.start.x + u.x * rad.offset;
      const ry = hostWall.start.y + u.y * rad.offset;
      const rw = rad.width || 1000;
      const rd = rad.depth || 100;

      // Radiator box
      const p1x = rx, p1y = ry;
      const p2x = rx + u.x * rw, p2y = ry + u.y * rw;
      const p3x = p2x - n.x * rd, p3y = p2y - n.y * rd;
      const p4x = p1x - n.x * rd, p4y = p1y - n.y * rd;

      addLine(p1x, p1y, p2x, p2y, "A-HVAC");
      addLine(p2x, p2y, p3x, p3y, "A-HVAC");
      addLine(p3x, p3y, p4x, p4y, "A-HVAC");
      addLine(p4x, p4y, p1x, p1y, "A-HVAC");
    });
  }

  // Draw Lighting Fixtures
  if (room.lighting && room.lighting.length > 0) {
    room.lighting.forEach((l) => {
      addCircle(l.x, l.y, 100, "A-LITE");
      addLine(l.x - 70, l.y - 70, l.x + 70, l.y + 70, "A-LITE");
      addLine(l.x + 70, l.y - 70, l.x - 70, l.y + 70, "A-LITE");
    });
  }

  // Room Tag Center Text
  if (room.walls.length >= 3) {
    let avgX = 0;
    let avgY = 0;
    room.walls.forEach((w) => {
      avgX += w.start.x;
      avgY += w.start.y;
    });
    avgX /= room.walls.length;
    avgY /= room.walls.length;

    addText(projectName.toUpperCase(), avgX - 250, avgY + 240, 120, "A-DIMS");
    addText(room.name.toUpperCase(), avgX - 250, avgY + 80, 160, "A-DIMS");
    addText(`${room.calculatedArea.toFixed(1)} m2`, avgX - 180, avgY - 100, 140, "A-DIMS");
  }

  push("0", "ENDSEC");
  push("0", "EOF");

  // AutoCAD requires Windows CRLF line endings (\r\n) and trailing newline
  return lines.join("\r\n") + "\r\n";
}

/**
 * Browser download trigger for DXF file
 */
export function downloadDxfFile(dxfContent: string, fileName: string = "floor_plan.dxf") {
  const blob = new Blob([dxfContent], { type: "application/dxf;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports 3D Three.js Group Scene into a binary .GLTF or .GLB file
 */
export function exportRoomSceneToGltf(sceneGroup: THREE.Group, fileName: string = "room_model.glb") {
  const exporter = new GLTFExporter();
  exporter.parse(
    sceneGroup,
    (result) => {
      let blob: Blob;
      if (result instanceof ArrayBuffer) {
        blob = new Blob([result], { type: "model/gltf-binary" });
      } else {
        const output = JSON.stringify(result, null, 2);
        blob = new Blob([output], { type: "model/gltf+json" });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.endsWith(".glb") ? fileName : `${fileName}.glb`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    (err) => {
      console.error("GLTF Export Error:", err);
    },
    { binary: true }
  );
}
