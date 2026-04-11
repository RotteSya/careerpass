import mysql from "mysql2/promise";

const TARGET_EMAIL = "slz5310539@gmail.com";

async function deleteUser() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);

  // 0. List all tables to find the users table name
  const [tables] = await pool.execute("SHOW TABLES") as any[];
  const tableNames: string[] = tables.map((r: any) => Object.values(r)[0] as string);
  console.log("[INFO] Tables:", tableNames.join(", "));

  // Find users table (could be 'users' or 'user')
  const usersTable = tableNames.find(t => t === "users" || t === "user") || "users";
  console.log("[INFO] Using users table:", usersTable);

  // 1. Find user by email
  const [users] = await pool.execute(
    `SELECT id, email, name FROM \`${usersTable}\` WHERE email = ?`,
    [TARGET_EMAIL]
  ) as any[];

  if (!users || users.length === 0) {
    console.log(`[NOT FOUND] No user found with email: ${TARGET_EMAIL}`);
    await pool.end();
    return;
  }

  const user = users[0];
  const userId = user.id;
  console.log(`[FOUND] User: id=${userId}, name=${user.name}, email=${user.email}`);

  // 2. Delete all related data in dependency order
  const candidateTables: [string, string][] = [
    ["agent_memory", "userId"],
    ["agent_sessions", "userId"],
    ["job_applications", "userId"],
    ["oauth_provider_accounts", "userId"],
    ["telegram_bindings", "userId"],
    ["sessions", "userId"],
    ["billing_accounts", "userId"],
    ["billing_company_ledger", "userId"],
    ["billing_notifications", "userId"],
  ];

  for (const [table, col] of candidateTables) {
    if (!tableNames.includes(table)) {
      console.log(`[SKIP] Table ${table} does not exist`);
      continue;
    }
    try {
      const [result] = await pool.execute(
        `DELETE FROM \`${table}\` WHERE \`${col}\` = ?`,
        [userId]
      ) as any[];
      console.log(`[OK] Deleted from ${table}: ${result.affectedRows} rows`);
    } catch (e: any) {
      console.error(`[ERR] ${table}:`, e.message);
    }
  }

  // 3. Finally delete the user record
  const [result] = await pool.execute(
    `DELETE FROM \`${usersTable}\` WHERE id = ?`,
    [userId]
  ) as any[];
  console.log(`[OK] Deleted user record: ${result.affectedRows} rows`);

  await pool.end();
  console.log("Done.");
}

deleteUser().catch(console.error);
