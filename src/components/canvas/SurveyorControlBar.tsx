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
  onOpenAddElectricalModal?: () => void;
  onOpenAddRadiatorModal?: () => void;
  onOpenAddLightModal?: () => void;
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
  onOpenAddElectricalModal,
  onOpenAddRadiatorModal,
  onOpenAddLightModal,
  onReopenPerimeter,
  isNearOrigin = false,
  onFlipLastWall,
}: SurveyorControlBarProps) {
  const [selectedDir, setSelectedDir] = useState<Direction>("right");
  const [wallLength, setWallLength] = useState<number>(300);
  const [wallAlignment, setWallAlignment] = useState<"interior" | "center" | "exterior">("interior");

  const canClose = !room.isClosed && room.walls.length >= 2;
  const canUndo = room.walls.length > 0;

  const handleDraw = () => {
    if (wallLength <= 0) return;
    onAddWall(selectedDir, wallLength * 10, wallAlignment);
  };

  const addPreset = (increment: number) => {
    setWallLength((prev) => Math.max(10, prev + increment));
  };

  // If Room is Already Closed -> Display Openings (Doors & Windows) mode
  if (room.isClosed) {
    return (
      <div className={styles.barContainer}>
        <div className={styles.closedBar}>
          <div className={styles.closedInfo}>
            <span className={styles.closedBadge}>Oda Tamamlandı</span>
            <span className={styles.closedArea}>{room.calculatedArea.toFixed(1)} m²</span>
            <span style={{ fontSize: "0.8rem", color: "var(--textMuted)" }}>
              ({room.walls.length} Duvar • {room.doors.length} Kapı • {room.windows.length} Pencere)
            </span>
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

  // Active Drafting Mode: D-Pad + Distance Bar
  return (
    <div className={styles.barContainer}>
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
                min="10"
                step="5"
                value={wallLength}
                onChange={(e) => setWallLength(Math.max(0, Number(e.target.value) || 0))}
                className={styles.mmInput}
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

          <div style={{ display: "flex", gap: "0.35rem" }}>
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
    </div>
  );
}
