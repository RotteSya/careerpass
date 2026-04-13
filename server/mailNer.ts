/**
 * mailNer.ts — Named Entity Recognition pipeline for Japanese recruiting emails
 *
 * Inspired by JobFight's NER architecture: scan text token-by-token and extract
 * structured entities (ORG, TIME, LOC) with confidence scoring.
 *
 * Entities extracted:
 *   - ORG  : company name (multi-strategy + voting)
 *   - TIME : event date/time (context-aware, multiple candidates)
 *   - LOC  : location / venue / online meeting info
 *   - ROUND: interview round (1st/2nd/3rd/final)
 */

import {
  normalizeCompanyDisplayName,
  normalizeCompanyKey,
  preferCompanyDisplayName,
  resolveCanonicalCompanyName,
} from "./companyName";

// ─── ORG (Company Name) Extraction ───────────────────────────────────────────

export interface OrgCandidate {
  name: string;
  source: string;
  confidence: number;
}

const PLATFORM_DOMAINS = new Set([
  "rikunabi.com", "mynavi.jp", "en-japan.com", "wantedly.com",
  "bizreach.jp", "doda.jp", "type.jp", "green-japan.com",
  "openwork.jp", "vorkers.com", "onecareer.jp", "offerbox.jp",
  "goodfind.jp", "unistyle.net", "syukatsu-kaigi.jp",
  "careerselect.jp", "paiza.jp", "atcoder.jp", "career-tasu.jp",
  "doda-student.jp", "iroots.jp", "massnavi.com", "gakujo.ne.jp",
  "talentbase.co.jp", "linkedin.com"
]);

const FREE_MAIL_DOMAINS_NER = new Set([
  "gmail.com", "yahoo.co.jp", "yahoo.com", "outlook.com", "outlook.jp",
  "hotmail.com", "hotmail.co.jp", "icloud.com", "live.com", "live.jp",
  "qq.com", "163.com", "126.com", "naver.com", "me.com", "mac.com"
]);

const NON_COMPANY_PATTERNS =
  /(noreply|no-reply|support|info|notification|system|admin|mailer-daemon|postmaster|alert|newsletter|magazine|do-not-reply|donotreply|bounce|webmaster)/i;

const HR_SUFFIXES =
  /(採用担当|採用チーム|人事部|人事課|リクルート|Recruiting|recruit|HR|人材|キャリア|新卒採用|中途採用|採用事務局|運営事務局|事務局|マイページ|team|Team|採用)$/i;

const PLATFORM_NAME_HINTS =
  /(syukatsu-kaigi|syukatsukaigi|就活会議|openwork|vorkers|onecareer|one-career|offerbox|goodfind|rikunabi|リクナビ|マイナビ|mynavi|ビズリーチ|bizreach|doda|wantedly|green|キャリタス|iroots|マスナビ|あさがくナビ)/i;

const LEGAL_ENTITY_PREFIX = /(?:株式会社|合同会社|有限会社|一般社団法人|一般財団法人)/;

