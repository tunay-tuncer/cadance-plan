export interface Point2D {
  x: number; // in millimeters (mm)
  y: number; // in millimeters (mm)
}

export type RoomType =
  | "living"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "corridor"
  | "balcony"
  | "office"
  | "dining"
  | "other";

export interface WallElement {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number; // mm (e.g. 150 for partition, 250 for structural)
  height: number;    // mm (e.g. 2800)
  alignment?: "interior" | "center" | "exterior"; // default: "interior" for laser tape measuring
  flipSide?: boolean; // true to flip exterior/interior side (Revit-style flip ⇄)
  material?: string; // e.g. "white_paint", "concrete", "brick"
}

export interface DoorElement {
  id: string;
  wallId: string;
  offset: number; // mm along the wall from wall.start
  width: number;  // mm (standard 800, 900)
  height: number; // mm (standard 2100)
  swingDirection: "left" | "right";
  swingOrientation: "inward" | "outward";
  swingAngle?: number; // degrees, default 90
  doorType?: "hinged" | "sliding"; // standard swing vs sliding pocket/patio door
  slidingSegments?: number; // 2, 3, or 4 panels for sliding doors
  isFullHeight?: boolean; // floor to ceiling
}

export interface WindowElement {
  id: string;
  wallId: string;
  offset: number; // mm along the wall from wall.start
  width: number;  // mm (e.g. 1200, 1500)
  height: number; // mm (e.g. 1400)
  sillHeight: number; // mm from slab floor, default 900 (0 for french balcony)
  windowType?: "standard" | "sliding" | "double_casement" | "french" | "fixed";
  segments?: number; // 1, 2, 3, 4 panes/sashes
  frameMaterial?: "pvc_white" | "anthracite" | "wood" | "aluminum";
}

export type ElectricalType = "socket" | "switch" | "panel";

export interface ElectricalElement {
  id: string;
  wallId: string;
  type: ElectricalType;
  subType?: "single" | "double" | "grounded" | "one_way" | "two_way" | "breaker";
  offset: number; // mm along wall from wall.start
  elevation: number; // mm from floor: socket=300 (or 1100 counter), switch=1100, panel=1800
  label?: string;
}

export interface RadiatorElement {
  id: string;
  wallId: string;
  offset: number; // mm along wall from wall.start
  width: number;  // mm (e.g. 600, 800, 1000, 1200)
  height: number; // mm (e.g. 600)
  depth: number;  // mm (e.g. 100 - standard PKKP 22)
  elevation: number; // mm from floor, default 150
}

export type LightType = "pendant" | "spot" | "ceiling" | "track";

export interface LightFixtureElement {
  id: string;
  type: LightType;
  x: number; // CAD mm in room coordinates
  y: number; // CAD mm in room coordinates
  elevation?: number; // mm from floor (defaults to ceiling height)
  refWallId1?: string;
  distWall1?: number; // distance in mm from nearest or selected reference wall
  refWallId2?: string;
  distWall2?: number; // distance in mm from second reference wall
  label?: string;
}

export interface SlabElement {
  id: string;
  boundary: Point2D[];
  thickness: number; // mm, default 150
  material: "hardwood" | "concrete" | "ceramic_tile" | "marble";
  elevation: number; // mm, default 0
}

export interface CeilingElement {
  id: string;
  boundary: Point2D[];
  elevation: number; // mm, default 2800
  thickness: number; // mm, default 20
  visibleIn3d: boolean;
}

export interface LayerVisibility {
  visible: boolean;
  locked: boolean;
}

export interface LayerSettings {
  walls: LayerVisibility;
  doors: LayerVisibility;
  windows: LayerVisibility;
  electrical: LayerVisibility;
  radiators: LayerVisibility;
  lighting: LayerVisibility;
  slab: LayerVisibility;
  ceiling: LayerVisibility;
  dimensions: LayerVisibility;
  roomTags: LayerVisibility;
}

export const DEFAULT_LAYER_SETTINGS: LayerSettings = {
  walls: { visible: true, locked: false },
  doors: { visible: true, locked: false },
  windows: { visible: true, locked: false },
  electrical: { visible: true, locked: false },
  radiators: { visible: true, locked: false },
  lighting: { visible: true, locked: false },
  slab: { visible: true, locked: false },
  ceiling: { visible: true, locked: false },
  dimensions: { visible: true, locked: false },
  roomTags: { visible: true, locked: false },
};

export interface RoomPlanItem {
  id: string;
  projectId: string;
  name: string;
  roomType: RoomType;
  calculatedArea: number; // in m²
  calculatedPerimeter: number; // in meters (m)
  wallCount: number;
  doorCount: number;
  windowCount: number;
  isClosed: boolean;
  walls: WallElement[];
  doors: DoorElement[];
  windows: WindowElement[];
  electrical?: ElectricalElement[];
  radiators?: RadiatorElement[];
  lighting?: LightFixtureElement[];
  slab?: SlabElement;
  ceiling?: CeilingElement;
  layerSettings?: LayerSettings;
  flooringType?: "laminate" | "ceramic";
  hasDrywallCeiling?: boolean;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type NewRoomPlanInput = Omit<RoomPlanItem, "id" | "createdAt" | "updatedAt">;
