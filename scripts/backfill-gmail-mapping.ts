import "dotenv/config";
import { listUserIdsByOauthProvider } from "../server/db";
import { ensureGoogleProviderAccountMapping, registerGmailPushWatch } from "../server/gmail";

async function main() {
  const userIds = await listUserIdsByOauthProvider("google");
  console.log(`[Backfill] Found ${userIds.length} user(s) with Google OAuth token.`);

  let mappedOk = 0;
  let mappedFail = 0;
  let watchOk = 0;
  let watchFail = 0;

  for (const userId of userIds) {
    try {
      const mapped = await ensureGoogleProviderAccountMapping(userId);
      if (mapped) {
        mappedOk += 1;
      } else {
        mappedFail += 1;
        console.warn(`[Backfill] Mapping failed for user ${userId}`);
      }

      const watch = await registerGmailPushWatch(userId);
      if (watch) {
        watchOk += 1;
      } else {
        watchFail += 1;
        console.warn(`[Backfill] Watch register failed for user ${userId}`);
      }
    } catch (err) {
      mappedFail += 1;
      watchFail += 1;
      console.error(`[Backfill] User ${userId} failed with exception:`, err);
    }
  }

  console.log("[Backfill] Summary:", {
    users: userIds.length,
    mappedOk,
    mappedFail,
    watchOk,
    watchFail,
  });
}

main().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
