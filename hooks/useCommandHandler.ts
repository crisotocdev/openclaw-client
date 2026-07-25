import { useCallback, useRef, useState } from "react";

export type CmdResponse = {
  ok: boolean;
  role: string;
  command: string;
  argument: string;
  response: string;
};

type ExecuteCommandOptions = {
  /**
   * No escribe el resultado en la terminal ni modifica el indicador
   * del último comando.
   *
   * Es útil para comandos internos como HELP durante el arranque.
   */
  silent?: boolean;
};

type UseCommandHandlerParams = {
  base: string;
  token: string;
  onResult: (out: string) => void;
  onOk: (ok: boolean) => void;
  onError?: (err: unknown) => void;
};

function joinUrl(base: string, path: string) {
  const normalizedBase = base.endsWith("/")
    ? base.slice(0, -1)
    : base;

  const normalizedPath = path.startsWith("/")
    ? path
    : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

function normalizeCmd(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

async function postJson<T>(
  url: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    if (typeof data === "string" && data.trim()) {
      message = data;
    }

    if (data && typeof data === "object") {
      const errorData = data as {
        response?: unknown;
        error?: unknown;
        message?: unknown;
      };

      message = String(
        errorData.response ??
          errorData.error ??
          errorData.message ??
          message,
      );
    }

    throw new Error(message);
  }

  return data as T;
}

function renderCmdResult(data: CmdResponse) {
  const role = String(data.role || "user").toLowerCase();

  const argument = data.argument
    ? ` ${data.argument}`
    : "";

  const prompt =
    `moltbot@${role} > ${data.command}${argument}`;

  const statusLine = data.ok
    ? "[OK]"
    : "[ERROR]";

  if (data.command.toUpperCase() === "STATUS") {
    let parsed: {
      status?: string;
      version?: string;
      uptime?: string;
      os?: string;
      pid?: number;
      cpu?: number;
      ram_used?: number;
      ram_total?: number;
    };

    try {
      parsed = JSON.parse(data.response);
    } catch {
      return [
        prompt,
        "[ERROR]",
        "",
        "Invalid STATUS JSON",
      ].join("\n");
    }

    const cpu = Number(parsed.cpu ?? 0);

    // Actualmente asumimos que el backend devuelve la RAM en MB.
    const ramUsed = Number(parsed.ram_used ?? 0) / 1024;
    const ramTotal = Number(parsed.ram_total ?? 0) / 1024;

    const systemStatus =
      parsed.status === "online"
        ? "🟢 ONLINE"
        : "🔴 OFFLINE";

    return [
      prompt,
      statusLine,
      "",
      "SYSTEM STATUS",
      "",
      `STATUS: ${systemStatus}`,
      `VERSION: ${parsed.version ?? "desconocida"}`,
      `UPTIME: ${parsed.uptime ?? "desconocido"}`,
      `OS: ${parsed.os ?? "desconocido"}`,
      `PID: ${parsed.pid ?? "desconocido"}`,
      "",
      `CPU: ${cpu.toFixed(2)}%`,
      `RAM: ${ramUsed.toFixed(1)} / ${ramTotal.toFixed(1)} GB`,
    ].join("\n");
  }

  const body = data.response || "(sin respuesta)";

  const debug = [
    "",
    "",
    "--- JSON ---",
    JSON.stringify(data, null, 2),
  ].join("\n");

  return [
    prompt,
    statusLine,
    "",
    body,
    debug,
  ].join("\n");
}

export function useCommandHandler({
  base,
  token,
  onResult,
  onOk,
  onError,
}: UseCommandHandlerParams) {
  const [cmdLoading, setCmdLoading] = useState(false);

  /*
   * El estado de React no cambia inmediatamente.
   * Esta referencia impide dos solicitudes simultáneas reales.
   */
  const executingRef = useRef(false);

  /*
   * Conservamos siempre las funciones más recientes sin obligar a
   * recrear executeCommand cada vez que Home se renderiza.
   */
  const callbacksRef = useRef({
    onResult,
    onOk,
    onError,
  });

  callbacksRef.current = {
    onResult,
    onOk,
    onError,
  };

  const executeCommand = useCallback(
    async (
      message: string,
      options: ExecuteCommandOptions = {},
    ): Promise<CmdResponse | undefined> => {
      const normalizedBase = base.trim();
      const normalizedToken = token.trim();
      const normalizedMessage = normalizeCmd(message);

      if (
        !normalizedBase ||
        !normalizedToken ||
        !normalizedMessage
      ) {
        return undefined;
      }

      if (executingRef.current) {
        return undefined;
      }

      executingRef.current = true;
      setCmdLoading(true);

      try {
        const url = joinUrl(normalizedBase, "/cmd");

        const data = await postJson<CmdResponse>(url, {
          token: normalizedToken,
          message: normalizedMessage,
        });

        if (!options.silent) {
          callbacksRef.current.onResult(
            renderCmdResult(data),
          );

          callbacksRef.current.onOk(Boolean(data.ok));
        }

        return data;
      } catch (error: unknown) {
        if (!options.silent) {
          callbacksRef.current.onOk(false);
        }

        callbacksRef.current.onError?.(error);

        return undefined;
      } finally {
        executingRef.current = false;
        setCmdLoading(false);
      }
    },
    [base, token],
  );

  return {
    executeCommand,
    cmdLoading,
  };
}
