import { createPool } from "mysql2/promise";

async function main() {
  const pool = createPool(process.env.DATABASE_URL!);

  const statements = [
    "UPDATE `job_applications` SET `status` = 'applied' WHERE `status` = 'researching'",
    "UPDATE `job_applications` SET `status` = 'document_screening' WHERE `status` = 'es_submitted'",
    "UPDATE `job_applications` SET `status` = 'withdrawn' WHERE `status` = 'rejected'",
    "UPDATE `job_status_events` SET `prevStatus` = 'applied' WHERE `prevStatus` = 'researching'",
    "UPDATE `job_status_events` SET `nextStatus` = 'applied' WHERE `nextStatus` = 'researching'",
    "UPDATE `job_status_events` SET `prevStatus` = 'document_screening' WHERE `prevStatus` = 'es_submitted'",
    "UPDATE `job_status_events` SET `nextStatus` = 'document_screening' WHERE `nextStatus` = 'es_submitted'",
    "UPDATE `job_status_events` SET `prevStatus` = 'withdrawn' WHERE `prevStatus` = 'rejected'",
    "UPDATE `job_status_events` SET `nextStatus` = 'withdrawn' WHERE `nextStatus` = 'rejected'",
  ];

  for (const sql of statements) {
    const [result] = await pool.execute(sql) as any[];
    console.log(`[OK] ${sql.slice(0, 60)}... → ${result.affectedRows} rows`);
  }

  await pool.end();
  console.log("Migration done: legacy job statuses migrated");
}

main().catch(console.error);
