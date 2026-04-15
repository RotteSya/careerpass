import type { Express, Request, Response } from "express";
import { upsertOauthToken } from "./db";
import { ENV } from "./_core/env";
import { verifyOauthSignedState } from "./_core/oauthSignedState";

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
      stateData = verifyOauthSignedState(state, ENV.cookieSecret);
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
