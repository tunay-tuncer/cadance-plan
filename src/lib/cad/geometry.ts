import type { Point2D, WallElement, DoorElement, WindowElement, RoomPlanItem } from "@/types/plan";

/**
 * Calculates Euclidean distance between two points in mm
 */
export function getDistance(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Calculates angle between two points in degrees (0 to 360)
 */
export function getAngle(p1: Point2D, p2: Point2D): number {
  const rad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Calculates polygon area using the Shoelace formula (in square meters m²)
 */
export function calculatePolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  area = Math.abs(area) / 2;
  // Convert mm² to m² (1 m² = 1,000,000 mm²)
  return area / 1_000_000;
}

/**
 * Calculates perimeter of a closed wall loop in meters (m)
 */
export function calculatePerimeter(walls: WallElement[]): number {
  const sumMm = walls.reduce((acc, w) => acc + getDistance(w.start, w.end), 0);
  return sumMm / 1000;
}

/**
 * Calculates bounding box of all wall points { minX, minY, maxX, maxY, width, height, centerX, centerY }
 */
export function getWallsBoundingBox(walls: WallElement[]) {
  if (walls.length === 0) {
    return { minX: 0, minY: 0, maxX: 4000, maxY: 4000, width: 4000, height: 4000, centerX: 2000, centerY: 2000 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  walls.forEach((w) => {
    minX = Math.min(minX, w.start.x, w.end.x);
    minY = Math.min(minY, w.start.y, w.end.y);
    maxX = Math.max(maxX, w.start.x, w.end.x);
    maxY = Math.max(maxY, w.start.y, w.end.y);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Checks if a set of sequential walls forms a closed room (end of last wall meets start of first wall)
 * Threshold: within 150mm tolerance
 */
export function checkIsClosedLoop(walls: WallElement[], toleranceMm: number = 150): boolean {
  if (walls.length < 3) return false;
  const first = walls[0];
  const last = walls[walls.length - 1];
  return getDistance(last.end, first.start) <= toleranceMm;
}

/**
 * Gets polygon vertices from a list of sequential walls
 */
export function getPolygonFromWalls(walls: WallElement[]): Point2D[] {
  if (walls.length === 0) return [];
  const points: Point2D[] = walls.map((w) => ({ ...w.start }));
  return points;
}

/**
 * Calculates a point along a line segment at a given offset distance in mm
 */
export function getPointOnSegment(start: Point2D, end: Point2D, offsetMm: number): Point2D {
  const len = getDistance(start, end);
  if (len <= 0) return { ...start };
  const t = Math.max(0, Math.min(1, offsetMm / len));
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

/**
 * Normalized unit direction vector between two points
 */
export function getUnitVector(start: Point2D, end: Point2D): Point2D {
  const len = getDistance(start, end);
  if (len <= 0) return { x: 1, y: 0 };
  return {
    x: (end.x - start.x) / len,
    y: (end.y - start.y) / len,
  };
}

/**
 * Normal vector (perpendicular 90 degrees CCW)
 */
export function getNormalVector(start: Point2D, end: Point2D): Point2D {
  const u = getUnitVector(start, end);
  return { x: -u.y, y: u.x };
}

/**
 * Calculates orientation of sequential points: 'cw' (Clockwise) or 'ccw' (Counter-Clockwise)
 */
export function getPolygonOrientation(points: Point2D[]): "cw" | "ccw" {
  if (points.length < 3) return "cw";
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }
  return sum >= 0 ? "cw" : "ccw";
}

/**
 * Computes outward (exterior) normal vector for a wall
 */
export function getWallExteriorNormal(wall: WallElement, orientation: "cw" | "ccw" = "cw"): Point2D {
  const u = getUnitVector(wall.start, wall.end);
  let n: Point2D;
  if (orientation === "cw") {
    n = { x: -u.y, y: u.x };
  } else {
    n = { x: u.y, y: -u.x };
  }
  if (wall.flipSide) {
    return { x: -n.x, y: -n.y };
  }
  return n;
}

/**
 * Computes the intersection point between two 2D lines defined by a point and a direction vector.
 * Returns null if the lines are parallel or colinear.
 */
export function getLineIntersection(
  p1: Point2D,
  dir1: Point2D,
  p2: Point2D,
  dir2: Point2D
): Point2D | null {
  const det = dir1.x * dir2.y - dir1.y * dir2.x;
  if (Math.abs(det) < 1e-4) return null; // parallel or colinear

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * dir2.y - dy * dir2.x) / det;
  return {
    x: p1.x + dir1.x * t,
    y: p1.y + dir1.y * t,
  };
}

export interface WallPolygonCorners {
  wallId: string;
  innerStart: Point2D;
  innerEnd: Point2D;
  outerEnd: Point2D;
  outerStart: Point2D;
}

/**
 * Computes clean architectural mitered 4-corner polygons for all walls in a room
 * Supports 'interior' (default for laser measuring), 'center', and 'exterior' alignments.
 * Eliminates overlapping bodies and ensures interior clear dimensions remain 100% accurate.
 */
export function computeWallPolygons(
  walls: WallElement[],
  isClosed: boolean
): WallPolygonCorners[] {
  if (walls.length === 0) return [];

  // Determine drafting orientation
  const points = walls.map((w) => w.start);
  if (walls.length > 0) points.push(walls[walls.length - 1].end);
  const orientation = getPolygonOrientation(points);

  const nWalls = walls.length;

  // 1. Calculate base unit vectors, exterior normals, and offsets for each wall
  const wallData = walls.map((w) => {
    const u = getUnitVector(w.start, w.end);
    const nExt = getWallExteriorNormal(w, orientation);
    const align = w.alignment || "interior";
    const thick = w.thickness || 150;

    let innerOffset = 0;
    let outerOffset = thick;

    if (align === "center") {
      innerOffset = -thick / 2;
      outerOffset = thick / 2;
    } else if (align === "exterior") {
      innerOffset = -thick;
      outerOffset = 0;
    }

    return { wall: w, u, nExt, innerOffset, outerOffset, thick, align };
  });

  // Helper to compute corner junction between wall i and next wall j
  const getCornerJunction = (i: number, j: number) => {
    const cur = wallData[i];
    const nxt = wallData[j];
    const cornerP = cur.wall.end; // Nominal corner point where walls meet

    // Inner Corner:
    let innerCorner: Point2D;
    if (Math.abs(cur.innerOffset) < 1 && Math.abs(nxt.innerOffset) < 1) {
      // For standard interior laser survey line, inner corner is EXACTLY cornerP!
      innerCorner = { x: cornerP.x, y: cornerP.y };
    } else {
      const pInner1: Point2D = {
        x: cur.wall.end.x + cur.nExt.x * cur.innerOffset,
        y: cur.wall.end.y + cur.nExt.y * cur.innerOffset,
      };
      const pInner2: Point2D = {
        x: nxt.wall.start.x + nxt.nExt.x * nxt.innerOffset,
        y: nxt.wall.start.y + nxt.nExt.y * nxt.innerOffset,
      };
      const hit = getLineIntersection(pInner1, cur.u, pInner2, nxt.u);
      if (hit && getDistance(cornerP, hit) < Math.max(cur.thick, nxt.thick) * 3) {
        innerCorner = hit;
      } else {
        innerCorner = pInner1;
      }
    }

    // Outer Corner:
    let outerCorner: Point2D;
    if (Math.abs(cur.outerOffset) < 1 && Math.abs(nxt.outerOffset) < 1) {
      outerCorner = { x: cornerP.x, y: cornerP.y };
    } else {
      const pOuter1: Point2D = {
        x: cur.wall.end.x + cur.nExt.x * cur.outerOffset,
        y: cur.wall.end.y + cur.nExt.y * cur.outerOffset,
      };
      const pOuter2: Point2D = {
        x: nxt.wall.start.x + nxt.nExt.x * nxt.outerOffset,
        y: nxt.wall.start.y + nxt.nExt.y * nxt.outerOffset,
      };
      const hit = getLineIntersection(pOuter1, cur.u, pOuter2, nxt.u);
      if (hit && getDistance(cornerP, hit) < Math.max(cur.thick, nxt.thick) * 3) {
        outerCorner = hit;
      } else {
        outerCorner = pOuter1;
      }
    }

    return { inner: innerCorner, outer: outerCorner };
  };

  // Compute all corners
  const corners: { inner: Point2D; outer: Point2D }[] = [];
  const numCorners = isClosed ? nWalls : nWalls - 1;

  for (let c = 0; c < numCorners; c++) {
    const nextIdx = (c + 1) % nWalls;
    corners.push(getCornerJunction(c, nextIdx));
  }

  const result: WallPolygonCorners[] = [];

  for (let i = 0; i < nWalls; i++) {
    const cur = wallData[i];

    // Corner at start of wall i:
    let innerStart: Point2D;
    let outerStart: Point2D;

    if (i === 0) {
      if (isClosed && corners.length > 0) {
        const prevCorner = corners[nWalls - 1];
        innerStart = prevCorner.inner;
        outerStart = prevCorner.outer;
      } else {
        innerStart = {
          x: cur.wall.start.x + cur.nExt.x * cur.innerOffset,
          y: cur.wall.start.y + cur.nExt.y * cur.innerOffset,
        };
        outerStart = {
          x: cur.wall.start.x + cur.nExt.x * cur.outerOffset,
          y: cur.wall.start.y + cur.nExt.y * cur.outerOffset,
        };
      }
    } else {
      const prevCorner = corners[i - 1];
      innerStart = prevCorner.inner;
      outerStart = prevCorner.outer;
    }

    // Corner at end of wall i:
    let innerEnd: Point2D;
    let outerEnd: Point2D;

    if (i < corners.length) {
      const corner = corners[i];
      innerEnd = corner.inner;
      outerEnd = corner.outer;
    } else {
      innerEnd = {
        x: cur.wall.end.x + cur.nExt.x * cur.innerOffset,
        y: cur.wall.end.y + cur.nExt.y * cur.innerOffset,
      };
      outerEnd = {
        x: cur.wall.end.x + cur.nExt.x * cur.outerOffset,
        y: cur.wall.end.y + cur.nExt.y * cur.outerOffset,
      };
    }

    result.push({
      wallId: cur.wall.id,
      innerStart,
      innerEnd,
      outerEnd,
      outerStart,
    });
  }

  return result;
}

/**
 * Calculates corner extension distance (mm) for Wall i in a closed room,
 * allowing 3D to meet cleanly without penetrating into adjacent wall bodies.
 * - Outside (convex) corners: extends by nextThick to cap the outside corner column.
 * - Inside (concave / reflex / alcove) corners: returns 0 so walls never penetrate into the room.
 */
export function getWallCornerExtension(
  walls: WallElement[],
  wallIndex: number,
  isClosed: boolean
): number {
  const nWalls = walls.length;
  if (nWalls === 0) return 0;
  const hasNext = isClosed || wallIndex < nWalls - 1;
  if (!hasNext) return 0;

  const curWall = walls[wallIndex];
  const nextWall = walls[(wallIndex + 1) % nWalls];

  const points = walls.map((w) => w.start);
  if (walls.length > 0) points.push(walls[walls.length - 1].end);
  const orientation = getPolygonOrientation(points);

  const uCur = getUnitVector(curWall.start, curWall.end);
  const nNextExt = getWallExteriorNormal(nextWall, orientation);
  const nextThick = nextWall.thickness || 150;

  // Dot product between curWall direction and nextWall exterior normal:
  // - If dotExt > 0.05: curWall points towards nextWall's exterior (convex outside corner).
  //   It extends by nextThick to seal the corner column cleanly.
  // - If dotExt <= 0.05: curWall points towards nextWall's interior (concave inside corner / alcove).
  //   Extending forward would penetrate into the room! Must return 0.
  const dotExt = uCur.x * nNextExt.x + uCur.y * nNextExt.y;
  if (dotExt <= 0.05) {
    return 0;
  }

  const extendDist = dotExt > 0.3 ? nextThick / dotExt : nextThick;
  return Math.min(extendDist, nextThick * 2);
}

export interface RoomQuantityTakeoff {
  grossWallAreaM2: number;
  openingsAreaM2: number;
  netWallAreaM2: number;
  grossPerimeterM: number;
  doorDeductionM: number;
  skirtingLengthM: number;
  floorAreaM2: number;
  ceilingAreaM2: number;
  flooringType: "laminate" | "ceramic";
  hasDrywallCeiling: boolean;
}

/**
 * Calculates accurate Quantity Takeoff / BOQ metrics for an architectural room plan:
 * 1. Net Wall Area (m²): Gross wall area minus door and window openings
 * 2. Net Baseboard / Skirting (m): Perimeter minus door opening widths
 * 3. Floor Area (m²): Classified by selected material (Laminate Parquet vs Ceramic Tile)
 * 4. Ceiling Area (m²): With Drywall False Ceiling option
 */
export function calculateRoomTakeoff(room: RoomPlanItem): RoomQuantityTakeoff {
  const walls = room.walls || [];
  const doors = room.doors || [];
  const windows = room.windows || [];

  let grossWallAreaMm2 = 0;
  let grossPerimeterMm = 0;

  walls.forEach((w) => {
    const len = getDistance(w.start, w.end);
    const h = w.height || 2800;
    grossWallAreaMm2 += len * h;
    grossPerimeterMm += len;
  });

  let doorAreaMm2 = 0;
  let doorWidthMm = 0;
  doors.forEach((d) => {
    doorAreaMm2 += d.width * (d.height || 2100);
    doorWidthMm += d.width;
  });

  let winAreaMm2 = 0;
  windows.forEach((win) => {
    winAreaMm2 += win.width * (win.height || 1400);
  });

  const openingsAreaMm2 = doorAreaMm2 + winAreaMm2;
  const netWallAreaMm2 = Math.max(0, grossWallAreaMm2 - openingsAreaMm2);
  const skirtingLengthMm = Math.max(0, grossPerimeterMm - doorWidthMm);

  const flooringType: "laminate" | "ceramic" =
    room.flooringType || (room.slab?.material === "ceramic_tile" ? "ceramic" : "laminate");
  const hasDrywallCeiling: boolean =
    room.hasDrywallCeiling ?? (room.ceiling?.visibleIn3d ?? false);

  return {
    grossWallAreaM2: Number((grossWallAreaMm2 / 1_000_000).toFixed(2)),
    openingsAreaM2: Number((openingsAreaMm2 / 1_000_000).toFixed(2)),
    netWallAreaM2: Number((netWallAreaMm2 / 1_000_000).toFixed(2)),
    grossPerimeterM: Number((grossPerimeterMm / 1000).toFixed(2)),
    doorDeductionM: Number((doorWidthMm / 1000).toFixed(2)),
    skirtingLengthM: Number((skirtingLengthMm / 1000).toFixed(2)),
    floorAreaM2: Number((room.calculatedArea || 0).toFixed(2)),
    ceilingAreaM2: Number((room.calculatedArea || 0).toFixed(2)),
    flooringType,
    hasDrywallCeiling,
  };
}

/**
 * Parametrically resizes the length of a wall in a closed room (Revit style).
 * For standard 4-wall / orthogonal rooms, moving the corner maintains the closed polygon,
 * shifts the adjacent wall, and adjusts the opposing wall so the entire room stretches cleanly.
 */
export function resizeRoomWallLength(
  room: RoomPlanItem,
  wallId: string,
  newLengthMm: number
): RoomPlanItem {
  const clampedLen = Math.max(500, Math.min(25000, Math.round(newLengthMm)));
  const wallIdx = room.walls.findIndex((w) => w.id === wallId);
  if (wallIdx === -1) return room;

  const targetWall = room.walls[wallIdx];
  const currentLen = getDistance(targetWall.start, targetWall.end);
  const delta = clampedLen - currentLen;
  if (Math.abs(delta) < 1) return room;

  const n = room.walls.length;
  const updatedWalls = room.walls.map((w) => ({
    ...w,
    start: { ...w.start },
    end: { ...w.end },
  }));

  const u = getUnitVector(targetWall.start, targetWall.end);
  const shiftVec = { x: u.x * delta, y: u.y * delta };

  if (n === 4 && room.isClosed) {
    // Standard 4-wall rectangular surveyor room
    const idx0 = wallIdx;
    const idx1 = (wallIdx + 1) % 4;
    const idx2 = (wallIdx + 2) % 4;

    // Wall 0 ends at new position
    updatedWalls[idx0].end.x += shiftVec.x;
    updatedWalls[idx0].end.y += shiftVec.y;

    // Wall 1 shifts its start and end
    updatedWalls[idx1].start.x += shiftVec.x;
    updatedWalls[idx1].start.y += shiftVec.y;
    updatedWalls[idx1].end.x += shiftVec.x;
    updatedWalls[idx1].end.y += shiftVec.y;

    // Wall 2 starts from new Wall 1 end
    updatedWalls[idx2].start.x += shiftVec.x;
    updatedWalls[idx2].start.y += shiftVec.y;
  } else {
    // General N-wall loop
    updatedWalls[wallIdx].end.x += shiftVec.x;
    updatedWalls[wallIdx].end.y += shiftVec.y;

    const nextIdx = (wallIdx + 1) % n;
    updatedWalls[nextIdx].start.x += shiftVec.x;
    updatedWalls[nextIdx].start.y += shiftVec.y;
  }

  // Recalculate polygon, area and perimeter
  const poly = getPolygonFromWalls(updatedWalls);
  const newArea = calculatePolygonArea(poly);
  const newPerim = calculatePerimeter(updatedWalls);

  // Clamp openings on walls that changed length
  const updatedDoors = room.doors.map((d) => {
    const wall = updatedWalls.find((w) => w.id === d.wallId);
    if (!wall) return d;
    const maxOffset = Math.max(50, getDistance(wall.start, wall.end) - d.width - 50);
    return { ...d, offset: Math.min(d.offset, maxOffset) };
  });

  const updatedWindows = room.windows.map((w) => {
    const wall = updatedWalls.find((wl) => wl.id === w.wallId);
    if (!wall) return w;
    const maxOffset = Math.max(50, getDistance(wall.start, wall.end) - w.width - 50);
    return { ...w, offset: Math.min(w.offset, maxOffset) };
  });

  return {
    ...room,
    walls: updatedWalls,
    doors: updatedDoors,
    windows: updatedWindows,
    calculatedArea: newArea,
    calculatedPerimeter: newPerim,
    slab: room.slab ? { ...room.slab, boundary: poly } : room.slab,
    ceiling: room.ceiling ? { ...room.ceiling, boundary: poly } : room.ceiling,
  };
}

/**
 * Merges consecutive co-planar / collinear walls into single continuous walls.
 * If 2 or more consecutive walls have the same direction vector (parallel within ~2.8 deg)
 * and meet end-to-start with the same thickness, height, and alignment, they are combined.
 * Doors and windows hosted on the merged walls are preserved with offsets updated.
 */
export function mergeColinearWalls(
  walls: WallElement[],
  doors: DoorElement[] = [],
  windows: WindowElement[] = [],
  isClosed: boolean = false
): {
  walls: WallElement[];
  doors: DoorElement[];
  windows: WindowElement[];
  mergedCount: number;
} {
  if (walls.length < 2) {
    return { walls, doors, windows, mergedCount: 0 };
  }

  let curWalls: WallElement[] = walls.map((w) => ({
    ...w,
    start: { ...w.start },
    end: { ...w.end },
  }));
  let curDoors: DoorElement[] = doors.map((d) => ({ ...d }));
  let curWindows: WindowElement[] = windows.map((w) => ({ ...w }));
  let mergedCount = 0;
  let changed = true;

  // Continue merging while consecutive collinear pairs exist
  while (changed && curWalls.length >= 2) {
    changed = false;
    const n = curWalls.length;

    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      // If room is open, do not wrap around to index 0
      if (!isClosed && i === n - 1) break;
      // In closed room, don't reduce below 3 walls
      if (isClosed && n <= 3) break;

      const w1 = curWalls[i];
      const w2 = curWalls[nextIdx];

      // End of w1 must meet start of w2 (within 25mm tolerance)
      const connectDist = getDistance(w1.end, w2.start);
      if (connectDist > 25) continue;

      const len1 = getDistance(w1.start, w1.end);
      const len2 = getDistance(w2.start, w2.end);
      if (len1 < 10 || len2 < 10) continue;

      const u1 = getUnitVector(w1.start, w1.end);
      const u2 = getUnitVector(w2.start, w2.end);

      // Collinear check: dot product close to 1 (same direction) and cross product near 0
      const dot = u1.x * u2.x + u1.y * u2.y;
      const cross = Math.abs(u1.x * u2.y - u1.y * u2.x);

      // Parallel within ~2.8 degrees: dot > 0.998 and cross < 0.05
      if (dot > 0.998 && cross < 0.05) {
        // Must match structural properties
        const sameThick = Math.abs((w1.thickness || 150) - (w2.thickness || 150)) < 5;
        const sameHeight = Math.abs((w1.height || 2800) - (w2.height || 2800)) < 5;
        const sameAlign = (w1.alignment || "interior") === (w2.alignment || "interior");

        if (sameThick && sameHeight && sameAlign) {
          // Merge w1 and w2
          const mergedWall: WallElement = {
            ...w1,
            start: { ...w1.start },
            end: { ...w2.end },
          };

          // Re-home doors on w2 to w1 with shifted offset
          curDoors = curDoors.map((d) => {
            if (d.wallId === w2.id) {
              return {
                ...d,
                wallId: w1.id,
                offset: d.offset + Math.round(len1),
              };
            }
            return d;
          });

          // Re-home windows on w2 to w1 with shifted offset
          curWindows = curWindows.map((w) => {
            if (w.wallId === w2.id) {
              return {
                ...w,
                wallId: w1.id,
                offset: w.offset + Math.round(len1),
              };
            }
            return w;
          });

          if (nextIdx > i) {
            // Standard consecutive pair (w1, w2)
            curWalls.splice(nextIdx, 1);
            curWalls[i] = mergedWall;
          } else {
            // Wrap-around pair: w1 is last wall, w2 is first wall (index 0)
            // Openings on w2 (originally from w2.start) now need their offset shifted by len1!
            curDoors = curDoors.map((d) => {
              if (d.wallId === w2.id) {
                return {
                  ...d,
                  wallId: w1.id,
                  offset: d.offset + Math.round(len1),
                };
              }
              return d;
            });

            curWindows = curWindows.map((w) => {
              if (w.wallId === w2.id) {
                return {
                  ...w,
                  wallId: w1.id,
                  offset: w.offset + Math.round(len1),
                };
              }
              return w;
            });

            curWalls[0] = mergedWall;
            curWalls.pop();
          }

          mergedCount++;
          changed = true;
          break; // Restart loop with new wall list
        }
      }
    }
  }

  return {
    walls: curWalls,
    doors: curDoors,
    windows: curWindows,
    mergedCount,
  };
}

/**
 * Projects a point onto a line segment and returns the closest point, perpendicular distance, and offset along the segment.
 */
export function getNearestPointOnSegment(
  p: Point2D,
  start: Point2D,
  end: Point2D
): { point: Point2D; distance: number; offset: number; t: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return {
      point: { ...start },
      distance: getDistance(p, start),
      offset: 0,
      t: 0,
    };
  }

  const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / lenSq));
  const projPoint = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };
  const len = Math.sqrt(lenSq);
  return {
    point: projPoint,
    distance: getDistance(p, projPoint),
    offset: Math.round(t * len),
    t,
  };
}

