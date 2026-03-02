import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../auth/AuthContext";

type CmdResponse = {
    ok: boolean;
    role: string;
    command: string;
    argument: string;
    response: string;
};

function joinUrl(base: string, path: string) {
    const b = base.endsWith("/") ? base.slice(0, -1) : base;
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${b}${p}`;
}

function isNetworkErrorMessage(msg: unknown) {
    if (typeof msg !== "string") return false;
    const m = msg.toLowerCase();
    return (
        m.includes("failed to fetch") ||
        m.includes("networkerror") ||
        m.includes("network request failed") ||
        m.includes("connection") ||
        m.includes("refused")
    );
}

function humanNetworkMessage(base: string) {
    return `No se pudo conectar al backend en:\n${base}\n\nAsegúrate de que el servidor Rust esté corriendo en 8080.`;
}

async function postJson<T>(url: string, body: any, timeoutMs = 4000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        const text = await res.text();

        let data: any = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }

        if (!res.ok) {
            const msg =
                (data && typeof data === "object" && (data.response || data.error || data.message)) ||
                (typeof data === "string" ? data : "") ||
                `HTTP ${res.status}`;
            throw new Error(msg);
        }

        return data as T;
    } catch (e: any) {
        const name = e?.name ?? "";
        const msg = e?.message ?? "";

        if (name === "AbortError") throw new Error("NETWORK_TIMEOUT");
        if (typeof msg === "string" && msg.toLowerCase().includes("failed to fetch")) throw new Error("NETWORK_DOWN");

        throw e;
    } finally {
        clearTimeout(timer);
    }
}

export default function Home() {
    const { token, signOut, loading: authLoading } = useAuth();

    const [apiBase, setApiBase] = useState("");
    const [cmd, setCmd] = useState("PING");
    const [out, setOut] = useState("");

    const [loading, setLoading] = useState(true);
    const [cmdLoading, setCmdLoading] = useState(false);

    // ✅ Nuevo: estado del backend
    const [online, setOnline] = useState<boolean | null>(null);
    const lastCheckRef = useRef<number>(0);

    const base = useMemo(() => apiBase.trim(), [apiBase]);
    const tok = useMemo(() => (token ?? "").trim(), [token]);

    async function checkBackend(reason: "init" | "poll" | "after_cmd" = "poll") {
        if (!base || !tok) return;

        // Evita spamear checks si ya hicimos uno muy reciente
        const now = Date.now();
        if (reason !== "init" && now - lastCheckRef.current < 1500) return;
        lastCheckRef.current = now;

        try {
            const data: any = await postJson(joinUrl(base, "/auth/verify"), { token: tok }, 2500);
            const valid = data && typeof data === "object" && (data.ok === true || data.response === "TOKEN_OK");
            setOnline(!!valid);
        } catch (e: any) {
            const msg = e?.message ?? "";
            if (msg === "NETWORK_DOWN" || msg === "NETWORK_TIMEOUT" || isNetworkErrorMessage(msg)) {
                setOnline(false);
                return;
            }
            // Si es otro error raro, no asumimos offline; dejamos estado como estaba
        }
    }

    useEffect(() => {
        (async () => {
            if (authLoading) return;

            const a = (await AsyncStorage.getItem("moltbot_api"))?.trim();

            if (!a || !tok) {
                setLoading(false);
                router.replace("/login");
                return;
            }

            setApiBase(a);

            try {
                const data: any = await postJson(joinUrl(a, "/auth/verify"), { token: tok });
                const valid = data && typeof data === "object" && (data.ok === true || data.response === "TOKEN_OK");
                if (!valid) throw new Error("Token inválido");

                setLoading(false);
                setOnline(true);
            } catch (e: any) {
                setLoading(false);

                const msg = e?.message ?? "";
                if (msg === "NETWORK_DOWN" || msg === "NETWORK_TIMEOUT" || isNetworkErrorMessage(msg)) {
                    setOnline(false);
                    Alert.alert("Sin conexión", humanNetworkMessage(a));
                    router.replace("/login");
                    return;
                }

                await signOut();
                router.replace("/login");
            }
        })();
    }, [authLoading, tok]);

    // ✅ Poll del estado online/offline cada 12s
    useEffect(() => {
        if (!base || !tok) return;
        const id = setInterval(() => {
            void checkBackend("poll");
        }, 12000);
        return () => clearInterval(id);
    }, [base, tok]);

    function renderCmdResult(data: CmdResponse) {
        const human = `${data.ok ? "✅" : "❌"} ${data.role} | ${data.command}${data.argument ? " " + data.argument : ""
            }\n${data.response}`;
        const debug = `\n\n---\nJSON:\n${JSON.stringify(data, null, 2)}`;
        return human + debug;
    }

    async function runCommand(message: string) {
        if (!base || !tok) {
            router.replace("/login");
            return;
        }
        if (cmdLoading) return;

        const url = joinUrl(base, "/cmd");
        setCmdLoading(true);

        try {
            const data = await postJson<CmdResponse>(url, { token: tok, message });
            setOut(renderCmdResult(data));
            setOnline(true);
            void checkBackend("after_cmd");
        } catch (e: any) {
            const msg = e?.message ?? "Error";

            if (msg === "NETWORK_DOWN" || msg === "NETWORK_TIMEOUT" || isNetworkErrorMessage(msg)) {
                setOnline(false);
                Alert.alert("Sin conexión", humanNetworkMessage(base));
                return;
            }

            if (typeof msg === "string" && msg.toLowerCase().includes("token")) {
                await signOut();
                router.replace("/login");
                return;
            }

            throw e;
        } finally {
            setCmdLoading(false);
        }
    }

    async function whoami() {
        try {
            await runCommand("WHOAMI");
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Error");
        }
    }

    async function sendCmd() {
        try {
            const message = cmd.trim();
            if (!message) {
                Alert.alert("Falta comando", "Escribe un comando (ej: PING).");
                return;
            }
            await runCommand(message);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Error");
        }
    }

    async function logout() {
        if (cmdLoading) return;
        await AsyncStorage.removeItem("moltbot_api");
        await signOut();
        setOut("");
        setCmd("PING");
        router.replace("/login");
    }

    const canUse = !!tok && !!base && !cmdLoading;
    const canSend = !!cmd.trim() && canUse;

    if (loading || authLoading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Text>Cargando...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* ✅ Banner superior */}
            <View
                style={[
                    styles.banner,
                    online === true && styles.bannerOk,
                    online === false && styles.bannerBad,
                ]}
            >
                <Text style={styles.bannerText}>
                    {online === null ? "⚪ Estado: verificando..." : online ? "🟢 Backend ONLINE" : "🔴 Backend OFFLINE"}
                </Text>

                <Pressable
                    onPress={() => checkBackend("init")}
                    style={[styles.bannerBtn, cmdLoading && { opacity: 0.6 }]}
                    disabled={cmdLoading}
                >
                    <Text style={styles.bannerBtnText}>Reintentar</Text>
                </Pressable>
            </View>

            <Text style={styles.title}>Panel</Text>
            <Text style={styles.small}>API: {base || "(no configurada)"}</Text>

            <View style={styles.row}>
                <Pressable style={[styles.btn, !canUse && { opacity: 0.5 }]} onPress={whoami} disabled={!canUse}>
                    <Text style={styles.btnText}>{cmdLoading ? "Ejecutando..." : "Whoami"}</Text>
                </Pressable>

                <Pressable style={[styles.btn, styles.red, cmdLoading && { opacity: 0.6 }]} onPress={logout} disabled={cmdLoading}>
                    <Text style={styles.btnText}>Salir</Text>
                </Pressable>
            </View>

            <Text style={styles.label}>Comando</Text>
            <TextInput
                style={styles.input}
                value={cmd}
                onChangeText={setCmd}
                autoCapitalize="none"
                onSubmitEditing={sendCmd}
                returnKeyType="send"
                editable={!cmdLoading}
            />

            <Pressable style={[styles.btn, !canSend && { opacity: 0.5 }]} onPress={sendCmd} disabled={!canSend}>
                <Text style={styles.btnText}>{cmdLoading ? "Ejecutando..." : "Enviar CMD"}</Text>
            </Pressable>

            <Text style={styles.label}>Salida</Text>
            <Pressable
                style={[styles.btn, (!out || cmdLoading) && { opacity: 0.5 }]}
                disabled={!out || cmdLoading}
                onPress={() => {
                    try {
                        // Web only
                        // @ts-ignore
                        navigator.clipboard.writeText(out);
                        Alert.alert("Listo", "Salida copiada.");
                    } catch {
                        Alert.alert("No disponible", "Copiar funciona solo en web por ahora.");
                    }
                }}
            >
                <Text style={styles.btnText}>Copiar salida</Text>
            </Pressable>

            <ScrollView style={styles.outBox}>
                <Text selectable style={styles.outText}>
                    {out || "(vacío)"}
                </Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 20, gap: 10, paddingTop: 24 },

    // ✅ Banner
    banner: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    bannerOk: {
        borderColor: "#1b5e20",
        backgroundColor: "rgba(27,94,32,0.08)",
    },
    bannerBad: {
        borderColor: "#b00020",
        backgroundColor: "rgba(176,0,32,0.06)",
    },
    bannerText: { fontSize: 13, fontWeight: "600" },
    bannerBtn: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
    },
    bannerBtnText: { fontSize: 12, fontWeight: "700" },

    title: { fontSize: 24, fontWeight: "700" },
    small: { fontSize: 12, opacity: 0.7 },
    row: { flexDirection: "row", gap: 10 },
    label: { fontSize: 14, opacity: 0.8, marginTop: 8 },
    input: { borderWidth: 1, borderColor: "#999", borderRadius: 10, padding: 12 },
    btn: { backgroundColor: "black", padding: 14, borderRadius: 12, flex: 1 },
    red: { backgroundColor: "#b00020" },
    btnText: { color: "white", textAlign: "center", fontWeight: "700" },
    outBox: { borderWidth: 1, borderColor: "#999", borderRadius: 10, padding: 12, height: 220 },
    outText: { fontFamily: "monospace" },
});