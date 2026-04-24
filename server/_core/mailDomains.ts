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

/**
 * Domains that are structurally NOT recruiting — consumer services,
 * e-commerce, ticketing, transport, utilities, govt, generic newsletters.
 * Matched via {@link isDomainMatch} so subdomains are covered.
 *
 * Keep entries specific enough that we don't accidentally block a real
 * recruiting subdomain (e.g. use `mail-unyu.hankyu.co.jp`, not `hankyu.co.jp`).
 */
export const NON_RECRUITING_DOMAINS = new Set<string>([
  // E-commerce / lifestyle
  "chocozap.jp", "info.chocozap.jp",
  "grailnet.jp",
  "oliveyoung.com",
  "paypay-card.co.jp", "mail.paypay-card.co.jp",
  "abceed.com",
  // Ticketing / events / music
  "eplus.co.jp",
  "livepocket.jp",
  "l-tike.com",
  "pia.co.jp",
  // Transport / travel / reservations
  "highwaybus.com",
  "expy.jp",
  "mail-unyu.hankyu.co.jp",
  "hotpepper.jp",
  // Delivery / post / govt / utilities / real estate
  "sagawa-exp.co.jp",
  "delivery.post.japanpost.jp", "post.japanpost.jp",
  "mail.net.kojinbango-card.go.jp", "kojinbango-card.go.jp",
  "tokyo.suidoapp.jp", "suidoapp.jp",
  "ens-immi.moj.go.jp",
  "e4.kepco.co.jp", "a3.kepco.co.jp",
  "heureux-c.com",
  // Publishing / newsletters unrelated to recruiting
  "theletter.jp",
  "news.statista.com",
  "shukatsu.jp",
  "chuoshoten.co.jp",
  "uc-navi.jp",           // 大学生協 seminar/travel reservations
  "unistyleinc.com",      // unistyle newsletter (distinct from unistyle.net platform)
  // University student-mailing subdomains (forwarded to self)
  "st.ritsumei.ac.jp", "fc.ritsumei.ac.jp",
]);

export const RECRUITING_PLATFORM_DOMAINS = new Set<string>([
  "rikunabi.com", "mynavi.jp", "en-japan.com", "wantedly.com",
  "bizreach.jp", "doda.jp", "type.jp", "green-japan.com",
  "career-tasu.jp", "doda-student.jp", "iroots.jp", "massnavi.com",
  "gakujo.ne.jp", "talentbase.co.jp", "paiza.jp", "i-plug.co.jp",
]);

/**
 * Shared ATS relay domains that send emails on behalf of various companies.
 */
export const ATS_DOMAINS = new Set<string>([
  "saiyo.jp", "mail.axol.jp", "s.axol.jp", "snar.jp", "hito-link.jp",
  "e2r.jp", "mypage-info.com", "miws.mynavi.jp", "recruit-mg.com",
  "n-ats.hrmos.co", "disc.co.jp", "m.kobot.cloud", "rpms.jp",
]);

/** Union of RECRUITING + NOISE + a few ancillary job-adjacent platforms. */
export const PLATFORM_DOMAINS = new Set<string>([
  ...RECRUITING_PLATFORM_DOMAINS,
  ...NOISE_PLATFORM_DOMAINS,
  ...ATS_DOMAINS,
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
