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

type VerifyResponse = {
    ok?: boolean;
    response?: string;
    role?: string;
};

type HistoryStat = {
    command: string;
    count: number;
    lastUsedAt: number;
};

type StoredHistoryV2 = {
    stats: HistoryStat[];
    recent: string[];
};

const API_KEY = "moltbot_api";
const HISTORY_KEY = "moltbot_cmd_history";
const HISTORY_MAX = 10;
const CHECK_INTERVAL_MS = 10000;

const USER_COMMANDS = [
    "PING",
    "TIME",
    "PROCESOS",
    "WHOAMI",
    "SYSINFO",
    "STATUS",
    "HELP",
    "VERSION",
];

const ADMIN_COMMANDS = ["NOTA", "VSCODE", "CHROME", "PS"];

const USER_SUGGESTIONS = [
    "PING",
    "TIME",
    "PROCESOS",
    "WHOAMI",
    "SYSINFO",
    "STATUS",
    "HELP",
    "VERSION",
];

const ADMIN_EXTRA_SUGGESTIONS = ["NOTA", "VSCODE", "CHROME", "PS"];

const VALID_COMMANDS = [
    "PING",
    "TIME",
    "PROCESOS",
    "WHOAMI",
    "SYSINFO",
    "STATUS",
    "HELP",
    "VERSION",
    "NOTA",
    "VSCODE",
    "CHROME",
    "PS",
];

function CommandBadge({ label }: { label: string }) {
    return (
        <View style={styles.commandBadge}>
            <Text style={styles.commandBadgeText}>{label}</Text>
        </View>
    );
}

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

function normalizeHistoryCommand(s: string) {
    return normalizeCmd(s).toUpperCase();
}

function isValidCommand(command: string) {
    return VALID_COMMANDS.includes(command);
}

