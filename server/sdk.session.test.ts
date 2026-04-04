import { beforeAll, describe, expect, it } from "vitest";

let sdk: (typeof import("./_core/sdk"))["sdk"];
let ENV: (typeof import("./_core/env"))["ENV"];

beforeAll(async () => {
  process.env.JWT_SECRET = "test-session-secret";
  process.env.VITE_APP_ID = "test-app-id";
  ({ sdk } = await import("./_core/sdk"));
  ({ ENV } = await import("./_core/env"));
});

describe("session verification", () => {
  it("accepts session tokens when name is an empty string", async () => {
    const token = await sdk.createSessionToken("email:test@example.com", {
      name: "",
      expiresInMs: 60_000,
    });

    const session = await sdk.verifySession(token);

    expect(session).toMatchObject({
      openId: "email:test@example.com",
      appId: ENV.appId,
      name: "",
    });
  });
});
