import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useAuth } from "../auth/AuthContext";

type CmdResponse = {
    ok: boolean;
    role: string;
    command: string;
    argument: string;
    response: string;
};

const API_KEY = "moltbot_api";
const HISTORY_KEY = "moltbot_cmd_history";
const HISTORY_MAX = 10;
const CHECK_INTERVAL_MS = 10000;

// ✅ comandos sugeridos (alineados con tu backend actual)
const COMMAND_SUGGESTIONS = [
    // user + admin
    "PING",
    "TIME",
    "PROCESOS",
    "WHOAMI",
    "SYSINFO",
    "HELP",
    "STATUS",
    // admin
    "NOTA",
    "VSCODE",
    "CHROME",
    "PS",
];

type VerifyResponse = {
    ok?: boolean;
    response?: string; // "TOKEN_OK"
    role?: string;
};

function joinUrl(base: string, path: string) {
    const b = base.endsWith("/") ? base.slice(0, -1) : base;
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${b}${p}`;
}

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

async function postJson<T>(url: string, body: any): Promise<T> {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
            (data &&
                typeof data === "object" &&
                (data.response || data.error || data.message)) ||
            (typeof data === "string" ? data : "") ||
            `HTTP ${res.status}`;
        throw new Error(msg);
    }

    return data as T;
}

export default function Home() {
    const { token, signOut, loading: authLoading } = useAuth();

    const [apiBase, setApiBase] = useState("");
    const [cmd, setCmd] = useState("PING");
    const [out, setOut] = useState("");
    const [loading, setLoading] = useState(true);
    const [cmdLoading, setCmdLoading] = useState(false);

    // null = verificando/unknown
    const [online, setOnline] = useState<null | boolean>(null);

    const [history, setHistory] = useState<string[]>([]);

    const base = useMemo(() => apiBase.trim(), [apiBase]);
    const tok = useMemo(() => (token ?? "").trim(), [token]);

    // ✅ sugerencias según lo escrito
    const suggestions = useMemo(() => {
        const q = normalizeCmd(cmd).toUpperCase();
        if (!q) return [];
        // solo sugiere si está escribiendo la primera palabra
        if (q.includes(" ")) return [];
        return COMMAND_SUGGESTIONS.filter((c) => c.startsWith(q) && c !== q).slice(
            0,
            6
        );
    }, [cmd]);

    // ✅ refs para polling sin recrear interval
    const baseRef = useRef<string>("");
    const tokRef = useRef<string>("");

    useEffect(() => {
        baseRef.current = base;
    }, [base]);

    useEffect(() => {
        tokRef.current = tok;
    }, [tok]);

    // Copiar feedback (web)
    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showCopiedToast() {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1200);
    }

    async function loadHistory() {
        try {
            const raw = await AsyncStorage.getItem(HISTORY_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                const cleaned = arr
                    .map((x) => (typeof x === "string" ? normalizeCmd(x) : ""))
                    .filter(Boolean);
                setHistory(dedupeKeepOrder(cleaned).slice(0, HISTORY_MAX));
            }
        } catch { }
    }

    async function saveHistory(next: string[]) {
        try {
            await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch { }
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
        } catch { }
    }

    async function checkBackend(_reason: string) {
        const b = baseRef.current;
        const t = tokRef.current;

        if (!b) {
            setOnline(null);
            return;
        }

        try {
            if (!t) {
                setOnline(null);
                return;
            }

            const url = joinUrl(b, "/auth/verify");
            const data = await postJson<VerifyResponse>(url, { token: t });

            const ok =
                data &&
                typeof data === "object" &&
                (data.ok === true ||
                    String(data.response ?? "").toUpperCase() === "TOKEN_OK");

            setOnline(ok ? true : false);

            // token inválido -> logout
            if (!ok) {
                await signOut();
                router.replace("/login");
            }
        } catch (e: any) {
            const msg = String(e?.message ?? "");
            if (
                msg.toLowerCase().includes("token") ||
                msg.toLowerCase().includes("unauthorized")
            ) {
                setOnline(false);
                await signOut();
                router.replace("/login");
                return;
            }
            setOnline(false);
        }
    }

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;

        (async () => {
            if (authLoading) return;

            const a = (await AsyncStorage.getItem(API_KEY))?.trim();

            if (!a || !tok) {
                setLoading(false);
                router.replace("/login");
                return;
            }

            setApiBase(a);
            await loadHistory();

            await checkBackend("init");
            setLoading(false);

            timer = setInterval(() => {
                void checkBackend("poll");
            }, CHECK_INTERVAL_MS);
        })();

        return () => {
            if (timer) clearInterval(timer);
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
        };
    }, [authLoading, tok]);

    function renderCmdResult(data: CmdResponse) {
        const human =
            `${data.ok ? "✅" : "❌"} ${data.role} | ${data.command}` +
            `${data.argument ? " " + data.argument : ""}\n${data.response}`;

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

        setCmdLoading(true);
        try {
            const url = joinUrl(base, "/cmd");
            const data = await postJson<CmdResponse>(url, {
                token: tok,
                message: msgClean,
            });

            setOut(renderCmdResult(data));
            await pushHistory(msgClean);

            void checkBackend("after_cmd");
        } catch (e: any) {
            const msg = String(e?.message ?? "Error");

            if (msg.toLowerCase().includes("token")) {
                await signOut();
                router.replace("/login");
                return;
            }

            Alert.alert("Error", msg);
            setOnline(false);
        } finally {
            setCmdLoading(false);
        }
    }

    async function whoami() {
        await runCommand("WHOAMI");
    }

    async function sendCmd() {
        const message = cmd.trim();
        if (!message) {
            Alert.alert("Falta comando", "Escribe un comando (ej: PING).");
            return;
        }
        await runCommand(message);
    }

    // ✅ completa con primera sugerencia (TAB)
    function applyFirstSuggestion() {
        if (cmdLoading) return false;
        if (suggestions.length === 0) return false;

        const s = suggestions[0];
        // PS lo dejamos con espacio para que puedas escribir argumento
        setCmd(s === "PS" ? "PS " : s);
        return true;
    }

    // ✅ ENTER: completa primero si está parcial
    async function onSubmitSmart() {
        const q = normalizeCmd(cmd).toUpperCase();
        if (suggestions.length > 0 && q !== suggestions[0]) {
            const s = suggestions[0];
            setCmd(s === "PS" ? "PS " : s);
            return;
        }
        await sendCmd();
    }

    async function logout() {
        if (cmdLoading) return;

        try {
            await AsyncStorage.removeItem(API_KEY);
            await AsyncStorage.removeItem(HISTORY_KEY);
        } catch { }

        await signOut();
        setOut("");
        setCmd("PING");
        router.replace("/login");
    }

    async function onCopy() {
        if (!out || cmdLoading) return;

        try {
            // @ts-ignore
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                // @ts-ignore
                await navigator.clipboard.writeText(out);
                showCopiedToast();
                return;
            }
        } catch { }

        Alert.alert("No disponible", "Copiar funciona solo en web por ahora.");
    }

    const canUse = !!tok && !!base && !cmdLoading;
    const canSend = !!cmd.trim() && canUse;

    if (loading || authLoading) {
        return (
            <View style={styles.center}>
                <Text>Cargando...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* ✅ Banner Online/Offline */}
            <View
                style={[
                    styles.banner,
                    online === true && styles.bannerOk,
                    online === false && styles.bannerBad,
                ]}
            >
                <Text style={styles.bannerText}>
                    {online === null
                        ? "⚪ Estado: verificando..."
                        : online
                            ? "🟢 Backend ONLINE"
                            : "🔴 Backend OFFLINE"}
                </Text>

                <Pressable
                    onPress={() => checkBackend("manual")}
                    disabled={cmdLoading}
                    style={({ pressed }) => [
                        styles.bannerBtn,
                        pressed && { opacity: 0.85 },
                        cmdLoading && { opacity: 0.6 },
                    ]}
                >
                    <Text style={styles.bannerBtnText}>Reintentar</Text>
                </Pressable>
            </View>

            <Text style={styles.title}>Panel</Text>
            <Text style={styles.small}>API: {base || "(no configurada)"}</Text>

            <View style={styles.row}>
                <Pressable
                    style={[styles.btn, (!canUse || cmdLoading) && { opacity: 0.5 }]}
                    onPress={whoami}
                    disabled={!canUse || cmdLoading}
                >
                    <Text style={styles.btnText}>{cmdLoading ? "..." : "Whoami"}</Text>
                </Pressable>

                <Pressable
                    style={[styles.btn, styles.red]}
                    onPress={logout}
                    disabled={cmdLoading}
                >
                    <Text style={styles.btnText}>Salir</Text>
                </Pressable>
            </View>

            <Text style={styles.label}>Comando</Text>
            <TextInput
                style={styles.input}
                value={cmd}
                onChangeText={setCmd}
                autoCapitalize="none"
                onSubmitEditing={onSubmitSmart} // ✅ ENTER inteligente
                returnKeyType="send"
                editable={!cmdLoading}
                placeholder="PING"
                onKeyPress={(e) => {
                    // ✅ TAB en web
                    // @ts-ignore
                    if (e?.nativeEvent?.key === "Tab") {
                        // @ts-ignore
                        e.preventDefault?.();
                        applyFirstSuggestion();
                    }
                }}
            />

            {/* ✅ Autocomplete / sugerencias */}
            {suggestions.length > 0 && (
                <View style={styles.suggestBox}>
                    {suggestions.map((s) => (
                        <Pressable
                            key={s}
                            disabled={cmdLoading}
                            onPress={() => setCmd(s === "PS" ? "PS " : s)}
                            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
                        >
                            <Text style={styles.chipText}>{s}</Text>
                        </Pressable>
                    ))}
                </View>
            )}

            {history.length > 0 && (
                <View style={styles.historyBox}>
                    <View style={styles.historyHeader}>
                        <Text style={styles.historyTitle}>Historial</Text>
                        <Pressable onPress={clearHistory} disabled={cmdLoading}>
                            <Text style={styles.historyClear}>Limpiar</Text>
                        </Pressable>
                    </View>

                    <View style={styles.historyChips}>
                        {history.map((h) => (
                            <Pressable
                                key={h}
                                disabled={cmdLoading}
                                onPress={() => setCmd(h)}
                                style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
                            >
                                <Text style={styles.chipText}>{h}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            )}

            <Pressable
                style={[styles.btnWide, (!canSend || cmdLoading) && { opacity: 0.5 }]}
                onPress={sendCmd}
                disabled={!canSend || cmdLoading}
            >
                <Text style={styles.btnText}>
                    {cmdLoading ? "Ejecutando..." : "Enviar CMD"}
                </Text>
            </Pressable>

            <Text style={styles.label}>Salida</Text>

            <Pressable
                style={[
                    styles.btnWide,
                    (!out || cmdLoading) && { opacity: 0.5 },
                    copied && styles.green,
                ]}
                onPress={onCopy}
                disabled={!out || cmdLoading}
            >
                <Text style={styles.btnText}>{copied ? "✅ Copiado" : "Copiar salida"}</Text>
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
    center: { flex: 1, alignItems: "center", justifyContent: "center" },

    container: { flex: 1, padding: 20, gap: 10, paddingTop: 40 },
    title: { fontSize: 24, fontWeight: "700" },
    small: { fontSize: 12, opacity: 0.7 },

    row: { flexDirection: "row", gap: 10 },

    label: { fontSize: 14, opacity: 0.8, marginTop: 8 },
    input: { borderWidth: 1, borderColor: "#999", borderRadius: 10, padding: 12 },

    btn: {
        backgroundColor: "black",
        padding: 14,
        borderRadius: 12,
        flex: 1,
        alignItems: "center",
    },
    btnWide: {
        backgroundColor: "black",
        padding: 14,
        borderRadius: 12,
        alignItems: "center",
    },
    red: { backgroundColor: "#b00020" },
    green: { backgroundColor: "#0b6b2d" },

    btnText: { color: "white", textAlign: "center", fontWeight: "700" },

    suggestBox: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

    historyBox: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 12,
        padding: 10,
        gap: 8,
    },
    historyHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    historyTitle: { fontSize: 12, fontWeight: "700", opacity: 0.8 },
    historyClear: {
        fontSize: 12,
        fontWeight: "700",
        textDecorationLine: "underline",
    },

    historyChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 10,
    },
    chipText: { fontSize: 12, fontWeight: "600" },

    outBox: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 10,
        padding: 12,
        height: 220,
    },
    outText: { fontFamily: "monospace" },

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
        backgroundColor: "rgba(27,94,32,0.10)",
    },
    bannerBad: {
        borderColor: "#b00020",
        backgroundColor: "rgba(176,0,32,0.08)",
    },
    bannerText: { fontSize: 13, fontWeight: "600" },

    bannerBtn: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    bannerBtnText: { fontSize: 12, fontWeight: "700" },
});