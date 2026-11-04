import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./client";
import { User as FirebaseUser } from "firebase/auth";

export async function createOrUpdateUser(user: FirebaseUser) {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || user.email?.split("@")[0],
            avatarUrl: user.photoURL || "",
            role: "admin",
            createdAt: serverTimestamp(),
        });
    }
}
