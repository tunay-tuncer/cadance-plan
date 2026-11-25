"use client";

import React, { useState } from "react";
import type { RoomPlanItem } from "@/types/plan";
import {
  MdArrowUpward,
  MdArrowForward,
  MdArrowDownward,
  MdArrowBack,
  MdUndo,
  MdCheckCircle,
  MdMeetingRoom,
  MdWindow,
  MdEdit,
  MdSwapHoriz,
  MdPower,
  MdWhatshot,
  MdLightbulb,
  MdArchitecture,
  MdLocalFireDepartment,
  MdAcUnit,
  MdAdd,
  MdClose,
  MdExpandMore,
  MdExpandLess,
} from "react-icons/md";
import styles from "./SurveyorControlBar.module.css";

export type Direction = "up" | "right" | "down" | "left";

interface SurveyorControlBarProps {
  room: RoomPlanItem;
  onAddWall: (direction: Direction, lengthMm: number, alignment: "interior" | "center" | "exterior") => void;
  onUndoWall: () => void;
  onCloseRoom: () => void;
  onOpenAddDoorModal: () => void;
  onOpenAddWindowModal: () => void;
  onOpenAddBeamModal?: () => void;
  onOpenAddElectricalModal?: () => void;
  onOpenAddRadiatorModal?: () => void;
  onOpenAddLightModal?: () => void;
  onOpenAddChimneyModal?: () => void;
  onOpenAddACModal?: () => void;
  onReopenPerimeter: () => void;
  isNearOrigin?: boolean;
  onFlipLastWall?: () => void;
}

