import { describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { verifyOidcJwt } from "./oidc";

describe("verifyOidcJwt", () => {
  it("verifies a valid RS256 token against a JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "k1";
    jwk.use = "sig";
    jwk.alg = "RS256";
    const jwks = { keys: [jwk] };
    const local = createLocalJWKSet(jwks);

    const token = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience("aud-1")
      .setExpirationTime("2h")
      .sign(privateKey);

    const { payload } = await verifyOidcJwt(token, {
      audience: "aud-1",
      issuer: "https://accounts.google.com",
      jwks: local,
    });

    expect(payload.sub).toBe("u1");
  });

  it("rejects token with wrong audience", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "k1";
    jwk.use = "sig";
    jwk.alg = "RS256";
    const jwks = { keys: [jwk] };
    const local = createLocalJWKSet(jwks);

    const token = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience("aud-1")
      .setExpirationTime("2h")
      .sign(privateKey);

    await expect(
      verifyOidcJwt(token, {
        audience: "aud-2",
        issuer: "https://accounts.google.com",
        jwks: local,
      })
    ).rejects.toThrow();
  });
});

