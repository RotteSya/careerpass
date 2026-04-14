import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`waitlist_users\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`email\` varchar(320) NOT NULL,
      \`created_at\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`waitlist_users_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`waitlist_users_email_unique\` UNIQUE(\`email\`)
    )
  `);
  console.log("✓ waitlist_users table created");
  await conn.end();
}

main().catch(console.error);
