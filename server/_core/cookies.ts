import type { CookieOptions, Request } from "express";

/**
 * Determine whether the current request arrived over HTTPS.
 *
 * With `app.set("trust proxy", 1)` in place, Express sets req.protocol to
 * "https" when the upstream proxy forwards the original scheme via the
 * x-forwarded-proto header.  We also fall back to reading that header
 * directly for environments where trust proxy is not yet active.
 */
function isSecureRequest(req: Request): boolean {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // In production the app is always served over HTTPS.
  // Force secure:true so that sameSite:"none" is accepted by modern browsers.
  // (sameSite:"none" + secure:false is rejected by Chrome/Firefox/Safari.)
  const isProduction = process.env.NODE_ENV === "production";
  const secure = isProduction ? true : isSecureRequest(req);

  return {
    httpOnly: true,
    path: "/",
    // sameSite:"none" requires secure:true; fall back to "lax" for local dev
    sameSite: secure ? "none" : "lax",
    secure,
  };
}