function extractOrgCandidates(subject: string, from: string, body: string, fromDomainTier?: DomainTier): OrgCandidate[] {
  const candidates: OrgCandidate[] = [];
  const displayName = from.split("<")[0]?.trim() ?? "";

  // Strategy 1: Legal entity in subject (highest confidence)
  const reSubjectLegal = new RegExp(
    `(${LEGAL_ENTITY_PREFIX.source}\\s*[^\\s【】\\[\\]<>「」]{1,40})`, "g"
  );
  for (const m of Array.from(subject.matchAll(reSubjectLegal))) {
    candidates.push({ name: m[1], source: "legal_subject", confidence: 0.95 });
  }

  // Strategy 2: Inverted legal entity in subject (サンプル株式会社)
  const reInvertedSubject = new RegExp(
    `([^\\s【】\\[\\]<>「」]{2,20})\\s*(?:${LEGAL_ENTITY_PREFIX.source})`, "g"
  );
  for (const m of Array.from(subject.matchAll(reInvertedSubject))) {
    candidates.push({ name: m[0], source: "legal_subject_inv", confidence: 0.94 });
  }

  // Strategy 3: Legal entity in sender display name
  const combinedFromSubject = `${displayName}\n${subject}`;
  const reFromLegal = new RegExp(
    `(${LEGAL_ENTITY_PREFIX.source}\\s*[^\\n【】\\[\\]<>「」]{1,40})`
  );
  const fromLegal = combinedFromSubject.match(reFromLegal);
  if (fromLegal?.[1] && !subject.includes(fromLegal[1])) {
    candidates.push({ name: fromLegal[1], source: "legal_from", confidence: 0.93 });
  }

  // Strategy 4: Display name with HR suffix → strip suffix to get company
  const fromHr = displayName.match(/^(.{2,30}?)\s*(?:採用|人事|HR|recruit|Recruit|キャリア|新卒|リクルート)/i);
  if (fromHr?.[1]) {
    candidates.push({ name: fromHr[1], source: "display_hr", confidence: 0.85 });
  }

  // Strategy 5: Bracket patterns in subject 【Company】
  for (const m of Array.from(subject.matchAll(/(?:【|「|\[)([^】」\]]{2,30})(?:】|」|\])/g))) {
    if (m[1] && !/(面接|説明会|選考|結果|内定|不採用|エントリー|日程|案内|お知らせ|通知|重要|緊急|締切|ご連絡|ご案内)/.test(m[1])) {
      candidates.push({ name: m[1], source: "bracket_subject", confidence: 0.80 });
    }
  }

  // Strategy 6: Subject lead pattern — "CompanyName 面接のご案内"
  const subjectLead = subject.match(
    /^(?:【[^】]*】\s*)?([^\s【】\[\]「」]{2,24})\s*(?:の|より|から)?\s*(?:採用|選考|面接|説明会|エントリー|内定|Webテスト)/
  );
  if (subjectLead?.[1]) {
    candidates.push({ name: subjectLead[1], source: "subject_lead", confidence: 0.75 });
  }

  // Strategies 7-9 are suppressed when the sender is a recruiting/noise platform,
  // because body text and domain SLD would reference promoted companies, not the sender.
  const isFromPlatform =
    fromDomainTier === "recruiting_platform" || fromDomainTier === "noise_platform";

  // Strategy 7: Legal entity in body (first 500 chars, lower confidence)
  if (!isFromPlatform) {
    const bodyPrefix = body.slice(0, 500);
    const reBodyLegal = new RegExp(
      `(${LEGAL_ENTITY_PREFIX.source}\\s*[^\\s【】\\[\\]<>「」\\n]{1,40})`
    );
    const bodyLegal = bodyPrefix.match(reBodyLegal);
    if (bodyLegal?.[1]) {
      candidates.push({ name: bodyLegal[1], source: "body_legal", confidence: 0.70 });
    }
  }

  // Strategy 8: Clean display name as fallback (skip if it looks like an email)
  if (displayName && displayName.length >= 2 && displayName.length <= 40 && !/@/.test(displayName)) {
    const cleaned = displayName.replace(HR_SUFFIXES, "").trim();
    if (cleaned.length >= 2 && !NON_COMPANY_PATTERNS.test(cleaned)) {
      candidates.push({ name: cleaned, source: "display_clean", confidence: 0.55 });
    }
  }

  // Strategy 9: Email domain SLD (lowest confidence) — also suppressed for platforms
  if (!isFromPlatform) {
    const domainMatch = from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (domainMatch?.[1]) {
      const fullDomain = domainMatch[1].toLowerCase();
      if (!FREE_MAIL_DOMAINS_NER.has(fullDomain) && !PLATFORM_DOMAINS.has(fullDomain)) {
        const sld = fullDomain.split(".")[0];
        if (sld && sld.length >= 2 && !NON_COMPANY_PATTERNS.test(sld)) {
          candidates.push({ name: sld, source: "domain_sld", confidence: 0.40 });
        }
      }
    }
  }

  return candidates;
}

