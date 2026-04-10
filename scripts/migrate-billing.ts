import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

async function main() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  const db = drizzle(pool);

  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS \`billing_accounts\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`billingMode\` enum('monthly','company') NOT NULL DEFAULT 'company',
      \`companyPlanLimit\` int DEFAULT 10,
      \`cycleStartedAt\` timestamp NOT NULL,
      \`cycleEndsAt\` timestamp,
      \`trialStartedAt\` timestamp NOT NULL,
      \`trialEndsAt\` timestamp NOT NULL,
      \`graceEndsAt\` timestamp NOT NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`billing_accounts_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`billing_accounts_userId_unique\` UNIQUE(\`userId\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`billing_company_ledger\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`companyKey\` varchar(255) NOT NULL,
      \`companyName\` varchar(255) NOT NULL,
      \`firstStatus\` varchar(32),
      \`countable\` boolean NOT NULL DEFAULT true,
      \`firstSeenAt\` timestamp NOT NULL DEFAULT (now()),
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`billing_company_ledger_id\` PRIMARY KEY(\`id\`)
    )`,
    `CREATE TABLE IF NOT EXISTS \`billing_notifications\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`day10SentAt\` timestamp,
      \`day13SentAt\` timestamp,
      \`suspensionSentAt\` timestamp,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`billing_notifications_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`billing_notifications_userId_unique\` UNIQUE(\`userId\`)
    )`,
  ];

  for (const [i, sql] of statements.entries()) {
    try {
      await db.execute(sql as any);
      console.log(`[OK] Statement ${i + 1}`);
    } catch (e: any) {
      if (e.code === "ER_TABLE_EXISTS_ERROR") {
        console.log(`[SKIP] Statement ${i + 1}: table already exists`);
      } else {
        console.error(`[ERR] Statement ${i + 1}:`, e.message);
      }
    }
  }

  try {
    await db.execute(
      `CREATE UNIQUE INDEX \`billing_company_ledger_user_company_unique\` ON \`billing_company_ledger\` (\`userId\`,\`companyKey\`)` as any
    );
    console.log("[OK] Unique index created");
  } catch (e: any) {
    if (e.code === "ER_DUP_KEYNAME" || e.message?.includes("Duplicate key")) {
      console.log("[SKIP] Unique index already exists");
    } else {
      console.error("[ERR] Index:", e.message);
    }
  }

  await pool.end();
  console.log("Migration complete");
}

main().catch(console.error);
