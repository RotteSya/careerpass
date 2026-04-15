import { describe, expect, it } from "vitest";
import { MANUS_OAUTH_STATE_COOKIE } from "./manusOauthState";
import { handleOauthCallback, handleOauthLogin } from "./oauth";

function createRes() {
  const res: any = {
    statusCode: 200,
    redirectTo: undefined as string | undefined,
    cookiesSet: [] as Array<{ name: string; value: string; options: any }>,
    cookiesCleared: [] as Array<{ name: string; options: any }>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    cookie(name: string, value: string, options: any) {
      this.cookiesSet.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: any) {
      this.cookiesCleared.push({ name, options });
      return this;
    },
    redirect(codeOrUrl: number | string, url?: string) {
      if (typeof codeOrUrl === "number") {
        this.statusCode = codeOrUrl;
        this.redirectTo = url;
      } else {
        this.statusCode = 302;
        this.redirectTo = codeOrUrl;
      }
      return this;
    },
    json() {
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

describe("oauth login route", () => {
  it("redirects to oauth portal and sets state cookie", () => {
    process.env.VITE_OAUTH_PORTAL_URL = "https://oauth.example.com";
    process.env.VITE_APP_ID = "app_123";

    const req: any = {
      protocol: "https",
      headers: { host: "careerpax.com" },
    };
    const res = createRes();
    handleOauthLogin(req, res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toContain("https://oauth.example.com/app-auth");
    expect(res.cookiesSet.some((c) => c.name === MANUS_OAUTH_STATE_COOKIE)).toBe(true);

    const stateCookie = res.cookiesSet.find((c) => c.name === MANUS_OAUTH_STATE_COOKIE);
    expect(stateCookie?.value).toBeTruthy();
    expect(res.redirectTo).toContain(`state=${encodeURIComponent(stateCookie!.value)}`);
    expect(res.redirectTo).toContain(encodeURIComponent("https://careerpax.com/api/oauth/callback"));
  });
});

describe("oauth callback state check", () => {
  it("rejects when state cookie is missing", async () => {
    const req: any = {
      query: { code: "c1", state: "s1" },
      headers: {},
    };
    const res = createRes();
    await handleOauthCallback(req, res);
    expect(res.statusCode).toBe(400);
  });
});
