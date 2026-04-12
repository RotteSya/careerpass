import { createPool } from "mysql2/promise";

async function main() {
  const pool = createPool(process.env.DATABASE_URL!);

  const tables = [
    "agent_memory",
    "agent_sessions",
    "job_status_events",
    "job_applications",
    "billing_company_ledger",
    "billing_notifications",
    "billing_accounts",
    "telegram_bindings",
    "messaging_bindings",
    "oauth_provider_accounts",
    "oauth_tokens",
    "email_auth",
    "users",
  ];

  for (const table of tables) {
    try {
      const [result] = await pool.execute(`DELETE FROM \`${table}\``) as any[];
      console.log(`[OK] Deleted from ${table}: ${result.affectedRows} rows`);
    } catch (e: any) {
      console.log(`[SKIP] ${table}: ${e.message}`);
    }
  }

  await pool.end();
  console.log("Done. All user data deleted.");
}

main().catch(console.error);
