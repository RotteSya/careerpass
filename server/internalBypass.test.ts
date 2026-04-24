import { describe, expect, it } from "vitest";
import {
  BYPASS_COOKIE_NAME,
  handleBypassEnable,
  handleBypassLogout,
  handleBypassStatus,
} from "./internalBypass";

function createRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: undefined as unknown,
    redirectTo: undefined as string | undefined,
    cookiesSet: [] as Array<{ name: string; value: string; options: any }>,
    cookiesCleared: [] as Array<{ name: string; options: any }>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
    end() {
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
    cookie(name: string, value: string, options: any) {
      this.cookiesSet.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: any) {
      this.cookiesCleared.push({ name, options });
      return this;
    },
  };
  return res;
}

describe("internal bypass", () => {
  it("status returns bypassed=false without cookie", () => {
    const req: any = { headers: {}, method: "GET" };
    const res = createRes();
    handleBypassStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ bypassed: false });
  });

  it("enable rejects wrong token", () => {
    process.env.STAFF_BYPASS_TOKEN = "t1";
    const req: any = { query: { token: "bad" }, headers: {}, method: "GET" };
    const res = createRes();
    handleBypassEnable(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("enable sets bypass cookie and redirects on correct token", () => {
    process.env.STAFF_BYPASS_TOKEN = "t1";
    const req: any = { query: { token: "t1" }, headers: {}, method: "GET" };
    const res = createRes();
    handleBypassEnable(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/");
    expect(res.cookiesSet.length).toBe(1);
    expect(res.cookiesSet[0].name).toBe(BYPASS_COOKIE_NAME);
    expect(res.cookiesSet[0].value).toBe("1");
  });

  it("enable accepts token from header", () => {
    process.env.STAFF_BYPASS_TOKEN = "t1";
    const req: any = { query: {}, headers: { "x-staff-bypass-token": "t1" }, method: "POST" };
    const res = createRes();
    handleBypassEnable(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.cookiesSet[0].name).toBe(BYPASS_COOKIE_NAME);
  });

  it("status returns bypassed=true with cookie", () => {
    const req: any = { headers: { cookie: `${BYPASS_COOKIE_NAME}=1` }, method: "GET" };
    const res = createRes();
    handleBypassStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ bypassed: true });
  });

  it("logout clears cookie and redirects", () => {
    const req: any = { headers: { cookie: `${BYPASS_COOKIE_NAME}=1` }, method: "GET" };
    const res = createRes();
    handleBypassLogout(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/");
    expect(res.cookiesCleared[0].name).toBe(BYPASS_COOKIE_NAME);
  });
});
