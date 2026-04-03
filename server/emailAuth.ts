/**
 * Email Auth helpers — registration, verification, login via Resend
 */
import { Resend } from "resend";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getDb } from "./db";
import { emailAuth, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "CareerPass <noreply@careerpax.com>";
const APP_DOMAIN = process.env.APP_DOMAIN ?? "https://careerpax.com";

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function tokenExpiresAt(hours = 24): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// ── DB helpers ───────────────────────────────────────────────────────────────

export async function getEmailAuthByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailAuth).where(eq(emailAuth.email, email.toLowerCase()));
  return rows[0] ?? null;
}

export async function getEmailAuthByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailAuth).where(eq(emailAuth.userId, userId));
  return rows[0] ?? null;
}

export async function getEmailAuthByVerifyToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailAuth).where(eq(emailAuth.verifyToken, token));
  return rows[0] ?? null;
}

// ── Registration ─────────────────────────────────────────────────────────────

export async function registerWithEmail(email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();

  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  // Check duplicate
  const existing = await getEmailAuthByEmail(normalizedEmail);
  if (existing) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);
  const verifyToken = generateToken();
  const verifyTokenExpiresAt = tokenExpiresAt(24);

  // Create user row first (openId = email-based synthetic id)
  const openId = `email:${normalizedEmail}`;
  await db.insert(users).values({
    openId,
    email: normalizedEmail,
    loginMethod: "email",
    profileCompleted: false,
    lastSignedIn: new Date(),
  });

  // Fetch the newly created user
  const userRows = await db.select().from(users).where(eq(users.openId, openId));
  const user = userRows[0];
  if (!user) throw new Error("USER_CREATION_FAILED");

  // Create email_auth row
  await db.insert(emailAuth).values({
    userId: user.id,
    email: normalizedEmail,
    passwordHash,
    verifyToken,
    verifyTokenExpiresAt,
  });

  // Send verification email
  await sendVerificationEmail(normalizedEmail, verifyToken);

  return { userId: user.id, email: normalizedEmail };
}

// ── Email Verification ────────────────────────────────────────────────────────

export async function verifyEmail(token: string) {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const record = await getEmailAuthByVerifyToken(token);
  if (!record) throw new Error("INVALID_TOKEN");

  if (record.verifiedAt) {
    return { userId: record.userId, alreadyVerified: true };
  }

  if (record.verifyTokenExpiresAt && record.verifyTokenExpiresAt < new Date()) {
    throw new Error("TOKEN_EXPIRED");
  }

  await db
    .update(emailAuth)
    .set({ verifiedAt: new Date(), verifyToken: null, verifyTokenExpiresAt: null })
    .where(eq(emailAuth.id, record.id));

  return { userId: record.userId, alreadyVerified: false };
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function loginWithEmail(email: string, password: string) {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const normalizedEmail = email.toLowerCase().trim();
  const record = await getEmailAuthByEmail(normalizedEmail);
  if (!record) throw new Error("INVALID_CREDENTIALS");

  if (!record.verifiedAt) throw new Error("EMAIL_NOT_VERIFIED");

  const valid = await bcrypt.compare(password, record.passwordHash);
  if (!valid) throw new Error("INVALID_CREDENTIALS");

  await db
    .update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.id, record.userId));

  const userRows = await db.select().from(users).where(eq(users.id, record.userId));
  return userRows[0] ?? null;
}

// ── Resend Verification Email ─────────────────────────────────────────────────

export async function resendVerificationEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const normalizedEmail = email.toLowerCase().trim();
  const record = await getEmailAuthByEmail(normalizedEmail);
  if (!record) throw new Error("EMAIL_NOT_FOUND");
  if (record.verifiedAt) throw new Error("ALREADY_VERIFIED");

  const verifyToken = generateToken();
  const verifyTokenExpiresAt = tokenExpiresAt(24);

  await db
    .update(emailAuth)
    .set({ verifyToken, verifyTokenExpiresAt })
    .where(eq(emailAuth.id, record.id));

  await sendVerificationEmail(normalizedEmail, verifyToken);
}

// ── Email Templates ───────────────────────────────────────────────────────────

async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${APP_DOMAIN}/api/verify-email?token=${token}`;
  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "【就活パス】メールアドレスの確認",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fff; padding: 40px 20px; margin: 0;">
  <div style="max-width: 480px; margin: 0 auto; background: #111; border-radius: 16px; padding: 40px; border: 1px solid #222;">
    <div style="text-align: center; margin-bottom: 32px;">
      <span style="font-size: 32px;">⚡</span>
      <h1 style="color: #2563eb; font-size: 24px; margin: 8px 0 0;">就活パス</h1>
    </div>
    <h2 style="font-size: 18px; margin-bottom: 16px;">メールアドレスの確認</h2>
    <p style="color: #aaa; line-height: 1.6; margin-bottom: 24px;">
      ご登録ありがとうございます。以下のボタンをクリックして、メールアドレスを確認してください。<br>
      （このリンクは24時間有効です）
    </p>
    <div style="text-align: center; margin-bottom: 32px;">
      <a href="${verifyUrl}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        メールアドレスを確認する
      </a>
    </div>
    <p style="color: #555; font-size: 12px; text-align: center;">
      このメールに心当たりがない場合は無視してください。
    </p>
  </div>
</body>
</html>`,
  });
}
