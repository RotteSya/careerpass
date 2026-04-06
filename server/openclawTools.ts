import express from "express";
import { z } from "zod";
import {
  generateES,
  reconCompany,
  startCompanyWorkflow,
  startInterview,
} from "./agents";
import { getOrCreateAgentSession } from "./db";
import { getOpenClawObservabilitySnapshot, recordToolCall } from "./openclawObservability";

export const openclawToolsRouter = express.Router();

function isEnabledFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

function resolveSessionId(sessionId: string | undefined, fallbackId: number): string {
  return sessionId?.trim() || String(fallbackId);
}

function ensureEnabledAndAuthorized(req: express.Request, res: express.Response): boolean {
  if (!isEnabledFlag(process.env.OPENCLAW_TOOLS_ENABLED)) {
    res.status(404).json({ ok: false, error: "OpenClaw tools API is disabled" });
    return false;
  }

  const expected = process.env.OPENCLAW_TOOL_SECRET ?? "";
  if (!expected) {
    res.status(503).json({ ok: false, error: "OPENCLAW_TOOL_SECRET is not configured" });
    return false;
  }

  const provided = req.header("x-openclaw-secret") ?? "";
  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }

  return true;
}

openclawToolsRouter.get("/health", (req, res) => {
  const startedAt = Date.now();
  if (!ensureEnabledAndAuthorized(req, res)) {
    recordToolCall({ endpoint: "health", ok: false, latencyMs: Date.now() - startedAt, error: "unauthorized_or_disabled" });
    return;
  }
  recordToolCall({ endpoint: "health", ok: true, latencyMs: Date.now() - startedAt });
  res.json({ ok: true });
});

openclawToolsRouter.get("/metrics", (req, res) => {
  const startedAt = Date.now();
  if (!ensureEnabledAndAuthorized(req, res)) {
    recordToolCall({ endpoint: "metrics", ok: false, latencyMs: Date.now() - startedAt, error: "unauthorized_or_disabled" });
    return;
  }
  recordToolCall({ endpoint: "metrics", ok: true, latencyMs: Date.now() - startedAt });
  res.json({ ok: true, metrics: getOpenClawObservabilitySnapshot() });
});

openclawToolsRouter.post("/recon", async (req, res) => {
  const startedAt = Date.now();
  if (!ensureEnabledAndAuthorized(req, res)) {
    recordToolCall({ endpoint: "recon", ok: false, latencyMs: Date.now() - startedAt, error: "unauthorized_or_disabled" });
    return;
  }

  const schema = z.object({
    userId: z.number().int().positive(),
    companyName: z.string().min(1),
    jobApplicationId: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    recordToolCall({ endpoint: "recon", ok: false, latencyMs: Date.now() - startedAt, error: "invalid_payload" });
    res.status(400).json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const report = await reconCompany(
      parsed.data.userId,
      parsed.data.companyName,
      parsed.data.jobApplicationId
    );
    recordToolCall({ endpoint: "recon", ok: true, latencyMs: Date.now() - startedAt });
    res.json({ ok: true, report });
  } catch (error) {
    recordToolCall({ endpoint: "recon", ok: false, latencyMs: Date.now() - startedAt, error });
    console.error("[OpenClawTools] /recon failed:", error);
    res.status(500).json({ ok: false, error: "Failed to run recon" });
  }
});

openclawToolsRouter.post("/es", async (req, res) => {
  const startedAt = Date.now();
  if (!ensureEnabledAndAuthorized(req, res)) {
    recordToolCall({ endpoint: "es", ok: false, latencyMs: Date.now() - startedAt, error: "unauthorized_or_disabled" });
    return;
  }

  const schema = z.object({
    userId: z.number().int().positive(),
    companyName: z.string().min(1),
    position: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    recordToolCall({ endpoint: "es", ok: false, latencyMs: Date.now() - startedAt, error: "invalid_payload" });
    res.status(400).json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const session = await getOrCreateAgentSession(parsed.data.userId);
    const sid = resolveSessionId(parsed.data.sessionId, session.id);
    const position = parsed.data.position ?? "総合職";
    const es = await generateES(parsed.data.userId, parsed.data.companyName, position, sid);
    recordToolCall({ endpoint: "es", ok: true, latencyMs: Date.now() - startedAt });
    res.json({ ok: true, es, sessionId: sid });
  } catch (error) {
    recordToolCall({ endpoint: "es", ok: false, latencyMs: Date.now() - startedAt, error });
    console.error("[OpenClawTools] /es failed:", error);
    res.status(500).json({ ok: false, error: "Failed to generate ES" });
  }
});

openclawToolsRouter.post("/workflow/start", async (req, res) => {
  const startedAt = Date.now();
  if (!ensureEnabledAndAuthorized(req, res)) {
    recordToolCall({ endpoint: "workflow_start", ok: false, latencyMs: Date.now() - startedAt, error: "unauthorized_or_disabled" });
    return;
  }

  const schema = z.object({
    userId: z.number().int().positive(),
    companyName: z.string().min(1),
    position: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    recordToolCall({ endpoint: "workflow_start", ok: false, latencyMs: Date.now() - startedAt, error: "invalid_payload" });
    res.status(400).json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const session = await getOrCreateAgentSession(parsed.data.userId);
    const sid = resolveSessionId(parsed.data.sessionId, session.id);
    const position = parsed.data.position ?? "総合職";
    const workflow = await startCompanyWorkflow(
      parsed.data.userId,
      parsed.data.companyName,
      position,
      sid
    );
    recordToolCall({ endpoint: "workflow_start", ok: true, latencyMs: Date.now() - startedAt });
    res.json({ ok: true, sessionId: sid, ...workflow });
  } catch (error) {
    recordToolCall({ endpoint: "workflow_start", ok: false, latencyMs: Date.now() - startedAt, error });
    console.error("[OpenClawTools] /workflow/start failed:", error);
    res.status(500).json({ ok: false, error: "Failed to run workflow" });
  }
});

openclawToolsRouter.post("/interview/start", async (req, res) => {
  const startedAt = Date.now();
  if (!ensureEnabledAndAuthorized(req, res)) {
    recordToolCall({ endpoint: "interview_start", ok: false, latencyMs: Date.now() - startedAt, error: "unauthorized_or_disabled" });
    return;
  }

  const schema = z.object({
    userId: z.number().int().positive(),
    companyName: z.string().min(1),
    position: z.string().min(1).optional(),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
      .optional(),
    userAnswer: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    recordToolCall({ endpoint: "interview_start", ok: false, latencyMs: Date.now() - startedAt, error: "invalid_payload" });
    res.status(400).json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const question = await startInterview(
      parsed.data.userId,
      parsed.data.companyName,
      parsed.data.position ?? "総合職",
      parsed.data.history ?? [],
      parsed.data.userAnswer
    );
    recordToolCall({ endpoint: "interview_start", ok: true, latencyMs: Date.now() - startedAt });
    res.json({ ok: true, question });
  } catch (error) {
    recordToolCall({ endpoint: "interview_start", ok: false, latencyMs: Date.now() - startedAt, error });
    console.error("[OpenClawTools] /interview/start failed:", error);
    res.status(500).json({ ok: false, error: "Failed to start interview" });
  }
});
