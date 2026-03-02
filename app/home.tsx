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

async function copyToClipboard(text: string) {
    // 1) Intento moderno (cuando está permitido)
    try {
        // @ts-ignore
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            // @ts-ignore
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // seguimos al fallback
    }

    // 2) Fallback web: execCommand
    try {
        // @ts-ignore
        if (typeof document === "undefined") return false;

        // @ts-ignore
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";

        // @ts-ignore
        document.body.appendChild(ta);
        ta.focus();
        ta.select();

        // @ts-ignore
        const ok = document.execCommand("copy");

        // @ts-ignore
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

const HISTORY_KEY = "moltbot_cmd_history";
const HISTORY_MAX = 10;

function normalizeCmd(s: string) {
    return s.trim().replace(/\s+/g, " ");
}

function dedupeKeepOrder(items: string[]) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of items) {
        const k = it.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(it);
    }
    return out;
}

export default function Home() {
    const { token, signOut, loading: authLoading } = useAuth();

    const [apiBase, setApiBase] = useState("");
    const [cmd, setCmd] = useState("PING");
    const [out, setOut] = useState("");

    const [loading, setLoading] = useState(true);
    const [cmdLoading, setCmdLoading] = useState(false);

    // ✅ estado del backend
    const [online, setOnline] = useState<boolean | null>(null);
    const lastCheckRef = useRef<number>(0);

    // ✅ historial de comandos
    const [history, setHistory] = useState<string[]>([]);

    // ✅ toast simple “copiado”
    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<any>(null);

    const base = useMemo(() => apiBase.trim(), [apiBase]);
    const tok = useMemo(() => (token ?? "").trim(), [token]);

    async function loadHistory() {
        try {
            const raw = await AsyncStorage.getItem(HISTORY_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                const cleaned = arr.map((x) => (typeof x === "string" ? normalizeCmd(x) : "")).filter(Boolean);
                setHistory(dedupeKeepOrder(cleaned).slice(0, HISTORY_MAX));
            }
        } catch {
            // ignore
        }
    }

    async function saveHistory(next: string[]) {
        try {
            await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    }

    async function pushHistory(entry: string) {
        const e = normalizeCmd(entry);
        if (!e) return;

        setHistory((prev) => {
            const next = dedupeKeepOrder([e, ...prev]).slice(0, HISTORY_MAX);
            void saveHistory(next);
            return next;
        });
    }

    async function clearHistory() {
        setHistory([]);
        try {
            await AsyncStorage.removeItem(HISTORY_KEY);
        } catch {
            // ignore
        }
    }

    function showCopiedToast() {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1400);
    }

    async function checkBackend(reason: "init" | "poll" | "after_cmd" = "poll") {
        if (!base || !tok) return;

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
            await loadHistory();

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

        return () => {
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
        };
    }, [authLoading, tok]);

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

        const msgClean = normalizeCmd(message);
        if (!msgClean) return;

        const url = joinUrl(base, "/cmd");
        setCmdLoading(true);

        try {
            const data = await postJson<CmdResponse>(url, { token: tok, message: msgClean });
            setOut(renderCmdResult(data));
            setOnline(true);
            void checkBackend("after_cmd");

            // ✅ solo si fue OK guardamos en historial
            await pushHistory(msgClean);
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

    async function onCopy() {
        if (!out || cmdLoading) return;

        const ok = await copyToClipboard(out);
        if (ok) {
            showCopiedToast();
        } else {
            Alert.alert("No disponible", "No se pudo copiar en este navegador.");
        }
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
            <View style={[styles.banner, online === true && styles.bannerOk, online === false && styles.bannerBad]}>
                <Text style={styles.bannerText}>
                    {online === null ? "⚪ Estado: verificando..." : online ? "🟢 Backend ONLINE" : "🔴 Backend OFFLINE"}
                </Text>

                <Pressable onPress={() => checkBackend("init")} style={[styles.bannerBtn, cmdLoading && { opacity: 0.6 }]} disabled={cmdLoading}>
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

            {/* ✅ Historial */}
            {history.length > 0 && (
                <View style={styles.historyBox}>
                    <View style={styles.historyHeader}>
                        <Text style={styles.historyTitle}>Historial</Text>
                        <Pressable onPress={clearHistory} disabled={cmdLoading}>
                            <Text style={[styles.historyClear, cmdLoading && { opacity: 0.5 }]}>Limpiar</Text>
                        </Pressable>
                    </View>

                    <View style={styles.historyChips}>
                        {history.map((h) => (
                            <Pressable
                                key={h}
                                style={[styles.chip, cmdLoading && { opacity: 0.6 }]}
                                disabled={cmdLoading}
                                onPress={() => setCmd(h)}
                            >
                                <Text style={styles.chipText}>{h}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            )}

            <Pressable style={[styles.btn, !canSend && { opacity: 0.5 }]} onPress={sendCmd} disabled={!canSend}>
                <Text style={styles.btnText}>{cmdLoading ? "Ejecutando..." : "Enviar CMD"}</Text>
            </Pressable>

            <Text style={styles.label}>Salida</Text>

            <Pressable
                style={[
                    styles.btn,
                    (!out || cmdLoading) && { opacity: 0.5 },
                    copied && styles.btnCopied,
                ]}
                disabled={!out || cmdLoading}
                onPress={onCopy}
            >
                <Text style={styles.btnText}>
                    {copied ? "✅ Copiado" : "Copiar salida"}
                </Text>
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

    // ✅ centra texto del botón "Reintentar"
    bannerBtn: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    bannerBtnText: { fontSize: 12, fontWeight: "700", textAlign: "center" },

    title: { fontSize: 24, fontWeight: "700" },
    small: { fontSize: 12, opacity: 0.7 },
    row: { flexDirection: "row", gap: 10 },
    label: { fontSize: 14, opacity: 0.8, marginTop: 8 },
    input: { borderWidth: 1, borderColor: "#999", borderRadius: 10, padding: 12 },

    // ✅ centra texto en TODOS los botones grandes
    btn: {
        backgroundColor: "black",
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 12,
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 48, // ayuda en web (expo web) para centrar bien
    },
    btnCopied: { backgroundColor: "#0b6b2d" },
    red: { backgroundColor: "#b00020" },

    // ✅ textAlign sí va en Text
    btnText: { color: "white", textAlign: "center", fontWeight: "700" },

    historyBox: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 12,
        padding: 10,
        gap: 8,
    },
    historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    historyTitle: { fontSize: 12, fontWeight: "700", opacity: 0.8 },
    historyClear: { fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
    historyChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

    // ✅ centra texto dentro de los chips
    chip: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 32,
    },
    chipText: { fontSize: 12, fontWeight: "600", textAlign: "center" },

    outBox: { borderWidth: 1, borderColor: "#999", borderRadius: 10, padding: 12, height: 220 },
    outText: { fontFamily: "monospace" },
});