import { useState } from "react";

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

function normalizeCmd(s: string) {
  return s.trim().replace(/\s+/g, " ");
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

function renderCmdResult(data: CmdResponse) {
  const prompt = `moltbot@${String(data.role || "user").toLowerCase()} > ${data.command}${
    data.argument ? " " + data.argument : ""
  }`;

  const statusLine = data.ok ? "[OK]" : "[ERROR]";

  // 🔹 CASO ESPECIAL: STATUS
  if (data.command === "STATUS") {
    return `${prompt}
${statusLine}

🟢 SYSTEM STATUS

${data.response}
`;
  }

  // 🔹 DEFAULT
  const body = data.response || "(sin respuesta)";
  const debug = `\n\n--- JSON ---\n${JSON.stringify(data, null, 2)}`;

  return `${prompt}\n${statusLine}\n\n${body}${debug}`;
}

export function useCommandHandler({
  base,
  token,
  onResult,
  onOk,
  onError,
}: {
  base: string;
  token: string;
  onResult: (out: string) => void;
  onOk: (ok: boolean) => void;
  onError?: (err: any) => void;
}) {
  const [cmdLoading, setCmdLoading] = useState(false);

  async function executeCommand(message: string) {
    if (!base || !token) return;
    if (cmdLoading) return;

    const msgClean = normalizeCmd(message);
    if (!msgClean) return;

    setCmdLoading(true);

    try {
      const url = joinUrl(base, "/cmd");

      const data = await postJson<CmdResponse>(url, {
        token,
        message: msgClean,
      });

      onResult(renderCmdResult(data));
      onOk(!!data.ok);

      return data;
    } catch (e) {
      onOk(false);
      onError?.(e);
    } finally {
      setCmdLoading(false);
    }
  }

  return {
    executeCommand,
    cmdLoading,
  };
}
