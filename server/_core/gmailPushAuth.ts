import { verifyOidcJwt } from "./oidc";

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function authorizeGmailPushRequest(
  headers: Record<string, string | undefined>,
  params: { audience: string; issuer: string; jwks: Parameters<typeof verifyOidcJwt>[1]["jwks"] }
) {
  const token = extractBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    throw new Error("Missing Authorization bearer token");
  }
  return verifyOidcJwt(token, {
    audience: params.audience,
    issuer: params.issuer,
    jwks: params.jwks,
  });
}

