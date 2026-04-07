import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { upsertOauthToken } from "./db";

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

async function exchangeNotionCode(code: string, redirectUri: string) {
  const clientId = process.env.NOTION_CLIENT_ID ?? "";
  const clientSecret = process.env.NOTION_CLIENT_SECRET ?? "";
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion token exchange failed: ${err}`);
  }
  return res.json() as Promise<{
    access_token: string;
    workspace_id?: string;
    workspace_name?: string;
    bot_id?: string;
    duplicated_template_id?: string;
    owner?: unknown;
  }>;
}

export function registerNotionOAuthRoute(app: Express) {
  app.get("/api/notion/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;
    const appDomain = process.env.APP_DOMAIN ?? "https://careerpax.com";

    if (error) {
      return res.redirect(`${appDomain}/dashboard?notion=error&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return res.redirect(`${appDomain}/dashboard?notion=error&reason=missing_code`);
    }

    let stateData: { userId: number; provider: string };
    try {
      stateData = verifySignedState(state);
    } catch {
      return res.redirect(`${appDomain}/dashboard?notion=error&reason=invalid_state`);
    }
    if (stateData.provider !== "notion") {
      return res.redirect(`${appDomain}/dashboard?notion=error&reason=invalid_provider`);
    }

    try {
      const redirectUri = `${appDomain}/api/notion/callback`;
      const tokenData = await exchangeNotionCode(code, redirectUri);
      await upsertOauthToken({
        userId: stateData.userId,
        provider: "notion",
        accessToken: tokenData.access_token,
        refreshToken: null,
        expiresAt: null,
        scope: JSON.stringify({
          workspaceId: tokenData.workspace_id ?? null,
          workspaceName: tokenData.workspace_name ?? null,
          botId: tokenData.bot_id ?? null,
        }),
      });
      return res.redirect(`${appDomain}/dashboard?notion=success`);
    } catch (e) {
      const reason = encodeURIComponent((e as Error).message ?? "token_exchange_failed");
      return res.redirect(`${appDomain}/dashboard?notion=error&reason=${reason}`);
    }
  });
}
