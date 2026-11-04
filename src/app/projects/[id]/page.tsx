"use client";

import React, { useEffect, useState, use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  ProjectItem,
  subscribeToUserProject,
} from "@/lib/firebase/projectService";
import {
  subscribeToProjectRooms,
  addRoomToProject,
  deleteRoomFromProject,
  updateRoomPlanInProject,
} from "@/lib/firebase/roomService";
import type { RoomPlanItem, RoomType } from "@/types/plan";
import { calculateRoomTakeoff } from "@/lib/cad/geometry";
import {
  MdChevronRight,
  MdAdd,
  MdLayers,
  MdStraighten,
  MdSquareFoot,
  MdMeetingRoom,
  MdDoorSliding,
  MdDeleteOutline,
  MdLockOutline,
  MdClose,
  MdHome,
  MdReceiptLong,
  MdFormatPaint,
} from "react-icons/md";
import { FaChevronLeft } from "react-icons/fa";
import styles from "./projectDetail.module.css";

interface PageProps {
  params: Promise<{ id: string }>;
}

const ROOM_PRESETS: { name: string; type: RoomType }[] = [
  { name: "Living Room (Salon)", type: "living" },
  { name: "Master Bedroom (Yatak Odası)", type: "bedroom" },
  { name: "Kitchen (Mutfak)", type: "kitchen" },
  { name: "Bathroom (Banyo)", type: "bathroom" },
  { name: "Corridor / Hallway", type: "corridor" },
  { name: "Balcony / Terrace", type: "balcony" },
  { name: "Office / Study", type: "office" },
];

