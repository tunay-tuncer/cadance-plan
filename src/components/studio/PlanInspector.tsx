"use client";

import React, { useState } from "react";
import type { RoomPlanItem, LayerSettings, Point2D } from "@/types/plan";
import {
  getDistance,
  resizeRoomWallLength,
  calculateRoomTakeoff,
  getRoomCentroid,
  calculateLightPositionFromWallDistances,
  calculateLightFourWayDimensions,
  computeBeamGeometry,
} from "@/lib/cad/geometry";
import {
  MdClose,
  MdLayers,
  MdTune,
  MdVisibility,
  MdVisibilityOff,
  MdLockOutline,
  MdLockOpen,
  MdDeleteOutline,
  MdChecklist,
  MdSwapHoriz,
} from "react-icons/md";
import styles from "./PlanInspector.module.css";

interface PlanInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  room: RoomPlanItem;
  onUpdateRoom: (updater: (prev: RoomPlanItem) => RoomPlanItem) => void;
  onUpdateAllWallHeights?: (newHeightMm: number) => void;
  selectedElementId: string | null;
  selectedElementType: "wall" | "door" | "window" | "electrical" | "radiator" | "lighting" | "beam" | "chimney" | "acUnit" | null;
  selectedElementIds?: string[];
  onDeselect: () => void;
  layerSettings: LayerSettings;
  onUpdateLayerSettings: (layers: LayerSettings) => void;
  onDeleteElements?: (ids: string[]) => void;
  onSetActivePoint?: (pt: Point2D) => void;
  onMergeColinearWalls?: () => void;
}

