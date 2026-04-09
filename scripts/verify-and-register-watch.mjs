/**
 * verify-and-register-watch.mjs
 * 1. 验证 Pub/Sub topic 是否存在
 * 2. 修复 upsertOauthProviderAccount 的 duplicate entry 问题（直接用 INSERT ... ON DUPLICATE KEY UPDATE）
 * 3. 为所有 Google OAuth 用户注册 Gmail watch
 */
import mysql from 'mysql2/promise';

const PROJECT = 'dulcet-bonito-491005-b8';
const TOPIC = 'careerpass-gmail-events';
const GMAIL_PUBSUB_TOPIC = process.env.GMAIL_PUBSUB_TOPIC ?? `projects/${PROJECT}/topics/${TOPIC}`;
console.log('Using GMAIL_PUBSUB_TOPIC:', GMAIL_PUBSUB_TOPIC);

async function getToken(conn, userId) {
  const [rows] = await conn.execute(
    "SELECT accessToken, refreshToken, expiresAt FROM oauth_tokens WHERE userId=? AND provider='google' LIMIT 1",
    [userId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  let token = row.accessToken;
  const expired = !token || (row.expiresAt && new Date(row.expiresAt) < new Date());
  if (expired) {
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
    if (!data.access_token) { console.warn(`  Token refresh failed for user ${userId}:`, data.error); return null; }
    token = data.access_token;
    // Update DB
    await conn.execute(
      "UPDATE oauth_tokens SET accessToken=?, expiresAt=? WHERE userId=? AND provider='google'",
      [token, new Date(Date.now() + 3600 * 1000), userId]
    );
  }
  return token;
}

async function getEmailFromProfile(token) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.emailAddress?.trim().toLowerCase() ?? null;
}

async function upsertProviderAccount(conn, userId, email) {
  await conn.execute(
    `INSERT INTO oauth_provider_accounts (userId, provider, accountEmail, createdAt, updatedAt)
     VALUES (?, 'google', ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE accountEmail=VALUES(accountEmail), updatedAt=NOW()`,
    [userId, email]
  );
}

async function registerWatch(conn, userId, token) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicName: GMAIL_PUBSUB_TOPIC, labelIds: ['INBOX'], labelFilterAction: 'include' }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`  Watch register failed for user ${userId}:`, JSON.stringify(data, null, 2));
    return false;
  }
  const expiration = data.expiration ? new Date(Number(data.expiration)) : null;
  const historyId = data.historyId ?? null;
  await conn.execute(
    "UPDATE oauth_provider_accounts SET watchExpiration=?, lastHistoryId=COALESCE(?,lastHistoryId), updatedAt=NOW() WHERE userId=? AND provider='google'",
    [expiration, historyId, userId]
  );
  console.log(`  Watch registered for user ${userId}: historyId=${historyId}, expires=${expiration?.toISOString()}`);
  return true;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Step 1: Verify topic exists using owner token
  console.log('--- Step 1: Verify Pub/Sub topic ---');
  const ownerToken = await getToken(conn, 1320215);
  if (!ownerToken) { console.error('Cannot get owner token'); process.exit(1); }
  const topicRes = await fetch(`https://pubsub.googleapis.com/v1/projects/${PROJECT}/topics/${TOPIC}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  if (topicRes.status === 200) {
    console.log('Topic exists');
  } else if (topicRes.status === 403) {
    console.log('Topic check returned 403 (scope limitation) - assuming topic exists since you confirmed creation');
  } else {
    const errText = await topicRes.text();
    console.error('Topic NOT found:', topicRes.status, errText.slice(0, 200));
    console.error('Please create the topic in Google Cloud Console first.');
    await conn.end();
    process.exit(1);
  }

  // Step 2: Get all Google OAuth users
  console.log('\n--- Step 2: Process all Google OAuth users ---');
  const [users] = await conn.execute("SELECT DISTINCT userId FROM oauth_tokens WHERE provider='google'");
  console.log(`Found ${users.length} users`);

  let mappedOk = 0, mappedFail = 0, watchOk = 0, watchFail = 0;

  for (const { userId } of users) {
    console.log(`\nUser ${userId}:`);
    const token = await getToken(conn, userId);
    if (!token) { console.warn('  No valid token'); mappedFail++; watchFail++; continue; }

    // Upsert provider account
    const email = await getEmailFromProfile(token);
    if (!email) { console.warn('  Cannot get email from profile'); mappedFail++; watchFail++; continue; }
    console.log(`  Email: ${email}`);
    await upsertProviderAccount(conn, userId, email);
    mappedOk++;

    // Register watch
    const ok = await registerWatch(conn, userId, token);
    if (ok) watchOk++; else watchFail++;
  }

  await conn.end();
  console.log(`\n=== Summary: users=${users.length}, mappedOk=${mappedOk}, mappedFail=${mappedFail}, watchOk=${watchOk}, watchFail=${watchFail} ===`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
