import express from "express";
import { parse as parseCookieHeader } from "cookie";
import { getSessionCookieOptions } from "./_core/cookies";
import { createRateLimiter } from "./_core/rateLimit";
import { createRateLimitMiddleware } from "./_core/rateLimitMiddleware";

export const BYPASS_COOKIE_NAME = "cp_staff_bypass";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getToken(): string {
  return (process.env.STAFF_BYPASS_TOKEN ?? "").trim();
}

function hasBypassCookie(req: { headers?: Record<string, any> }): boolean {
  const cookieHeader = req.headers?.cookie;
  const raw = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  const cookies = parseCookieHeader(typeof raw === "string" ? raw : "");
  return cookies[BYPASS_COOKIE_NAME] === "1";
}

export function handleBypassStatus(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ bypassed: hasBypassCookie(req) });
}

export function handleBypassEnable(req: any, res: any) {
  const expected = getToken();
  if (!expected) {
    res.status(503).end();
    return;
  }

  const token = typeof req.query?.token === "string" ? req.query.token : "";
  if (!token || token !== expected) {
    res.status(401).end();
    return;
  }

  const base = getSessionCookieOptions(req);
  res.cookie(BYPASS_COOKIE_NAME, "1", {
    ...base,
    sameSite: "lax",
    maxAge: THIRTY_DAYS_MS,
  });
  res.redirect(302, "/");
}

export function handleBypassLogout(req: any, res: any) {
  const base = getSessionCookieOptions(req);
  res.clearCookie(BYPASS_COOKIE_NAME, {
    ...base,
    sameSite: "lax",
    maxAge: -1,
  });
  res.redirect(302, "/");
}

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

export const internalBypassRouter = express.Router();
internalBypassRouter.use(
  createRateLimitMiddleware({
    limiter,
    key: (req) => `ip:${req.ip}`,
  })
);
internalBypassRouter.get("/", handleBypassEnable);
internalBypassRouter.get("/status", handleBypassStatus);
internalBypassRouter.get("/logout", handleBypassLogout);
internalBypassRouter.post("/logout", handleBypassLogout);