function ProjectRoomsContent({ params }: PageProps) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [project, setProject] = useState<ProjectItem | null>(null);
  const [rooms, setRooms] = useState<RoomPlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // New Room Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("Living Room (Salon)");
  const [newRoomType, setNewRoomType] = useState<RoomType>("living");
  const [creating, setCreating] = useState(false);

  // Filter Toggles for BOQ Breakdown
  const [floorFilter, setFloorFilter] = useState<"all" | "laminate" | "ceramic">("all");
  const [ceilingOnlyDrywall, setCeilingOnlyDrywall] = useState<boolean>(false);

  // Subscriptions
  useEffect(() => {
    if (!user?.uid || !projectId) return;

    const unsubProj = subscribeToUserProject(user.uid, projectId, (proj) => {
      setProject(proj);
    });

    const unsubRooms = subscribeToProjectRooms(
      user.uid,
      projectId,
      (items) => {
        setRooms(items);
        setLoading(false);
      }
    );

    return () => {
      unsubProj();
      unsubRooms();
    };
  }, [user?.uid, projectId]);

  // Derived Project Totals & Accurate Architectural BOQ Takeoff
  const { totals, boqTotals } = useMemo(() => {
    let totalArea = 0;
    let totalPerimeter = 0;
    let totalWalls = 0;
    let totalDoors = 0;
    let totalWindows = 0;

    let totalNetWallAreaM2 = 0;
    let totalGrossWallAreaM2 = 0;
    let totalOpeningsAreaM2 = 0;

    let totalSkirtingLengthM = 0;
    let totalGrossPerimeterM = 0;
    let totalDoorDeductionM = 0;

    let totalFloorAreaM2 = 0;
    let totalLaminateAreaM2 = 0;
    let totalCeramicAreaM2 = 0;

    let totalCeilingAreaM2 = 0;
    let totalDrywallCeilingAreaM2 = 0;
    let totalStandardCeilingAreaM2 = 0;

    rooms.forEach((r) => {
      totalArea += r.calculatedArea || 0;
      totalPerimeter += r.calculatedPerimeter || 0;
      totalWalls += r.wallCount || r.walls?.length || 0;
      totalDoors += r.doorCount || r.doors?.length || 0;
      totalWindows += r.windowCount || r.windows?.length || 0;

      const t = calculateRoomTakeoff(r);
      totalNetWallAreaM2 += t.netWallAreaM2;
      totalGrossWallAreaM2 += t.grossWallAreaM2;
      totalOpeningsAreaM2 += t.openingsAreaM2;

      totalSkirtingLengthM += t.skirtingLengthM;
      totalGrossPerimeterM += t.grossPerimeterM;
      totalDoorDeductionM += t.doorDeductionM;

      totalFloorAreaM2 += t.floorAreaM2;
      if (t.flooringType === "ceramic") {
        totalCeramicAreaM2 += t.floorAreaM2;
      } else {
        totalLaminateAreaM2 += t.floorAreaM2;
      }

      totalCeilingAreaM2 += t.ceilingAreaM2;
      if (t.hasDrywallCeiling) {
        totalDrywallCeilingAreaM2 += t.ceilingAreaM2;
      } else {
        totalStandardCeilingAreaM2 += t.ceilingAreaM2;
      }
    });

    return {
      totals: {
        roomCount: rooms.length,
        totalArea: Number(totalArea.toFixed(1)),
        totalPerimeter: Number(totalPerimeter.toFixed(1)),
        totalWalls,
        totalOpenings: totalDoors + totalWindows,
      },
      boqTotals: {
        netWallAreaM2: Number(totalNetWallAreaM2.toFixed(1)),
        grossWallAreaM2: Number(totalGrossWallAreaM2.toFixed(1)),
        openingsAreaM2: Number(totalOpeningsAreaM2.toFixed(1)),
        skirtingLengthM: Number(totalSkirtingLengthM.toFixed(1)),
        grossPerimeterM: Number(totalGrossPerimeterM.toFixed(1)),
        doorDeductionM: Number(totalDoorDeductionM.toFixed(1)),
        floorAreaM2: Number(totalFloorAreaM2.toFixed(1)),
        laminateAreaM2: Number(totalLaminateAreaM2.toFixed(1)),
        ceramicAreaM2: Number(totalCeramicAreaM2.toFixed(1)),
        ceilingAreaM2: Number(totalCeilingAreaM2.toFixed(1)),
        drywallCeilingAreaM2: Number(totalDrywallCeilingAreaM2.toFixed(1)),
        standardCeilingAreaM2: Number(totalStandardCeilingAreaM2.toFixed(1)),
      },
    };
  }, [rooms]);

  // Quick toggles directly on room cards (with immediate Firestore persistence)
  const handleToggleFlooring = async (roomId: string, type: "laminate" | "ceramic") => {
    if (!user?.uid || !projectId) return;
    try {
      await updateRoomPlanInProject(user.uid, projectId, roomId, {
        flooringType: type,
        slab: {
          material: type === "ceramic" ? "ceramic_tile" : "hardwood",
          thickness: 150,
          elevation: 0,
          id: "slab",
          boundary: [],
        },
      });
    } catch (err) {
      console.error("Failed to update flooring type:", err);
    }
  };

  const handleToggleDrywall = async (roomId: string, currentVal: boolean) => {
    if (!user?.uid || !projectId) return;
    try {
      await updateRoomPlanInProject(user.uid, projectId, roomId, {
        hasDrywallCeiling: !currentVal,
      });
    } catch (err) {
      console.error("Failed to update ceiling type:", err);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid || !projectId || !newRoomName.trim()) return;

    setCreating(true);
    try {
      const docRef = await addRoomToProject(user.uid, projectId, {
        projectId,
        name: newRoomName.trim(),
        roomType: newRoomType,
        calculatedArea: 0,
        calculatedPerimeter: 0,
        wallCount: 0,
        doorCount: 0,
        windowCount: 0,
        isClosed: false,
        walls: [],
        doors: [],
        windows: [],
      });

      setIsModalOpen(false);
      if (docRef?.id) {
        router.push(`/projects/${projectId}/plan?roomId=${docRef.id}`);
      }
    } catch (err) {
      console.error("Error creating room:", err);
      alert("Failed to create room.");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!user?.uid || !projectId) return;
    if (!confirm(`Are you sure you want to delete "${roomName}"?`)) return;

    try {
      await deleteRoomFromProject(user.uid, projectId, roomId);
    } catch (err) {
      console.error("Error deleting room:", err);
      alert("Failed to delete room.");
    }
  };

  if (!authLoading && !user) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <MdLockOutline />
          </div>
          <h2 className={styles.emptyTitle}>Sign In Required</h2>
          <p className={styles.emptyDesc}>
            Please sign in to view and draw architectural room plans for this project.
          </p>
          <Link href="/login" className={styles.addRoomBtn}>
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Breadcrumb Navigation */}
      <nav className={styles.breadcrumb}>
        <Link href="/projects" className={styles.backLink}>
          <FaChevronLeft size={10} />
          <span>Projects</span>
        </Link>
        <MdChevronRight size={14} color="var(--textMuted)" />
        <span className={styles.crumbCurrent}>
          {project?.name || "Project Plans"}
        </span>
      </nav>

      {/* Project Header & Actions */}
      <header className={styles.projectHeader}>
        <div className={styles.headerMain}>
          <div className={styles.titleRow}>
            <h1 className={styles.projectTitle}>
              {project?.name || "Project Rooms & Plans"}
            </h1>
            {project?.type && (
              <span className={styles.typeBadge}>{project.type}</span>
            )}
          </div>
          <p className={styles.headerSubtitle}>
            Room-by-room architectural floor plan drafting, live 3D BIM model generation,
            and AutoCAD .DWG / .GLTF export.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.addRoomBtn}
            onClick={() => setIsModalOpen(true)}
          >
            <MdAdd size={18} />
            <span>Yeni Oda Çiz / Add Room</span>
          </button>
        </div>
      </header>

      {/* Metraj & Hakediş Özeti (Quantity Takeoff / BOQ Panel) */}
      <section className={styles.boqSection}>
        <div className={styles.boqHeader}>
          <div className={styles.boqTitleGroup}>
            <MdReceiptLong size={22} color="var(--accent)" />
            <h2 className={styles.boqTitle}>Metraj & Keşif Özeti (Quantity Takeoff)</h2>
            <span className={styles.boqBadge}>BOQ / Hakediş</span>
          </div>
          <span style={{ fontSize: "0.8rem", color: "var(--textMuted)" }}>
            Açıklıklar ve mimari detaylar otomatik hesaplanır
          </span>
        </div>

        <div className={styles.boqGrid}>
          {/* 1. Net Duvar Metrekaresi */}
          <div className={styles.boqCard}>
            <div className={styles.boqCardHead}>
              <span className={styles.boqCardLabel}>Net Duvar Metrekaresi</span>
              <MdFormatPaint size={18} color="#38bdf8" />
            </div>
            <div>
              <span className={styles.boqCardValue} style={{ color: "#38bdf8" }}>
                {boqTotals.netWallAreaM2}
              </span>
              <span className={styles.boqCardUnit}>m²</span>
            </div>
            <p className={styles.boqCardSub}>
              Brüt: {boqTotals.grossWallAreaM2} m² | Açıklıklar (Kapı + Pencere): -{boqTotals.openingsAreaM2} m² net düşülmüştür.
            </p>
          </div>

          {/* 2. Total Süpürgelik Metresi */}
          <div className={styles.boqCard}>
            <div className={styles.boqCardHead}>
              <span className={styles.boqCardLabel}>Total Süpürgelik Metresi</span>
              <MdStraighten size={18} color="#facc15" />
            </div>
            <div>
              <span className={styles.boqCardValue} style={{ color: "#facc15" }}>
                {boqTotals.skirtingLengthM}
              </span>
              <span className={styles.boqCardUnit}>m</span>
            </div>
            <p className={styles.boqCardSub}>
              Brüt Çevre: {boqTotals.grossPerimeterM} m | Kapı Geçişleri: -{boqTotals.doorDeductionM} m düşülmüştür (Pencereler düşülmez).
            </p>
          </div>

          {/* 3. Total Zemin Metrekaresi with Radio Buttons */}
          <div className={styles.boqCard}>
            <div className={styles.boqCardHead}>
              <span className={styles.boqCardLabel}>Total Zemin Metrekaresi</span>
              <MdSquareFoot size={18} color="var(--accent)" />
            </div>
            <div>
              <span className={styles.boqCardValue} style={{ color: "var(--accent)" }}>
                {floorFilter === "all"
                  ? boqTotals.floorAreaM2
                  : floorFilter === "laminate"
                  ? boqTotals.laminateAreaM2
                  : boqTotals.ceramicAreaM2}
              </span>
              <span className={styles.boqCardUnit}>m²</span>
            </div>

            {/* Radio Buttons for Floor Filter */}
            <div className={styles.boqFilterGroup}>
              <label
                className={`${styles.boqRadioBtn} ${floorFilter === "all" ? styles.boqRadioActive : ""}`}
              >
                <input
                  type="radio"
                  name="boqFloorFilter"
                  value="all"
                  checked={floorFilter === "all"}
                  onChange={() => setFloorFilter("all")}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span>Tümü ({boqTotals.floorAreaM2} m²)</span>
              </label>

              <label
                className={`${styles.boqRadioBtn} ${floorFilter === "laminate" ? styles.boqRadioActive : ""}`}
              >
                <input
                  type="radio"
                  name="boqFloorFilter"
                  value="laminate"
                  checked={floorFilter === "laminate"}
                  onChange={() => setFloorFilter("laminate")}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span>Laminant ({boqTotals.laminateAreaM2} m²)</span>
              </label>

              <label
                className={`${styles.boqRadioBtn} ${floorFilter === "ceramic" ? styles.boqRadioActive : ""}`}
              >
                <input
                  type="radio"
                  name="boqFloorFilter"
                  value="ceramic"
                  checked={floorFilter === "ceramic"}
                  onChange={() => setFloorFilter("ceramic")}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span>Seramik ({boqTotals.ceramicAreaM2} m²)</span>
              </label>
            </div>
          </div>

          {/* 4. Total Tavan Metrekaresi with Checkbox */}
          <div className={styles.boqCard}>
            <div className={styles.boqCardHead}>
              <span className={styles.boqCardLabel}>Total Tavan Metrekaresi</span>
              <MdLayers size={18} color="#c084fc" />
            </div>
            <div>
              <span className={styles.boqCardValue} style={{ color: "#c084fc" }}>
                {ceilingOnlyDrywall ? boqTotals.drywallCeilingAreaM2 : boqTotals.ceilingAreaM2}
              </span>
              <span className={styles.boqCardUnit}>m²</span>
            </div>

            {/* Checkbox for Drywall Ceiling */}
            <div className={styles.boqFilterGroup}>
              <label
                className={`${styles.boqCheckboxBtn} ${ceilingOnlyDrywall ? styles.boqCheckboxActive : ""}`}
              >
                <input
                  type="checkbox"
                  checked={ceilingOnlyDrywall}
                  onChange={(e) => setCeilingOnlyDrywall(e.target.checked)}
                  style={{ accentColor: "#c084fc", width: "15px", height: "15px" }}
                />
                <span>Sadece Alçıpan Asma Tavanlılar ({boqTotals.drywallCeilingAreaM2} m²)</span>
              </label>
            </div>
            <p className={styles.boqCardSub}>
              Toplam: {boqTotals.ceilingAreaM2} m² | Normal Sıva Tavan: {boqTotals.standardCeilingAreaM2} m²
            </p>
          </div>
        </div>
      </section>

      {/* Metrics Summary Bar */}
      <section className={styles.metricsBar}>
        {/* Total Floor Area */}
        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <MdSquareFoot />
          </div>
          <div className={styles.metricInfo}>
            <span className={styles.metricLabel}>Total Floor Area</span>
            <span className={styles.metricValue}>
              {totals.totalArea} <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>m²</span>
            </span>
            <span className={styles.metricSub}>{totals.roomCount} Rooms Measured</span>
          </div>
        </div>

        {/* Total Rooms */}
        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <MdMeetingRoom />
          </div>
          <div className={styles.metricInfo}>
            <span className={styles.metricLabel}>Measured Rooms</span>
            <span className={styles.metricValue}>{totals.roomCount}</span>
            <span className={styles.metricSub}>Saved Spaces</span>
          </div>
        </div>

        {/* Total Wall Perimeter */}
        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <MdStraighten />
          </div>
          <div className={styles.metricInfo}>
            <span className={styles.metricLabel}>Wall Perimeter</span>
            <span className={styles.metricValue}>
              {totals.totalPerimeter} <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>m</span>
            </span>
            <span className={styles.metricSub}>{totals.totalWalls} Wall Segments</span>
          </div>
        </div>

        {/* Doors & Windows */}
        <div className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <MdDoorSliding />
          </div>
          <div className={styles.metricInfo}>
            <span className={styles.metricLabel}>Openings (Doors/Windows)</span>
            <span className={styles.metricValue}>{totals.totalOpenings}</span>
            <span className={styles.metricSub}>Placed Architectural Fixtures</span>
          </div>
        </div>
      </section>

      {/* Empty State */}
      {!loading && rooms.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <MdLayers />
          </div>
          <h2 className={styles.emptyTitle}>Henüz Oda Eklenmedi</h2>
          <p className={styles.emptyDesc}>
            Bu projede çizilmiş oda planı bulunmamaktadır. Mobil uyumlu ölçü alma moduyla
            ilk oda planını çizmeye başlamak için aşağıdaki butona tıklayın.
          </p>
          <button
            type="button"
            className={styles.addRoomBtn}
            onClick={() => setIsModalOpen(true)}
          >
            <MdAdd size={18} />
            <span>İlk Odayı Çizmeye Başla</span>
          </button>
        </div>
      )}

      {/* Rooms Grid */}
      {!loading && rooms.length > 0 && (
        <section className={styles.roomsGrid}>
          {rooms.map((room) => {
            const takeoff = calculateRoomTakeoff(room);
            const isLaminate = (room.flooringType || "laminate") === "laminate";
            const isCeramic = room.flooringType === "ceramic";
            const isDrywall = Boolean(room.hasDrywallCeiling);

            return (
              <article key={room.id} className={styles.roomCard}>
                <div className={styles.cardHead}>
                  <h3 className={styles.roomTitle}>{room.name}</h3>
                  <span className={styles.categoryTag}>{room.roomType}</span>
                </div>

                {/* Area Highlight Box */}
                <div className={styles.areaHighlightBox}>
                  <span className={styles.areaLabel}>Net Taban Alanı</span>
                  <span className={styles.areaValue}>
                    {room.calculatedArea > 0 ? room.calculatedArea.toFixed(1) : "--"}{" "}
                    <span className={styles.areaUnit}>m²</span>
                  </span>
                </div>

                {/* Room BOQ Metraj Breakdown Box */}
                <div className={styles.roomTakeoffBlock}>
                  <div className={styles.roomTakeoffRow}>
                    <span className={styles.roomTakeoffLabel}>Net Duvar (Açıklık düşülmüş):</span>
                    <span className={styles.roomTakeoffVal} style={{ color: "#38bdf8" }}>
                      {takeoff.netWallAreaM2} m²
                    </span>
                  </div>
                  <div className={styles.roomTakeoffRow}>
                    <span className={styles.roomTakeoffLabel}>Süpürgelik (Kapı düşülmüş):</span>
                    <span className={styles.roomTakeoffVal} style={{ color: "#facc15" }}>
                      {takeoff.skirtingLengthM} m
                    </span>
                  </div>
                  <div className={styles.roomTakeoffRow}>
                    <span className={styles.roomTakeoffLabel}>Tavan Alanı:</span>
                    <span className={styles.roomTakeoffVal} style={{ color: "#c084fc" }}>
                      {takeoff.ceilingAreaM2} m²
                    </span>
                  </div>
                </div>

                {/* Interactive Radio & Checkbox Options directly on Card */}
                <div className={styles.roomCardOptions}>
                  {/* Flooring Radio Buttons */}
                  <div className={styles.roomOptionRow}>
                    <span style={{ color: "var(--textMuted)", fontWeight: 600 }}>Zemin:</span>
                    <div className={styles.roomRadioGroup}>
                      <label
                        className={`${styles.roomRadioLabel} ${isLaminate ? styles.roomRadioLabelActive : ""}`}
                        title="Laminant Parke Döşeme"
                      >
                        <input
                          type="radio"
                          name={`floor_${room.id}`}
                          value="laminate"
                          checked={isLaminate}
                          onChange={() => handleToggleFlooring(room.id, "laminate")}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <span>Laminant</span>
                      </label>
                      <label
                        className={`${styles.roomRadioLabel} ${isCeramic ? styles.roomRadioLabelActive : ""}`}
                        title="Seramik / Fayans Döşeme"
                      >
                        <input
                          type="radio"
                          name={`floor_${room.id}`}
                          value="ceramic"
                          checked={isCeramic}
                          onChange={() => handleToggleFlooring(room.id, "ceramic")}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <span>Seramik</span>
                      </label>
                    </div>
                  </div>

                  {/* Drywall Ceiling Checkbox */}
                  <div className={styles.roomOptionRow}>
                    <span style={{ color: "var(--textMuted)", fontWeight: 600 }}>Tavan:</span>
                    <label
                      className={`${styles.roomCheckLabel} ${isDrywall ? styles.roomCheckLabelActive : ""}`}
                      title="Alçıpan Asma Tavan Yapılacak mı?"
                    >
                      <input
                        type="checkbox"
                        checked={isDrywall}
                        onChange={() => handleToggleDrywall(room.id, isDrywall)}
                        style={{ accentColor: "#c084fc" }}
                      />
                      <span>Alçıpan Asma Tavan</span>
                    </label>
                  </div>
                </div>

                {/* Elements Stats Breakdown */}
                <div className={styles.elementsList}>
                  <div className={styles.elementItem}>
                    <span className={styles.elementCount}>{room.walls?.length || 0}</span>
                    <span className={styles.elementName}>Duvar</span>
                  </div>
                  <div className={styles.elementItem}>
                    <span className={styles.elementCount}>{room.doors?.length || 0}</span>
                    <span className={styles.elementName}>Kapı</span>
                  </div>
                  <div className={styles.elementItem}>
                    <span className={styles.elementCount}>{room.windows?.length || 0}</span>
                    <span className={styles.elementName}>Pencere</span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className={styles.cardActions}>
                  <Link
                    href={`/projects/${projectId}/plan?roomId=${room.id}`}
                    className={styles.openStudioBtn}
                  >
                    <MdHome size={16} />
                    <span>2D Çizim & 3D Model</span>
                  </Link>

                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => handleDeleteRoom(room.id, room.name)}
                    aria-label="Delete Room"
                  >
                    <MdDeleteOutline size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Quick New Room Creator Modal */}
      {isModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>Yeni Oda Planı Oluştur</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setIsModalOpen(false)}
              >
                <MdClose size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateRoom} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Hızlı Oda Şablonu</label>
                <div className={styles.presetChips}>
                  {ROOM_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className={styles.presetChip}
                      onClick={() => {
                        setNewRoomName(preset.name);
                        setNewRoomType(preset.type);
                      }}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Oda İsmi</label>
                <input
                  type="text"
                  required
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="Örn: Salon, Çocuk Odası"
                  className={styles.textInput}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Oda Tipi</label>
                <select
                  value={newRoomType}
                  onChange={(e) => setNewRoomType(e.target.value as RoomType)}
                  className={styles.selectInput}
                >
                  <option value="living">Living Room / Salon</option>
                  <option value="bedroom">Bedroom / Yatak Odası</option>
                  <option value="kitchen">Kitchen / Mutfak</option>
                  <option value="bathroom">Bathroom / Banyo</option>
                  <option value="corridor">Corridor / Koridor</option>
                  <option value="balcony">Balcony / Balkon</option>
                  <option value="office">Office / Çalışma Odası</option>
                  <option value="dining">Dining / Yemek Odası</option>
                  <option value="other">Other / Diğer</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={creating || !newRoomName.trim()}
                className={styles.addRoomBtn}
                style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
              >
                <MdAdd size={18} />
                <span>{creating ? "Oluşturuluyor..." : "Çizime Başla"}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectRoomsPage({ params }: PageProps) {
  return (
    <React.Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0d0d12",
            color: "var(--accent)",
            fontSize: "0.85rem",
          }}
        >
          YÜKLENİYOR...
        </div>
      }
    >
      <ProjectRoomsContent params={params} />
    </React.Suspense>
  );
}
