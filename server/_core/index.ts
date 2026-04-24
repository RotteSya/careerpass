import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { telegramRouter } from "../telegram";
import { registerTelegramWebhook } from "../telegram";
import { gmailPushRouter } from "../gmailPush";
import { registerGmailPushWatch } from "../gmail";
import { listUserIdsByOauthProvider } from "../db";
import { appRouter } from "../routers";
import { registerCalendarOAuthRoute } from "../calendarOAuth";

import { createContext } from "./context";
import { createCsrfMiddleware } from "./csrfMiddleware";
import { internalBypassRouter } from "../internalBypass";
import { serveStatic, setupVite } from "./vite";
import { createRateLimiter } from "./rateLimit";
import { createRateLimitMiddleware } from "./rateLimitMiddleware";
import { registerDispatcher } from "./messaging";
import { TelegramDispatcher } from "./messaging";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = { status: "fulfilled", value: await worker(items[idx]) };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function startServer() {
  // Register messaging channel dispatchers
  registerDispatcher(new TelegramDispatcher());

  const app = express();
  app.set("trust proxy", true);
  const server = createServer(app);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Google Calendar OAuth callback — server-side Express route to avoid SPA routing issues
  registerCalendarOAuthRoute(app);

  // Telegram Bot Webhook under /api/telegram
  app.use("/api/telegram", telegramRouter);
  // Gmail push notifications (Google Pub/Sub push endpoint)
  app.use("/api/gmail", gmailPushRouter);
  app.use("/api/internal/bypass", internalBypassRouter);

  // Auto-register Telegram webhook on startup to avoid silent bot inactivity.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken) {
    const appDomain = process.env.APP_DOMAIN ?? "https://careerpax.com";
    const webhookUrl =
      process.env.TELEGRAM_WEBHOOK_URL ?? `${appDomain}/api/telegram/webhook`;
    registerTelegramWebhook(webhookUrl).catch(err => {
      console.error("[Telegram] Webhook auto-registration failed:", err);
    });
  }

  // Renew Gmail push watches for already-linked users on startup.
  const gmailTopic = process.env.GMAIL_PUBSUB_TOPIC;
  if (gmailTopic) {
    listUserIdsByOauthProvider("google")
      .then(async userIds => {
        const concurrency = Number.parseInt(process.env.GMAIL_WATCH_RENEWAL_CONCURRENCY ?? "3", 10);
        const results = await mapWithConcurrency(userIds, concurrency, userId => registerGmailPushWatch(userId));
        const okCount = results.filter(
          (r): r is PromiseFulfilledResult<boolean> => r.status === "fulfilled" && r.value === true
        ).length;
        const failCount = userIds.length - okCount;
        console.log(
          `[Gmail] Push watch renewal finished: total=${userIds.length}, success=${okCount}, failed=${failCount}.`
        );
      })
      .catch(err => {
        console.error("[Gmail] Failed to renew push watches on startup:", err);
      });
  }

  // tRPC API
  const appDomain = process.env.APP_DOMAIN ?? "http://localhost:3000";
  const allowedOrigins = (() => {
    try {
      return [new URL(appDomain).origin];
    } catch {
      return [];
    }
  })();
  const trpcLimiter = createRateLimiter({ windowMs: 60_000, max: 300 });
  app.use(
    "/api/trpc",
    createRateLimitMiddleware({
      limiter: trpcLimiter,
      key: (req) => `ip:${req.ip}`,
    }),
    createCsrfMiddleware({ allowedOrigins }),
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
