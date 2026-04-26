import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { deliveredNudges } from "../../drizzle/schema";
import { getDb } from "../db";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export async function getNudgeLastDeliveredAt(
  userId: number,
  rawKey: string
): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ deliveredAt: deliveredNudges.deliveredAt })
    .from(deliveredNudges)
    .where(
      and(
        eq(deliveredNudges.userId, userId),
        eq(deliveredNudges.deliveryKey, hashKey(rawKey))
      )
    )
    .limit(1);
  return rows[0]?.deliveredAt ?? null;
}

export async function recordNudgeDelivered(
  userId: number,
  rawKey: string,
  deliveredAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(deliveredNudges)
    .values({ userId, deliveryKey: hashKey(rawKey), deliveredAt })
    .onDuplicateKeyUpdate({ set: { deliveredAt } });
}
