/**
 * setup-pubsub.mjs
 * 创建 Pub/Sub topic 和 push subscription，并授予 Gmail API 发布权限
 */
import mysql from 'mysql2/promise';

const PROJECT = 'dulcet-bonito-491005-b8';
const TOPIC = 'careerpax-gmail-events';
const SUBSCRIPTION = 'careerpax-gmail-events-sub';
const PUSH_ENDPOINT = 'https://careerpax.com/api/gmail/push';
const GMAIL_SA = 'gmail-api-push@system.gserviceaccount.com';

async function getAccessToken() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    "SELECT accessToken, refreshToken, expiresAt FROM oauth_tokens WHERE userId=1320215 AND provider='google' LIMIT 1"
  );
  await conn.end();
  if (!rows.length) throw new Error('No Google token found for userId=1320215');

  const row = rows[0];
  let token = row.accessToken;

  const expired = !token || (row.expiresAt && new Date(row.expiresAt) < new Date());
  if (expired) {
    console.log('Token expired, refreshing...');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: row.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    token = data.access_token;
    console.log('Token refreshed OK');
  }
  return token;
}

async function pubsubRequest(token, method, path, body) {
  const res = await fetch(`https://pubsub.googleapis.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  const token = await getAccessToken();
  console.log('Access token obtained');

  // Step 1: Create topic
  console.log('\n--- Step 1: Create topic ---');
  const topicRes = await pubsubRequest(token, 'PUT', `projects/${PROJECT}/topics/${TOPIC}`, {});
  console.log(`Status: ${topicRes.status}`, JSON.stringify(topicRes.data).slice(0, 200));
  if (topicRes.status !== 200 && topicRes.status !== 409) {
    console.error('Failed to create topic');
    process.exit(1);
  }
  if (topicRes.status === 409) console.log('Topic already exists, continuing...');

  // Step 2: Grant gmail-api-push SA publisher role on topic
  console.log('\n--- Step 2: Grant Gmail SA publisher role ---');
  const iamRes = await pubsubRequest(token, 'POST', `projects/${PROJECT}/topics/${TOPIC}:setIamPolicy`, {
    policy: {
      bindings: [{
        role: 'roles/pubsub.publisher',
        members: [`serviceAccount:${GMAIL_SA}`],
      }],
    },
  });
  console.log(`Status: ${iamRes.status}`, JSON.stringify(iamRes.data).slice(0, 300));

  // Step 3: Create or update push subscription
  console.log('\n--- Step 3: Create push subscription ---');
  const subRes = await pubsubRequest(token, 'PUT', `projects/${PROJECT}/subscriptions/${SUBSCRIPTION}`, {
    topic: `projects/${PROJECT}/topics/${TOPIC}`,
    pushConfig: { pushEndpoint: PUSH_ENDPOINT },
    ackDeadlineSeconds: 60,
  });
  console.log(`Status: ${subRes.status}`, JSON.stringify(subRes.data).slice(0, 300));

  if (subRes.status === 409) {
    console.log('Subscription exists, updating push endpoint...');
    const updateRes = await pubsubRequest(token, 'PATCH', `projects/${PROJECT}/subscriptions/${SUBSCRIPTION}`, {
      subscription: { pushConfig: { pushEndpoint: PUSH_ENDPOINT } },
      updateMask: 'pushConfig',
    });
    console.log(`Update status: ${updateRes.status}`, JSON.stringify(updateRes.data).slice(0, 200));
  }

  console.log('\nDone. Pub/Sub setup complete.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
