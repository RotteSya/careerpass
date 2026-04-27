import { listUserIdsWithActiveMessagingBinding } from "../db";
import { runProactiveCheckForUser } from "./scheduler";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_CONCURRENCY = 4;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(concurrency: number): Promise<void> {
  if (running) {
    console.warn("[Proactive Cron] Previous tick still running, skipping");
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const userIds = await listUserIdsWithActiveMessagingBinding();
    if (userIds.length === 0) return;

    let cursor = 0;
    let okCount = 0;
    let failCount = 0;
    const limit = Math.max(1, Math.min(concurrency, userIds.length));

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= userIds.length) return;
        try {
          await runProactiveCheckForUser(userIds[idx]);
          okCount++;
        } catch (err) {
          failCount++;
          console.error(`[Proactive Cron] User ${userIds[idx]} failed:`, err);
        }
      }
    };

    await Promise.all(Array.from({ length: limit }, () => worker()));
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[Proactive Cron] Tick complete: total=${userIds.length} ok=${okCount} fail=${failCount} elapsedMs=${elapsedMs}`
    );
  } catch (err) {
    console.error("[Proactive Cron] Tick failed:", err);
  } finally {
    running = false;
  }
}

export function startProactiveCron(options?: {
  intervalMs?: number;
  concurrency?: number;
}): void {
  if (timer) return;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;

  timer = setInterval(() => {
    void runOnce(concurrency);
  }, intervalMs);

  console.info(`[Proactive Cron] Started: intervalMs=${intervalMs} concurrency=${concurrency}`);
}

export function stopProactiveCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
