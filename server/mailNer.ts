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
import { limitMailBody, limitText, MAX_MAIL_TEXT_CHARS } from "./_core/mailText";
import {
  FREE_MAIL_DOMAINS,
  NOISE_PLATFORM_DOMAINS,
  RECRUITING_PLATFORM_DOMAINS,
  PLATFORM_DOMAINS,
  isDomainMatch,
  extractDomain,
} from "./_core/mailDomains";
import { NEGATIVE_SIGNALS } from "./_core/mailKeywords";

// ─── ORG (Company Name) Extraction ───────────────────────────────────────────

export interface OrgCandidate {
  name: string;
  source: string;
  confidence: number;
}

const NON_COMPANY_PATTERNS =
  /^(noreply|no-reply|support|info|notification|system|admin|mailer-daemon|postmaster|alert|newsletter|magazine|do-not-reply|donotreply|bounce|webmaster|mail|me|cs|job|job-s27|reply|zoom)$/i;

const AD_TITLE_PATTERNS =
  /^(外国人留学生必見|.{0,20}の知識を活かせます|.{0,20}向け|.{0,20}卒|1次|2次|3次|一次|二次|三次|四次|最終|面接|選考|説明会|セミナー|エントリー|案内|結果|通知|お知らせ|重要|緊急|締切|ご連絡|ご案内|就活|速報|オファー|スカウト|メッセージ|おすすめ|ピックアップ|特集|キャンペーン|ランキング|本人確認|会員登録|利用規約|退会フォーム|履歴書送付|資料提出|日程調整|書類選考|適性検査)$/i;

const HR_SUFFIXES = /(採用担当|採用チーム|人事部|人事課|リクルート|Recruiting|recruit|HR|人材|キャリア|新卒採用|中途採用|採用事務局|運営事務局|事務局|マイページ|team|Team|採用|新卒)$/i;

const PLATFORM_NAME_HINTS =
  /(syukatsu-kaigi|syukatsukaigi|就活会議|openwork|vorkers|onecareer|one-career|offerbox|goodfind|rikunabi|リクナビ|マイナビ|mynavi|ビズリーチ|bizreach|doda|wantedly|green|キャリタス|iroots|マスナビ|あさがくナビ|グローバル人材紹介|人材紹介)/i;

const NON_TARGET_ORG_HINTS =
  /(careercenter|career\s*center|キャリアセンター|キャリア支援|就職支援|大学キャリア|大学|短大|専門学校|学校法人|学生課|留学生センター)/i;

const LEGAL_ENTITY_PREFIX = /(?:株式会社|合同会社|有限会社|一般社団法人|一般財団法人)/;

const ORG_DATE_LIKE =
  /(?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}[\/\-]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}月|\d{1,2}日|\d{1,2}時|\d{1,2}:\d{2})/;
const ORG_DEADLINE_HINT = /(〆切|締切|締め切り|期限|応募締切|申込期限)/;
const ORG_TRAILING_PERSON_TOKEN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,4}$/u;

function isDateLikeOrgName(name: string): boolean {
  const s = name.replace(/[\s　]+/g, "");
  if (!s) return true;
  if (LEGAL_ENTITY_PREFIX.test(s)) return false;
  if (ORG_DEADLINE_HINT.test(s)) return true;
  if (/^\d/.test(s) && ORG_DATE_LIKE.test(s)) return true;
  if (ORG_DATE_LIKE.test(s) && /(開催|日時)/.test(s)) return true;
  return false;
}