export default function PlanInspector({
  isOpen,
  onClose,
  room,
  onUpdateRoom,
  onUpdateAllWallHeights,
  selectedElementId,
  selectedElementType,
  selectedElementIds,
  onDeselect,
  layerSettings,
  onUpdateLayerSettings,
  onDeleteElements,
  onSetActivePoint,
  onMergeColinearWalls,
}: PlanInspectorProps) {
  const [activeTab, setActiveTab] = useState<"layers" | "properties">("layers");

  // Selected Elements
  const selectedWall =
    selectedElementType === "wall"
      ? room.walls.find((w) => w.id === selectedElementId)
      : null;

  const selectedDoor =
    selectedElementType === "door"
      ? room.doors.find((d) => d.id === selectedElementId)
      : null;

  const selectedWindow =
    selectedElementType === "window"
      ? room.windows.find((w) => w.id === selectedElementId)
      : null;

  const selectedElectrical =
    selectedElementType === "electrical"
      ? room.electrical?.find((el) => el.id === selectedElementId)
      : null;

  const selectedRadiator =
    selectedElementType === "radiator"
      ? room.radiators?.find((rad) => rad.id === selectedElementId)
      : null;

  const selectedLight =
    selectedElementType === "lighting"
      ? room.lighting?.find((l) => l.id === selectedElementId)
      : null;

  const selectedBeam =
    selectedElementType === "beam"
      ? room.beams?.find((b) => b.id === selectedElementId)
      : null;

  const selectedChimney =
    selectedElementType === "chimney"
      ? room.chimneys?.find((c) => c.id === selectedElementId)
      : null;

  const selectedAC =
    selectedElementType === "acUnit"
      ? room.acUnits?.find((ac) => ac.id === selectedElementId)
      : null;

  // Layer toggle helper
  const toggleVisibility = (layerKey: keyof LayerSettings) => {
    const current = layerSettings[layerKey] || { visible: true, locked: false };
    onUpdateLayerSettings({
      ...layerSettings,
      [layerKey]: {
        ...current,
        visible: !current.visible,
      },
    });
  };

  const toggleLock = (layerKey: keyof LayerSettings) => {
    const current = layerSettings[layerKey] || { visible: true, locked: false };
    onUpdateLayerSettings({
      ...layerSettings,
      [layerKey]: {
        ...current,
        locked: !current.locked,
      },
    });
  };

  // Delete Handlers
  const handleDeleteSelected = () => {
    if (!selectedElementId) return;

    if (onDeleteElements) {
      onDeleteElements([selectedElementId]);
      return;
    }

    if (selectedElementType === "wall") {
      onUpdateRoom((prev) => ({
        ...prev,
        walls: prev.walls.filter((w) => w.id !== selectedElementId),
        doors: prev.doors.filter((d) => d.wallId !== selectedElementId),
        windows: prev.windows.filter((w) => w.wallId !== selectedElementId),
        isClosed: false,
      }));
      onDeselect();
    } else if (selectedElementType === "door") {
      onUpdateRoom((prev) => ({
        ...prev,
        doors: prev.doors.filter((d) => d.id !== selectedElementId),
      }));
      onDeselect();
    } else if (selectedElementType === "window") {
      onUpdateRoom((prev) => ({
        ...prev,
        windows: prev.windows.filter((w) => w.id !== selectedElementId),
      }));
      onDeselect();
    } else if (selectedElementType === "electrical") {
      onUpdateRoom((prev) => ({
        ...prev,
        electrical: prev.electrical?.filter((el) => el.id !== selectedElementId) || [],
      }));
      onDeselect();
    } else if (selectedElementType === "radiator") {
      onUpdateRoom((prev) => ({
        ...prev,
        radiators: prev.radiators?.filter((rad) => rad.id !== selectedElementId) || [],
      }));
      onDeselect();
    } else if (selectedElementType === "lighting") {
      onUpdateRoom((prev) => ({
        ...prev,
        lighting: prev.lighting?.filter((l) => l.id !== selectedElementId) || [],
      }));
      onDeselect();
    } else if (selectedElementType === "beam") {
      onUpdateRoom((prev) => ({
        ...prev,
        beams: prev.beams?.filter((b) => b.id !== selectedElementId) || [],
      }));
      onDeselect();
    }
  };

  return (
    <aside
      className={`${styles.inspectorDrawer} ${
        isOpen ? styles.drawerOpen : styles.drawerClosed
      }`}
    >
      <div className={styles.drawerHeader}>
        <div className={styles.tabSwitcher}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "layers" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("layers")}
          >
            <MdLayers size={14} />
            <span>Katmanlar</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "properties" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("properties")}
          >
            <MdTune size={14} />
            <span>Özellikler</span>
          </button>
        </div>

        <button
          type="button"
          className={styles.closeDrawerBtn}
          onClick={onClose}
          aria-label="Kapat"
        >
          <MdClose size={18} />
        </button>
      </div>

      <div className={styles.drawerContent}>
        {/* TAB 1: Layer Hierarchy */}
        {activeTab === "layers" && (
          <div className={styles.layersList}>
            <div className={styles.sectionTitle}>BIM Katman Hiyerarşisi</div>

            {/* Walls Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#29f57e" }} />
                <span>Duvarlar (Walls)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("walls")}
                  title="Görünürlük"
                >
                  {layerSettings.walls.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("walls")}
                  title="Kilitle"
                >
                  {layerSettings.walls.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Doors Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#facc15" }} />
                <span>Kapılar (Doors)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("doors")}
                >
                  {layerSettings.doors.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("doors")}
                >
                  {layerSettings.doors.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Windows Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#38bdf8" }} />
                <span>Pencereler (Windows)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("windows")}
                >
                  {layerSettings.windows.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("windows")}
                >
                  {layerSettings.windows.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Slab Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#d4a373" }} />
                <span>Döşeme / Zemin (Slab)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("slab")}
                >
                  {layerSettings.slab.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
              </div>
            </div>

            {/* Ceiling Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#cbd5e1" }} />
                <span>Tavan (Ceiling)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("ceiling")}
                >
                  {layerSettings.ceiling.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
              </div>
            </div>

            {/* Dimensions Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#a855f7" }} />
                <span>Ölçülendirme (Dims)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("dimensions")}
                >
                  {layerSettings.dimensions.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
              </div>
            </div>

            {/* Electrical Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#4ade80" }} />
                <span>Elektrik (Priz/Anahtar/Pano)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("electrical")}
                >
                  {layerSettings.electrical?.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("electrical")}
                >
                  {layerSettings.electrical?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Radiators Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#f87171" }} />
                <span>Doğalgaz Petekleri</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("radiators")}
                >
                  {layerSettings.radiators?.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("radiators")}
                >
                  {layerSettings.radiators?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Lighting Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#fbbf24" }} />
                <span>Aydınlatma (Armatür/Spot)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("lighting")}
                >
                  {layerSettings.lighting?.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("lighting")}
                >
                  {layerSettings.lighting?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Beams Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#94a3b8" }} />
                <span>Kirişler (Structural Beams)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("beams")}
                >
                  {layerSettings.beams?.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("beams")}
                >
                  {layerSettings.beams?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Chimneys Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#ea580c" }} />
                <span>Bacalar (Chimneys)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("chimneys")}
                >
                  {layerSettings.chimneys?.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("chimneys")}
                >
                  {layerSettings.chimneys?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* AC Units Layer */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#06b6d4" }} />
                <span>Klimalar (AC Units)</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("acUnits")}
                >
                  {layerSettings.acUnits?.visible ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("acUnits")}
                >
                  {layerSettings.acUnits?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>

            {/* Room Tags (Oda Adı ve Metrekare) */}
            <div className={styles.layerItem}>
              <div className={styles.layerNameArea}>
                <span className={styles.layerDot} style={{ background: "#22c55e" }} />
                <span>Oda Adı & Metrekare Etiketi</span>
              </div>
              <div className={styles.layerControls}>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleVisibility("roomTags")}
                  title="Oda adını ve m² etiketini göster/gizle"
                >
                  {layerSettings.roomTags?.visible !== false ? <MdVisibility size={16} /> : <MdVisibilityOff size={16} />}
                </button>
                <button
                  type="button"
                  className={styles.layerToggleBtn}
                  onClick={() => toggleLock("roomTags")}
                  title="Kilitle"
                >
                  {layerSettings.roomTags?.locked ? <MdLockOutline size={16} /> : <MdLockOpen size={16} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Properties Inspector */}
        {activeTab === "properties" && (
          <div>
            {/* Multi-Selection Panel */}
            {selectedElementIds && selectedElementIds.length > 1 && (
              <div>
                <div className={styles.sectionTitle}>
                  <MdChecklist size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} />
                  Çoklu Seçim ({selectedElementIds.length} Öğe)
                </div>

                <div className={styles.multiSelectBadge}>
                  {(() => {
                    const wCount = room.walls.filter((w) => selectedElementIds.includes(w.id)).length;
                    const dCount = room.doors.filter((d) => selectedElementIds.includes(d.id)).length;
                    const winCount = room.windows.filter((w) => selectedElementIds.includes(w.id)).length;
                    const parts: string[] = [];
                    if (wCount > 0) parts.push(`${wCount} Duvar`);
                    if (dCount > 0) parts.push(`${dCount} Kapı`);
                    if (winCount > 0) parts.push(`${winCount} Pencere`);
                    return parts.join(", ");
                  })()}
                </div>

                {/* Bulk Wall Adjustments if walls are selected */}
                {room.walls.some((w) => selectedElementIds.includes(w.id)) && (
                  <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "0.75rem", borderRadius: "8px", marginBottom: "0.85rem", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.55rem" }}>
                      Seçili Duvarları Toplu Düzenle
                    </div>

                    <div className={styles.formField}>
                      <label className={styles.fieldLabel}>Toplu Kalınlık (cm)</label>
                      <select
                        onChange={(e) => {
                          const thick = Number(e.target.value);
                          onUpdateRoom((prev) => ({
                            ...prev,
                            walls: prev.walls.map((w) =>
                              selectedElementIds.includes(w.id) ? { ...w, thickness: thick } : w
                            ),
                          }));
                        }}
                        className={styles.selectInput}
                        defaultValue=""
                      >
                        <option value="" disabled>Kalınlık Seçin...</option>
                        <option value={100}>10 cm (İç Bölme)</option>
                        <option value={150}>15 cm (Standart Bölme)</option>
                        <option value={200}>20 cm (Bölme Duvar)</option>
                        <option value={250}>25 cm (Dış Cephe)</option>
                        <option value={300}>30 cm (Taşıyıcı / Yalıtımlı)</option>
                      </select>
                    </div>

                    <div className={styles.formField}>
                      <label className={styles.fieldLabel}>Toplu Yükseklik (cm)</label>
                      <input
                        type="number"
                        step="10"
                        placeholder="Örn: 280"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const h = Number(e.target.value);
                          if (h >= 10) {
                            onUpdateRoom((prev) => ({
                              ...prev,
                              walls: prev.walls.map((w) =>
                                selectedElementIds.includes(w.id) ? { ...w, height: h * 10 } : w
                              ),
                            }));
                          }
                        }}
                        className={styles.textInput}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={() => {
                    if (onDeleteElements && selectedElementIds && selectedElementIds.length > 0) {
                      onDeleteElements(selectedElementIds);
                      return;
                    }
                    onUpdateRoom((prev) => ({
                      ...prev,
                      walls: prev.walls.filter((w) => !selectedElementIds.includes(w.id)),
                      doors: prev.doors.filter((d) => !selectedElementIds.includes(d.id) && !selectedElementIds.includes(d.wallId)),
                      windows: prev.windows.filter((w) => !selectedElementIds.includes(w.id) && !selectedElementIds.includes(w.wallId)),
                      isClosed: prev.walls.some((w) => selectedElementIds.includes(w.id)) ? false : prev.isClosed,
                    }));
                    onDeselect();
                  }}
                  style={{ width: "100%" }}
                >
                  <MdDeleteOutline size={16} />
                  <span>Seçili Tüm Öğeleri Sil ({selectedElementIds.length})</span>
                </button>
              </div>
            )}

            {/* If a Single Wall is Selected */}
            {(!selectedElementIds || selectedElementIds.length <= 1) && selectedWall && (
              <div>
                <div className={styles.sectionTitle}>Seçili Duvar Parametreleri</div>

                {/* Parametric Wall Length (Width of Room) - Revit Style */}
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Duvar Uzunluğu (Ölçü) (cm)</label>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(getDistance(selectedWall.start, selectedWall.end) / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const newL = Number(e.target.value);
                        if (newL > 0) {
                          onUpdateRoom((prev) => resizeRoomWallLength(prev, selectedWall.id, newL * 10));
                        }
                      }}
                      className={styles.textInput}
                    />
                    <span style={{ fontSize: "0.85rem", color: "var(--textMuted)", fontWeight: 600 }}>cm</span>
                  </div>
                  {/* Quick increment chips */}
                  <div className={styles.presetChipRow}>
                    {[-50, -10, 10, 50].map((inc) => (
                      <button
                        key={inc}
                        type="button"
                        className={styles.presetChip}
                        onClick={() => {
                          const curL = getDistance(selectedWall.start, selectedWall.end);
                          onUpdateRoom((prev) => resizeRoomWallLength(prev, selectedWall.id, curL + inc * 10));
                        }}
                      >
                        {inc > 0 ? `+${inc}` : inc} cm
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Duvar Kalınlığı</label>
                  <select
                    value={selectedWall.thickness}
                    onChange={(e) => {
                      const thick = Number(e.target.value);
                      onUpdateRoom((prev) => ({
                        ...prev,
                        walls: prev.walls.map((w) =>
                          w.id === selectedWall.id ? { ...w, thickness: thick } : w
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value={100}>10 cm (İç Bölme)</option>
                    <option value={150}>15 cm (Standart Bölme)</option>
                    <option value={200}>20 cm (Bölme Duvar)</option>
                    <option value={250}>25 cm (Dış Cephe)</option>
                    <option value={300}>30 cm (Taşıyıcı Duvar)</option>
                  </select>
                </div>

                {/* Flip Wall Thickness Side (Revit Spacebar / Flip) */}
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Duvar Kalınlık Yönü</label>
                  <button
                    type="button"
                    className={styles.presetChip}
                    style={{ width: "100%", justifyContent: "center", padding: "0.45rem", display: "flex", alignItems: "center", gap: "0.4rem" }}
                    onClick={() => {
                      onUpdateRoom((prev) => ({
                        ...prev,
                        walls: prev.walls.map((w) =>
                          w.id === selectedWall.id ? { ...w, flipSide: !w.flipSide } : w
                        ),
                      }));
                    }}
                  >
                    <MdSwapHoriz size={16} />
                    <span>⇄ Kalınlık Yönünü Ters Çevir ({selectedWall.flipSide ? "Ters Yön" : "Standart"})</span>
                  </button>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Duvar Yüksekliği (cm)</label>
                  <input
                    type="number"
                    step="10"
                    value={Math.round(selectedWall.height / 10) || ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const h = Number(e.target.value);
                      if (h > 0) {
                        onUpdateRoom((prev) => ({
                          ...prev,
                          walls: prev.walls.map((w) =>
                            w.id === selectedWall.id ? { ...w, height: h * 10 } : w
                          ),
                        }));
                      }
                    }}
                    className={styles.textInput}
                  />
                </div>

                {/* Cursor Snapping to Wall Endpoint */}
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>📍 Çizim İmleci (Cursor) Konumu</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className={styles.presetChip}
                      onClick={() => onSetActivePoint?.(selectedWall.start)}
                      title="Surveyor imlecini bu duvarın başlangıç noktasına kilitler"
                    >
                      Başlangıca Snap
                    </button>
                    <button
                      type="button"
                      className={styles.presetChip}
                      onClick={() => onSetActivePoint?.(selectedWall.end)}
                      title="Surveyor imlecini bu duvarın bitiş noktasına kilitler"
                    >
                      Bitişe Snap
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Duvarı Sil</span>
                </button>
              </div>
            )}

            {/* If a Single Door is Selected */}
            {(!selectedElementIds || selectedElementIds.length <= 1) && selectedDoor && (
              <div>
                <div className={styles.sectionTitle}>Seçili Kapı Parametreleri</div>

                {/* Temporary Distance Dimension Inputs - Revit Style */}
                {(() => {
                  const parentWall = room.walls.find((w) => w.id === selectedDoor.wallId);
                  if (!parentWall) return null;
                  const wallLen = Math.round(getDistance(parentWall.start, parentWall.end));
                  const distFromEnd = Math.max(0, wallLen - selectedDoor.offset - selectedDoor.width);

                  return (
                    <div style={{ background: "rgba(56, 189, 248, 0.08)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "8px", padding: "0.65rem", marginBottom: "0.85rem" }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#38bdf8", marginBottom: "0.45rem", textTransform: "uppercase" }}>
                        Geçici Konum Ölçüleri (Revit Boyutu)
                      </div>
                      <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                        <label className={styles.fieldLabel}>Duvar Başından Mesafe (cm)</label>
                        <input
                          type="number"
                          step="5"
                          value={selectedDoor.offset ? Math.round(selectedDoor.offset / 10) : ""}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const newOffCm = Number(e.target.value);
                            const newOff = newOffCm * 10;
                            const maxOff = Math.max(50, wallLen - selectedDoor.width - 50);
                            const safe = Math.max(0, Math.min(maxOff, newOff));
                            onUpdateRoom((prev) => ({
                              ...prev,
                              doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, offset: safe } : d)),
                            }));
                          }}
                          className={styles.textInput}
                        />
                      </div>
                      <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                        <label className={styles.fieldLabel}>Duvar Sonundan Mesafe (cm)</label>
                        <input
                          type="number"
                          step="5"
                          value={distFromEnd ? Math.round(distFromEnd / 10) : ""}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const targetDistCm = Number(e.target.value);
                            const targetDist = targetDistCm * 10;
                            const newOff = wallLen - selectedDoor.width - targetDist;
                            const maxOff = Math.max(50, wallLen - selectedDoor.width - 50);
                            const safe = Math.max(0, Math.min(maxOff, newOff));
                            onUpdateRoom((prev) => ({
                              ...prev,
                              doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, offset: safe } : d)),
                            }));
                          }}
                          className={styles.textInput}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.presetChip}
                        style={{ width: "100%", justifyContent: "center", marginTop: "0.25rem" }}
                        onClick={() => {
                          const centered = Math.round((wallLen - selectedDoor.width) / 2);
                          onUpdateRoom((prev) => ({
                            ...prev,
                            doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, offset: Math.max(50, centered) } : d)),
                          }));
                        }}
                      >
                        Duvarın Ortasına Hizala
                      </button>
                    </div>
                  );
                })()}

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Kapı Tipi</label>
                  <select
                    value={selectedDoor.doorType || "hinged"}
                    onChange={(e) => {
                      const dt = e.target.value as "hinged" | "sliding";
                      onUpdateRoom((prev) => ({
                        ...prev,
                        doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, doorType: dt } : d)),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="hinged">Standart Menteşeli Kapı</option>
                    <option value="sliding">Boydan Kayar / Sürme Kapı</option>
                  </select>
                </div>

                {selectedDoor.doorType === "sliding" && (
                  <>
                    <div className={styles.formField}>
                      <label className={styles.fieldLabel}>Kayar Segment / Kanat Sayısı</label>
                      <select
                        value={selectedDoor.slidingSegments || 2}
                        onChange={(e) => {
                          const segs = Number(e.target.value) || 2;
                          onUpdateRoom((prev) => ({
                            ...prev,
                            doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, slidingSegments: segs } : d)),
                          }));
                        }}
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
                        id="fullHeightDoor"
                        checked={Boolean(selectedDoor.isFullHeight)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          onUpdateRoom((prev) => ({
                            ...prev,
                            doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, isFullHeight: checked } : d)),
                          }));
                        }}
                      />
                      <label htmlFor="fullHeightDoor" className={styles.fieldLabel} style={{ marginBottom: 0, cursor: "pointer" }}>
                        Tavana Kadar Boydan (Full Height)
                      </label>
                    </div>
                  </>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Genişlik (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(selectedDoor.width / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const w = Number(e.target.value);
                        if (w > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            doors: prev.doors.map((d) =>
                              d.id === selectedDoor.id ? { ...d, width: w * 10 } : d
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Yükseklik (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round((selectedDoor.height || 2100) / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const h = Number(e.target.value);
                        if (h > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            doors: prev.doors.map((d) =>
                              d.id === selectedDoor.id ? { ...d, height: h * 10 } : d
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Menteşe Yönü</label>
                  <select
                    value={selectedDoor.swingDirection}
                    onChange={(e) => {
                      const dir = e.target.value as "left" | "right";
                      onUpdateRoom((prev) => ({
                        ...prev,
                        doors: prev.doors.map((d) =>
                          d.id === selectedDoor.id ? { ...d, swingDirection: dir } : d
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="right">Sağ Menteşe (Sağ Açılır)</option>
                    <option value="left">Sol Menteşe (Sol Açılır)</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Açılış Yönü (İç / Dış)</label>
                  <select
                    value={selectedDoor.swingOrientation}
                    onChange={(e) => {
                      const ori = e.target.value as "inward" | "outward";
                      onUpdateRoom((prev) => ({
                        ...prev,
                        doors: prev.doors.map((d) =>
                          d.id === selectedDoor.id ? { ...d, swingOrientation: ori } : d
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="inward">İçeriye Açılır (Oda İçi)</option>
                    <option value="outward">Dışarıya Açılır (Oda Dışı)</option>
                  </select>
                </div>

                {/* Quick Flip Buttons for Door */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.25rem", marginBottom: "0.5rem" }}>
                  <button
                    type="button"
                    className={styles.presetChip}
                    style={{ justifyContent: "center", padding: "0.45rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => {
                      const nextDir = selectedDoor.swingDirection === "right" ? "left" : "right";
                      onUpdateRoom((prev) => ({
                        ...prev,
                        doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, swingDirection: nextDir } : d)),
                      }));
                    }}
                    title="Menteşe tarafını değiştir (Sağ / Sol)"
                  >
                    <MdSwapHoriz size={15} />
                    <span>⇄ Menteşe ({selectedDoor.swingDirection === "right" ? "Sağ" : "Sol"})</span>
                  </button>

                  <button
                    type="button"
                    className={styles.presetChip}
                    style={{ justifyContent: "center", padding: "0.45rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => {
                      const nextOri = selectedDoor.swingOrientation === "inward" ? "outward" : "inward";
                      onUpdateRoom((prev) => ({
                        ...prev,
                        doors: prev.doors.map((d) => (d.id === selectedDoor.id ? { ...d, swingOrientation: nextOri } : d)),
                      }));
                    }}
                    title="Açılışı odaya veya dışa doğru çevir"
                  >
                    <MdSwapHoriz size={15} />
                    <span>⇄ Açılış ({selectedDoor.swingOrientation === "inward" ? "İçeri" : "Dışarı"})</span>
                  </button>
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Kapıyı Sil</span>
                </button>
              </div>
            )}

            {/* If a Single Window is Selected */}
            {(!selectedElementIds || selectedElementIds.length <= 1) && selectedWindow && (
              <div>
                <div className={styles.sectionTitle}>Seçili Pencere Parametreleri</div>

                {/* Temporary Distance Dimension Inputs - Revit Style */}
                {(() => {
                  const parentWall = room.walls.find((w) => w.id === selectedWindow.wallId);
                  if (!parentWall) return null;
                  const wallLen = Math.round(getDistance(parentWall.start, parentWall.end));
                  const distFromEnd = Math.max(0, wallLen - selectedWindow.offset - selectedWindow.width);

                  return (
                    <div style={{ background: "rgba(56, 189, 248, 0.08)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "8px", padding: "0.65rem", marginBottom: "0.85rem" }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#38bdf8", marginBottom: "0.45rem", textTransform: "uppercase" }}>
                        Geçici Konum Ölçüleri (Revit Boyutu)
                      </div>
                      <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                        <label className={styles.fieldLabel}>Duvar Başından Mesafe (cm)</label>
                        <input
                          type="number"
                          step="5"
                          value={selectedWindow.offset ? Math.round(selectedWindow.offset / 10) : ""}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const newOffCm = Number(e.target.value);
                            const newOff = newOffCm * 10;
                            const maxOff = Math.max(50, wallLen - selectedWindow.width - 50);
                            const safe = Math.max(0, Math.min(maxOff, newOff));
                            onUpdateRoom((prev) => ({
                              ...prev,
                              windows: prev.windows.map((win) => (win.id === selectedWindow.id ? { ...win, offset: safe } : win)),
                            }));
                          }}
                          className={styles.textInput}
                        />
                      </div>
                      <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                        <label className={styles.fieldLabel}>Duvar Sonundan Mesafe (cm)</label>
                        <input
                          type="number"
                          step="5"
                          value={distFromEnd ? Math.round(distFromEnd / 10) : ""}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const targetDistCm = Number(e.target.value);
                            const targetDist = targetDistCm * 10;
                            const newOff = wallLen - selectedWindow.width - targetDist;
                            const maxOff = Math.max(50, wallLen - selectedWindow.width - 50);
                            const safe = Math.max(0, Math.min(maxOff, newOff));
                            onUpdateRoom((prev) => ({
                              ...prev,
                              windows: prev.windows.map((win) => (win.id === selectedWindow.id ? { ...win, offset: safe } : win)),
                            }));
                          }}
                          className={styles.textInput}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.presetChip}
                        style={{ width: "100%", justifyContent: "center", marginTop: "0.25rem" }}
                        onClick={() => {
                          const centered = Math.round((wallLen - selectedWindow.width) / 2);
                          onUpdateRoom((prev) => ({
                            ...prev,
                            windows: prev.windows.map((win) => (win.id === selectedWindow.id ? { ...win, offset: Math.max(50, centered) } : win)),
                          }));
                        }}
                      >
                        Duvarın Ortasına Hizala
                      </button>
                    </div>
                  );
                })()}

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Pencere Tipi</label>
                  <select
                    value={selectedWindow.windowType || "standard"}
                    onChange={(e) => {
                      const wt = e.target.value as any;
                      onUpdateRoom((prev) => ({
                        ...prev,
                        windows: prev.windows.map((win) =>
                          win.id === selectedWindow.id
                            ? { ...win, windowType: wt, sillHeight: wt === "french" ? 0 : win.sillHeight }
                            : win
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="standard">Standart Tek Kanat Açılır</option>
                    <option value="sliding">Sürme Pencere</option>
                    <option value="double_casement">Çift Kanat Açılır</option>
                    <option value="french">Fransız Balkon (Korkuluklu)</option>
                    <option value="fixed">Sabit Cam / Vitrin</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Bölme / Kanat Sayısı</label>
                  <select
                    value={selectedWindow.segments || 1}
                    onChange={(e) => {
                      const seg = Number(e.target.value) || 1;
                      onUpdateRoom((prev) => ({
                        ...prev,
                        windows: prev.windows.map((win) =>
                          win.id === selectedWindow.id ? { ...win, segments: seg } : win
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value={1}>1 Bölme (Tek Cam)</option>
                    <option value={2}>2 Bölme (Orta Kayıtlı)</option>
                    <option value={3}>3 Bölme</option>
                    <option value={4}>4 Bölme (Geniş Açıklık)</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Doğrama Malzemesi / Renk</label>
                  <select
                    value={selectedWindow.frameMaterial || "anthracite"}
                    onChange={(e) => {
                      const mat = e.target.value as any;
                      onUpdateRoom((prev) => ({
                        ...prev,
                        windows: prev.windows.map((win) =>
                          win.id === selectedWindow.id ? { ...win, frameMaterial: mat } : win
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="anthracite">Antrasit PVC / Alüminyum (RAL 7016)</option>
                    <option value="pvc_white">Beyaz PVC</option>
                    <option value="wood">Doğal Ahşap Masif</option>
                    <option value="aluminum">Siyah Eloksal Alüminyum</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Genişlik (cm)</label>
                  <input
                    type="number"
                    step="5"
                    value={Math.round(selectedWindow.width / 10) || ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const w = Number(e.target.value);
                      if (w > 0) {
                        onUpdateRoom((prev) => ({
                          ...prev,
                          windows: prev.windows.map((win) =>
                            win.id === selectedWindow.id ? { ...win, width: w * 10 } : win
                          ),
                        }));
                      }
                    }}
                    className={styles.textInput}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Yükseklik (cm)</label>
                  <input
                    type="number"
                    step="5"
                    value={Math.round(selectedWindow.height / 10) || ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const h = Number(e.target.value);
                      if (h > 0) {
                        onUpdateRoom((prev) => ({
                          ...prev,
                          windows: prev.windows.map((win) =>
                            win.id === selectedWindow.id ? { ...win, height: h * 10 } : win
                          ),
                        }));
                      }
                    }}
                    className={styles.textInput}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Parapet / Denizlik Kotu (cm)</label>
                  <input
                    type="number"
                    step="5"
                    value={selectedWindow.sillHeight !== undefined ? Math.round(selectedWindow.sillHeight / 10) : ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const sill = e.target.value === "" ? 0 : Number(e.target.value);
                      onUpdateRoom((prev) => ({
                        ...prev,
                        windows: prev.windows.map((win) =>
                          win.id === selectedWindow.id ? { ...win, sillHeight: sill * 10 } : win
                        ),
                      }));
                    }}
                    className={styles.textInput}
                  />
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Pencereyi Sil</span>
                </button>
              </div>
            )}

            {/* Selected Electrical Element Inspector */}
            {(!selectedElementIds || selectedElementIds.length <= 1) && selectedElectrical && (
              <div>
                <div className={styles.sectionTitle}>Seçili Elektrik Elemanı</div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Eleman Tipi</label>
                  <select
                    value={selectedElectrical.type}
                    onChange={(e) => {
                      const t = e.target.value as "socket" | "switch" | "panel";
                      const defaultElev = t === "socket" ? 300 : t === "switch" ? 1100 : 1800;
                      onUpdateRoom((prev) => ({
                        ...prev,
                        electrical: prev.electrical?.map((el) =>
                          el.id === selectedElectrical.id ? { ...el, type: t, elevation: defaultElev } : el
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="socket">Priz (Elektrik Prizi)</option>
                    <option value="switch">Anahtar (Aydınlatma Anahtarı)</option>
                    <option value="panel">Sigorta Panosu (Dağıtım Kutusu)</option>
                  </select>
                </div>

                {(() => {
                  const parentWall = room.walls.find((w) => w.id === selectedElectrical.wallId);
                  if (!parentWall) return null;
                  const wallLen = Math.round(getDistance(parentWall.start, parentWall.end));

                  return (
                    <div className={styles.formField}>
                      <label className={styles.fieldLabel}>Duvar Başından Mesafe (cm)</label>
                      <input
                        type="number"
                        step="5"
                        value={selectedElectrical.offset ? Math.round(selectedElectrical.offset / 10) : ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const offCm = Number(e.target.value);
                          const safe = Math.max(0, Math.min(wallLen - 50, offCm * 10));
                          onUpdateRoom((prev) => ({
                            ...prev,
                            electrical: prev.electrical?.map((el) =>
                              el.id === selectedElectrical.id ? { ...el, offset: safe } : el
                            ),
                          }));
                        }}
                        className={styles.textInput}
                      />
                    </div>
                  );
                })()}

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Montaj Kotu / Yükseklik (cm)</label>
                  <input
                    type="number"
                    step="5"
                    value={selectedElectrical.elevation !== undefined ? Math.round((selectedElectrical.elevation || 0) / 10) : ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const elevCm = Number(e.target.value);
                      onUpdateRoom((prev) => ({
                        ...prev,
                        electrical: prev.electrical?.map((el) =>
                          el.id === selectedElectrical.id ? { ...el, elevation: elevCm * 10 } : el
                        ),
                      }));
                    }}
                    className={styles.textInput}
                  />
                  {/* Preset Kot Chips */}
                  <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                    {[
                      { label: "Priz (30cm)", val: 30 },
                      { label: "Tezgah (110cm)", val: 110 },
                      { label: "Pano (180cm)", val: 180 },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        className={styles.presetChip}
                        onClick={() => {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            electrical: prev.electrical?.map((el) =>
                              el.id === selectedElectrical.id ? { ...el, elevation: p.val * 10 } : el
                            ),
                          }));
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Elektrik Elemanını Sil</span>
                </button>
              </div>
            )}

            {/* Selected Radiator Inspector */}
            {(!selectedElementIds || selectedElementIds.length <= 1) && selectedRadiator && (
              <div>
                <div className={styles.sectionTitle}>Seçili Doğalgaz Peteği</div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Petek Genişliği (cm)</label>
                  <input
                    type="number"
                    step="10"
                    value={Math.round(selectedRadiator.width / 10) || ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const wCm = Number(e.target.value);
                      if (wCm > 0) {
                        onUpdateRoom((prev) => ({
                          ...prev,
                          radiators: prev.radiators?.map((rad) =>
                            rad.id === selectedRadiator.id ? { ...rad, width: wCm * 10 } : rad
                          ),
                        }));
                      }
                    }}
                    className={styles.textInput}
                  />
                  <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                    {[60, 80, 100, 120, 140, 160].map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={styles.presetChip}
                        onClick={() => {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            radiators: prev.radiators?.map((rad) =>
                              rad.id === selectedRadiator.id ? { ...rad, width: w * 10 } : rad
                            ),
                          }));
                        }}
                      >
                        {w} cm
                      </button>
                    ))}
                  </div>
                </div>

                {(() => {
                  const parentWall = room.walls.find((w) => w.id === selectedRadiator.wallId);
                  if (!parentWall) return null;
                  const wallLen = Math.round(getDistance(parentWall.start, parentWall.end));

                  return (
                    <div className={styles.formField}>
                      <label className={styles.fieldLabel}>Duvar Başından Mesafe (cm)</label>
                      <input
                        type="number"
                        step="5"
                        value={selectedRadiator.offset ? Math.round(selectedRadiator.offset / 10) : ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const offCm = Number(e.target.value);
                          const safe = Math.max(0, Math.min(wallLen - selectedRadiator.width - 50, offCm * 10));
                          onUpdateRoom((prev) => ({
                            ...prev,
                            radiators: prev.radiators?.map((rad) =>
                              rad.id === selectedRadiator.id ? { ...rad, offset: safe } : rad
                            ),
                          }));
                        }}
                        className={styles.textInput}
                      />
                      <button
                        type="button"
                        className={styles.presetChip}
                        style={{ width: "100%", justifyContent: "center", marginTop: "0.35rem" }}
                        onClick={() => {
                          const centered = Math.round((wallLen - selectedRadiator.width) / 2);
                          onUpdateRoom((prev) => ({
                            ...prev,
                            radiators: prev.radiators?.map((rad) =>
                              rad.id === selectedRadiator.id ? { ...rad, offset: Math.max(50, centered) } : rad
                            ),
                          }));
                        }}
                      >
                        Duvarın Ortasına Hizala
                      </button>
                    </div>
                  );
                })()}

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Yükseklik (cm)</label>
                  <input
                    type="number"
                    step="5"
                    value={Math.round(selectedRadiator.height / 10) || ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const hCm = Number(e.target.value);
                      if (hCm > 0) {
                        onUpdateRoom((prev) => ({
                          ...prev,
                          radiators: prev.radiators?.map((rad) =>
                            rad.id === selectedRadiator.id ? { ...rad, height: hCm * 10 } : rad
                          ),
                        }));
                      }
                    }}
                    className={styles.textInput}
                  />
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Peteği Sil</span>
                </button>
              </div>
            )}

            {/* Selected Lighting Fixture Inspector */}
            {(!selectedElementIds || selectedElementIds.length <= 1) && selectedLight && (
              <div>
                <div className={styles.sectionTitle}>Seçili Aydınlatma Armatürü</div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Armatür Tipi</label>
                  <select
                    value={selectedLight.type || "pendant"}
                    onChange={(e) => {
                      const t = e.target.value as any;
                      onUpdateRoom((prev) => ({
                        ...prev,
                        lighting: prev.lighting?.map((l) =>
                          l.id === selectedLight.id ? { ...l, type: t } : l
                        ),
                      }));
                    }}
                    className={styles.selectInput}
                  >
                    <option value="pendant">Sarkıt / Avize</option>
                    <option value="spot">Gömme Tavan Spotu</option>
                    <option value="ceiling">Tavan Plafonyeri</option>
                    <option value="track">Ray Spot Sistemi</option>
                  </select>
                </div>

                {/* Parametric Wall Distance Controls */}
                <div style={{ background: "rgba(251, 191, 36, 0.08)", border: "1px solid rgba(251, 191, 36, 0.2)", borderRadius: "8px", padding: "0.65rem", marginBottom: "0.85rem" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#fbbf24", marginBottom: "0.45rem", textTransform: "uppercase" }}>
                    4 Taraflı Duvar Mesafeleri (cm)
                  </div>

                  {(() => {
                    const dims4 = selectedLight && room.walls.length >= 3
                      ? calculateLightFourWayDimensions({ x: selectedLight.x, y: selectedLight.y }, room.walls)
                      : null;
                    if (!dims4) return null;
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem", marginBottom: "0.55rem" }}>
                        <div style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ color: "var(--textMuted)" }}>↑ Üst: </span>
                          <span style={{ fontWeight: "700", color: "#fef08a" }}>{dims4.up ? `${Math.round(dims4.up.distanceMm / 10)} cm` : "-"}</span>
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ color: "var(--textMuted)" }}>↓ Alt: </span>
                          <span style={{ fontWeight: "700", color: "#fef08a" }}>{dims4.down ? `${Math.round(dims4.down.distanceMm / 10)} cm` : "-"}</span>
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ color: "var(--textMuted)" }}>← Sol: </span>
                          <span style={{ fontWeight: "700", color: "#fef08a" }}>{dims4.left ? `${Math.round(dims4.left.distanceMm / 10)} cm` : "-"}</span>
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ color: "var(--textMuted)" }}>→ Sağ: </span>
                          <span style={{ fontWeight: "700", color: "#fef08a" }}>{dims4.right ? `${Math.round(dims4.right.distanceMm / 10)} cm` : "-"}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Ref Wall 1 */}
                  <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                    <label className={styles.fieldLabel}>1. Referans Duvar</label>
                    <select
                      value={selectedLight.refWallId1 || room.walls[0]?.id || ""}
                      onChange={(e) => {
                        const refId = e.target.value;
                        onUpdateRoom((prev) => ({
                          ...prev,
                          lighting: prev.lighting?.map((l) =>
                            l.id === selectedLight.id ? { ...l, refWallId1: refId } : l
                          ),
                        }));
                      }}
                      className={styles.selectInput}
                    >
                      {room.walls.map((w, idx) => (
                        <option key={w.id} value={w.id}>
                          Duvar {idx + 1} ({Math.round(getDistance(w.start, w.end) / 10)} cm)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                    <label className={styles.fieldLabel}>1. Duvara Mesafe (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={selectedLight.distWall1 ? Math.round(selectedLight.distWall1 / 10) : ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const distCm = Number(e.target.value);
                        const distMm = distCm * 10;
                        const ref1 = selectedLight.refWallId1 || room.walls[0]?.id;
                        const ref2 = selectedLight.refWallId2;
                        const dist2 = selectedLight.distWall2;
                        const newPos = calculateLightPositionFromWallDistances(room, ref1, distMm, ref2, dist2);

                        onUpdateRoom((prev) => ({
                          ...prev,
                          lighting: prev.lighting?.map((l) =>
                            l.id === selectedLight.id ? { ...l, distWall1: distMm, x: newPos.x, y: newPos.y } : l
                          ),
                        }));
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  {/* Ref Wall 2 */}
                  <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                    <label className={styles.fieldLabel}>2. Referans Duvar (Dik Duvar)</label>
                    <select
                      value={selectedLight.refWallId2 || room.walls[1]?.id || ""}
                      onChange={(e) => {
                        const refId = e.target.value;
                        onUpdateRoom((prev) => ({
                          ...prev,
                          lighting: prev.lighting?.map((l) =>
                            l.id === selectedLight.id ? { ...l, refWallId2: refId } : l
                          ),
                        }));
                      }}
                      className={styles.selectInput}
                    >
                      {room.walls.map((w, idx) => (
                        <option key={w.id} value={w.id}>
                          Duvar {idx + 1} ({Math.round(getDistance(w.start, w.end) / 10)} cm)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formField} style={{ marginBottom: "0.45rem" }}>
                    <label className={styles.fieldLabel}>2. Duvara Mesafe (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={selectedLight.distWall2 ? Math.round(selectedLight.distWall2 / 10) : ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const distCm = Number(e.target.value);
                        const distMm = distCm * 10;
                        const ref1 = selectedLight.refWallId1 || room.walls[0]?.id;
                        const ref2 = selectedLight.refWallId2 || room.walls[1]?.id;
                        const dist1 = selectedLight.distWall1 || 1000;
                        const newPos = calculateLightPositionFromWallDistances(room, ref1, dist1, ref2, distMm);

                        onUpdateRoom((prev) => ({
                          ...prev,
                          lighting: prev.lighting?.map((l) =>
                            l.id === selectedLight.id ? { ...l, distWall2: distMm, x: newPos.x, y: newPos.y } : l
                          ),
                        }));
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  {/* Center in Room Button */}
                  <button
                    type="button"
                    className={styles.presetChip}
                    style={{ width: "100%", justifyContent: "center", marginTop: "0.35rem", background: "rgba(251, 191, 36, 0.2)", borderColor: "#fbbf24", color: "#fbbf24" }}
                    onClick={() => {
                      const centroid = getRoomCentroid(room);
                      const wall1 = room.walls[0];
                      const wall2 = room.walls[1];
                      let d1 = 1500;
                      let d2 = 1500;
                      if (wall1) {
                        d1 = Math.round(Math.abs(centroid.y - wall1.start.y));
                      }
                      if (wall2) {
                        d2 = Math.round(Math.abs(centroid.x - wall2.start.x));
                      }

                      onUpdateRoom((prev) => ({
                        ...prev,
                        lighting: prev.lighting?.map((l) =>
                          l.id === selectedLight.id
                            ? { ...l, x: centroid.x, y: centroid.y, distWall1: d1, distWall2: d2 }
                            : l
                        ),
                      }));
                    }}
                  >
                    ◎ Odaya Tam Ortala
                  </button>
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Aydınlatmayı Sil</span>
                </button>
              </div>
            )}

            {/* Selected Beam Inspector */}
            {selectedBeam && (
              <div>
                <div className={styles.sectionTitle}>
                  Kiriş Özellikleri ({selectedBeam.name || "Kiriş"})
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Kiriş Tanımı / Kodu</label>
                  <input
                    type="text"
                    value={selectedBeam.name || ""}
                    onChange={(e) =>
                      onUpdateRoom((prev) => ({
                        ...prev,
                        beams: prev.beams?.map((b) =>
                          b.id === selectedBeam.id ? { ...b, name: e.target.value } : b
                        ),
                      }))
                    }
                    className={styles.textInput}
                    placeholder="Örn: K101"
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Doğrultu (Yön)</label>
                  <div className={styles.optionRadioGroup}>
                    <label
                      className={`${styles.optionRadioLabel} ${
                        selectedBeam.orientation === "horizontal" ? styles.optionRadioActive : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="beamOrientation"
                        value="horizontal"
                        checked={selectedBeam.orientation === "horizontal"}
                        onChange={() =>
                          onUpdateRoom((prev) => ({
                            ...prev,
                            beams: prev.beams?.map((b) =>
                              b.id === selectedBeam.id ? { ...b, orientation: "horizontal" } : b
                            ),
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span>↔ Yatay (X)</span>
                    </label>

                    <label
                      className={`${styles.optionRadioLabel} ${
                        selectedBeam.orientation === "vertical" ? styles.optionRadioActive : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="beamOrientation"
                        value="vertical"
                        checked={selectedBeam.orientation === "vertical"}
                        onChange={() =>
                          onUpdateRoom((prev) => ({
                            ...prev,
                            beams: prev.beams?.map((b) =>
                              b.id === selectedBeam.id ? { ...b, orientation: "vertical" } : b
                            ),
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span>↕ Dikey (Y)</span>
                    </label>
                  </div>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Hizalama (Referans Hattı)</label>
                  <div className={styles.optionRadioGroup}>
                    {(["interior", "center", "exterior"] as const).map((align) => (
                      <label
                        key={align}
                        className={`${styles.optionRadioLabel} ${
                          (selectedBeam.alignment || "center") === align ? styles.optionRadioActive : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name="beamAlignment"
                          value={align}
                          checked={(selectedBeam.alignment || "center") === align}
                          onChange={() =>
                            onUpdateRoom((prev) => ({
                              ...prev,
                              beams: prev.beams?.map((b) =>
                                b.id === selectedBeam.id ? { ...b, alignment: align } : b
                              ),
                            }))
                          }
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <span>{align === "interior" ? "İç Hat" : align === "center" ? "Aks (Orta)" : "Dış Hat"}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Genişlik / Kalınlık (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(selectedBeam.width / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            beams: prev.beams?.map((b) =>
                              b.id === selectedBeam.id ? { ...b, width: val * 10 } : b
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Sarkma Derinliği (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(selectedBeam.depth / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            beams: prev.beams?.map((b) =>
                              b.id === selectedBeam.id ? { ...b, depth: val * 10 } : b
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>
                </div>

                <div className={styles.subCard}>
                  <div className={styles.subCardTitle}>Çevre Duvarlara Canlı Mesafeler</div>
                  <span style={{ fontSize: "0.75rem", color: "var(--textMuted)", display: "block", marginBottom: "0.5rem" }}>
                    2D planda kirişin 4 tarafındaki ölçü etiketlerine (cm ✎) tıklayarak veya aşağıdaki hızlı butonlarla kirişi doğrudan bir duvara bitişik yerleştirebilirsiniz.
                  </span>

                  {/* Quick Snap-to-Wall Buttons */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginTop: "0.4rem" }}>
                    {selectedBeam.orientation === "horizontal" ? (
                      <>
                        <button
                          type="button"
                          className={styles.presetChip}
                          style={{ justifyContent: "center" }}
                          onClick={() => {
                            const geo = computeBeamGeometry(selectedBeam, room.walls);
                            if (geo.dimensions.up) {
                              const hitY = geo.dimensions.up.point.y;
                              const w = selectedBeam.width || 250;
                              let newY = hitY - w / 2;
                              if (selectedBeam.alignment === "interior") newY = hitY - w;
                              else if (selectedBeam.alignment === "exterior") newY = hitY;
                              onUpdateRoom((prev) => ({
                                ...prev,
                                beams: prev.beams?.map((b) =>
                                  b.id === selectedBeam.id ? { ...b, y: Math.round(newY) } : b
                                ),
                              }));
                            }
                          }}
                        >
                          ↑ Üst Duvara Bitiştir (0 cm)
                        </button>
                        <button
                          type="button"
                          className={styles.presetChip}
                          style={{ justifyContent: "center" }}
                          onClick={() => {
                            const geo = computeBeamGeometry(selectedBeam, room.walls);
                            if (geo.dimensions.down) {
                              const hitY = geo.dimensions.down.point.y;
                              const w = selectedBeam.width || 250;
                              let newY = hitY + w / 2;
                              if (selectedBeam.alignment === "interior") newY = hitY;
                              else if (selectedBeam.alignment === "exterior") newY = hitY + w;
                              onUpdateRoom((prev) => ({
                                ...prev,
                                beams: prev.beams?.map((b) =>
                                  b.id === selectedBeam.id ? { ...b, y: Math.round(newY) } : b
                                ),
                              }));
                            }
                          }}
                        >
                          ↓ Alt Duvara Bitiştir (0 cm)
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={styles.presetChip}
                          style={{ justifyContent: "center" }}
                          onClick={() => {
                            const geo = computeBeamGeometry(selectedBeam, room.walls);
                            if (geo.dimensions.left) {
                              const hitX = geo.dimensions.left.point.x;
                              const w = selectedBeam.width || 250;
                              let newX = hitX + w / 2;
                              if (selectedBeam.alignment === "interior") newX = hitX;
                              else if (selectedBeam.alignment === "exterior") newX = hitX + w;
                              onUpdateRoom((prev) => ({
                                ...prev,
                                beams: prev.beams?.map((b) =>
                                  b.id === selectedBeam.id ? { ...b, x: Math.round(newX) } : b
                                ),
                              }));
                            }
                          }}
                        >
                          ← Sol Duvara Bitiştir (0 cm)
                        </button>
                        <button
                          type="button"
                          className={styles.presetChip}
                          style={{ justifyContent: "center" }}
                          onClick={() => {
                            const geo = computeBeamGeometry(selectedBeam, room.walls);
                            if (geo.dimensions.right) {
                              const hitX = geo.dimensions.right.point.x;
                              const w = selectedBeam.width || 250;
                              let newX = hitX - w / 2;
                              if (selectedBeam.alignment === "interior") newX = hitX - w;
                              else if (selectedBeam.alignment === "exterior") newX = hitX;
                              onUpdateRoom((prev) => ({
                                ...prev,
                                beams: prev.beams?.map((b) =>
                                  b.id === selectedBeam.id ? { ...b, x: Math.round(newX) } : b
                                ),
                              }));
                            }
                          }}
                        >
                          → Sağ Duvara Bitiştir (0 cm)
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Kirişi Sil</span>
                </button>
              </div>
            )}

            {/* Selected Chimney Element Card */}
            {selectedChimney && (
              <div className={styles.inspectorCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <span style={{ color: "#ea580c" }}>🔥</span>
                    <span>{selectedChimney.name || "BACA"}</span>
                  </div>
                  <span className={styles.elementTag}>Baca</span>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Baca Kodu / Tanımı</label>
                  <input
                    type="text"
                    value={selectedChimney.name || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateRoom((prev) => ({
                        ...prev,
                        chimneys: prev.chimneys?.map((c) =>
                          c.id === selectedChimney.id ? { ...c, name: val } : c
                        ),
                      }));
                    }}
                    className={styles.textInput}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Genişlik (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(selectedChimney.width / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            chimneys: prev.chimneys?.map((c) =>
                              c.id === selectedChimney.id ? { ...c, width: val * 10 } : c
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Derinlik (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(selectedChimney.depth / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            chimneys: prev.chimneys?.map((c) =>
                              c.id === selectedChimney.id ? { ...c, depth: val * 10 } : c
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>İç Duman Kanalı Çapı (cm)</label>
                  <input
                    type="number"
                    step="2"
                    value={Math.round((selectedChimney.flueDiameter || 180) / 10) || ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > 0) {
                        onUpdateRoom((prev) => ({
                          ...prev,
                          chimneys: prev.chimneys?.map((c) =>
                            c.id === selectedChimney.id ? { ...c, flueDiameter: val * 10 } : c
                          ),
                        }));
                      }
                    }}
                    className={styles.textInput}
                  />
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Bacayı Sil</span>
                </button>
              </div>
            )}

            {/* Selected AC Unit Element Card */}
            {selectedAC && (
              <div className={styles.inspectorCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <span style={{ color: "#06b6d4" }}>❄️</span>
                    <span>{selectedAC.name || "KLİMA"}</span>
                  </div>
                  <span className={styles.elementTag}>Klima</span>
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Klima Tipi</label>
                  <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.2rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer", fontSize: "0.82rem" }}>
                      <input
                        type="radio"
                        name="acType"
                        value="split_wall"
                        checked={selectedAC.type === "split_wall"}
                        onChange={() =>
                          onUpdateRoom((prev) => ({
                            ...prev,
                            acUnits: prev.acUnits?.map((ac) =>
                              ac.id === selectedAC.id ? { ...ac, type: "split_wall" } : ac
                            ),
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span>Duvar Tipi Split</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer", fontSize: "0.82rem" }}>
                      <input
                        type="radio"
                        name="acType"
                        value="ceiling_cassette"
                        checked={selectedAC.type === "ceiling_cassette"}
                        onChange={() =>
                          onUpdateRoom((prev) => ({
                            ...prev,
                            acUnits: prev.acUnits?.map((ac) =>
                              ac.id === selectedAC.id ? { ...ac, type: "ceiling_cassette" } : ac
                            ),
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span>Kaset Tipi Tavan</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Duvar Başı (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round((selectedAC.offset || 0) / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onUpdateRoom((prev) => ({
                          ...prev,
                          acUnits: prev.acUnits?.map((ac) =>
                            ac.id === selectedAC.id ? { ...ac, offset: val * 10 } : ac
                          ),
                        }));
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Montaj Kotu (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round((selectedAC.elevation || 2400) / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onUpdateRoom((prev) => ({
                          ...prev,
                          acUnits: prev.acUnits?.map((ac) =>
                            ac.id === selectedAC.id ? { ...ac, elevation: val * 10 } : ac
                          ),
                        }));
                      }}
                      className={styles.textInput}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Genişlik (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={Math.round(selectedAC.width / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            acUnits: prev.acUnits?.map((ac) =>
                              ac.id === selectedAC.id ? { ...ac, width: val * 10 } : ac
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Derinlik (cm)</label>
                    <input
                      type="number"
                      step="2"
                      value={Math.round(selectedAC.depth / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 0) {
                          onUpdateRoom((prev) => ({
                            ...prev,
                            acUnits: prev.acUnits?.map((ac) =>
                              ac.id === selectedAC.id ? { ...ac, depth: val * 10 } : ac
                            ),
                          }));
                        }
                      }}
                      className={styles.textInput}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.fieldLabel}>Kapasite (BTU)</label>
                    <select
                      value={selectedAC.capacityBtu || 12000}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onUpdateRoom((prev) => ({
                          ...prev,
                          acUnits: prev.acUnits?.map((ac) =>
                            ac.id === selectedAC.id ? { ...ac, capacityBtu: val } : ac
                          ),
                        }));
                      }}
                      className={styles.selectInput}
                    >
                      <option value={9000}>9.000 BTU</option>
                      <option value={12000}>12.000 BTU</option>
                      <option value={18000}>18.000 BTU</option>
                      <option value={24000}>24.000 BTU</option>
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.deleteItemBtn}
                  onClick={handleDeleteSelected}
                >
                  <MdDeleteOutline size={16} />
                  <span>Klimayı Sil</span>
                </button>
              </div>
            )}

            {/* Nothing Selected -> Room General Info */}
            {!selectedWall && !selectedDoor && !selectedWindow && !selectedElectrical && !selectedRadiator && !selectedLight && !selectedBeam && !selectedChimney && !selectedAC && (
              <div>
                <div className={styles.sectionTitle}>Oda Genel Bilgileri</div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Oda İsmi</label>
                  <input
                    type="text"
                    value={room.name}
                    onChange={(e) =>
                      onUpdateRoom((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className={styles.textInput}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Tüm Duvar Yükseklikleri (cm)</label>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="number"
                      step="10"
                      value={Math.round((room.walls[0]?.height || 2800) / 10) || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const newHCm = Number(e.target.value);
                        if (newHCm > 0) {
                          const newH = newHCm * 10;
                          if (onUpdateAllWallHeights) {
                            onUpdateAllWallHeights(newH);
                          } else {
                            onUpdateRoom((prev) => ({
                              ...prev,
                              walls: prev.walls.map((w) => ({ ...w, height: newH })),
                              ceiling: prev.ceiling ? { ...prev.ceiling, elevation: newH } : prev.ceiling,
                            }));
                          }
                        }
                      }}
                      className={styles.textInput}
                    />
                    <span style={{ fontSize: "0.85rem", color: "var(--textMuted)", fontWeight: 600 }}>cm</span>
                  </div>
                  {/* Quick Height Preset Buttons */}
                  <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.45rem" }}>
                    {[260, 280, 300, 320].map((presetHCm) => (
                      <button
                        key={presetHCm}
                        type="button"
                        onClick={() => {
                          const presetH = presetHCm * 10;
                          if (onUpdateAllWallHeights) {
                            onUpdateAllWallHeights(presetH);
                          } else {
                            onUpdateRoom((prev) => ({
                              ...prev,
                              walls: prev.walls.map((w) => ({ ...w, height: presetH })),
                              ceiling: prev.ceiling ? { ...prev.ceiling, elevation: presetH } : prev.ceiling,
                            }));
                          }
                        }}
                        style={{
                          padding: "0.25rem 0.55rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background:
                            Math.round((room.walls[0]?.height || 2800) / 10) === presetHCm
                              ? "rgba(41, 245, 126, 0.2)"
                              : "rgba(255, 255, 255, 0.05)",
                          color:
                            Math.round((room.walls[0]?.height || 2800) / 10) === presetHCm
                              ? "var(--accent)"
                              : "var(--textMuted)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        {presetHCm} cm
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "var(--textMuted)", marginTop: "0.3rem", display: "block" }}>
                    Odadaki tüm duvarların ve tavanın yüksekliğini tek seferde günceller.
                  </span>
                </div>

                {/* Flooring Type Radio Buttons (Laminant vs Seramik) */}
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Zemin Kaplama Tipi</label>
                  <div className={styles.optionRadioGroup}>
                    <label
                      className={`${styles.optionRadioLabel} ${
                        (room.flooringType || "laminate") === "laminate" ? styles.optionRadioActive : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="studioFlooringType"
                        value="laminate"
                        checked={(room.flooringType || "laminate") === "laminate"}
                        onChange={() =>
                          onUpdateRoom((prev) => ({
                            ...prev,
                            flooringType: "laminate",
                            slab: prev.slab ? { ...prev.slab, material: "hardwood" } : prev.slab,
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span>Laminant Parke</span>
                    </label>

                    <label
                      className={`${styles.optionRadioLabel} ${
                        room.flooringType === "ceramic" ? styles.optionRadioActive : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="studioFlooringType"
                        value="ceramic"
                        checked={room.flooringType === "ceramic"}
                        onChange={() =>
                          onUpdateRoom((prev) => ({
                            ...prev,
                            flooringType: "ceramic",
                            slab: prev.slab ? { ...prev.slab, material: "ceramic_tile" } : prev.slab,
                          }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span>Seramik / Fayans</span>
                    </label>
                  </div>
                </div>

                {/* Ceiling Type Checkbox (Alçıpan Asma Tavan) */}
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Asma Tavan Durumu</label>
                  <label
                    className={`${styles.checkboxLabel} ${
                      room.hasDrywallCeiling ? styles.checkboxActive : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(room.hasDrywallCeiling)}
                      onChange={(e) =>
                        onUpdateRoom((prev) => ({
                          ...prev,
                          hasDrywallCeiling: e.target.checked,
                          ceiling: prev.ceiling
                            ? { ...prev.ceiling, visibleIn3d: e.target.checked }
                            : prev.ceiling,
                        }))
                      }
                      style={{ accentColor: "var(--accent)", width: "16px", height: "16px" }}
                    />
                    <span>Alçıpan Asma Tavan Yapılacak</span>
                  </label>
                </div>

                {/* Live BOQ Takeoff Card (Metraj ve Hakediş Tablosu) */}
                {(() => {
                  const takeoff = calculateRoomTakeoff(room);
                  return (
                    <div className={styles.formField}>
                      <div className={styles.fieldLabel} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Metraj & Hakediş Özeti</span>
                        <span style={{ fontSize: "0.7rem", color: "var(--accent)", fontWeight: 700 }}>CANLI HESAP</span>
                      </div>

                      <div className={styles.takeoffCard}>
                        {/* Net Wall Area */}
                        <div className={styles.takeoffRow}>
                          <div className={styles.takeoffLabel}>
                            <span style={{ color: "#ffffff", fontWeight: 600 }}>Net Duvar Alanı</span>
                            <span className={styles.takeoffSub}>
                              Brüt: {takeoff.grossWallAreaM2} m² | Boşluk: -{takeoff.openingsAreaM2} m²
                            </span>
                          </div>
                          <span className={styles.takeoffValue} style={{ color: "#38bdf8" }}>
                            {takeoff.netWallAreaM2} m²
                          </span>
                        </div>

                        {/* Skirting Length */}
                        <div className={styles.takeoffRow} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "0.45rem" }}>
                          <div className={styles.takeoffLabel}>
                            <span style={{ color: "#ffffff", fontWeight: 600 }}>Süpürgelik Metresi</span>
                            <span className={styles.takeoffSub}>
                              Çevre: {takeoff.grossPerimeterM} m | Kapı: -{takeoff.doorDeductionM} m
                            </span>
                          </div>
                          <span className={styles.takeoffValue} style={{ color: "#facc15" }}>
                            {takeoff.skirtingLengthM} m
                          </span>
                        </div>

                        {/* Floor Area */}
                        <div className={styles.takeoffRow} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "0.45rem" }}>
                          <div className={styles.takeoffLabel}>
                            <span style={{ color: "#ffffff", fontWeight: 600 }}>Net Zemin Alanı</span>
                            <span className={styles.takeoffSub}>
                              {takeoff.flooringType === "ceramic" ? "Seramik / Fayans" : "Laminant Parke"}
                            </span>
                          </div>
                          <span className={styles.takeoffValue} style={{ color: "var(--accent)" }}>
                            {takeoff.floorAreaM2} m²
                          </span>
                        </div>

                        {/* Ceiling Area */}
                        <div className={styles.takeoffRow} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "0.45rem" }}>
                          <div className={styles.takeoffLabel}>
                            <span style={{ color: "#ffffff", fontWeight: 600 }}>Tavan Alanı</span>
                            <span className={styles.takeoffSub}>
                              {takeoff.hasDrywallCeiling ? "Alçıpan Asma Tavanlı" : "Düz Sıva Tavan"}
                            </span>
                          </div>
                          <span className={styles.takeoffValue} style={{ color: "#c084fc" }}>
                            {takeoff.ceilingAreaM2} m²
                          </span>
                        </div>

                        {/* Structural Beams */}
                        {(takeoff.beamCount || 0) > 0 && (
                          <div className={styles.takeoffRow} style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "0.45rem" }}>
                            <div className={styles.takeoffLabel}>
                              <span style={{ color: "#ffffff", fontWeight: 600 }}>Kirişler ({takeoff.beamCount} adet)</span>
                              <span className={styles.takeoffSub}>
                                Toplam Boy: {takeoff.totalBeamLengthM} m
                              </span>
                            </div>
                            <span className={styles.takeoffValue} style={{ color: "#94a3b8" }}>
                              {takeoff.totalBeamVolumeM3} m³
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
