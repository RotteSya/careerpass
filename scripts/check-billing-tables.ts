import mysql from "mysql2/promise";

async function check() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  const [rows] = await pool.execute("SHOW TABLES LIKE 'billing%'");
  console.log("Billing tables:", rows);
  await pool.end();
}

check().catch(console.error);