export function extractOrgCandidates(subject: string, from: string, body: string, fromDomainTier?: DomainTier, recipientNames: string[] = []): OrgCandidate[] {
  body = limitMailBody(body).text;
  const candidates: OrgCandidate[] = [];
  const displayName = from.split("<")[0]?.trim() ?? "";

  const addCandidate = (raw: string, source: string, conf: number) => {
    let c = raw.replace(/（株）|\(株\)/g, "株式会社").replace(HR_SUFFIXES, "").trim();
    c = c.replace(/御中|様$/, "").replace(/\)$/, "").trim();

    // Dynamically filter out extracted recipient names
    if (recipientNames.length > 0 && recipientNames.some(n => c === n || (c.includes(n) && c.length - n.length <= 4))) {
       return;
    }

    if (LEGAL_ENTITY_PREFIX.test(c) && /\s/.test(c)) {
      const parts = c.split(/\s+/);
      const last = parts[parts.length - 1] ?? "";
      if (ORG_TRAILING_PERSON_TOKEN.test(last)) {
        parts.pop();
        c = parts.join(" ").trim();
      }
    }
    if (
      c.length >= 2 &&
      !isDateLikeOrgName(c) &&
      !NON_COMPANY_PATTERNS.test(c) &&
      !PLATFORM_NAME_HINTS.test(c) &&
      !/^(新卒|中途|採用|人事)$/.test(c) &&
      !/^(株式会社|合同会社|有限会社|一般社団法人|一般財団法人)\s*(新卒|中途|採用|人事)?$/.test(c)
    ) {
      const valid = isValidExtractedCompany(c);
      if (valid) {
        candidates.push({ name: valid, source, confidence: conf });
      }
    }
  };

  // Helper to extract Maekabu and Atokabu legal entities
  const extractLegal = (text: string, sourcePrefix: string, baseConf: number) => {
    if (!text) return;
    const reMaekabu = new RegExp(`(?:^|[\\s【】\\[\\]<>「」/／\\n"'(（:：])(${LEGAL_ENTITY_PREFIX.source}\\s*[^\\s【】\\[\\]<>「」/／\\n"'(（)）]+)`, "g");
    for (const m of Array.from(text.matchAll(reMaekabu))) {
      addCandidate(m[1], `${sourcePrefix}_maekabu`, baseConf);
    }
    const reAtokabu = new RegExp(`([^\\s【】\\[\\]<>「」/／\\n"'(（:：)）]+)\\s*(?:${LEGAL_ENTITY_PREFIX.source})(?=$|[\\s【】\\[\\]<>「」/／\\n"')）:：])`, "g");
    for (const m of Array.from(text.matchAll(reAtokabu))) {
      const fullMatch = m[0];
      const prefixMatch = text.substring(0, m.index).match(/([a-zA-Z0-9\s.-]+)$/);
      if (prefixMatch) {
         addCandidate(prefixMatch[1] + fullMatch, `${sourcePrefix}_atokabu`, baseConf - 0.01);
      } else {
         addCandidate(fullMatch, `${sourcePrefix}_atokabu`, baseConf - 0.01);
      }
    }
  };

  // Strategy 1: Explicit match in sender name
  if (fromDomainTier !== "recruiting_platform" && fromDomainTier !== "noise_platform") {
    extractLegal(displayName, "sender_explicit", 0.95);
  }

  // Strategy 1 & 2: Legal entity in subject
  extractLegal(subject, "legal_subject", 0.95);

  // Strategy 3: Legal entity in sender display name
  const combinedFromSubject = `${displayName}\n${subject}`;
  extractLegal(combinedFromSubject, "legal_from", 0.93);

  // Strategy 4: Display name with HR suffix → strip suffix to get company
  const fromHr = displayName.match(/^(.{2,30}?)\s*(?:採用|人事|HR|recruit|Recruit|キャリア|新卒|リクルート)/i);
  if (fromHr?.[1]) {
    candidates.push({ name: fromHr[1], source: "display_hr", confidence: 0.85 });
  }

  // Strategy 4.5: "XXXからメッセージが届きました" pattern in platform subject
  if (fromDomainTier === "recruiting_platform") {
    const msgMatch = subject.match(/(?:メッセージが届きました|新着メッセージ).*?\((.+)\)/i);
    if (msgMatch?.[1] && msgMatch[1].length <= 50) {
      // Split by " など" or "】" if they clutter the name
      let cleanMsg = msgMatch[1].replace(/株式会社|（株）|\(株\)/g, "株式会社").replace(HR_SUFFIXES, "").trim();
      cleanMsg = cleanMsg.split(/[\s　]+など/)[0].trim();
      cleanMsg = cleanMsg.replace(/【[^】]+】/g, "").trim();
      if (cleanMsg) candidates.push({ name: cleanMsg, source: "platform_subject", confidence: 0.85 });
    }
  }

  // Strategy 4.6: "XXX / YYY" pattern in subject
  const splitMatch = subject.split(/[\/／]/);
  if (splitMatch.length > 1) {
    const lastPart = splitMatch[splitMatch.length - 1].trim();
    if (lastPart.length >= 2 && lastPart.length <= 30 && !NON_COMPANY_PATTERNS.test(lastPart)) {
      // Avoid cases where the last part is a person's name or generic text
      if (!/様$/.test(lastPart) && !PLATFORM_NAME_HINTS.test(lastPart)) {
        const cleanSplit = lastPart.replace(/株式会社|（株）|\(株\)/g, "株式会社").replace(HR_SUFFIXES, "").trim();
        // Slightly lower confidence as it could be just a department or generic text
        if (cleanSplit) candidates.push({ name: cleanSplit, source: "subject_split", confidence: 0.65 });
      }
    }
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
      const leadClean = subjectLead[1].trim();
      if (
        !AD_TITLE_PATTERNS.test(leadClean) &&
        !/^(一次|二次|三次|四次|最終|書類|適性)$/.test(leadClean) &&
        !/(web合同|合同企業|合同説明会)/i.test(leadClean)
      ) {
        candidates.push({ name: leadClean, source: "subject_lead", confidence: 0.75 });
      }
    }

  // Strategy 6.5: Fallback pattern matching in body
  const fallbackMatches = Array.from(body.matchAll(/(?:株式会社|合同会社|有限会社|一般社団法人|一般財団法人)\s*([^\s【】\\[\\]<>「」\n]{2,20})/g));
  for (const m of fallbackMatches) {
    const clean = m[1].replace(HR_SUFFIXES, "").replace(/御中|様$/, "").trim();
    if (clean.length >= 2 && !NON_COMPANY_PATTERNS.test(clean) && !PLATFORM_NAME_HINTS.test(clean) && !/^(新卒|中途)$/.test(clean)) {
      candidates.push({ name: `株式会社 ${clean}`, source: "body_fallback", confidence: 0.5 });
    }
  }

  // Strategies 7-9 are suppressed when the sender is a recruiting/noise platform,
  // because body text and domain SLD would reference promoted companies, not the sender.
  const isFromPlatform =
    fromDomainTier === "recruiting_platform" || fromDomainTier === "noise_platform";

  // Strategy 7: Legal entity in body (prefix, lower confidence)
  if (!isFromPlatform) {
    const bodyPrefix = body.slice(0, 2500);
    extractLegal(bodyPrefix, "body_legal", 0.70);
  }

    // Strategy 8: Clean display name as fallback (skip if it looks like an email)
  if (displayName && displayName.length >= 2 && displayName.length <= 40 && !/@/.test(displayName)) {
    // If it's a free mail domain, the display name is highly likely to be a person's name (e.g. a student forwarding an email)
    // unless it explicitly contains legal entity keywords.
    if (fromDomainTier === "free_mail" && !LEGAL_ENTITY_PREFIX.test(displayName)) {
      // skip
    } else {
      let cleaned = displayName.replace(/^["'“”]+|["'“”]+$/g, "").trim()
        .replace(HR_SUFFIXES, "")
        .replace(/\)$/, "") // fix trailing parenthesis often caught from platform subject templates
        .replace(/\s*\([^)]*$/, "") // fix unclosed parenthesis e.g. "ROUTE INN GROUP ( ROUTE INN HOTELS"
        .replace(/株式会社|合同会社|有限会社|一般社団法人|一般財団法人|（株）|\(株\)/g, "")
        .trim();
      if (cleaned.length >= 2 && !NON_COMPANY_PATTERNS.test(cleaned)) {
        candidates.push({ name: cleaned, source: "display_clean", confidence: 0.55 });
      }
    }
  }

  // Strategy 9: Email domain SLD (lowest confidence) — also suppressed for platforms
  if (!isFromPlatform) {
    const fullDomain = extractDomain(from);
    if (fullDomain) {
      if (!isDomainMatch(fullDomain, FREE_MAIL_DOMAINS) && !isDomainMatch(fullDomain, PLATFORM_DOMAINS)) {
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
  if (isDateLikeOrgName(c)) return null;
  if (NON_TARGET_ORG_HINTS.test(c)) return null;
  if (PLATFORM_NAME_HINTS.test(c)) return null;
  if (NON_COMPANY_PATTERNS.test(c)) return null;
  if (AD_TITLE_PATTERNS.test(c)) return null;
  if (c.length < 2) return null;
  return c;
}

export function isValidExtractedCompany(name: string | null | undefined, recipientNames: string[] = []): string | null {
  if (!name) return null;
  let c = name.replace(/^(【|「|\[|\(|"|')(.+?)(】|」|\]|\)|"|')$/, "$2").trim();
  c = c.replace(/\)$/, "").replace(/）$/, "").trim(); // fix trailing parenthesis
  
  // Reject obvious sentences or long descriptive texts
  if (c.length > 40) return null;
  if (NON_TARGET_ORG_HINTS.test(c)) return null;
  if (/[!！?？。、]/.test(c)) return null;
  if (/^fwd?:/i.test(c)) return null;
  if (/^[-_=+*]{3,}/.test(c)) return null;
  if (/^[一-龥]{1,3}[\s　]+[一-龥]{1,3}$/.test(c)) return null;
  if (AD_TITLE_PATTERNS.test(c)) return null;
  if (NON_COMPANY_PATTERNS.test(c)) return null;
  
  // Dynamically reject if it's likely the recipient's name
  if (recipientNames.length > 0 && recipientNames.some(n => c === n || (c.includes(n) && c.length - n.length <= 4))) {
    return null;
  }

  return normalizeOrgName(c);
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
  recipientNames: string[] = []
): { name: string | null; confidence: number } {
  body = limitMailBody(body).text;
  // Extract candidates using multi-strategy approach
  const candidates = extractOrgCandidates(subject, from, body, fromDomainTier, recipientNames);
  const normalized = candidates
    .map((c) => ({ ...c, name: isValidExtractedCompany(c.name, recipientNames) ?? "" }))
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

  if (best.name && (body.includes(`${best.name}様`) || body.includes(`${best.name} 様`))) {
    return { name: null, confidence: 0 };
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
  { re: /(?<![\d年])(\d{1,2})月(\d{1,2})日/g, hasYear: false, confidence: 0.75 },
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
  text = limitText(text ?? "", MAX_MAIL_TEXT_CHARS).text;
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
  text = limitText(text ?? "", MAX_MAIL_TEXT_CHARS).text;
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
  text = limitText(text ?? "", MAX_MAIL_TEXT_CHARS).text;
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
  text = limitText(text ?? "", MAX_MAIL_TEXT_CHARS).text;
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

const JOB_RELATED_DOMAIN_HINTS_NER = [
  "recruit", "career", "saiyo", "hr", "job", "talent",
  "mypage", "jinji", "saiyou", "entry",
];

export function getDomainReputation(from: string): DomainReputation {
  const domain = extractDomain(from);
  if (!domain) return { tier: "unknown", score: 0.3, domain: null };

  if (isDomainMatch(domain, FREE_MAIL_DOMAINS)) return { tier: "free_mail", score: 0.15, domain };
  if (isDomainMatch(domain, NOISE_PLATFORM_DOMAINS)) return { tier: "noise_platform", score: 0.05, domain };
  if (isDomainMatch(domain, RECRUITING_PLATFORM_DOMAINS)) return { tier: "recruiting_platform", score: 0.70, domain };

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

/** Returns a penalty score ∈ [-0.8, 0]. More negative = more likely noise. */
export function calculateNegativeSignalPenalty(text: string): number {
  let penalty = 0;
  for (const s of NEGATIVE_SIGNALS) {
    if (s.pattern.test(text)) penalty += s.weight;
  }
  return Math.max(penalty, -0.8);
}
