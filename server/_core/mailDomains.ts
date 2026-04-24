/**
 * mailDomains.ts — Single source of truth for email-domain classification.
 *
 * All email-identification modules should import from here instead of
 * maintaining their own copies of these sets.
 */

export const FREE_MAIL_DOMAINS = new Set<string>([
  "gmail.com", "yahoo.co.jp", "yahoo.com", "outlook.com", "outlook.jp",
  "hotmail.com", "hotmail.co.jp", "icloud.com", "live.com", "live.jp",
  "qq.com", "163.com", "126.com", "naver.com", "me.com", "mac.com",
]);

export const NOISE_PLATFORM_DOMAINS = new Set<string>([
  "openwork.jp", "vorkers.com", "onecareer.jp", "offerbox.jp",
  "goodfind.jp", "unistyle.net", "syukatsu-kaigi.jp",
]);

export const RECRUITING_PLATFORM_DOMAINS = new Set<string>([
  "rikunabi.com", "mynavi.jp", "en-japan.com", "wantedly.com",
  "bizreach.jp", "doda.jp", "type.jp", "green-japan.com",
]);

/** Union of RECRUITING + NOISE + a few ancillary job-adjacent platforms. */
export const PLATFORM_DOMAINS = new Set<string>([
  ...RECRUITING_PLATFORM_DOMAINS,
  ...NOISE_PLATFORM_DOMAINS,
  "careerselect.jp", "paiza.jp", "atcoder.jp", "career-tasu.jp",
  "doda-student.jp", "iroots.jp", "massnavi.com", "gakujo.ne.jp",
  "talentbase.co.jp", "linkedin.com",
]);

export function isDomainMatch(domain: string, set: ReadonlySet<string>): boolean {
  if (set.has(domain)) return true;
  for (const d of set) {
    if (domain.endsWith("." + d)) return true;
  }
  return false;
}

/** Extract lowercase fully qualified domain from a "Name <user@host>" / "user@host" string. */
export function extractDomain(from: string): string | null {
  const m = from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return m ? m[1].toLowerCase() : null;
}
