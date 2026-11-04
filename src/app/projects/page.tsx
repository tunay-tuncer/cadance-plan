"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
    ProjectItem,
    subscribeToUserProjects,
} from "@/lib/firebase/projectService";
import {
    MdWorkOutline,
    MdArrowForward,
    MdOutlineLayers,
    MdLockOutline,
} from "react-icons/md";
import styles from "./projects.module.css";

export default function ProjectsPage() {
    const { user, loading: authLoading } = useAuth();
    const [projects, setProjects] = useState<ProjectItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) return;

        const unsubscribe = subscribeToUserProjects(user.uid, (fetched) => {
            setProjects(fetched);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user?.uid]);

    const displayedProjects = user ? projects : [];
    const isLoading = authLoading || (Boolean(user) && loading);
    const completedCount = displayedProjects.filter((p) => p.isComplete).length;
    const activeCount = displayedProjects.length - completedCount;

    if (!authLoading && !user) {
        return (
            <div className={styles.pageContainer}>
                <div className={styles.stateCard}>
                    <div className={styles.stateIcon}>
                        <MdLockOutline />
                    </div>
                    <h2 className={styles.stateTitle}>Sign In Required</h2>
                    <p className={styles.stateDesc}>
                        Sign in with your Cadance account to view and access your synchronized
                        projects from Cadance Dashboard.
                    </p>
                    <Link href="/login" className={styles.loginPromptBtn}>
                        <span>Sign In to Continue</span>
                        <MdArrowForward size={16} />
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.pageContainer}>
            <section className={styles.headerSection}>
                <div className={styles.titleArea}>
                    <h1 className={styles.pageTitle}>Projects</h1>
                    <p className={styles.pageSubtitle}>
                        Synchronized directly from your Cadance Dashboard. Select a project to view its floor plans.
                    </p>
                </div>

                <div className={styles.statsRow}>
                    <div className={styles.statBadge}>
                        <span>Total Projects:</span>
                        <span className={styles.statValue}>{displayedProjects.length}</span>
                    </div>
                    <div className={styles.statBadge}>
                        <span>In Progress:</span>
                        <span className={styles.statValue}>{activeCount}</span>
                    </div>
                    <div className={styles.statBadge}>
                        <span>Completed:</span>
                        <span className={styles.statValue}>{completedCount}</span>
                    </div>
                </div>
            </section>

            {isLoading && (
                <div className={styles.skeletonGrid}>
                    <div className={styles.skeletonCard} />
                    <div className={styles.skeletonCard} />
                    <div className={styles.skeletonCard} />
                </div>
            )}

            {!isLoading && displayedProjects.length === 0 && (
                <div className={styles.stateCard}>
                    <div className={styles.stateIcon}>
                        <MdWorkOutline />
                    </div>
                    <h2 className={styles.stateTitle}>No Projects Found</h2>
                    <p className={styles.stateDesc}>
                        You don&apos;t have any projects in your Cadance account yet. Projects
                        created on Cadance Dashboard will automatically sync here.
                    </p>
                    <Link href="/" className={styles.actionButton} style={{ flex: "none" }}>
                        Return to 3D Furniture Studio
                    </Link>
                </div>
            )}

            {!isLoading && displayedProjects.length > 0 && (
                <div className={styles.projectsGrid}>
                    {displayedProjects.map((project) => (
                        <Link
                            key={project.id}
                            href={`/projects/${project.id}`}
                            className={styles.projectCard}
                        >
                            <div className={styles.cardTop}>
                                <h2 className={styles.projectName}>{project.name}</h2>
                                {project.type && (
                                    <span className={styles.typeBadge}>{project.type}</span>
                                )}
                            </div>

                            <div className={styles.detailsList}>
                                <div className={styles.detailRow}>
                                    <span className={styles.detailLabel}>Status</span>
                                    <span
                                        className={`${styles.statusIndicator} ${project.isComplete
                                            ? styles.statusCompleted
                                            : styles.statusActive
                                            }`}
                                    >
                                        <span className={styles.statusDot} />
                                        {project.isComplete ? "Completed" : "In Progress"}
                                    </span>
                                </div>

                                {project.startDate && (
                                    <div className={styles.detailRow}>
                                        <span className={styles.detailLabel}>Start Date</span>
                                        <span className={styles.detailValue}>
                                            {project.startDate}
                                        </span>
                                    </div>
                                )}

                                {Boolean(project.agreedPayment) && (
                                    <div className={styles.detailRow}>
                                        <span className={styles.detailLabel}>Budget</span>
                                        <span className={styles.detailValue}>
                                            ${project.agreedPayment?.toLocaleString()}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className={styles.cardFooter}>
                                <span className={styles.actionButton}>
                                    <MdOutlineLayers size={16} />
                                    <span>View Plans</span>
                                </span>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
