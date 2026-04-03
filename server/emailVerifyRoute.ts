/**
 * Server-side email verification handler.
 * Registered as a real Express route at /api/verify-email
 * so the browser never needs to handle token via SPA routing.
 * The server sets the session cookie directly and HTTP-redirects to /register.
 */
import type { Express, Request, Response } from "express";
import { verifyEmail as verifyEmailToken } from "./emailAuth";
import { getUserById } from "./db";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "../shared/const";

export function registerEmailVerifyRoute(app: Express) {
  app.get("/api/verify-email", async (req: Request, res: Response) => {
    const appDomain = process.env.APP_DOMAIN ?? "https://careerpax.com";
    const token = req.query.token as string | undefined;

    if (!token) {
      return res.redirect(`${appDomain}/signup?error=missing_token`);
    }

    try {
      const { userId } = await verifyEmailToken(token);
      const user = await getUserById(userId);
      if (!user) throw new Error("USER_NOT_FOUND");

      // Issue session cookie directly on the server response
      const cookieOptions = getSessionCookieOptions(req);
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name ?? "",
        expiresInMs: 7 * 24 * 60 * 60 * 1000,
      });
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // Redirect to the appropriate page
      if (user.profileCompleted) {
        return res.redirect(`${appDomain}/dashboard`);
      } else {
        return res.redirect(`${appDomain}/register`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "UNKNOWN";
      console.error("[EmailVerify] Error:", msg);

      if (msg === "TOKEN_EXPIRED") {
        return res.redirect(`${appDomain}/signup?error=token_expired`);
      }
      if (msg === "INVALID_TOKEN") {
        return res.redirect(`${appDomain}/signup?error=invalid_token`);
      }
      return res.redirect(`${appDomain}/signup?error=verification_failed`);
    }
  });
}
