import { COOKIE_NAME } from "@shared/const";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertCsrf(
  req: {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
  params: { allowedOrigins: string[] }
) {
  const method = (req.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  const headers = req.headers ?? {};
  const header = (name: string) => {
    const v = headers[name];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const cookie = header("cookie") ?? "";
  if (!cookie.includes(`${COOKIE_NAME}=`)) return;

  // Require Origin header on cookie-authenticated unsafe requests. Modern
  // browsers always send Origin on cross-origin POST/PUT/DELETE; Referer can
  // be stripped by referrer-policy or privacy extensions, so we no longer
  // accept it as a fallback.
  const origin = header("origin");
  if (!origin) {
    throw new Error("CSRF blocked: missing origin");
  }

  const host = header("host");
  const hostHttp = host ? `http://${host}` : null;
  const hostHttps = host ? `https://${host}` : null;

  if (
    !params.allowedOrigins.includes(origin) &&
    origin !== hostHttp &&
    origin !== hostHttps
  ) {
    throw new Error("CSRF blocked: origin mismatch");
  }
}