/**
 * Calculates room geometric center (centroid of polygon or bounding box center)
 */
export function getRoomCentroid(room: RoomPlanItem): Point2D {
  if (room.walls.length === 0) return { x: 0, y: 0 };
  const poly = getPolygonFromWalls(room.walls);
  if (poly.length >= 3) {
    let cx = 0;
    let cy = 0;
    let signedArea = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const a = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
      signedArea += a;
      cx += (poly[i].x + poly[j].x) * a;
      cy += (poly[i].y + poly[j].y) * a;
    }
    signedArea *= 0.5;
    if (Math.abs(signedArea) > 1000) {
      return {
        x: Math.round(cx / (6 * signedArea)),
        y: Math.round(cy / (6 * signedArea)),
      };
    }
  }

  const bbox = getWallsBoundingBox(room.walls);
  return { x: Math.round(bbox.centerX), y: Math.round(bbox.centerY) };
}

/**
 * Calculates the exact (x, y) coordinates for a lighting fixture based on distances
 * from two surrounding reference walls.
 */
export function calculateLightPositionFromWallDistances(
  room: RoomPlanItem,
  refWallId1: string,
  dist1Mm: number,
  refWallId2?: string,
  dist2Mm?: number
): Point2D {
  const w1 = room.walls.find((w) => w.id === refWallId1);
  if (!w1) return getRoomCentroid(room);

  const points = room.walls.map((w) => w.start);
  if (room.walls.length > 0) points.push(room.walls[room.walls.length - 1].end);
  const orientation = getPolygonOrientation(points);

  const nExt1 = getWallExteriorNormal(w1, orientation);
  const nInt1 = { x: -nExt1.x, y: -nExt1.y };
  const u1 = getUnitVector(w1.start, w1.end);

  // Line 1: offset inward from w1 by dist1Mm
  const p1_start = {
    x: w1.start.x + nInt1.x * dist1Mm,
    y: w1.start.y + nInt1.y * dist1Mm,
  };

  const w2 = refWallId2 ? room.walls.find((w) => w.id === refWallId2) : null;
  if (w2 && dist2Mm !== undefined && dist2Mm > 0) {
    const nExt2 = getWallExteriorNormal(w2, orientation);
    const nInt2 = { x: -nExt2.x, y: -nExt2.y };
    const u2 = getUnitVector(w2.start, w2.end);

    const p2_start = {
      x: w2.start.x + nInt2.x * dist2Mm,
      y: w2.start.y + nInt2.y * dist2Mm,
    };

    const intersection = getLineIntersection(p1_start, u1, p2_start, u2);
    if (intersection) {
      return {
        x: Math.round(intersection.x),
        y: Math.round(intersection.y),
      };
    }
  }

  // If only 1 wall provided, position at midpoint of w1 offset by dist1Mm
  const w1Len = getDistance(w1.start, w1.end);
  return {
    x: Math.round(w1.start.x + u1.x * (w1Len / 2) + nInt1.x * dist1Mm),
    y: Math.round(w1.start.y + u1.y * (w1Len / 2) + nInt1.y * dist1Mm),
  };
}

