import { createPool } from "mysql2/promise";

async function main() {
  const pool = createPool(process.env.DATABASE_URL!);
  const sql = `ALTER TABLE \`job_applications\`
MODIFY COLUMN \`status\` enum(
  'researching',
  'applied',
  'briefing',
  'es_preparing',
  'es_submitted',
  'document_screening',
  'written_test',
  'interview_1',
  'interview_2',
  'interview_3',
  'interview_4',
  'interview_final',
  'offer',
  'rejected',
  'withdrawn'
) NOT NULL DEFAULT 'researching'`;
  await pool.execute(sql);
  console.log("Migration done: job_applications.status enum expanded");
  await pool.end();
}

main().catch(console.error);
