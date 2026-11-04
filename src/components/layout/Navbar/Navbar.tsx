"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { logout } from "@/lib/firebase/auth";
import { MdMenu, MdClose, MdWorkOutline, MdHome, MdLogout } from "react-icons/md";
import { FaUser, FaChevronDown } from "react-icons/fa";
import styles from "./Navbar.module.css";

export default function Navbar() {
    const { user, loading } = useAuth();
    const pathname = usePathname();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsUserDropdownOpen(false);
            }
        };

        if (isUserDropdownOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isUserDropdownOpen]);

    const handleLogout = async () => {
        try {
            await logout();
            setIsUserDropdownOpen(false);
        } catch (err) {
            console.error("Sign out error:", err);
        }
    };

    const closeMenus = () => {
        setIsMobileMenuOpen(false);
        setIsUserDropdownOpen(false);
    };

    // Hide global navigation in Plan Studio for full-screen immersive CAD workspace
    if (pathname?.includes("/plan")) {
        return null;
    }

    return (
        <nav className={styles.navBar}>
            <div className={styles.brandArea}>
                <button
                    type="button"
                    className={styles.mobileHamburgerBtn}
                    onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                    aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                >
                    {isMobileMenuOpen ? <MdClose size={22} /> : <MdMenu size={22} />}
                </button>

                <Link href="/" className={styles.brandLink} onClick={closeMenus}>
                    <div className={styles.brandLogo}>P</div>
                    <span className={styles.brandTitle}>PLAN STUDIO</span>
                </Link>
            </div>

            <div className={styles.navContainer}>
                <Link
                    href="/"
                    className={pathname === "/" ? styles.activeNavLink : ""}
                    onClick={closeMenus}
                >
                    HOME
                </Link>
                <Link
                    href="/projects"
                    className={pathname.startsWith("/projects") ? styles.activeNavLink : ""}
                    onClick={closeMenus}
                >
                    PROJECTS
                </Link>
            </div>

            <div className={styles.userContainer} ref={dropdownRef}>
                {!loading && (
                    <>
                        {user ? (
                            <div className={styles.userDisplay}>
                                <button
                                    type="button"
                                    className={styles.userButton}
                                    onClick={() => setIsUserDropdownOpen((prev) => !prev)}
                                    aria-expanded={isUserDropdownOpen}
                                >
                                    {user.photoURL ? (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img
                                            src={user.photoURL}
                                            alt="User avatar"
                                            className={styles.userImage}
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <div className={styles.userAvatarFallback}>
                                            <FaUser />
                                        </div>
                                    )}
                                    <span>{user.displayName || user.email?.split("@")[0] || "User"}</span>
                                    <FaChevronDown
                                        className={`${styles.chevron} ${isUserDropdownOpen ? styles.expanded : ""
                                            }`}
                                    />
                                </button>

                                {isUserDropdownOpen && (
                                    <div className={styles.dropdownMenu}>
                                        <div className={styles.dropdownUserInfo}>
                                            <div className={styles.dropdownName}>
                                                {user.displayName || "Studio User"}
                                            </div>
                                            <div className={styles.dropdownEmail}>{user.email}</div>
                                        </div>

                                        <Link
                                            href="/projects"
                                            className={styles.dropdownItem}
                                            onClick={closeMenus}
                                        >
                                            <MdWorkOutline size={16} />
                                            <span>Projects</span>
                                        </Link>

                                        <button
                                            type="button"
                                            className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                                            onClick={handleLogout}
                                        >
                                            <MdLogout size={16} />
                                            <span>Sign Out</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link href="/login" className={styles.signInButton} onClick={closeMenus}>
                                SIGN IN
                            </Link>
                        )}
                    </>
                )}
            </div>

            {isMobileMenuOpen && (
                <div className={styles.mobileMenuDrawer}>
                    <Link
                        href="/"
                        className={`${styles.mobileNavLink} ${pathname === "/" ? styles.activeMobileLink : ""
                            }`}
                        onClick={closeMenus}
                    >
                        <MdHome size={18} />
                        <span>Home</span>
                    </Link>
                    <Link
                        href="/projects"
                        className={`${styles.mobileNavLink} ${pathname.startsWith("/projects") ? styles.activeMobileLink : ""
                            }`}
                        onClick={closeMenus}
                    >
                        <MdWorkOutline size={18} />
                        <span>Projects</span>
                    </Link>

                    {!user && (
                        <Link
                            href="/login"
                            className={styles.signInButton}
                            style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}
                            onClick={closeMenus}
                        >
                            SIGN IN
                        </Link>
                    )}
                </div>
            )}
        </nav>
    );
}
