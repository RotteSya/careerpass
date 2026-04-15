import crypto from "crypto";

export type OauthSignedStatePayload = {
  userId: number;
  provider: string;
  exp: number;
};

export function buildOauthSignedState(
  payload: OauthSignedStatePayload,
  secret: string
): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyOauthSignedState(
  state: string,
  secret: string
): { userId: number; provider: string } {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) throw new Error("Malformed state");
  const data = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);

  if (!data || !sig) throw new Error("Malformed state");
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
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

