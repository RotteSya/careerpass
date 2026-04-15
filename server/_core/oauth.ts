import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { createManusOauthState, MANUS_OAUTH_STATE_COOKIE, verifyManusOauthState } from "./manusOauthState";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getOrigin(req: Request): string {
  const host = req.headers.host;
  const proto = req.protocol;
  return host ? `${proto}://${host}` : "";
}

function getRedirectUri(req: Request): string {
  return `${getOrigin(req)}/api/oauth/callback`;
}

function oauthPortalUrl(): string {
  return (process.env.VITE_OAUTH_PORTAL_URL ?? "").trim();
}

function appId(): string {
  return (process.env.VITE_APP_ID ?? "").trim();
}

export function handleOauthLogin(req: Request, res: Response) {
  const portal = oauthPortalUrl();
  const id = appId();
  if (!portal || !id) {
    res.status(503).end();
    return;
  }

  const state = createManusOauthState();
  const base = getSessionCookieOptions(req);
  res.cookie(MANUS_OAUTH_STATE_COOKIE, state, {
    ...base,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
  });

  const redirectUri = getRedirectUri(req);
  const url = new URL(`${portal.replace(/\/$/, "")}/app-auth`);
  url.searchParams.set("appId", id);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");
  res.redirect(302, url.toString());
}

export async function handleOauthCallback(req: Request, res: Response) {
  const code = getQueryParam(req, "code");
  const state = getQueryParam(req, "state");

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  try {
    verifyManusOauthState({ stateParam: state, cookieHeader: req.headers.cookie ?? "" });
  } catch {
    res.status(400).json({ error: "invalid state" });
    return;
  } finally {
    const base = getSessionCookieOptions(req);
    res.clearCookie(MANUS_OAUTH_STATE_COOKIE, { ...base, sameSite: "lax", maxAge: -1 });
  }

  try {
    const tokenResponse = await sdk.exchangeCodeForToken(code, getRedirectUri(req));
    const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

    if (!userInfo.openId) {
      res.status(400).json({ error: "openId missing from user info" });
      return;
    }

    await db.upsertUser({
      openId: userInfo.openId,
      name: userInfo.name || null,
      email: userInfo.email ?? null,
      loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(userInfo.openId, {
      name: userInfo.name || "",
      expiresInMs: ONE_YEAR_MS,
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.redirect(302, "/");
  } catch (error) {
    console.error("[OAuth] Callback failed", error);
    res.status(500).json({ error: "OAuth callback failed" });
  }
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/login", handleOauthLogin);
  app.get("/api/oauth/callback", handleOauthCallback);
}
