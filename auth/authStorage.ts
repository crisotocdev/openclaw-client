import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const TOKEN_KEY = "moltbot_token";

function canUseLocalStorage() {
    try {
        return typeof window !== "undefined" && !!window.localStorage;
    } catch {
        return false;
    }
}

export async function getToken(): Promise<string | null> {
    try {
        const t = await AsyncStorage.getItem(TOKEN_KEY);
        if (t && t.trim()) return t.trim();
    } catch { }

    if (Platform.OS === "web" && canUseLocalStorage()) {
        try {
            const t = window.localStorage.getItem(TOKEN_KEY);
            return t && t.trim() ? t.trim() : null;
        } catch { }
    }

    return null;
}

export async function setToken(token: string): Promise<void> {
    const cleaned = (token ?? "").trim();
    if (!cleaned) return;

    try {
        await AsyncStorage.setItem(TOKEN_KEY, cleaned);
        return;
    } catch { }

    if (Platform.OS === "web" && canUseLocalStorage()) {
        try {
            window.localStorage.setItem(TOKEN_KEY, cleaned);
        } catch { }
    }
}

export async function clearToken(): Promise<void> {
    try {
        await AsyncStorage.removeItem(TOKEN_KEY);
    } catch { }

    if (Platform.OS === "web" && canUseLocalStorage()) {
        try {
            window.localStorage.removeItem(TOKEN_KEY);
        } catch { }
    }
}