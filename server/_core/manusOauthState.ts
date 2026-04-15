import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";

export const MANUS_OAUTH_STATE_COOKIE = "manus_oauth_state";

export function createManusOauthState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function verifyManusOauthState(params: {
  stateParam: string;
  cookieHeader: string;
}): true {
  const cookies = parseCookieHeader(params.cookieHeader ?? "");
  const cookie = cookies[MANUS_OAUTH_STATE_COOKIE];
  if (!cookie) throw new Error("Missing OAuth state cookie");

  const a = Buffer.from(params.stateParam ?? "");
  const b = Buffer.from(cookie ?? "");
  if (a.length === 0 || b.length === 0) throw new Error("Invalid OAuth state");
  if (a.length !== b.length) throw new Error("OAuth state mismatch");
  if (!crypto.timingSafeEqual(a, b)) throw new Error("OAuth state mismatch");
  return true;
}