export default function SurveyorControlBar({
  room,
  onAddWall,
  onUndoWall,
  onCloseRoom,
  onOpenAddDoorModal,
  onOpenAddWindowModal,
  onOpenAddBeamModal,
  onOpenAddElectricalModal,
  onOpenAddRadiatorModal,
  onOpenAddLightModal,
  onOpenAddChimneyModal,
  onOpenAddACModal,
  onReopenPerimeter,
  isNearOrigin = false,
  onFlipLastWall,
}: SurveyorControlBarProps) {
  const [selectedDir, setSelectedDir] = useState<Direction>("right");
  const [wallLength, setWallLength] = useState<number>(300);
  const [wallAlignment, setWallAlignment] = useState<"interior" | "center" | "exterior">("interior");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAddTrayOpen, setIsAddTrayOpen] = useState(false);

  const canClose = !room.isClosed && room.walls.length >= 2;
  const canUndo = room.walls.length > 0;

  const handleDraw = () => {
    if (wallLength <= 0) return;
    onAddWall(selectedDir, wallLength * 10, wallAlignment);
  };

  const addPreset = (increment: number) => {
    setWallLength((prev) => Math.max(10, prev + increment));
  };

  const triggerElementAction = (fn?: () => void) => {
    setIsAddTrayOpen(false);
    fn?.();
  };

  // If Room is Already Closed -> Display Openings (Doors & Windows) mode
  if (room.isClosed) {
    return (
      <div className={styles.barContainer} data-surveyor-bar="true">
        {/* Mobile Expandable Element Picker Tray */}
        {isAddTrayOpen && (
          <div className={styles.mobileAddTray}>
            <div className={styles.mobileAddTrayHeader}>
              <span>Odaya Eleman Ekle</span>
              <button
                type="button"
                className={styles.trayCloseBtn}
                onClick={() => setIsAddTrayOpen(false)}
                aria-label="Kapat"
              >
                <MdClose size={18} />
              </button>
            </div>
            <div className={styles.mobileAddGrid}>
              <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddDoorModal)}>
                <MdMeetingRoom size={18} color="#facc15" />
                <span>Kapı</span>
              </button>
              <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddWindowModal)}>
                <MdWindow size={18} color="#38bdf8" />
                <span>Pencere</span>
              </button>
              {onOpenAddBeamModal && (
                <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddBeamModal)}>
                  <MdArchitecture size={18} color="#c084fc" />
                  <span>Kiriş</span>
                </button>
              )}
              {onOpenAddElectricalModal && (
                <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddElectricalModal)}>
                  <MdPower size={18} color="#4ade80" />
                  <span>Elektrik</span>
                </button>
              )}
              {onOpenAddRadiatorModal && (
                <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddRadiatorModal)}>
                  <MdWhatshot size={18} color="#f87171" />
                  <span>Petek</span>
                </button>
              )}
              {onOpenAddLightModal && (
                <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddLightModal)}>
                  <MdLightbulb size={18} color="#fbbf24" />
                  <span>Aydınlatma</span>
                </button>
              )}
              {onOpenAddChimneyModal && (
                <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddChimneyModal)}>
                  <MdLocalFireDepartment size={18} color="#ea580c" />
                  <span>Baca</span>
                </button>
              )}
              {onOpenAddACModal && (
                <button type="button" className={styles.actionBtnSecondary} onClick={() => triggerElementAction(onOpenAddACModal)}>
                  <MdAcUnit size={18} color="#06b6d4" />
                  <span>Klima</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className={styles.closedBar}>
          <div className={styles.closedInfo}>
            <span className={styles.closedBadge}>Tamamlandı</span>
            <span className={styles.closedArea}>{room.calculatedArea.toFixed(1)} m²</span>
            <span className={styles.closedStatsText}>
              ({room.walls.length} Duvar • {room.doors.length} Kapı • {room.windows.length} Pencere)
            </span>
          </div>

          {/* Mobile Compact Closed-Room Dock (replaces 3x3 permanent grid) */}
          <div className={styles.mobileClosedDock}>
            <button
              type="button"
              className={`${styles.mobileAddTriggerBtn} ${isAddTrayOpen ? styles.mobileAddTriggerActive : ""}`}
              onClick={() => setIsAddTrayOpen((prev) => !prev)}
            >
              {isAddTrayOpen ? <MdClose size={18} /> : <MdAdd size={18} />}
              <span>{isAddTrayOpen ? "Kapat" : "Eleman Ekle"}</span>
            </button>

            <button
              type="button"
              className={styles.mobileEditPerimeterBtn}
              onClick={onReopenPerimeter}
              title="Duvar eklemeye devam et"
            >
              <MdEdit size={16} />
              <span>Duvarlar</span>
            </button>
          </div>

          <div className={styles.closedActions}>
            <button
              type="button"
              className={styles.actionBtnSecondary}
              onClick={onOpenAddDoorModal}
            >
              <MdMeetingRoom size={16} color="#facc15" />
              <span>+ Kapı</span>
            </button>

            <button
              type="button"
              className={styles.actionBtnSecondary}
              onClick={onOpenAddWindowModal}
            >
              <MdWindow size={16} color="#38bdf8" />
              <span>+ Pencere</span>
            </button>

            {onOpenAddBeamModal && (
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={onOpenAddBeamModal}
                title="Yatay veya dikey taşıyıcı kiriş ekle"
              >
                <MdArchitecture size={16} color="#c084fc" />
                <span>+ Kiriş</span>
              </button>
            )}

            {onOpenAddElectricalModal && (
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={onOpenAddElectricalModal}
              >
                <MdPower size={16} color="#4ade80" />
                <span>+ Elektrik</span>
              </button>
            )}

            {onOpenAddRadiatorModal && (
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={onOpenAddRadiatorModal}
              >
                <MdWhatshot size={16} color="#f87171" />
                <span>+ Petek</span>
              </button>
            )}

            {onOpenAddLightModal && (
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={onOpenAddLightModal}
              >
                <MdLightbulb size={16} color="#fbbf24" />
                <span>+ Aydınlatma</span>
              </button>
            )}

            {onOpenAddChimneyModal && (
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={onOpenAddChimneyModal}
                title="Şömine / Havalandırma Bacası Ekle"
              >
                <MdLocalFireDepartment size={16} color="#ea580c" />
                <span>+ Baca</span>
              </button>
            )}

            {onOpenAddACModal && (
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={onOpenAddACModal}
                title="Klima Ünitesi Ekle"
              >
                <MdAcUnit size={16} color="#06b6d4" />
                <span>+ Klima</span>
              </button>
            )}

            <button
              type="button"
              className={styles.actionBtnSecondary}
              onClick={onReopenPerimeter}
              title="Duvar eklemeye devam et"
            >
              <MdEdit size={15} />
              <span>Düzenle</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Drafting Mode: D-Pad + Distance Bar (Collapsible on Phone)
  return (
    <div
      className={`${styles.barContainer} ${isCollapsed ? styles.barContainerCollapsed : ""}`}
      data-surveyor-bar="true"
    >
      {/* Mobile Collapse/Expand Handle */}
      <button
        type="button"
        className={styles.mobileCollapseHandle}
        onClick={() => setIsCollapsed((prev) => !prev)}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? "Çizim çubuğunu aç" : "Çizim çubuğunu gizle"}
      >
        <span className={styles.collapseSummary}>
          {isCollapsed ? `Çizim Çubuğu (${wallLength} cm)` : "Çizim Kontrolleri"}
        </span>
        {isCollapsed ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
      </button>

      {!isCollapsed && (
      <div className={styles.draftingRow}>
        {/* D-Pad Direction Arrows */}
        <div className={styles.dpadArea}>
          {/* UP Arrow */}
          <button
            type="button"
            className={`${styles.arrowBtn} ${selectedDir === "up" ? styles.arrowBtnActive : ""}`}
            style={{ gridColumn: 2, gridRow: 1 }}
            onClick={() => setSelectedDir("up")}
            aria-label="Yukarı Yön"
          >
            <MdArrowUpward size={20} />
          </button>

          {/* LEFT Arrow */}
          <button
            type="button"
            className={`${styles.arrowBtn} ${selectedDir === "left" ? styles.arrowBtnActive : ""}`}
            style={{ gridColumn: 1, gridRow: 2 }}
            onClick={() => setSelectedDir("left")}
            aria-label="Sol Yön"
          >
            <MdArrowBack size={20} />
          </button>

          {/* Center Indicator */}
          <div className={styles.dpadCenter}>
            CAD
          </div>

          {/* RIGHT Arrow */}
          <button
            type="button"
            className={`${styles.arrowBtn} ${selectedDir === "right" ? styles.arrowBtnActive : ""}`}
            style={{ gridColumn: 3, gridRow: 2 }}
            onClick={() => setSelectedDir("right")}
            aria-label="Sağ Yön"
          >
            <MdArrowForward size={20} />
          </button>

          {/* DOWN Arrow */}
          <button
            type="button"
            className={`${styles.arrowBtn} ${selectedDir === "down" ? styles.arrowBtnActive : ""}`}
            style={{ gridColumn: 2, gridRow: 3 }}
            onClick={() => setSelectedDir("down")}
            aria-label="Aşağı Yön"
          >
            <MdArrowDownward size={20} />
          </button>
        </div>

        {/* Center: Distance Number Input & Increment Presets */}
        <div className={styles.dimensionControl}>
          <div className={styles.inputRow}>
            {/* Wall Alignment Mode: Interior (Default) vs Centerline vs Exterior */}
            <div className={styles.alignmentToggle}>
              <button
                type="button"
                className={`${styles.alignBtn} ${wallAlignment === "interior" ? styles.alignBtnActive : ""}`}
                onClick={() => setWallAlignment("interior")}
                title="İç Hat: Lazer ölçüm tam oda içini verir, duvar dışa doğru kalınlaşır"
              >
                İç Hat
              </button>
              <button
                type="button"
                className={`${styles.alignBtn} ${wallAlignment === "center" ? styles.alignBtnActive : ""}`}
                onClick={() => setWallAlignment("center")}
                title="Aks / Orta: Duvar kalınlığı çizgiye ortalanır"
              >
                Aks
              </button>
              <button
                type="button"
                className={`${styles.alignBtn} ${wallAlignment === "exterior" ? styles.alignBtnActive : ""}`}
                onClick={() => setWallAlignment("exterior")}
                title="Dış Hat: Duvar kalınlığı içe doğru genişler"
              >
                Dış
              </button>
            </div>

            <div className={styles.mmInputWrapper}>
              <input
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="5"
                value={wallLength || ""}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleDraw();
                  }
                }}
                onChange={(e) => setWallLength(e.target.value === "" ? 0 : Number(e.target.value))}
                className={styles.mmInput}
                aria-label="Duvar uzunluğu (cm)"
              />
              <span className={styles.unitSuffix}>cm</span>
            </div>
          </div>

          {/* Quick Increment Preset Chips (in cm) */}
          <div className={styles.presetsRow}>
            <button type="button" className={styles.presetBtn} onClick={() => addPreset(10)}>
              +10
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => addPreset(50)}>
              +50
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => addPreset(100)}>
              +1m
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => addPreset(-50)}>
              -50
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => setWallLength(250)}>
              2.5m
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => setWallLength(350)}>
              3.5m
            </button>
          </div>
        </div>

        {/* Right Action Column */}
        <div className={styles.actionColumn}>
          <button
            type="button"
            className={styles.drawWallBtn}
            onClick={handleDraw}
          >
            <span>Duvarı Çiz</span>
          </button>

          <div className={styles.actionSubRow}>
            {canUndo && onFlipLastWall && (
              <button
                type="button"
                className={styles.undoBtn}
                onClick={onFlipLastWall}
                title="Son duvarın kalınlık yönünü ters çevir (Boşluk Tuşu)"
              >
                <MdSwapHoriz size={16} />
                <span>⇄ Yön</span>
              </button>
            )}

            {canUndo && (
              <button
                type="button"
                className={styles.undoBtn}
                onClick={onUndoWall}
                title="Son duvarı geri al"
              >
                <MdUndo size={16} />
                <span>Geri</span>
              </button>
            )}

            {canClose && (
              <button
                type="button"
                className={`${styles.closeRoomBtn} ${isNearOrigin ? styles.closeRoomBtnPulse : ""}`}
                onClick={onCloseRoom}
                title="Başlangıç noktasına bağlayarak odayı kapat"
              >
                <MdCheckCircle size={15} />
                <span>Odayı Kapat</span>
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