function normalizeOrgName(raw: string): string | null {
  const c = normalizeCompanyDisplayName(raw);
  if (!c) return null;
  if (PLATFORM_NAME_HINTS.test(c)) return null;
  if (NON_COMPANY_PATTERNS.test(c)) return null;
  return c;
}

/**
 * Multi-strategy company name extraction with voting.
 * Multiple sources agreeing on the same name boosts confidence.
 */
export function extractBestCompanyName(
  subject: string,
  from: string,
  body: string,
  fromDomainTier?: DomainTier,
): { name: string | null; confidence: number } {
  const candidates = extractOrgCandidates(subject, from, body, fromDomainTier);
  const normalized = candidates
    .map((c) => ({ ...c, name: normalizeOrgName(c.name) ?? "" }))
    .filter((c) => c.name.length >= 2);

  if (normalized.length === 0) return { name: null, confidence: 0 };

  // Group by normalized key and aggregate
  const groups = new Map<
    string,
    { name: string; maxConfidence: number; sources: string[] }
  >();
  for (const c of normalized) {
    const key = normalizeCompanyKey(c.name) ?? c.name.toLowerCase().replace(/[\s　]+/g, "");
    const g = groups.get(key);
    if (g) {
      g.maxConfidence = Math.max(g.maxConfidence, c.confidence);
      g.sources.push(c.source);
      g.name = preferCompanyDisplayName(g.name, c.name);
    } else {
      groups.set(key, { name: c.name, maxConfidence: c.confidence, sources: [c.source] });
    }
  }

  let best = { name: "", confidence: 0 };
  for (const g of Array.from(groups.values())) {
    // Multi-source agreement bonus: +0.05 per extra source, max +0.15
    const sourceBonus = Math.min(g.sources.length - 1, 3) * 0.05;
    const score = Math.min(g.maxConfidence + sourceBonus, 1);
    if (score > best.confidence) {
      best = { name: resolveCanonicalCompanyName(g.name) ?? g.name, confidence: score };
    }
  }

  return best;
}

// ─── TIME (Date/Time) Extraction ─────────────────────────────────────────────

export interface TimeCandidate {
  date: string;       // YYYY-MM-DD
  time: string | null; // HH:MM
  endTime: string | null;
  confidence: number;
  context: string;
}

const NER_DATE_PATTERNS: Array<{ re: RegExp; hasYear: boolean; confidence: number }> = [
  { re: /(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*\([^)]+\))?/g, hasYear: true, confidence: 0.95 },
  { re: /(\d{4})\/(\d{1,2})\/(\d{1,2})/g, hasYear: true, confidence: 0.90 },
  { re: /(\d{4})-(\d{1,2})-(\d{1,2})/g, hasYear: true, confidence: 0.90 },
  { re: /(?<!\d)(\d{1,2})月(\d{1,2})日/g, hasYear: false, confidence: 0.75 },
];

const NER_RELATIVE_DATE_PATTERNS: Array<{ re: RegExp; offsetDays: number; confidence: number }> = [
  { re: /本日|今日/g, offsetDays: 0, confidence: 0.85 },
  { re: /明日|あす|あした/g, offsetDays: 1, confidence: 0.85 },
  { re: /明後日|あさって/g, offsetDays: 2, confidence: 0.85 },
];

const NER_TIME_PATTERNS: Array<{ re: RegExp; hasEnd: boolean }> = [
  { re: /(\d{1,2})[:：](\d{2})\s*[~〜\-－]\s*(\d{1,2})[:：](\d{2})/, hasEnd: true },
  { re: /(\d{1,2})時(\d{2})分?\s*[~〜\-－]\s*(\d{1,2})時(\d{2})分?/, hasEnd: true },
  { re: /(\d{1,2})[:：](\d{2})(?!\s*[~〜\-－])/, hasEnd: false },
  { re: /(\d{1,2})時(\d{2})?分?(?!\s*[~〜\-－])/, hasEnd: false },
];

