import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./client";
import type { RoomPlanItem, NewRoomPlanInput } from "@/types/plan";
import { DEFAULT_LAYER_SETTINGS } from "@/types/plan";

const getRoomsRef = (userId: string, projectId: string) => {
  return collection(db, "users", userId, "projects", projectId, "rooms");
};

export const subscribeToProjectRooms = (
  userId: string,
  projectId: string,
  callback: (rooms: RoomPlanItem[]) => void
) => {
  if (!userId || !projectId) return () => {};

  const roomsRef = getRoomsRef(userId, projectId);
  const q = query(roomsRef, orderBy("createdAt", "desc"));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: RoomPlanItem[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          projectId: data.projectId || projectId,
          name: data.name || "Untitled Room",
          roomType: data.roomType || "living",
          calculatedArea: Number(data.calculatedArea) || 0,
          calculatedPerimeter: Number(data.calculatedPerimeter) || 0,
          wallCount: Number(data.wallCount) || (data.walls?.length ?? 0),
          doorCount: Number(data.doorCount) || (data.doors?.length ?? 0),
          windowCount: Number(data.windowCount) || (data.windows?.length ?? 0),
          isClosed: Boolean(data.isClosed),
          walls: data.walls || [],
          doors: data.doors || [],
          windows: data.windows || [],
          electrical: data.electrical || [],
          radiators: data.radiators || [],
          lighting: data.lighting || [],
          slab: data.slab,
          ceiling: data.ceiling,
          flooringType: data.flooringType || (data.slab?.material === "ceramic_tile" ? "ceramic" : "laminate"),
          hasDrywallCeiling: data.hasDrywallCeiling ?? (data.ceiling?.visibleIn3d ?? false),
          layerSettings: data.layerSettings || DEFAULT_LAYER_SETTINGS,
          notes: data.notes || "",
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      callback(items);
    },
    (err) => {
      console.error("Error subscribing to project rooms:", err);
      callback([]);
    }
  );
};

export const addRoomToProject = async (
  userId: string,
  projectId: string,
  input: NewRoomPlanInput
) => {
  if (!userId || !projectId) return null;
  const roomsRef = getRoomsRef(userId, projectId);
  return await addDoc(roomsRef, {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const getRoomPlanItem = async (
  userId: string,
  projectId: string,
  roomId: string
): Promise<RoomPlanItem | null> => {
  if (!userId || !projectId || !roomId) return null;
  const docRef = doc(db, "users", userId, "projects", projectId, "rooms", roomId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    projectId: data.projectId || projectId,
    name: data.name || "Untitled Room",
    roomType: data.roomType || "living",
    calculatedArea: Number(data.calculatedArea) || 0,
    calculatedPerimeter: Number(data.calculatedPerimeter) || 0,
    wallCount: Number(data.wallCount) || (data.walls?.length ?? 0),
    doorCount: Number(data.doorCount) || (data.doors?.length ?? 0),
    windowCount: Number(data.windowCount) || (data.windows?.length ?? 0),
    isClosed: Boolean(data.isClosed),
    walls: data.walls || [],
    doors: data.doors || [],
    windows: data.windows || [],
    electrical: data.electrical || [],
    radiators: data.radiators || [],
    lighting: data.lighting || [],
    slab: data.slab,
    ceiling: data.ceiling,
    flooringType: data.flooringType || (data.slab?.material === "ceramic_tile" ? "ceramic" : "laminate"),
    hasDrywallCeiling: data.hasDrywallCeiling ?? (data.ceiling?.visibleIn3d ?? false),
    layerSettings: data.layerSettings || DEFAULT_LAYER_SETTINGS,
    notes: data.notes || "",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

export const subscribeToRoomPlanItem = (
  userId: string,
  projectId: string,
  roomId: string,
  callback: (room: RoomPlanItem | null) => void
) => {
  if (!userId || !projectId || !roomId) return () => {};
  const docRef = doc(db, "users", userId, "projects", projectId, "rooms", roomId);
  return onSnapshot(
    docRef,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const data = snap.data();
      callback({
        id: snap.id,
        projectId: data.projectId || projectId,
        name: data.name || "Untitled Room",
        roomType: data.roomType || "living",
        calculatedArea: Number(data.calculatedArea) || 0,
        calculatedPerimeter: Number(data.calculatedPerimeter) || 0,
        wallCount: Number(data.wallCount) || (data.walls?.length ?? 0),
        doorCount: Number(data.doorCount) || (data.doors?.length ?? 0),
        windowCount: Number(data.windowCount) || (data.windows?.length ?? 0),
        isClosed: Boolean(data.isClosed),
        walls: data.walls || [],
        doors: data.doors || [],
        windows: data.windows || [],
        electrical: data.electrical || [],
        radiators: data.radiators || [],
        lighting: data.lighting || [],
        slab: data.slab,
        ceiling: data.ceiling,
        flooringType: data.flooringType || (data.slab?.material === "ceramic_tile" ? "ceramic" : "laminate"),
        hasDrywallCeiling: data.hasDrywallCeiling ?? (data.ceiling?.visibleIn3d ?? false),
        layerSettings: data.layerSettings || DEFAULT_LAYER_SETTINGS,
        notes: data.notes || "",
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    },
    (err) => {
      console.error("Error subscribing to room item:", err);
      callback(null);
    }
  );
};

export const updateRoomPlanInProject = async (
  userId: string,
  projectId: string,
  roomId: string,
  updates: Partial<NewRoomPlanInput>
) => {
  if (!userId || !projectId || !roomId) return;
  const docRef = doc(db, "users", userId, "projects", projectId, "rooms", roomId);
  return await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
};

export const deleteRoomFromProject = async (
  userId: string,
  projectId: string,
  roomId: string
) => {
  if (!userId || !projectId || !roomId) return;
  const docRef = doc(db, "users", userId, "projects", projectId, "rooms", roomId);
  return await deleteDoc(docRef);
};
