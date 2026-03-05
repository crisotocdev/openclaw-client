import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
    const { signIn } = useAuth();

    const [apiBase, setApiBase] = useState("http://127.0.0.1:8080");
    const [token, setToken] = useState("");
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string>("");

    useEffect(() => {
        (async () => {
            const saved = await AsyncStorage.getItem("moltbot_api");
            if (saved && saved.trim()) setApiBase(saved.trim());
        })();
    }, []);

    function showError(msg: string, title = "Error") {
        setErrorMsg(msg);
        // En móvil suele mostrarse, en web a veces no: igual lo intentamos.
        try {
            Alert.alert(title, msg);
        } catch { }
    }

    async function onSave() {
        if (saving) return;
        setErrorMsg("");

        const base = apiBase.trim().replace(/\/+$/, "");
        const tok = token.trim();

        if (!base || !tok) {
            showError("API Base y Token son obligatorios.", "Falta info");
            return;
        }

        setSaving(true);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);

        try {
            const res = await fetch(`${base}/auth/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: tok }),
                signal: controller.signal,
            });

            const text = await res.text();

            let data: any = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch {
                data = text;
            }

            const isOk =
                res.ok &&
                data &&
                typeof data === "object" &&
                (data.ok === true || data.response === "TOKEN_OK");

            if (!isOk) {
                const msg =
                    (data &&
                        typeof data === "object" &&
                        (data.response || data.error || data.message)) ||
                    `Token inválido (HTTP ${res.status})`;
                throw new Error(msg);
            }

            await AsyncStorage.setItem("moltbot_api", base);
            await signIn(tok);

            router.replace("/home");
        } catch (e: any) {
            const name = e?.name ?? "";
            const rawMsg = (e?.message ?? "").toString();
            const msg = rawMsg.toLowerCase();

            if (name === "AbortError" || msg.includes("failed to fetch") || msg.includes("network request failed")) {
                showError(
                    `No se pudo conectar al backend:\n${base}\n\nAsegúrate de que el servidor Rust esté corriendo en 8080.`,
                    "Sin conexión"
                );
                return;
            }

            showError(rawMsg || "Token inválido", "No autorizado");
        } finally {
            clearTimeout(timer);
            setSaving(false);
        }
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Moltbot</Text>

            <Text style={styles.label}>API Base</Text>
            <TextInput
                style={styles.input}
                value={apiBase}
                onChangeText={setApiBase}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!saving}
            />

            <Text style={styles.label}>Token</Text>
            <TextInput
                style={styles.input}
                value={token}
                onChangeText={(t) => setToken(t)}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!saving}
            />

            <Pressable style={[styles.btn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
                <Text style={styles.btnText}>{saving ? "Verificando..." : "Guardar"}</Text>
            </Pressable>

            {!!errorMsg && (
                <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
            )}

            <Text style={styles.hint}>En Web puedes usar 127.0.0.1. En celular luego usaremos IP/Tailscale.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 20, justifyContent: "center", gap: 10 },
    title: { fontSize: 28, fontWeight: "700" },
    label: { fontSize: 14, opacity: 0.8 },
    input: { borderWidth: 1, borderColor: "#999", borderRadius: 10, padding: 12 },
    btn: { backgroundColor: "black", padding: 14, borderRadius: 12, marginTop: 8 },
    btnText: { color: "white", textAlign: "center", fontWeight: "700" },
    errorBox: {
        borderWidth: 1,
        borderColor: "#b00020",
        borderRadius: 10,
        padding: 10,
        backgroundColor: "rgba(176,0,32,0.06)",
    },
    errorText: { color: "#b00020", fontSize: 13, lineHeight: 18 },
    hint: { marginTop: 10, fontSize: 12, opacity: 0.7 },
});