"use client";

import Link from "next/link";
import { MdWorkOutline, MdDesignServices, MdArrowForward } from "react-icons/md";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <div className={styles.statusCard}>
          <div className={styles.heroBadge}>
            <MdDesignServices size={14} />
            <span>Architectural Plan Studio</span>
          </div>

          <h1 className={styles.cardTitle}>2D Plan & 3D BIM Studio</h1>
          <p className={styles.cardDescription}>
            Draft 2D room plans with mobile-first surveyor controls on phones and tablets,
            procedurally generate 3D BIM models (walls, doors, windows, slabs, ceilings),
            and export clean AutoCAD .DWG / .DXF and 3D .GLTF files.
          </p>

          <div className={styles.specsList}>
            <div className={styles.specItem}>
              <span className={styles.specDot} />
              <span>Mobile-first <strong>Directional Surveyor D-Pad</strong> for fast on-site measurement</span>
            </div>
            <div className={styles.specItem}>
              <span className={styles.specDot} />
              <span>Real-time <strong>3D BIM extrusion</strong> with doors, windows, slab & ceiling</span>
            </div>
            <div className={styles.specItem}>
              <span className={styles.specDot} />
              <span>Layer hierarchy with instant show/hide & object property inspector</span>
            </div>
            <div className={styles.specItem}>
              <span className={styles.specDot} />
              <span>AutoCAD <strong>.DWG / .DXF</strong> layered export & 3D <strong>.GLTF</strong> modeler export</span>
            </div>
          </div>

          <div className={styles.actionRow}>
            <Link href="/projects" className={styles.primaryBtn}>
              <MdWorkOutline size={16} />
              <span>Projeleri Görüntüle / View Projects</span>
              <MdArrowForward size={14} />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