export interface LightFourWayDimensions {
  up: { distanceMm: number; point: Point2D; wallId: string } | null;
  down: { distanceMm: number; point: Point2D; wallId: string } | null;
  left: { distanceMm: number; point: Point2D; wallId: string } | null;
  right: { distanceMm: number; point: Point2D; wallId: string } | null;
}

/**
 * Computes orthogonal distances in all 4 cardinal directions (Up, Down, Left, Right)
 * from a lighting fixture point to surrounding bounding room walls.
 */
export function calculateLightFourWayDimensions(
  p: Point2D,
  walls: WallElement[]
): LightFourWayDimensions {
  const directions = [
    { key: "up" as const, dir: { x: 0, y: 1 } },
    { key: "down" as const, dir: { x: 0, y: -1 } },
    { key: "left" as const, dir: { x: -1, y: 0 } },
    { key: "right" as const, dir: { x: 1, y: 0 } },
  ];

  const result: LightFourWayDimensions = {
    up: null,
    down: null,
    left: null,
    right: null,
  };

  for (const { key, dir } of directions) {
    let closest: { distanceMm: number; point: Point2D; wallId: string } | null = null;
    let minT = Infinity;

    for (const w of walls) {
      const ax = w.start.x;
      const ay = w.start.y;
      const bx = w.end.x;
      const by = w.end.y;
      const dx = bx - ax;
      const dy = by - ay;

      const denom = dir.x * dy - dir.y * dx;
      if (Math.abs(denom) > 1e-5) {
        const t = ((ax - p.x) * dy - (ay - p.y) * dx) / denom;
        const u = ((ax - p.x) * dir.y - (ay - p.y) * dir.x) / denom;

        if (t > 5 && u >= -0.005 && u <= 1.005) {
          if (t < minT) {
            minT = t;
            closest = {
              distanceMm: Math.round(t),
              point: { x: p.x + dir.x * t, y: p.y + dir.y * t },
              wallId: w.id,
            };
          }
        }
      }
    }

    // Fallback: If no direct collinear ray intersection, project to closest perpendicular wall in this quadrant
    if (!closest && walls.length > 0) {
      for (const w of walls) {
        const proj = getNearestPointOnSegment(p, w.start, w.end);
        const toProj = { x: proj.point.x - p.x, y: proj.point.y - p.y };
        const dot = toProj.x * dir.x + toProj.y * dir.y;
        if (dot > 5 && proj.distance < minT) {
          minT = proj.distance;
          closest = {
            distanceMm: Math.round(proj.distance),
            point: proj.point,
            wallId: w.id,
          };
        }
      }
    }

    result[key] = closest;
  }

  return result;
}
