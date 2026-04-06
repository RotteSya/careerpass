import crypto from "crypto";
import { handleAgentChat } from "./agents";
import { saveAgentMemory } from "./db";

type ChatHistoryItem = { role: string; content: string };

type HybridChatParams = {
  userId: number;
  message: string;
  sessionId?: string;
  history?: ChatHistoryItem[];
  extraSystemInstruction?: string;
};

type HybridChatResult = {
  reply: string;
  sessionId: string;
  mode: "openclaw" | "legacy";
};

function isTruthy(input: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((input ?? "").trim());
}

function buildOpenClawUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function extractReply(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;

  const topLevel = body.reply ?? body.text ?? body.output_text;
  if (typeof topLevel === "string" && topLevel.trim()) return topLevel;

  const choices = body.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }
  }

  return null;
}

async function invokeOpenClawChat(params: {
  message: string;
  sessionId: string;
  history: ChatHistoryItem[];
  extraSystemInstruction?: string;
  userId: number;
}): Promise<string> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "";
  if (!gatewayUrl) {
    throw new Error("OPENCLAW_GATEWAY_URL is not configured");
  }

  const endpoint = process.env.OPENCLAW_CHAT_ENDPOINT ?? "/v1/chat/completions";
  const url = buildOpenClawUrl(gatewayUrl, endpoint);
  const apiKey = process.env.OPENCLAW_API_KEY;
  const agentId = process.env.OPENCLAW_AGENT_ID ?? "careerpass";

  const messages = [
    ...(params.extraSystemInstruction
      ? [{ role: "system" as const, content: params.extraSystemInstruction }]
      : []),
    ...params.history,
    { role: "user" as const, content: params.message },
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      agentId,
      sessionId: params.sessionId,
      userId: params.userId,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenClaw request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as unknown;
  const reply = extractReply(payload);
  if (!reply) {
    throw new Error("OpenClaw response has no readable reply");
  }
  return reply;
}

export async function handleHybridAgentChat(params: HybridChatParams): Promise<HybridChatResult> {
  const sid = params.sessionId ?? crypto.randomUUID();
  const history = params.history ?? [];
  const hybridEnabled = isTruthy(process.env.OPENCLAW_HYBRID_ENABLED);

  if (!hybridEnabled) {
    const legacy = await handleAgentChat(
      params.userId,
      params.message,
      sid,
      history,
      params.extraSystemInstruction
    );
    return { ...legacy, mode: "legacy" };
  }

  try {
    const reply = await invokeOpenClawChat({
      userId: params.userId,
      message: params.message,
      sessionId: sid,
      history,
      extraSystemInstruction: params.extraSystemInstruction,
    });

    await saveAgentMemory({
      userId: params.userId,
      memoryType: "conversation",
      title: `Chat ${new Date().toISOString()}`,
      content: `User: ${params.message}\nAssistant: ${reply}`,
      metadata: { sessionId: sid, provider: "openclaw" },
    });

    return { reply, sessionId: sid, mode: "openclaw" };
  } catch (error) {
    console.error("[OpenClawBridge] Fallback to legacy agent due to error:", error);
    const legacy = await handleAgentChat(
      params.userId,
      params.message,
      sid,
      history,
      params.extraSystemInstruction
    );
    return { ...legacy, mode: "legacy" };
  }
}
