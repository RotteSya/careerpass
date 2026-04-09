/**
 * diagnose-pubsub.mjs
 * 等效于：
 *   gcloud pubsub topics describe careerpax-gmail-events --project dulcet-bonito-491005-b8
 *   gcloud pubsub topics get-iam-policy careerpax-gmail-events --project dulcet-bonito-491005-b8
 * 使用 Cloud Resource Manager token（cloud-platform scope）
 */
import mysql from 'mysql2/promise';

const PROJECT = 'dulcet-bonito-491005-b8';
const TOPIC = 'careerpax-gmail-events';

async function getCloudToken(refreshToken) {
  // Request cloud-platform scope token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  return data.access_token ?? null;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    "SELECT accessToken, refreshToken FROM oauth_tokens WHERE userId=1320215 AND provider='google' LIMIT 1"
  );
  await conn.end();
  if (!rows.length) { console.error('No token'); process.exit(1); }

  const token = await getCloudToken(rows[0].refreshToken);
  if (!token) { console.error('Token refresh failed'); process.exit(1); }
  console.log('Token obtained\n');

  // 1) Describe topic
  console.log('=== gcloud pubsub topics describe ===');
  const descRes = await fetch(
    `https://pubsub.googleapis.com/v1/projects/${PROJECT}/topics/${TOPIC}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log(`Status: ${descRes.status}`);
  console.log(JSON.stringify(await descRes.json(), null, 2));

  // 2) Get IAM policy
  console.log('\n=== gcloud pubsub topics get-iam-policy ===');
  const iamRes = await fetch(
    `https://pubsub.googleapis.com/v1/projects/${PROJECT}/topics/${TOPIC}:getIamPolicy`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log(`Status: ${iamRes.status}`);
  console.log(JSON.stringify(await iamRes.json(), null, 2));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
