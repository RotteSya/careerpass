import { getDb } from './server/db.ts';
import { jobApplications, jobStatusEvents, users } from './drizzle/schema.ts';
import { monitorGmailAndSync } from './server/gmail.ts';

async function resetAndSync() {
  const db = await getDb();
  if (!db) {
    console.error("DB not ready");
    return;
  }
  
  console.log("Clearing old job applications and status events...");
  await db.delete(jobStatusEvents);
  await db.delete(jobApplications);
  
  const userId = 1;
  const us = await db.select().from(users).limit(1);
  const chatId = us[0]?.telegramChatId ?? undefined;
  
  console.log("Running full mailbox scan and sync...");
  const res = await monitorGmailAndSync(userId, chatId, {
    fullMailboxScan: true,
    suppressTelegramItemNotifications: true,
    enableAutoBoardWrite: true,
    enableAutoWorkflow: false
  });
  
  console.log(`Scan complete! Scanned: ${res.scanned}, Detected: ${res.detected}`);
}

resetAndSync().catch(console.error);