const EVENT_DATE_CONTEXT =
  /(面接|面談|説明会|セミナー|テスト|試験|締切|期限|日時|開始|集合|開催|実施|予約|interview|test|deadline)/i;

export function extractTimeCandidates(text: string): TimeCandidate[] {
  const candidates: TimeCandidate[] = [];
  const now = new Date();

  // 1. Absolute Dates
  for (const dp of NER_DATE_PATTERNS) {
    const regex = new RegExp(dp.re.source, dp.re.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      let year: number, month: number, day: number;
      if (dp.hasYear) {
        year = parseInt(m[1]);
        month = parseInt(m[2]);
        day = parseInt(m[3]);
      } else {
        month = parseInt(m[1]);
        day = parseInt(m[2]);
        year = now.getFullYear();
        const candidate = new Date(year, month - 1, day);
        if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)) {
          year += 1;
        }
      }

      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      // Look for time near the date match
      const afterDate = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
      let time: string | null = null;
      let endTime: string | null = null;

      for (const tp of NER_TIME_PATTERNS) {
        const tm = afterDate.match(tp.re);
        if (tm) {
          time = `${String(tm[1]).padStart(2, "0")}:${String(tm[2] ?? "00").padStart(2, "0")}`;
          if (tp.hasEnd && tm[3]) {
            endTime = `${String(tm[3]).padStart(2, "0")}:${String(tm[4] ?? "00").padStart(2, "0")}`;
          }
          break;
        }
      }

      // Context-based confidence boost
      const ctxStart = Math.max(0, m.index - 50);
      const ctxEnd = Math.min(text.length, m.index + m[0].length + 50);
      const contextWindow = text.slice(ctxStart, ctxEnd);
      const hasEventContext = EVENT_DATE_CONTEXT.test(contextWindow);
      const conf = Math.min(dp.confidence + (hasEventContext ? 0.05 : 0) + (time ? 0.03 : 0), 1);

      candidates.push({ date: dateStr, time, endTime, confidence: conf, context: contextWindow.trim() });
    }
  }

  // 2. Relative Dates
  for (const rdp of NER_RELATIVE_DATE_PATTERNS) {
    const regex = new RegExp(rdp.re.source, rdp.re.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + rdp.offsetDays);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const afterDate = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
      let time: string | null = null;
      let endTime: string | null = null;

      for (const tp of NER_TIME_PATTERNS) {
        const tm = afterDate.match(tp.re);
        if (tm) {
          time = `${String(tm[1]).padStart(2, "0")}:${String(tm[2] ?? "00").padStart(2, "0")}`;
          if (tp.hasEnd && tm[3]) {
            endTime = `${String(tm[3]).padStart(2, "0")}:${String(tm[4] ?? "00").padStart(2, "0")}`;
          }
          break;
        }
      }

      const ctxStart = Math.max(0, m.index - 50);
      const ctxEnd = Math.min(text.length, m.index + m[0].length + 50);
      const contextWindow = text.slice(ctxStart, ctxEnd);
      const hasEventContext = EVENT_DATE_CONTEXT.test(contextWindow);
      // Boost is lower if no time is attached, since "明日" could just mean "I will send it tomorrow"
      const conf = Math.min(rdp.confidence + (hasEventContext ? 0.05 : -0.1) + (time ? 0.05 : -0.1), 1);

      candidates.push({ date: dateStr, time, endTime, confidence: conf, context: contextWindow.trim() });
    }
  }

  // Deduplicate by date+time, keep highest confidence
  const seen = new Map<string, TimeCandidate>();
  for (const c of candidates) {
    const key = `${c.date}|${c.time ?? ""}`;
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
}

