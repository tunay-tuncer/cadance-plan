import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
} from "firebase/auth";
import { auth } from "./client";
import { createOrUpdateUser } from "./user";

export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        await createOrUpdateUser(result.user);
        return result.user;
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        throw error;
    }
}

export async function loginWithEmail(email: string, pass: string) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, pass);
        await createOrUpdateUser(result.user);
        return result.user;
    } catch (error) {
        console.error("Email Login Error:", error);
        throw error;
    }
}

export async function registerWithEmail(email: string, pass: string) {
    try {
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        await createOrUpdateUser(result.user);
        return result.user;
    } catch (error) {
        console.error("Email Register Error:", error);
        throw error;
    }
}

export async function logout() {
    return await signOut(auth);
}
