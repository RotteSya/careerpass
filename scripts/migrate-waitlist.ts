import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`waitlist\` (
      \`id\` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
      \`email\` varchar(255) NOT NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      UNIQUE KEY \`waitlist_email_unique\` (\`email\`)
    )
  `);
  console.log("[OK] waitlist table created");
  await conn.end();
}

main().catch(console.error);