function sortHistoryStats(stats: HistoryStat[]) {
    return [...stats].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.lastUsedAt - a.lastUsedAt;
    });
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
    const [online, setOnline] = useState<null | boolean>(null);
    const [historyStats, setHistoryStats] = useState<HistoryStat[]>([]);
    const [recentHistory, setRecentHistory] = useState<string[]>([]);
    const [role, setRole] = useState("");
    const [lastCmdOk, setLastCmdOk] = useState<null | boolean>(null);

    const base = useMemo(() => apiBase.trim(), [apiBase]);
    const tok = useMemo(() => (token ?? "").trim(), [token]);

    const allowedSuggestions = useMemo(() => {
        const baseList = [...USER_SUGGESTIONS];
        if (role.toUpperCase() === "ADMIN") {
            return [...baseList, ...ADMIN_EXTRA_SUGGESTIONS];
        }
        return baseList;
    }, [role]);

    const suggestions = useMemo(() => {
        const q = normalizeCmd(cmd).toUpperCase();
        if (!q) return [];
        if (q.includes(" ")) return [];
        return allowedSuggestions.filter((c) => c.startsWith(q) && c !== q).slice(0, 6);
    }, [cmd, allowedSuggestions]);

    const topHistory = useMemo(() => {
        return sortHistoryStats(historyStats).slice(0, HISTORY_MAX);
    }, [historyStats]);

    const baseRef = useRef<string>("");
    const tokRef = useRef<string>("");
    const outScrollRef = useRef<ScrollView | null>(null);

    useEffect(() => {
        baseRef.current = base;
    }, [base]);

    useEffect(() => {
        tokRef.current = tok;
    }, [tok]);

    useEffect(() => {
        if (!out) return;
        const id = setTimeout(() => {
            outScrollRef.current?.scrollToEnd({ animated: true });
        }, 30);
        return () => clearTimeout(id);
    }, [out]);

    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    function showCopiedToast() {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1200);
    }

    async function saveHistory(nextStats: HistoryStat[], nextRecent: string[]) {
        try {
            const payload: StoredHistoryV2 = {
                stats: nextStats,
                recent: nextRecent,
            };
            await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
        } catch { }
    }

    async function loadHistory() {
        try {
            const raw = await AsyncStorage.getItem(HISTORY_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed)) {
                const cleanedRecent = dedupeKeepOrder(
                    parsed
                        .map((x) => (typeof x === "string" ? normalizeHistoryCommand(x) : ""))
                        .filter((x) => x && isValidCommand(x))
                ).slice(0, HISTORY_MAX);

                const legacyStats: HistoryStat[] = cleanedRecent.map((command, index) => ({
                    command,
                    count: 1,
                    lastUsedAt: Date.now() - index,
                }));

                setRecentHistory(cleanedRecent);
                setHistoryStats(legacyStats);
                void saveHistory(legacyStats, cleanedRecent);
                return;
            }

            if (parsed && typeof parsed === "object") {
                const statsRaw = Array.isArray(parsed.stats) ? parsed.stats : [];
                const recentRaw = Array.isArray(parsed.recent) ? parsed.recent : [];

                const cleanedStats: HistoryStat[] = statsRaw
                    .map((x: any) => ({
                        command:
                            typeof x?.command === "string"
                                ? normalizeHistoryCommand(x.command)
                                : "",
                        count:
                            typeof x?.count === "number" && Number.isFinite(x.count) && x.count > 0
                                ? Math.floor(x.count)
                                : 1,
                        lastUsedAt:
                            typeof x?.lastUsedAt === "number" && Number.isFinite(x.lastUsedAt)
                                ? x.lastUsedAt
                                : 0,
                    }))
                    .filter((x: HistoryStat) => !!x.command && isValidCommand(x.command));

                const dedupedStatsMap = new Map<string, HistoryStat>();
                for (const item of cleanedStats) {
                    const prev = dedupedStatsMap.get(item.command);
                    if (!prev) {
                        dedupedStatsMap.set(item.command, item);
                    } else {
                        dedupedStatsMap.set(item.command, {
                            command: item.command,
                            count: prev.count + item.count,
                            lastUsedAt: Math.max(prev.lastUsedAt, item.lastUsedAt),
                        });
                    }
                }

                const finalStats = Array.from(dedupedStatsMap.values());

                const cleanedRecent = dedupeKeepOrder(
                    recentRaw
                        .map((x: any) =>
                            typeof x === "string" ? normalizeHistoryCommand(x) : ""
                        )
                        .filter((x: string) => !!x && isValidCommand(x))
                ).slice(0, HISTORY_MAX);

                setHistoryStats(finalStats);
                setRecentHistory(cleanedRecent);
                void saveHistory(finalStats, cleanedRecent);
            }
        } catch { }
    }

    async function pushHistory(entry: string) {
        const normalized = normalizeHistoryCommand(entry);
        if (!normalized) return;
        if (!isValidCommand(normalized)) return;

        const now = Date.now();

        setHistoryStats((prevStats) => {
            const idx = prevStats.findIndex((x) => x.command === normalized);

            let nextStats: HistoryStat[];
            if (idx >= 0) {
                nextStats = prevStats.map((item, i) =>
                    i === idx
                        ? {
                            ...item,
                            count: item.count + 1,
                            lastUsedAt: now,
                        }
                        : item
                );
            } else {
                nextStats = [
                    ...prevStats,
                    {
                        command: normalized,
                        count: 1,
                        lastUsedAt: now,
                    },
                ];
            }

            setRecentHistory((prevRecent) => {
                const nextRecent = dedupeKeepOrder([normalized, ...prevRecent]).slice(
                    0,
                    HISTORY_MAX
                );
                void saveHistory(nextStats, nextRecent);
                return nextRecent;
            });

            return nextStats;
        });
    }

    async function clearHistory() {
        setHistoryStats([]);
        setRecentHistory([]);
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

            if (ok) {
                setRole(String(data.role ?? "").toUpperCase());
            }

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
        const prompt = `moltbot@${String(data.role || "user").toLowerCase()} > ${data.command}${data.argument ? " " + data.argument : ""
            }`;

        const statusLine = data.ok ? "[OK]" : "[ERROR]";
        const body = data.response || "(sin respuesta)";
        const debug = `\n\n--- JSON ---\n${JSON.stringify(data, null, 2)}`;

        return `${prompt}\n${statusLine}\n\n${body}${debug}`;
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
            setLastCmdOk(!!data.ok);
            await pushHistory(data.command || msgClean);

            void checkBackend("after_cmd");
        } catch (e: any) {
            const msg = String(e?.message ?? "Error");

            if (msg.toLowerCase().includes("token")) {
                await signOut();
                router.replace("/login");
                return;
            }

            setLastCmdOk(false);
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

    function applyFirstSuggestion() {
        if (cmdLoading) return false;
        if (suggestions.length === 0) return false;

        const s = suggestions[0];
        setCmd(s === "PS" ? "PS " : s);
        return true;
    }

    async function onSubmitSmart() {
        const q = normalizeCmd(cmd).toUpperCase();
        if (suggestions.length > 0 && q !== suggestions[0]) {
            const s = suggestions[0];
            setCmd(s === "PS" ? "PS " : s);
            return;
        }
        await sendCmd();
    }

    async function repeatCommand(command: string) {
        await runCommand(command);
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
        setRole("");
        setHistoryStats([]);
        setRecentHistory([]);
        setLastCmdOk(null);
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
    const hasHistory = topHistory.length > 0 || recentHistory.length > 0;

    if (loading || authLoading) {
        return (
            <View style={styles.center}>
                <Text>Cargando...</Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
        >
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

            <Text style={styles.title}>Panel Moltbot</Text>
            <Text style={styles.small}>API: {base || "(no configurada)"}</Text>
            <Text style={styles.small}>Rol: {role || "(desconocido)"}</Text>

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
                autoCapitalize="characters"
                onSubmitEditing={onSubmitSmart}
                returnKeyType="send"
                editable={!cmdLoading}
                placeholder="PING"
                placeholderTextColor="#7c8796"
                onKeyPress={(e) => {
                    // @ts-ignore
                    if (e?.nativeEvent?.key === "Tab") {
                        // @ts-ignore
                        e.preventDefault?.();
                        applyFirstSuggestion();
                    }
                }}
            />

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

            <View style={styles.helpPanel}>
                <Text style={styles.helpPanelTitle}>Comandos disponibles</Text>

                <View style={styles.commandSection}>
                    <Text style={styles.commandSectionTitle}>USER</Text>
                    <View style={styles.commandList}>
                        {USER_COMMANDS.map((cmdItem) => (
                            <CommandBadge key={cmdItem} label={cmdItem} />
                        ))}
                    </View>
                </View>

                <View style={styles.commandSection}>
                    <Text style={styles.commandSectionTitle}>ADMIN</Text>
                    <View style={styles.commandList}>
                        {ADMIN_COMMANDS.map((cmdItem) => (
                            <CommandBadge key={cmdItem} label={cmdItem} />
                        ))}
                    </View>
                </View>
            </View>

            {hasHistory && (
                <View style={styles.historyBox}>
                    <View style={styles.historyHeader}>
                        <Text style={styles.historyTitle}>Historial inteligente</Text>
                        <Pressable onPress={clearHistory} disabled={cmdLoading}>
                            <Text style={styles.historyClear}>Limpiar</Text>
                        </Pressable>
                    </View>

                    {topHistory.length > 0 && (
                        <View style={styles.historySection}>
                            <Text style={styles.historySectionTitle}>Más usados</Text>

                            <View style={styles.historyList}>
                                {topHistory.map((item) => (
                                    <View key={item.command} style={styles.historyRow}>
                                        <View style={styles.historyInfo}>
                                            <Text style={styles.historyCommand}>
                                                {item.command}
                                            </Text>
                                            <Text style={styles.historyMeta}>
                                                Usos: {item.count}
                                            </Text>
                                        </View>

                                        <View style={styles.historyActions}>
                                            <Pressable
                                                disabled={cmdLoading}
                                                onPress={() => setCmd(item.command)}
                                                style={({ pressed }) => [
                                                    styles.secondaryBtn,
                                                    pressed && { opacity: 0.85 },
                                                    cmdLoading && { opacity: 0.6 },
                                                ]}
                                            >
                                                <Text style={styles.secondaryBtnText}>
                                                    Cargar
                                                </Text>
                                            </Pressable>

                                            <Pressable
                                                disabled={cmdLoading}
                                                onPress={() => repeatCommand(item.command)}
                                                style={({ pressed }) => [
                                                    styles.repeatBtn,
                                                    pressed && { opacity: 0.85 },
                                                    cmdLoading && { opacity: 0.6 },
                                                ]}
                                            >
                                                <Text style={styles.repeatBtnText}>
                                                    Repetir
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    {recentHistory.length > 0 && (
                        <View style={styles.historySection}>
                            <Text style={styles.historySectionTitle}>Últimos 10</Text>

                            <View style={styles.historyChips}>
                                {recentHistory.map((item) => (
                                    <Pressable
                                        key={item}
                                        disabled={cmdLoading}
                                        onPress={() => setCmd(item)}
                                        style={({ pressed }) => [
                                            styles.chip,
                                            pressed && { opacity: 0.85 },
                                        ]}
                                    >
                                        <Text style={styles.chipText}>{item}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>
                    )}
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

            <View
                style={[
                    styles.outShell,
                    lastCmdOk === true && styles.outShellOk,
                    lastCmdOk === false && styles.outShellBad,
                ]}
            >
                <View style={styles.outHeader}>
                    <Text style={styles.outHeaderText}>TERMINAL</Text>
                    <Text style={styles.outHeaderStatus}>
                        {cmdLoading ? "RUNNING..." : lastCmdOk === false ? "ERROR" : "READY"}
                    </Text>
                </View>

                <ScrollView
                    ref={outScrollRef}
                    style={styles.outBox}
                    contentContainerStyle={styles.outBoxContent}
                    onContentSizeChange={() =>
                        outScrollRef.current?.scrollToEnd({ animated: true })
                    }
                >
                    <Text selectable style={styles.outText}>
                        {out || "moltbot@panel > esperando comando..."}
                    </Text>
                </ScrollView>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },

    screen: {
        flex: 1,
        backgroundColor: "#f5f7fb",
    },

    container: {
        padding: 20,
        gap: 10,
        paddingTop: 40,
        paddingBottom: 40,
    },

    title: {
        fontSize: 24,
        fontWeight: "700",
    },

    small: {
        fontSize: 12,
        opacity: 0.7,
    },

    row: {
        flexDirection: "row",
        gap: 10,
    },

    label: {
        fontSize: 14,
        opacity: 0.8,
        marginTop: 8,
    },

    input: {
        borderWidth: 1,
        borderColor: "#b8c0cc",
        borderRadius: 12,
        padding: 12,
        backgroundColor: "#ffffff",
        fontWeight: "600",
    },

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

    red: {
        backgroundColor: "#b00020",
    },

    green: {
        backgroundColor: "#0b6b2d",
    },

    btnText: {
        color: "white",
        textAlign: "center",
        fontWeight: "700",
    },

    suggestBox: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    helpPanel: {
        marginTop: 6,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#d5dbe3",
        backgroundColor: "#ffffff",
        gap: 6,
    },

    helpPanelTitle: {
        fontSize: 16,
        fontWeight: "700",
        marginBottom: 4,
    },

    commandSection: {
        marginTop: 4,
        marginBottom: 6,
    },

    commandSectionTitle: {
        fontSize: 13,
        fontWeight: "700",
        marginBottom: 8,
        opacity: 0.8,
    },

    commandList: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    commandBadge: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "#c8d0da",
        backgroundColor: "#eef3f8",
    },

    commandBadgeText: {
        fontSize: 12,
        fontWeight: "600",
    },

    historyBox: {
        borderWidth: 1,
        borderColor: "#d5dbe3",
        borderRadius: 12,
        padding: 12,
        gap: 12,
        backgroundColor: "#ffffff",
    },

    historyHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },

    historyTitle: {
        fontSize: 14,
        fontWeight: "700",
        opacity: 0.9,
    },

    historyClear: {
        fontSize: 12,
        fontWeight: "700",
        textDecorationLine: "underline",
    },

    historySection: {
        gap: 8,
    },

    historySectionTitle: {
        fontSize: 12,
        fontWeight: "700",
        opacity: 0.8,
    },

    historyList: {
        gap: 8,
    },

    historyRow: {
        borderWidth: 1,
        borderColor: "#d5dbe3",
        borderRadius: 12,
        padding: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        backgroundColor: "#fafbfd",
    },

    historyInfo: {
        flex: 1,
        gap: 2,
    },

    historyCommand: {
        fontSize: 14,
        fontWeight: "700",
    },

    historyMeta: {
        fontSize: 12,
        opacity: 0.75,
    },

    historyActions: {
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
    },

    historyChips: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    secondaryBtn: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ffffff",
    },

    secondaryBtnText: {
        fontSize: 12,
        fontWeight: "700",
    },

    repeatBtn: {
        backgroundColor: "black",
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },

    repeatBtnText: {
        color: "white",
        fontSize: 12,
        fontWeight: "700",
    },

    chip: {
        borderWidth: 1,
        borderColor: "#c8d0da",
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: "#ffffff",
    },

    chipText: {
        fontSize: 12,
        fontWeight: "600",
    },

    outShell: {
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "#1f2937",
        backgroundColor: "#0b1220",
        marginTop: 4,
    },

    outShellOk: {
        borderColor: "#14532d",
    },

    outShellBad: {
        borderColor: "#7f1d1d",
    },

    outHeader: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(255,255,255,0.08)",
        backgroundColor: "#111827",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },

    outHeaderText: {
        color: "#e5e7eb",
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 1,
    },

    outHeaderStatus: {
        color: "#93c5fd",
        fontSize: 11,
        fontWeight: "700",
    },

    outBox: {
        height: 360,
    },

    outBoxContent: {
        padding: 12,
    },

    outText: {
        fontFamily: "monospace",
        color: "#00ff9c",
        lineHeight: 20,
        fontSize: 13,
    },

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

    bannerText: {
        fontSize: 13,
        fontWeight: "600",
    },

    bannerBtn: {
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ffffff",
    },

    bannerBtnText: {
        fontSize: 12,
        fontWeight: "700",
    },
});