import type { NextFunction, Request, Response } from "express";
import { createRateLimiter } from "./rateLimit";

export function createRateLimitMiddleware(params: {
  limiter: ReturnType<typeof createRateLimiter>;
  key: (req: Request) => string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = params.key(req);
    const ok = k ? params.limiter.consume(k) : true;
    if (!ok) {
      res.status(429).end();
      return;
    }
    next();
  };
}
