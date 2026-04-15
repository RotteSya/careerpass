import { describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { authorizeGmailPushRequest } from "./gmailPushAuth";

describe("authorizeGmailPushRequest", () => {
  it("rejects missing Authorization header", async () => {
    await expect(
      authorizeGmailPushRequest(
        {},
        {
          audience: "aud-1",
          issuer: "https://accounts.google.com",
          jwks: createLocalJWKSet({ keys: [] }),
        }
      )
    ).rejects.toThrow(/authorization/i);
  });

  it("accepts a valid Bearer token", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "k1";
    jwk.use = "sig";
    jwk.alg = "RS256";
    const local = createLocalJWKSet({ keys: [jwk] });

    const token = await new SignJWT({ sub: "svc", email: "pubsub@example.iam.gserviceaccount.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience("aud-1")
      .setExpirationTime("2h")
      .sign(privateKey);

    const result = await authorizeGmailPushRequest(
      { authorization: `Bearer ${token}` },
      {
        audience: "aud-1",
        issuer: "https://accounts.google.com",
        jwks: local,
      }
    );

    expect(result.payload.sub).toBe("svc");
  });
});

