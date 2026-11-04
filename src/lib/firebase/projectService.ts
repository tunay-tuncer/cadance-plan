import {
    collection,
    query,
    orderBy,
    onSnapshot,
    doc,
    Timestamp,
} from "firebase/firestore";
import { db } from "./client";

export type ProjectType = "Drawing" | "Modelling" | "Renovation" | "Custom";

export interface ProjectItem {
    id: string;
    name: string;
    type?: ProjectType;
    startDate?: string;
    agreedPayment?: number;
    totalMoneySpent?: number;
    totalMoneyReceived?: number;
    targetProfit?: number;
    isComplete: boolean;
    isBilled: boolean;
    notes?: string;
    createdAt?: Timestamp | unknown;
}

const PROJECTS_SUBCOLLECTION = "projects";

export const subscribeToUserProjects = (
    userId: string,
    callback: (projects: ProjectItem[]) => void
) => {
    if (!userId) return () => { };

    const projectsRef = collection(db, "users", userId, PROJECTS_SUBCOLLECTION);
    const q = query(projectsRef, orderBy("createdAt", "desc"));

    return onSnapshot(
        q,
        (snapshot) => {
            const projects: ProjectItem[] = snapshot.docs.map((docSnap) => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    name: data.name ?? "Untitled Project",
                    type: data.type,
                    startDate: data.startDate ?? "",
                    agreedPayment: Number(data.agreedPayment) || 0,
                    totalMoneySpent: Number(data.totalMoneySpent) || 0,
                    totalMoneyReceived: Number(data.totalMoneyReceived) || 0,
                    targetProfit: Number(data.targetProfit) || 0,
                    isComplete: Boolean(data.isComplete),
                    isBilled: Boolean(data.isBilled),
                    notes: data.notes ?? "",
                    createdAt: data.createdAt,
                };
            });
            callback(projects);
        },
        (error) => {
            console.error("Error subscribing to projects:", error);
            callback([]);
        }
    );
};

export const subscribeToUserProject = (
    userId: string,
    projectId: string,
    callback: (project: ProjectItem | null) => void
) => {
    if (!userId || !projectId) return () => { };

    const projectDocRef = doc(db, "users", userId, PROJECTS_SUBCOLLECTION, projectId);

    return onSnapshot(
        projectDocRef,
        (docSnap) => {
            if (!docSnap.exists()) {
                callback(null);
                return;
            }
            const data = docSnap.data();
            callback({
                id: docSnap.id,
                name: data.name ?? "Untitled Project",
                type: data.type,
                startDate: data.startDate ?? "",
                agreedPayment: Number(data.agreedPayment) || 0,
                totalMoneySpent: Number(data.totalMoneySpent) || 0,
                totalMoneyReceived: Number(data.totalMoneyReceived) || 0,
                targetProfit: Number(data.targetProfit) || 0,
                isComplete: Boolean(data.isComplete),
                isBilled: Boolean(data.isBilled),
                notes: data.notes ?? "",
                createdAt: data.createdAt,
            });
        },
        (error) => {
            console.error("Error subscribing to project:", error);
            callback(null);
        }
    );
};
