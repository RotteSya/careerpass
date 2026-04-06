type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type OpenClawChatRequest = {
  agentId: string;
  userId: number;
  sessionId: string;
  message: string;
  history: ChatHistoryItem[];
  systemPrompt: string;
};

function extractReply(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;
  if (typeof obj.reply === "string") return obj.reply;
  if (typeof obj.text === "string") return obj.text;

  const output = obj.output as Record<string, unknown> | undefined;
  if (output && typeof output.text === "string") return output.text;

  const message = obj.message as Record<string, unknown> | undefined;
  if (message && typeof message.content === "string") return message.content;

  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const msg = first.message as Record<string, unknown> | undefined;
    if (msg && typeof msg.content === "string") return msg.content;
  }

  return null;
}

export function isOpenClawChatEnabled(): boolean {
  return (process.env.OPENCLAW_CHAT_ENABLED ?? "false").toLowerCase() === "true";
}

export function isOpenClawChatRequired(): boolean {
  return (process.env.OPENCLAW_CHAT_REQUIRED ?? "false").toLowerCase() === "true";
}

export async function openClawChat(req: OpenClawChatRequest): Promise<string> {
  const endpoint = process.env.OPENCLAW_CHAT_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error("OPENCLAW_CHAT_ENDPOINT is not set");
  }

  const timeoutMs = Number(process.env.OPENCLAW_CHAT_TIMEOUT_MS ?? "25000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 25000);

  try {
    const token = process.env.OPENCLAW_CHAT_TOKEN?.trim();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        agentId: req.agentId,
        sessionKey: `careerpass:${req.userId}:${req.sessionId}`,
        userId: String(req.userId),
        message: req.message,
        history: req.history,
        systemPrompt: req.systemPrompt,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenClaw endpoint failed: ${res.status} ${body.slice(0, 400)}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      if (!text.trim()) throw new Error("OpenClaw endpoint returned empty body");
      return text;
    }

    const data = (await res.json()) as unknown;
    const reply = extractReply(data);
    if (!reply) throw new Error("OpenClaw response has no reply text");
    return reply;
  } finally {
    clearTimeout(timer);
  }
}