/** Pick the best future date/time from text. */
export function extractBestDateTime(text: string): {
  date: string | null;
  time: string | null;
  endTime: string | null;
} {
  const candidates = extractTimeCandidates(text);
  if (candidates.length === 0) return { date: null, time: null, endTime: null };

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const future = candidates.filter((c) => c.date >= todayStr);
  const best = future.length > 0 ? future[0] : candidates[0];

  return { date: best.date, time: best.time, endTime: best.endTime };
}

// ─── LOC (Location / Venue) Extraction ───────────────────────────────────────

const LOC_LABEL_PATTERN =
  /(?:会場|場所|アクセス|住所|開催場所|集合場所|面接場所|面接会場|venue|location)\s*[:：]\s*(.{3,80})/i;
const LOC_POSTAL_PATTERN = /〒\d{3}-?\d{4}\s*(.{5,80})/;
const LOC_ADDRESS_PATTERN = /(東京都|北海道|(?:京都|大阪)府|.{2,3}県).{2,5}(?:区|市|町|村).{2,30}/;
const LOC_ONLINE_URL_PATTERN =
  /((?:zoom|teams|google\s*meet|webex|skype)\s*(?:url|リンク|ミーティング)?)\s*[:：]?\s*(https?:\/\/\S{10,120})/i;
const LOC_RAW_URL_PATTERN = /(https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s　]+)/i;
const LOC_ONLINE_KEYWORD_PATTERN =
  /(オンライン(?:面接|面談|説明会)?|web(?:面接|面談|説明会)|リモート(?:面接|面談))/i;

export function extractLocation(text: string): string | null {
  const labelMatch = text.match(LOC_LABEL_PATTERN);
  if (labelMatch?.[1]) return labelMatch[1].split("\n")[0].trim();

  const postalMatch = text.match(LOC_POSTAL_PATTERN);
  if (postalMatch?.[1]) return postalMatch[1].split("\n")[0].trim();

  const addressMatch = text.match(LOC_ADDRESS_PATTERN);
  if (addressMatch?.[0]) return addressMatch[0].split("\n")[0].trim();

  const onlineUrl = text.match(LOC_ONLINE_URL_PATTERN);
  if (onlineUrl) return `${onlineUrl[1]} ${onlineUrl[2]}`.trim();

  const rawUrl = text.match(LOC_RAW_URL_PATTERN);
  if (rawUrl) return rawUrl[1].trim();

  const onlineKw = text.match(LOC_ONLINE_KEYWORD_PATTERN);
  if (onlineKw?.[1]) return onlineKw[1].trim();

  return null;
}

// ─── Interview Round Detection ───────────────────────────────────────────────

export type InterviewRound = "1st" | "2nd" | "3rd" | "4th" | "final" | "unknown";

export function detectInterviewRound(text: string): InterviewRound | null {
  const t = text.toLowerCase();
  if (/最終面接|最終選考|final\s*interview|last\s*interview/.test(t)) return "final";
  if (/四次面[接談]|4次面[接談]|４次面[接談]|fourth\s*interview|4th\s*interview/.test(t)) return "4th";
  if (/三次面[接談]|3次面[接談]|３次面[接談]|third\s*interview|3rd\s*interview/.test(t)) return "3rd";
  if (/二次面[接談]|2次面[接談]|２次面[接談]|second\s*interview|2nd\s*interview/.test(t)) return "2nd";
  if (/一次面[接談]|1次面[接談]|１次面[接談]|first\s*interview|1st\s*interview/.test(t)) return "1st";
  if (/最終/.test(t) && /面[接談]|選考/.test(t)) return "final";
  if (/面[接談]|interview/i.test(t)) return "unknown";
  return null;
}

// ─── Domain Reputation ───────────────────────────────────────────────────────

export type DomainTier =
  | "corporate_jp"    // *.co.jp — very likely a real company
  | "corporate"       // *.com / other TLD with non-free domain
  | "recruiting_platform" // rikunabi, mynavi, etc.
  | "noise_platform"  // openwork, 就活会議 — review / info sites
  | "free_mail"
  | "unknown";

