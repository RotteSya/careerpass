/**
 * Server-side Google/Outlook OAuth callback handler.
 * Registered as a real Express route at /api/calendar/callback
 * so the browser never needs to parse query params via SPA routing.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { upsertOauthProviderAccount, upsertOauthToken } from "./db";
import { registerGmailPushWatch } from "./gmail";

function getStateSecret(): string {
  return process.env.JWT_SECRET ?? "careerpass-oauth-state-secret";
}

function verifySignedState(state: string): { userId: number; provider: string } {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) throw new Error("Malformed state");
  const data = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = crypto.createHmac("sha256", getStateSecret()).update(data).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("State signature mismatch");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as {
    userId: number;
    provider: string;
    exp: number;
  };
  if (Date.now() > payload.exp) throw new Error("State expired");
  return { userId: payload.userId, provider: payload.provider };
}

async function exchangeGoogleCode(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>;
}

async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return typeof data.email === "string" ? data.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export function registerCalendarOAuthRoute(app: Express) {
  app.get("/api/calendar/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;

    // Always use the canonical production domain for redirect_uri (must match Google Console registration)
    // and for post-auth redirect, so users land on the correct domain regardless of which URL they used.
    const appDomain = process.env.APP_DOMAIN ?? "https://careerpax.com";

    if (error) {
      console.error("[CalendarOAuth] Google returned error:", error);
      return res.redirect(`${appDomain}/dashboard?calendar=error&reason=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.error("[CalendarOAuth] Missing code or state. query:", req.query);
      return res.redirect(`${appDomain}/dashboard?calendar=error&reason=missing_code`);
    }

    let stateData: { userId: number; provider: string };
    try {
      stateData = verifySignedState(state);
    } catch (e) {
      console.error("[CalendarOAuth] State verification failed:", e);
      return res.redirect(`${appDomain}/dashboard?calendar=error&reason=invalid_state`);
    }

    // Must match exactly what was used to generate the auth URL
    const redirectUri = `${appDomain}/api/calendar/callback`;

    try {
      const tokenData = await exchangeGoogleCode(code, redirectUri);
      const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);
      await upsertOauthToken({
        userId: stateData.userId,
        provider: "google",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        expiresAt,
        scope: tokenData.scope ?? null,
      });
      const accountEmail = await fetchGoogleAccountEmail(tokenData.access_token);
      if (accountEmail) {
        await upsertOauthProviderAccount({
          userId: stateData.userId,
          provider: "google",
          accountEmail,
        });
      }
      await registerGmailPushWatch(stateData.userId);
      console.log(`[CalendarOAuth] Google calendar linked for user ${stateData.userId}`);
      return res.redirect(`${appDomain}/dashboard?calendar=success`);
    } catch (e) {
      console.error("[CalendarOAuth] Token exchange error:", e);
      const reason = encodeURIComponent((e as Error).message ?? "token_exchange_failed");
      return res.redirect(`${appDomain}/dashboard?calendar=error&reason=${reason}`);
    }
  });
}
