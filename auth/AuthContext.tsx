import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { clearToken, getToken, setToken } from "./authStorage";

type AuthContextValue = {
    token: string | null;
    loading: boolean;
    signIn: (token: string) => Promise<void>;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [tokenState, setTokenState] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const t = await getToken();
                setTokenState(t ?? null);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            token: tokenState,
            loading,

            signIn: async (newToken: string) => {
                const clean = (newToken ?? "").trim();
                setTokenState(clean);
                await setToken(clean);
            },

            signOut: async () => {
                try {
                    await clearToken();
                } finally {
                    setTokenState(null);
                }
            },
        }),
        [tokenState, loading]
    );

    return <AuthContext.Provider value={value}> {children} </AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuth debe usarse dentro de AuthProvider");
    }
    return ctx;
}