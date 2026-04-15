import type { NextFunction, Request, Response } from "express";
import { assertCsrf } from "./csrf";

export function createCsrfMiddleware(params: { allowedOrigins: string[] }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      assertCsrf(req, params);
      next();
    } catch {
      res.status(403).end();
    }
  };
}