export interface DomainReputation {
  tier: DomainTier;
  score: number;        // 0–1, higher = more likely recruiting signal
  domain: string | null;
}

const NOISE_PLATFORM_DOMAINS = new Set([
  "openwork.jp", "vorkers.com", "onecareer.jp", "offerbox.jp",
  "goodfind.jp", "unistyle.net", "syukatsu-kaigi.jp",
]);

const RECRUITING_PLATFORM_DOMAINS = new Set([
  "rikunabi.com", "mynavi.jp", "en-japan.com", "wantedly.com",
  "bizreach.jp", "doda.jp", "type.jp", "green-japan.com",
]);

const JOB_RELATED_DOMAIN_HINTS_NER = [
  "recruit", "career", "saiyo", "hr", "job", "talent",
  "mypage", "jinji", "saiyou", "entry",
];

export function getDomainReputation(from: string): DomainReputation {
  const m = from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (!m) return { tier: "unknown", score: 0.3, domain: null };
  const domain = m[1].toLowerCase();

  if (FREE_MAIL_DOMAINS_NER.has(domain)) return { tier: "free_mail", score: 0.15, domain };
  if (NOISE_PLATFORM_DOMAINS.has(domain)) return { tier: "noise_platform", score: 0.05, domain };
  if (RECRUITING_PLATFORM_DOMAINS.has(domain)) return { tier: "recruiting_platform", score: 0.70, domain };

  // *.co.jp is almost always a real Japanese company
  if (/\.co\.jp$/i.test(domain)) {
    const hasHint = JOB_RELATED_DOMAIN_HINTS_NER.some((h) => domain.includes(h));
    return { tier: "corporate_jp", score: hasHint ? 0.95 : 0.85, domain };
  }

  // Other JP organizational domains
  if (/\.(or|ac|ne|go)\.jp$/i.test(domain)) return { tier: "corporate_jp", score: 0.80, domain };

  // Generic corporate
  const hasHint = JOB_RELATED_DOMAIN_HINTS_NER.some((h) => domain.includes(h));
  return { tier: "corporate", score: hasHint ? 0.90 : 0.60, domain };
}

// ─── Negative Signal Detection ───────────────────────────────────────────────

const NEGATIVE_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /(配信停止|配信解除|unsubscribe|opt[\s-]?out|メール配信の停止|退会)/i, weight: -0.30 },
  { pattern: /(メルマガ|ニュースレター|newsletter|magazine|お役立ち情報|コラム)/i, weight: -0.25 },
  { pattern: /(キャンペーン|campaign|セール|sale|クーポン|coupon|割引)/i, weight: -0.20 },
  { pattern: /(広告|PR|sponsored|advertisement|プロモーション)/i, weight: -0.20 },
  { pattern: /(口コミ|レビュー|review|評判|ランキング|ranking|年収|給与データ)/i, weight: -0.15 },
  { pattern: /(新着求人|おすすめ求人|求人情報|job alert|recommended jobs|あなたへのおすすめ)/i, weight: -0.10 },
  { pattern: /(アンケート|アンケートのお願い|ご回答のお願い)/i, weight: -0.20 },
  { pattern: /(自動配信|自動送信|自動返信|this is an automated message)/i, weight: -0.15 },
  { pattern: /(登録完了|パスワード変更|パスワード再発行|メールアドレスの確認|セキュリティ通知|アカウント設定)/i, weight: -0.25 },
];

/** Returns a penalty score ∈ [-0.8, 0]. More negative = more likely noise. */
export function calculateNegativeSignalPenalty(text: string): number {
  let penalty = 0;
  for (const s of NEGATIVE_SIGNALS) {
    if (s.pattern.test(text)) penalty += s.weight;
  }
  return Math.max(penalty, -0.8);
}
